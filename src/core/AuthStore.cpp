#include "../pch.h"

#include "AuthStore.h"

#include "Common.h"

#include <dpapi.h>

namespace vrcsm::core
{

namespace
{

constexpr std::string_view kEntropy = "vrcsm-session-v1";

DATA_BLOB MakeBlob(const void* data, std::size_t size)
{
    DATA_BLOB blob{};
    blob.pbData = const_cast<BYTE*>(reinterpret_cast<const BYTE*>(data));
    blob.cbData = static_cast<DWORD>(size);
    return blob;
}

std::vector<std::uint8_t> ReadFileBytes(const std::filesystem::path& path)
{
    std::ifstream in(path, std::ios::binary);
    if (!in)
    {
        return {};
    }

    in.seekg(0, std::ios::end);
    const auto size = static_cast<std::size_t>(in.tellg());
    in.seekg(0, std::ios::beg);

    std::vector<std::uint8_t> bytes(size);
    if (size > 0)
    {
        in.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(size));
    }
    return bytes;
}

bool WriteFileBytes(const std::filesystem::path& path, const std::vector<std::uint8_t>& bytes)
{
    std::error_code ec;
    std::filesystem::create_directories(path.parent_path(), ec);

    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    if (!out)
    {
        return false;
    }

    if (!bytes.empty())
    {
        out.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    }

    return static_cast<bool>(out);
}

} // namespace

AuthStore& AuthStore::Instance()
{
    static AuthStore store;
    return store;
}

bool AuthStore::Load()
{
    std::lock_guard<std::mutex> lock(m_mutex);

    m_authCookie.clear();
    m_twoFactorCookie.clear();

    const auto path = ResolveSessionPath();
    const auto encryptedBytes = ReadFileBytes(path);
    if (encryptedBytes.empty())
    {
        return false;
    }

    DATA_BLOB encrypted = MakeBlob(encryptedBytes.data(), encryptedBytes.size());
    DATA_BLOB entropy = MakeBlob(kEntropy.data(), kEntropy.size());
    DATA_BLOB decrypted{};

    // User-scope DPAPI is enough here: if Windows can no longer unwrap the
    // blob we should degrade to "logged out" rather than exploding during
    // startup, because profile moves and SID changes do happen in the wild.
    if (!CryptUnprotectData(&encrypted, nullptr, &entropy, nullptr, nullptr, 0, &decrypted))
    {
        spdlog::warn(
            "AuthStore: failed to decrypt session.dat ({}), treating as signed out",
            GetLastError());
        return false;
    }

    auto freeBlob = wil::scope_exit([&]()
    {
        if (decrypted.pbData != nullptr)
        {
            LocalFree(decrypted.pbData);
        }
    });

    try
    {
        const std::string jsonText(
            reinterpret_cast<const char*>(decrypted.pbData),
            reinterpret_cast<const char*>(decrypted.pbData) + decrypted.cbData);
        const auto doc = nlohmann::json::parse(jsonText);
        if (!doc.is_object())
        {
            spdlog::warn("AuthStore: session.dat decrypted to a non-object payload");
            return false;
        }

        if (doc.contains("auth") && doc["auth"].is_string())
        {
            m_authCookie = doc["auth"].get<std::string>();
        }
        if (doc.contains("twoFactorAuth") && doc["twoFactorAuth"].is_string())
        {
            m_twoFactorCookie = doc["twoFactorAuth"].get<std::string>();
        }

        return !m_authCookie.empty();
    }
    catch (const std::exception& ex)
    {
        spdlog::warn("AuthStore: failed to parse decrypted session.dat: {}", ex.what());
        m_authCookie.clear();
        m_twoFactorCookie.clear();
        return false;
    }
}

bool AuthStore::Save() const
{
    std::lock_guard<std::mutex> lock(m_mutex);

    const nlohmann::json doc{
        {"auth", m_authCookie},
        {"twoFactorAuth", m_twoFactorCookie},
    };
    const std::string payload = doc.dump();

    DATA_BLOB plain = MakeBlob(payload.data(), payload.size());
    DATA_BLOB entropy = MakeBlob(kEntropy.data(), kEntropy.size());
    DATA_BLOB encrypted{};

    // The file on disk is opaque binary, but the payload inside is still
    // plain JSON so future schema bumps stay easy to evolve without a
    // bespoke binary format.
    if (!CryptProtectData(&plain, L"VRCSM session", &entropy, nullptr, nullptr, 0, &encrypted))
    {
        spdlog::warn("AuthStore: failed to encrypt session.dat ({})", GetLastError());
        return false;
    }

    auto freeBlob = wil::scope_exit([&]()
    {
        if (encrypted.pbData != nullptr)
        {
            LocalFree(encrypted.pbData);
        }
    });

    std::vector<std::uint8_t> encryptedBytes(
        encrypted.pbData,
        encrypted.pbData + encrypted.cbData);
    if (!WriteFileBytes(ResolveSessionPath(), encryptedBytes))
    {
        spdlog::warn("AuthStore: failed to write {}", toUtf8(ResolveSessionPath().wstring()));
        return false;
    }

    return true;
}

void AuthStore::SetCookies(std::string auth, std::string twoFactor)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    m_authCookie = std::move(auth);
    m_twoFactorCookie = std::move(twoFactor);
}

void AuthStore::Clear()
{
    std::lock_guard<std::mutex> lock(m_mutex);

    m_authCookie.clear();
    m_twoFactorCookie.clear();

    std::error_code ec;
    std::filesystem::remove(ResolveSessionPath(), ec);
    if (ec)
    {
        spdlog::warn("AuthStore: failed to delete session.dat: {}", ec.message());
    }
}

bool AuthStore::HasSession() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return !m_authCookie.empty();
}

std::string AuthStore::AuthCookie() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_authCookie;
}

std::string AuthStore::BuildCookieHeader() const
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_authCookie.empty())
    {
        return {};
    }

    std::string header = "auth=" + m_authCookie;
    if (!m_twoFactorCookie.empty())
    {
        header += "; twoFactorAuth=" + m_twoFactorCookie;
    }
    return header;
}

std::filesystem::path AuthStore::ResolveSessionPath() const
{
    return getAppDataRoot() / L"session.dat";
}

} // namespace vrcsm::core
