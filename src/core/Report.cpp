#include "Report.h"

#include "AvatarData.h"
#include "BundleSniff.h"
#include "CacheScanner.h"
#include "Common.h"
#include "JunctionUtil.h"
#include "LogParser.h"

#include <algorithm>
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

    const auto summaries = CacheScanner::scanAll(baseDir);
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

    const auto cwpDir = baseDir / L"Cache-WindowsPlayer";
    auto cwpEntries = BundleSniff::scanCacheWindowsPlayer(cwpDir);

    nlohmann::json cwpJson;
    cwpJson["entry_count"] = cwpEntries.size();
    cwpJson["entries"] = cwpEntries;

    auto largest = cwpEntries;
    std::sort(largest.begin(), largest.end(), [](const BundleEntry& a, const BundleEntry& b) {
        return a.bytes > b.bytes;
    });
    if (largest.size() > kLargestEntriesLimit)
    {
        largest.resize(kLargestEntriesLimit);
    }
    cwpJson["largest_entries"] = largest;

    report["cache_windows_player"] = cwpJson;

    report["local_avatar_data"] = AvatarData::scan(baseDir);
    report["logs"] = LogParser::parse(baseDir);

    return report;
}

nlohmann::json CacheScanner::buildReport(const std::filesystem::path& baseDir)
{
    return BuildFullReport(baseDir);
}

} // namespace vrcsm::core
