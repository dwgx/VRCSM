#include "Common.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <ctime>
#include <system_error>

#include <Windows.h>

#include <fmt/format.h>

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

bool ensureWithinBase(const std::filesystem::path& base, const std::filesystem::path& candidate)
{
    std::error_code ec;
    auto baseAbs = std::filesystem::weakly_canonical(base, ec);
    if (ec) baseAbs = base;
    auto candAbs = std::filesystem::weakly_canonical(candidate, ec);
    if (ec) candAbs = candidate;

    auto baseStr = baseAbs.wstring();
    auto candStr = candAbs.wstring();
    if (candStr.size() < baseStr.size())
    {
        return false;
    }
    return std::equal(baseStr.begin(), baseStr.end(), candStr.begin());
}

} // namespace vrcsm::core
