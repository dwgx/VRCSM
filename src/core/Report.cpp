#include "Report.h"

#include "AvatarData.h"
#include "BundleSniff.h"
#include "CacheScanner.h"
#include "Common.h"
#include "JunctionUtil.h"
#include "LogParser.h"

#include <algorithm>
#include <future>
#include <system_error>

namespace vrcsm::core
{

namespace
{
constexpr std::size_t kLargestEntriesLimit = 10;
} // namespace

nlohmann::json BuildFullReport(const std::filesystem::path& baseDir)
{
    nlohmann::json report;
    report["generated_at"] = nowIso();
    report["base_dir"] = toUtf8(baseDir.wstring());

    // Kick all four heavy walkers off in parallel. Previously they
    // ran strictly sequentially: scanAll → scanCacheWindowsPlayer →
    // AvatarData::scan → LogParser::parse. scanAll itself already
    // fans out per category (see CacheScanner.cpp), and
    // scanCacheWindowsPlayer fans out per hash dir (see
    // BundleSniff.cpp) — running them concurrently means the big
    // walks overlap instead of stacking.
    const auto cwpDir = baseDir / L"Cache-WindowsPlayer";
    auto summariesFut = std::async(std::launch::async, [&baseDir]() {
        return CacheScanner::scanAll(baseDir);
    });
    auto cwpEntriesFut = std::async(std::launch::async, [&cwpDir]() {
        return BundleSniff::scanCacheWindowsPlayer(cwpDir);
    });
    auto avatarDataFut = std::async(std::launch::async, [&baseDir]() {
        return AvatarData::scan(baseDir);
    });
    auto logsFut = std::async(std::launch::async, [&baseDir]() {
        return LogParser::parse(baseDir);
    });

    auto summaries = summariesFut.get();
    auto cwpEntries = cwpEntriesFut.get();

    // CacheScanner::scanAll skipped the full walk of
    // cache_windows_player. Fold bytes, file_count and mtime ranges
    // in from the BundleSniff aggregate so the category row stays
    // accurate without the duplicate walk.
    for (auto& s : summaries)
    {
        if (s.key != "cache_windows_player") continue;
        std::uint64_t bytes = 0;
        std::uint64_t fileCount = 0;
        std::optional<std::string> latest;
        std::optional<std::string> oldest;
        for (const auto& be : cwpEntries)
        {
            bytes += be.bytes;
            fileCount += be.file_count;
            if (be.latest_mtime && (!latest || *be.latest_mtime > *latest))
            {
                latest = be.latest_mtime;
            }
            if (be.oldest_mtime && (!oldest || *be.oldest_mtime < *oldest))
            {
                oldest = be.oldest_mtime;
            }
        }
        s.bytes = bytes;
        s.file_count = fileCount;
        s.bytes_human = formatBytesHuman(bytes);
        s.latest_mtime = latest;
        s.oldest_mtime = oldest;
        break;
    }

    report["category_summaries"] = summaries;

    std::uint64_t totalBytes = 0;
    std::size_t existingCount = 0;
    for (const auto& s : summaries)
    {
        totalBytes += s.bytes;
        if (s.exists) ++existingCount;
    }
    report["total_bytes"] = totalBytes;
    report["total_bytes_human"] = formatBytesHuman(totalBytes);
    report["existing_category_count"] = existingCount;

    nlohmann::json brokenLinks = nlohmann::json::array();
    for (const auto& def : categoryDefs())
    {
        const auto p = baseDir / std::filesystem::path(toWide(def.rel_path));
        if (!JunctionUtil::isReparsePoint(p)) continue;

        const auto target = JunctionUtil::readJunctionTarget(p);
        std::error_code ec;
        const bool targetExists = target.has_value() && std::filesystem::exists(*target, ec) && !ec;
        if (targetExists) continue;

        nlohmann::json entry;
        entry["category"] = std::string(def.key);
        entry["path"] = toUtf8(p.wstring());
        if (target.has_value())
        {
            entry["target"] = toUtf8(target->wstring());
        }
        else
        {
            entry["target"] = nullptr;
        }
        brokenLinks.push_back(entry);
    }
    report["broken_links"] = brokenLinks;

    nlohmann::json cwpJson;
    cwpJson["entry_count"] = cwpEntries.size();
    cwpJson["entries"] = cwpEntries;

    // cwpEntries is already sorted by bytes desc inside
    // scanCacheWindowsPlayer, so largest_entries is just a prefix.
    nlohmann::json largest = nlohmann::json::array();
    for (std::size_t i = 0; i < cwpEntries.size() && i < kLargestEntriesLimit; ++i)
    {
        largest.push_back(cwpEntries[i]);
    }
    cwpJson["largest_entries"] = std::move(largest);

    report["cache_windows_player"] = cwpJson;

    report["local_avatar_data"] = avatarDataFut.get();
    report["logs"] = logsFut.get();

    return report;
}

nlohmann::json CacheScanner::buildReport(const std::filesystem::path& baseDir)
{
    return BuildFullReport(baseDir);
}

} // namespace vrcsm::core
