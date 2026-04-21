#pragma once

#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>
#include <variant>

#include <guiddef.h>
#include <nlohmann/json.hpp>

namespace vrcsm::core
{

struct Error
{
    std::string code;
    std::string message;
    int httpStatus{0};
};

inline void to_json(nlohmann::json& j, const Error& e)
{
    j = nlohmann::json{{"code", e.code}, {"message", e.message}};
    if (e.httpStatus != 0)
    {
        j["httpStatus"] = e.httpStatus;
    }
}

template <typename T>
using Result = std::variant<T, Error>;

template <typename T>
bool isOk(const Result<T>& r)
{
    return std::holds_alternative<T>(r);
}

template <typename T>
const T& value(const Result<T>& r)
{
    return std::get<T>(r);
}

template <typename T>
const Error& error(const Result<T>& r)
{
    return std::get<Error>(r);
}

std::string formatBytesHuman(std::uint64_t bytes);

std::string nowIso();

std::string isoTimestamp(std::filesystem::file_time_type t);

std::optional<std::filesystem::file_time_type> safeLastWriteTime(const std::filesystem::path& p) noexcept;

std::string toUtf8(std::wstring_view wide);

std::wstring toWide(std::string_view utf8);

std::filesystem::path utf8Path(std::string_view utf8);

bool ensureWithinBase(const std::filesystem::path& base, const std::filesystem::path& candidate);

std::optional<std::filesystem::path> tryGetKnownFolderPath(const GUID& id);

std::optional<std::filesystem::path> tryGetEnvPath(std::wstring_view key);

std::filesystem::path getExecutableDirectory();

std::filesystem::path getWritableTempDirectory();

std::filesystem::path getLocalAppDataPath();

std::filesystem::path getAppDataRoot();

// ── Credential scrubbing ────────────────────────────────────────────────
// std::string::clear() only resets size(); the capacity-worth of buffer
// (either SSO inline region or heap storage) keeps its old contents legible
// until the slot is later reused. For password / cookie material we want to
// zero the buffer before the buffer is freed, so a crash dump or DLL
// injection can't read stale credentials out of the free-list.
//
// Volatile-store loop is portable (no Windows.h required here) and the
// `volatile` qualifier prevents the optimizer from treating the writes as
// dead. Keep this as the single canonical entry point so we don't sprinkle
// multiple "secure wipe" helpers across the codebase.
inline void secureWipeBytes(volatile char* p, std::size_t n) noexcept
{
    while (n--) *p++ = 0;
}

inline void secureClearString(std::string& s) noexcept
{
    if (s.capacity() > 0)
    {
        secureWipeBytes(s.data(), s.capacity());
    }
    s.clear();
}

inline void secureClearString(std::wstring& s) noexcept
{
    if (s.capacity() > 0)
    {
        secureWipeBytes(
            reinterpret_cast<volatile char*>(s.data()),
            s.capacity() * sizeof(wchar_t));
    }
    s.clear();
}

} // namespace vrcsm::core
