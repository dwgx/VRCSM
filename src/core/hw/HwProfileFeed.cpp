#include "HwProfileFeed.h"

#include <Windows.h>
#include <winhttp.h>

#include <fmt/format.h>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <cctype>
#include <cstddef>
#include <memory>
#include <vector>

namespace vrcsm::core::hw
{

namespace
{

constexpr const wchar_t* kUserAgent = L"VRCSM-HwProfileFeed/1.0";
constexpr std::string_view kDefaultFeed = "https://dwgx.github.io/VRCSM/hw-profiles.json";
constexpr std::chrono::minutes kCacheTtl{5};

struct CrackedUrl
{
    std::wstring host;
    std::wstring path;
    INTERNET_PORT port{INTERNET_DEFAULT_HTTPS_PORT};
    bool https{true};
};

std::string ToLower(std::string_view text)
{
    std::string lowered;
    lowered.reserve(text.size());
    for (const unsigned char ch : text)
    {
        lowered.push_back(static_cast<char>(std::tolower(ch)));
    }
    return lowered;
}

std::optional<CrackedUrl> CrackUrl(const std::string& url)
{
    URL_COMPONENTSW comp{};
    comp.dwStructSize = sizeof(comp);
    comp.dwHostNameLength = static_cast<DWORD>(-1);
    comp.dwUrlPathLength = static_cast<DWORD>(-1);
    comp.dwSchemeLength = static_cast<DWORD>(-1);

    const auto wUrl = toWide(url);
    if (!WinHttpCrackUrl(wUrl.c_str(), 0, 0, &comp))
    {
        return std::nullopt;
    }

    CrackedUrl out;
    out.host.assign(comp.lpszHostName, comp.dwHostNameLength);
    out.path.assign(comp.lpszUrlPath, comp.dwUrlPathLength);
    out.port = comp.nPort;
    out.https = comp.nScheme == INTERNET_SCHEME_HTTPS;
    return out;
}

Result<std::vector<std::byte>> HttpGetBytes(const std::string& url)
{
    const auto cracked = CrackUrl(url);
    if (!cracked)
    {
        return Error{"hw_profile_feed_network", fmt::format("invalid URL: {}", url), 0};
    }

    using UniqueH = std::unique_ptr<void, decltype(&WinHttpCloseHandle)>;

    UniqueH hSession(WinHttpOpen(kUserAgent, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                                 WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0),
                     WinHttpCloseHandle);
    if (!hSession)
    {
        return Error{"hw_profile_feed_network", "WinHttpOpen failed", 0};
    }
    WinHttpSetTimeouts(hSession.get(), 30000, 30000, 30000, 120000);

    UniqueH hConnect(WinHttpConnect(hSession.get(), cracked->host.c_str(), cracked->port, 0),
                     WinHttpCloseHandle);
    if (!hConnect)
    {
        return Error{"hw_profile_feed_network", "WinHttpConnect failed", 0};
    }

    const DWORD flags = cracked->https ? WINHTTP_FLAG_SECURE : 0;
    UniqueH hRequest(WinHttpOpenRequest(hConnect.get(), L"GET",
                                        cracked->path.empty() ? L"/" : cracked->path.c_str(),
                                        nullptr, WINHTTP_NO_REFERER,
                                        WINHTTP_DEFAULT_ACCEPT_TYPES, flags),
                     WinHttpCloseHandle);
    if (!hRequest)
    {
        return Error{"hw_profile_feed_network", "WinHttpOpenRequest failed", 0};
    }

    if (!WinHttpSendRequest(hRequest.get(),
                            WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                            WINHTTP_NO_REQUEST_DATA, 0, 0, 0))
    {
        return Error{"hw_profile_feed_network", "WinHttpSendRequest failed", 0};
    }
    if (!WinHttpReceiveResponse(hRequest.get(), nullptr))
    {
        return Error{"hw_profile_feed_network", "WinHttpReceiveResponse failed", 0};
    }

    DWORD status = 0;
    DWORD statusSize = sizeof(status);
    if (!WinHttpQueryHeaders(hRequest.get(),
                             WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                             WINHTTP_HEADER_NAME_BY_INDEX,
                             &status, &statusSize, WINHTTP_NO_HEADER_INDEX))
    {
        return Error{"hw_profile_feed_network", "WinHttpQueryHeaders failed", 0};
    }
    if (status < 200 || status >= 300)
    {
        return Error{"hw_profile_feed_network", fmt::format("HTTP {}", status), static_cast<int>(status)};
    }

    std::vector<std::byte> body;
    std::vector<std::byte> chunk(64 * 1024);
    DWORD available = 0;
    while (WinHttpQueryDataAvailable(hRequest.get(), &available) && available > 0)
    {
        if (available > chunk.size())
        {
            chunk.resize(available);
        }
        DWORD read = 0;
        if (!WinHttpReadData(hRequest.get(), chunk.data(), available, &read))
        {
            break;
        }
        body.insert(body.end(), chunk.begin(), chunk.begin() + read);
    }
    return body;
}

bool MatchWildcard(std::string_view value, std::string_view pattern)
{
    if (pattern.empty())
    {
        return true;
    }

    const auto loweredValue = ToLower(value);
    std::string loweredPattern = ToLower(pattern);
    const bool startsWithStar = !loweredPattern.empty() && loweredPattern.front() == '*';
    const bool endsWithStar = !loweredPattern.empty() && loweredPattern.back() == '*';

    while (!loweredPattern.empty() && loweredPattern.front() == '*')
    {
        loweredPattern.erase(loweredPattern.begin());
    }
    while (!loweredPattern.empty() && loweredPattern.back() == '*')
    {
        loweredPattern.pop_back();
    }

    if (loweredPattern.empty())
    {
        return true;
    }
    (void)startsWithStar;
    (void)endsWithStar;
    return loweredValue.find(loweredPattern) != std::string::npos;
}

} // namespace

HwProfileFeed::HwProfileFeed() : m_feedUrl(kDefaultFeed) {}

HwProfileFeed& HwProfileFeed::Instance()
{
    static HwProfileFeed instance;
    return instance;
}

void HwProfileFeed::SetFeedUrl(std::string url)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    m_feedUrl = std::move(url);
    m_cachedText.reset();
}

