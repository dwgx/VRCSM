#include "OtpMailStore.h"

#include "ImapClient.h"

#include <windows.h>
#include <dpapi.h>
#include <wil/resource.h>

#include <cstdint>
#include <fstream>
#include <vector>

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

namespace vrcsm::core
{

namespace
{

constexpr std::string_view kEntropy = "vrcsm-imap-otp-v1";

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

OtpMailStore& OtpMailStore::Instance()
{
    static OtpMailStore store;
    return store;
}

std::filesystem::path OtpMailStore::Path() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_overridePath)
    {
        return *m_overridePath;
    }
    return getAppDataRoot() / L"imap-otp.dat";
}

void OtpMailStore::SetPathForTests(std::filesystem::path path)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (path.empty())
    {
        m_overridePath.reset();
    }
    else
    {
        m_overridePath = std::move(path);
    }
}

Result<std::monostate> OtpMailStore::ValidatePublic(const ImapOtpConfig& cfg)
{
    return ValidateImapEndpoint(cfg.host, cfg.port, cfg.tls);
}

Result<ImapOtpConfig> OtpMailStore::Load()
{
    const auto path = Path();
    const auto encryptedBytes = ReadFileBytes(path);
    if (encryptedBytes.empty())
    {
        return Error{"not_found", "IMAP secret is not saved", 0};
    }

    DATA_BLOB encrypted = MakeBlob(encryptedBytes.data(), encryptedBytes.size());
    DATA_BLOB entropy = MakeBlob(kEntropy.data(), kEntropy.size());
    DATA_BLOB decrypted{};
    if (!CryptUnprotectData(&encrypted, nullptr, &entropy, nullptr, nullptr, 0, &decrypted))
    {
        spdlog::warn("OtpMailStore: failed to decrypt imap-otp.dat");
        return Error{"io_error", "failed to decrypt IMAP secret", 0};
    }
    auto freeBlob = wil::scope_exit([&]() {
        if (decrypted.pbData != nullptr)
        {
            LocalFree(decrypted.pbData);
        }
    });

    std::string jsonText(
        reinterpret_cast<const char*>(decrypted.pbData),
        reinterpret_cast<const char*>(decrypted.pbData) + decrypted.cbData);
    auto wipeJson = wil::scope_exit([&]() { secureClearString(jsonText); });

    try
    {
        const auto doc = nlohmann::json::parse(jsonText);
        ImapOtpConfig cfg;
        cfg.host = doc.value("host", "");
        cfg.port = doc.value("port", 993);
        cfg.tls = doc.value("tls", "imaps");
        cfg.username = doc.value("username", "");
        cfg.password = doc.value("password", "");
        cfg.markSeen = doc.value("markSeen", false);
        if (doc.contains("fromAllow") && doc["fromAllow"].is_array())
        {
            cfg.fromAllow.clear();
            for (const auto& item : doc["fromAllow"])
            {
                if (item.is_string())
                {
                    cfg.fromAllow.push_back(item.get<std::string>());
                }
            }
        }
        return cfg;
    }
    catch (const std::exception&)
    {
        spdlog::warn("OtpMailStore: imap-otp.dat payload was not valid JSON");
        return Error{"io_error", "IMAP secret payload is corrupt", 0};
    }
}

Result<std::monostate> OtpMailStore::Save(const ImapOtpConfig& cfg)
{
    auto validated = ValidatePublic(cfg);
    if (!isOk(validated))
    {
        return error(validated);
    }
    if (cfg.username.empty() || cfg.password.empty())
    {
        return Error{"invalid_params", "IMAP username and password are required", 0};
    }

    nlohmann::json doc{
        {"host", cfg.host},
        {"port", cfg.port},
        {"tls", cfg.tls},
        {"username", cfg.username},
        {"password", cfg.password},
        {"fromAllow", cfg.fromAllow},
        {"markSeen", cfg.markSeen},
    };
    std::string payload = doc.dump();
    auto wipePayload = wil::scope_exit([&]() { secureClearString(payload); });

    DATA_BLOB plain = MakeBlob(payload.data(), payload.size());
    DATA_BLOB entropy = MakeBlob(kEntropy.data(), kEntropy.size());
    DATA_BLOB encrypted{};
    if (!CryptProtectData(&plain, L"VRCSM IMAP OTP", &entropy, nullptr, nullptr, 0, &encrypted))
    {
        spdlog::warn("OtpMailStore: CryptProtectData failed");
        return Error{"io_error", "failed to encrypt IMAP secret", 0};
    }
    auto freeBlob = wil::scope_exit([&]() {
        if (encrypted.pbData != nullptr)
        {
            LocalFree(encrypted.pbData);
        }
    });

    std::vector<std::uint8_t> bytes(encrypted.pbData, encrypted.pbData + encrypted.cbData);
    if (!WriteFileBytes(Path(), bytes))
    {
        return Error{"io_error", "failed to write imap-otp.dat", 0};
    }
    return std::monostate{};
}

Result<std::monostate> OtpMailStore::Clear()
{
    std::error_code ec;
    std::filesystem::remove(Path(), ec);
    if (ec)
    {
        return Error{"io_error", "failed to delete imap-otp.dat", 0};
    }
    return std::monostate{};
}

bool OtpMailStore::Exists() const
{
    std::error_code ec;
    return std::filesystem::exists(Path(), ec);
}

} // namespace vrcsm::core
