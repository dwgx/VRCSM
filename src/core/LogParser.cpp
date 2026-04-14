#include "LogParser.h"

#include "Common.h"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <regex>
#include <system_error>
#include <unordered_set>

namespace vrcsm::core
{

void to_json(nlohmann::json& j, const LogSettings& s)
{
    j = nlohmann::json{
        {"cache_directory", s.cache_directory ? nlohmann::json(*s.cache_directory) : nlohmann::json(nullptr)},
        {"cache_size_mb", s.cache_size_mb ? nlohmann::json(*s.cache_size_mb) : nlohmann::json(nullptr)},
        {"clear_cache_on_start", s.clear_cache_on_start ? nlohmann::json(*s.clear_cache_on_start) : nlohmann::json(nullptr)},
    };
}

void to_json(nlohmann::json& j, const LogReport& r)
{
    j = nlohmann::json{
        {"log_files", r.log_files},
        {"log_count", r.log_count},
        {"settings", r.settings},
        {"recent_world_ids", r.recent_world_ids},
        {"recent_avatar_ids", r.recent_avatar_ids},
        {"world_names", r.world_names},
        {"world_event_count", r.world_event_count},
        {"avatar_event_count", r.avatar_event_count},
    };
}

namespace
{
constexpr std::size_t kMaxLogFiles = 5;
constexpr std::size_t kMaxRecentIds = 25;

const std::regex kLogFileRe(R"(^output_log_.*\.txt$)");
const std::regex kWorldRe(R"((wrld_[0-9a-fA-F-]+))");
const std::regex kAvatarRe(R"((avtr_[0-9a-fA-F-]+))");
const std::regex kWorldNameRe(R"(worldName=([^}\r\n]+))");
const std::regex kCacheDirRe(R"(Using default cache directory\.?)");
const std::regex kCacheSizeRe(R"(Using default cache size:\s*(\d+))");
const std::regex kClearCacheRe(R"(Clear cache on start:\s*(\w+))");

std::vector<std::filesystem::path> findLogFiles(const std::filesystem::path& baseDir)
{
    std::vector<std::filesystem::path> files;
    std::error_code ec;
    if (!std::filesystem::exists(baseDir, ec) || ec) return files;

    for (const auto& entry : std::filesystem::directory_iterator(baseDir, ec))
    {
        if (ec) break;
        if (!entry.is_regular_file()) continue;
        const auto name = entry.path().filename().string();
        if (std::regex_match(name, kLogFileRe))
        {
            files.push_back(entry.path());
        }
    }

    std::sort(files.begin(), files.end(), [](const auto& a, const auto& b) {
        return a.filename().string() > b.filename().string();
    });
    if (files.size() > kMaxLogFiles)
    {
        files.resize(kMaxLogFiles);
    }
    return files;
}

void parseLine(const std::string& line, LogReport& report,
               std::vector<std::string>& worldOrder,
               std::vector<std::string>& avatarOrder,
               std::unordered_set<std::string>& worldSet,
               std::unordered_set<std::string>& avatarSet,
               std::string& lastWorldId)
{
    std::smatch m;

    if (std::regex_search(line, m, kWorldRe))
    {
        const std::string id = m[1];
        report.world_event_count += 1;
        if (worldSet.insert(id).second)
        {
            worldOrder.push_back(id);
        }
        lastWorldId = id;
    }

    if (std::regex_search(line, m, kAvatarRe))
    {
        const std::string id = m[1];
        report.avatar_event_count += 1;
        if (avatarSet.insert(id).second)
        {
            avatarOrder.push_back(id);
        }
    }

    if (std::regex_search(line, m, kWorldNameRe))
    {
        std::string name = m[1];
        while (!name.empty() && (name.back() == ' ' || name.back() == ',' || name.back() == '\r'))
        {
            name.pop_back();
        }
        if (!lastWorldId.empty())
        {
            report.world_names[lastWorldId] = name;
        }
    }

    if (!report.settings.cache_directory && std::regex_search(line, m, kCacheDirRe))
    {
        report.settings.cache_directory = "default";
    }

    if (!report.settings.cache_size_mb && std::regex_search(line, m, kCacheSizeRe))
    {
        try
        {
            report.settings.cache_size_mb = std::stoi(m[1]);
        }
        catch (...)
        {
        }
    }

    if (!report.settings.clear_cache_on_start && std::regex_search(line, m, kClearCacheRe))
    {
        std::string v = m[1];
        std::transform(v.begin(), v.end(), v.begin(), [](unsigned char c) { return std::tolower(c); });
        if (v == "true" || v == "1" || v == "yes")
        {
            report.settings.clear_cache_on_start = true;
        }
        else if (v == "false" || v == "0" || v == "no")
        {
            report.settings.clear_cache_on_start = false;
        }
    }
}
} // namespace

LogReport LogParser::parse(const std::filesystem::path& baseDir)
{
    LogReport report;
    auto files = findLogFiles(baseDir);
    report.log_count = files.size();
    report.log_files.reserve(files.size());
    for (const auto& f : files)
    {
        report.log_files.push_back(f.filename().string());
    }

    std::vector<std::string> worldOrder;
    std::vector<std::string> avatarOrder;
    std::unordered_set<std::string> worldSet;
    std::unordered_set<std::string> avatarSet;
    std::string lastWorldId;

    for (const auto& path : files)
    {
        std::ifstream stream(path);
        if (!stream) continue;
        std::string line;
        while (std::getline(stream, line))
        {
            parseLine(line, report, worldOrder, avatarOrder, worldSet, avatarSet, lastWorldId);
        }
    }

    if (worldOrder.size() > kMaxRecentIds) worldOrder.resize(kMaxRecentIds);
    if (avatarOrder.size() > kMaxRecentIds) avatarOrder.resize(kMaxRecentIds);
    report.recent_world_ids = std::move(worldOrder);
    report.recent_avatar_ids = std::move(avatarOrder);
    return report;
}

} // namespace vrcsm::core
