#pragma once

#include <cstddef>
#include <filesystem>
#include <map>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

struct LogSettings
{
    std::optional<std::string> cache_directory;
    std::optional<int> cache_size_mb;
    std::optional<bool> clear_cache_on_start;
};

void to_json(nlohmann::json& j, const LogSettings& s);

struct LogReport
{
    std::vector<std::string> log_files;
    std::size_t log_count = 0;
    LogSettings settings;
    std::vector<std::string> recent_world_ids;
    std::vector<std::string> recent_avatar_ids;
    std::map<std::string, std::string> world_names;
    std::size_t world_event_count = 0;
    std::size_t avatar_event_count = 0;
};

void to_json(nlohmann::json& j, const LogReport& r);

class LogParser
{
public:
    static LogReport parse(const std::filesystem::path& baseDir);
};

} // namespace vrcsm::core
