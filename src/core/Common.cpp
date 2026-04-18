#include "Common.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <ctime>
#include <system_error>

#include <Windows.h>
#include <KnownFolders.h>
#include <ShlObj.h>

#include <fmt/format.h>
#include <wil/resource.h>

namespace vrcsm::core
{

std::string formatBytesHuman(std::uint64_t bytes)
{
    constexpr std::array<const char*, 5> units{"B", "KiB", "MiB", "GiB", "TiB"};
    if (bytes == 0)
    {
        return "0 B";
    }
    double value = static_cast<double>(bytes);
    std::size_t unit = 0;
    while (value >= 1024.0 && unit + 1 < units.size())
    {
        value /= 1024.0;
        ++unit;
    }
    return fmt::format("{:.2f} {}", value, units[unit]);
}

std::string nowIso()
{
    const auto now = std::chrono::system_clock::now();
    const auto t = std::chrono::system_clock::to_time_t(now);
    std::tm local{};
    localtime_s(&local, &t);

    TIME_ZONE_INFORMATION tz{};
    GetTimeZoneInformation(&tz);
    long bias = -tz.Bias;
    const char sign = bias >= 0 ? '+' : '-';
    if (bias < 0) bias = -bias;

    return fmt::format(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}{}{:02}:{:02}",
        local.tm_year + 1900,
        local.tm_mon + 1,
        local.tm_mday,
        local.tm_hour,
        local.tm_min,
        local.tm_sec,
        sign,
        bias / 60,
        bias % 60);
}

std::string isoTimestamp(std::filesystem::file_time_type t)
{
    using namespace std::chrono;
    const auto sysTime = time_point_cast<system_clock::duration>(
        t - std::filesystem::file_time_type::clock::now() + system_clock::now());
    const auto tt = system_clock::to_time_t(sysTime);
    std::tm local{};
    localtime_s(&local, &tt);

    TIME_ZONE_INFORMATION tz{};
    GetTimeZoneInformation(&tz);
    long bias = -tz.Bias;
    const char sign = bias >= 0 ? '+' : '-';
    if (bias < 0) bias = -bias;

    return fmt::format(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}{}{:02}:{:02}",
        local.tm_year + 1900,
        local.tm_mon + 1,
        local.tm_mday,
        local.tm_hour,
        local.tm_min,
        local.tm_sec,
        sign,
        bias / 60,
        bias % 60);
}

std::optional<std::filesystem::file_time_type> safeLastWriteTime(const std::filesystem::path& p) noexcept
{
    std::error_code ec;
    auto t = std::filesystem::last_write_time(p, ec);
    if (ec)
    {
        return std::nullopt;
    }
    return t;
}

std::string toUtf8(std::wstring_view wide)
{
    if (wide.empty())
    {
        return {};
    }
    const int needed = WideCharToMultiByte(
        CP_UTF8,
        0,
        wide.data(),
        static_cast<int>(wide.size()),
        nullptr,
        0,
        nullptr,
        nullptr);
    if (needed <= 0)
    {
        return {};
    }
    std::string out(static_cast<std::size_t>(needed), '\0');
    WideCharToMultiByte(
        CP_UTF8,
        0,
        wide.data(),
        static_cast<int>(wide.size()),
        out.data(),
        needed,
        nullptr,
        nullptr);
    return out;
}

std::wstring toWide(std::string_view utf8)
{
    if (utf8.empty())
    {
        return {};
    }
    const int needed = MultiByteToWideChar(
        CP_UTF8,
        0,
        utf8.data(),
        static_cast<int>(utf8.size()),
        nullptr,
        0);
    if (needed <= 0)
    {
        return {};
    }
    std::wstring out(static_cast<std::size_t>(needed), L'\0');
    MultiByteToWideChar(
        CP_UTF8,
        0,
        utf8.data(),
        static_cast<int>(utf8.size()),
        out.data(),
        needed);
    return out;
}

std::filesystem::path utf8Path(std::string_view utf8)
{
    return std::filesystem::path(toWide(utf8));
}

namespace
{

std::filesystem::path normalizeContainmentPath(const std::filesystem::path& input)
{
    // Use absolute() + lexically_normal() instead of weakly_canonical().
    // weakly_canonical() follows NTFS junctions, which causes the containment
    // check to fail when the user has relocated cache dirs via junctions
    // (e.g. HTTPCache-WindowsPlayer → D:\VRChatCache\...). lexically_normal()
    // still resolves ".." traversal without touching the filesystem.
    std::error_code ec;
    auto abs = std::filesystem::absolute(input, ec);
    if (ec) abs = input;
    return abs.lexically_normal();
}

bool pathComponentEquals(const std::filesystem::path& lhs, const std::filesystem::path& rhs)
{
    return _wcsicmp(lhs.native().c_str(), rhs.native().c_str()) == 0;
}

} // namespace

