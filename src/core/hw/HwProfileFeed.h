#pragma once

#include "HwDetector.h"
#include "HwProfiler.h"

#include "../Common.h"

#include <chrono>
#include <mutex>
#include <optional>
#include <string>

namespace vrcsm::core::hw
{

class HwProfileFeed
{
public:
    static HwProfileFeed& Instance();

    Result<std::optional<PresetRecommendation>> FetchCommunityProfile(const HwReport& report, bool force = false);

    void SetFeedUrl(std::string url);
    std::string FeedUrl() const;

private:
    HwProfileFeed();

    Result<std::optional<PresetRecommendation>> FetchCommunityProfileImpl(const HwReport& report);
    Result<std::string> DownloadText(const std::string& url);

    mutable std::mutex m_mutex;
    std::string m_feedUrl;
    std::optional<std::string> m_cachedText;
    std::chrono::steady_clock::time_point m_cachedAt{};
};

} // namespace vrcsm::core::hw