std::string HwProfileFeed::FeedUrl() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_feedUrl;
}

Result<std::string> HwProfileFeed::DownloadText(const std::string& url)
{
    auto bytes = HttpGetBytes(url);
    if (!isOk(bytes))
    {
        return std::get<Error>(std::move(bytes));
    }
    const auto& data = std::get<std::vector<std::byte>>(bytes);
    return std::string(reinterpret_cast<const char*>(data.data()), data.size());
}

Result<std::optional<PresetRecommendation>> HwProfileFeed::FetchCommunityProfile(const HwReport& report, bool force)
{
    try
    {
        bool useCache = false;
        {
            std::lock_guard<std::mutex> lock(m_mutex);
            useCache = !force && m_cachedText
                && (std::chrono::steady_clock::now() - m_cachedAt) < kCacheTtl;
        }
        if (useCache)
        {
            return FetchCommunityProfileImpl(report);
        }

        auto text = DownloadText(FeedUrl());
        if (!isOk(text))
        {
            spdlog::warn("[hw] hw profile feed fetch failed: {}", std::get<Error>(text).message);
            bool hasCachedText = false;
            {
                std::lock_guard<std::mutex> lock(m_mutex);
                hasCachedText = m_cachedText.has_value();
            }
            if (hasCachedText)
            {
                return FetchCommunityProfileImpl(report);
            }
            return std::optional<PresetRecommendation>{};
        }

        {
            std::lock_guard<std::mutex> lock(m_mutex);
            m_cachedText = std::get<std::string>(std::move(text));
            m_cachedAt = std::chrono::steady_clock::now();
        }

        return FetchCommunityProfileImpl(report);
    }
    catch (const std::exception& ex)
    {
        spdlog::warn("[hw] hw profile feed failed: {}", ex.what());
        return std::optional<PresetRecommendation>{};
    }
    catch (...)
    {
        spdlog::warn("[hw] hw profile feed failed with unknown error");
        return std::optional<PresetRecommendation>{};
    }
}

Result<std::optional<PresetRecommendation>> HwProfileFeed::FetchCommunityProfileImpl(const HwReport& report)
{
    std::string text;
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (!m_cachedText)
        {
            return std::optional<PresetRecommendation>{};
        }
        text = *m_cachedText;
    }

    try
    {
        const auto doc = nlohmann::json::parse(text);
        if (!doc.is_object() || !doc.contains("communityProfiles") || !doc["communityProfiles"].is_array())
        {
            spdlog::warn("[hw] hw profile feed payload is invalid");
            return std::optional<PresetRecommendation>{};
        }

        int targetBandwidthMax = 0;
        if (doc.contains("overrides") && doc["overrides"].is_object())
        {
            targetBandwidthMax = doc["overrides"].value("targetBandwidthMax", 0);
        }

        for (const auto& profile : doc["communityProfiles"])
        {
            if (!profile.is_object())
            {
                continue;
            }

            const std::string cpuPattern = profile.value("cpu", "");
            const std::string gpuPattern = profile.value("gpu", "");
            const std::string hmdPattern = profile.value("hmd", "");
            const std::string preset = profile.value("preset", "");
            const std::string note = profile.value("note", "");

            if (!MatchWildcard(report.cpuName, cpuPattern)
                || !MatchWildcard(report.gpuName, gpuPattern)
                || !MatchWildcard(report.hmdModel, hmdPattern))
            {
                continue;
            }

            auto recommendation = PresetForTier(preset, report);
            if (!isOk(recommendation))
            {
                spdlog::warn("[hw] matched community preset '{}' is invalid: {}",
                             preset,
                             std::get<Error>(recommendation).message);
                return std::optional<PresetRecommendation>{};
            }

            auto result = std::get<PresetRecommendation>(std::move(recommendation));
            if (targetBandwidthMax > 0)
            {
                result.targetBandwidth = std::min(result.targetBandwidth, targetBandwidthMax);
            }
            if (!note.empty())
            {
                result.rationale += " " + note;
            }
            return std::optional<PresetRecommendation>{std::move(result)};
        }

        return std::optional<PresetRecommendation>{};
    }
    catch (const std::exception& ex)
    {
        spdlog::warn("[hw] failed to parse hw profile feed: {}", ex.what());
        return std::optional<PresetRecommendation>{};
    }
}

} // namespace vrcsm::core::hw