bool ensureWithinBase(const std::filesystem::path& base, const std::filesystem::path& candidate)
{
    if (base.empty() || candidate.empty())
    {
        return false;
    }

    const auto baseAbs = normalizeContainmentPath(base);
    const auto candAbs = normalizeContainmentPath(candidate);

    auto baseIt = baseAbs.begin();
    auto candIt = candAbs.begin();
    for (; baseIt != baseAbs.end(); ++baseIt, ++candIt)
    {
        if (candIt == candAbs.end())
        {
            return false;
        }
        if (!pathComponentEquals(*baseIt, *candIt))
        {
            return false;
        }
    }

    return true;
}

std::optional<std::filesystem::path> tryGetKnownFolderPath(const GUID& id)
{
    wil::unique_cotaskmem_string raw;
    if (FAILED(SHGetKnownFolderPath(id, 0, nullptr, raw.put())) || raw == nullptr)
    {
        return std::nullopt;
    }

    return std::filesystem::path(raw.get());
}

std::optional<std::filesystem::path> tryGetEnvPath(std::wstring_view key)
{
    if (key.empty())
    {
        return std::nullopt;
    }

    const std::wstring keyCopy(key);
    const DWORD required = GetEnvironmentVariableW(keyCopy.c_str(), nullptr, 0);
    if (required <= 1)
    {
        return std::nullopt;
    }

    std::wstring buffer(static_cast<std::size_t>(required), L'\0');
    const DWORD written = GetEnvironmentVariableW(keyCopy.c_str(), buffer.data(), required);
    if (written == 0 || written >= required)
    {
        return std::nullopt;
    }

    buffer.resize(static_cast<std::size_t>(written));
    return std::filesystem::path(buffer);
}

std::filesystem::path getExecutableDirectory()
{
    std::wstring buffer(static_cast<std::size_t>(MAX_PATH), L'\0');
    DWORD length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
    while (length >= buffer.size())
    {
        buffer.resize(buffer.size() * 2);
        length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
    }

    if (length == 0)
    {
        return {};
    }

    buffer.resize(static_cast<std::size_t>(length));
    return std::filesystem::path(buffer).parent_path();
}

std::filesystem::path getWritableTempDirectory()
{
    DWORD required = GetTempPathW(0, nullptr);
    if (required > 1)
    {
        std::wstring buffer(static_cast<std::size_t>(required), L'\0');
        const DWORD written = GetTempPathW(required, buffer.data());
        if (written > 0 && written < required)
        {
            buffer.resize(static_cast<std::size_t>(written));
            return std::filesystem::path(buffer).lexically_normal();
        }
    }

    if (const auto temp = tryGetEnvPath(L"TEMP"))
    {
        return *temp;
    }
    if (const auto tmp = tryGetEnvPath(L"TMP"))
    {
        return *tmp;
    }
    if (const auto profile = tryGetEnvPath(L"USERPROFILE"))
    {
        return *profile / L"AppData" / L"Local" / L"Temp";
    }

    std::wstring buffer(static_cast<std::size_t>(MAX_PATH), L'\0');
    UINT length = GetWindowsDirectoryW(buffer.data(), static_cast<UINT>(buffer.size()));
    while (length >= buffer.size())
    {
        buffer.resize(buffer.size() * 2);
        length = GetWindowsDirectoryW(buffer.data(), static_cast<UINT>(buffer.size()));
    }
    if (length > 0)
    {
        buffer.resize(static_cast<std::size_t>(length));
        return std::filesystem::path(buffer) / L"Temp";
    }

    return std::filesystem::path(L"C:\\Windows\\Temp");
}

std::filesystem::path getLocalAppDataPath()
{
    if (const auto known = tryGetKnownFolderPath(FOLDERID_LocalAppData))
    {
        return *known;
    }
    if (const auto env = tryGetEnvPath(L"LOCALAPPDATA"))
    {
        return *env;
    }
    if (const auto profile = tryGetEnvPath(L"USERPROFILE"))
    {
        return *profile / L"AppData" / L"Local";
    }

    return getWritableTempDirectory() / L"VRCSM-LocalAppData";
}

std::filesystem::path getAppDataRoot()
{
    return getLocalAppDataPath() / L"VRCSM";
}

} // namespace vrcsm::core
