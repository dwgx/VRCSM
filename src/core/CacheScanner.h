#pragma once

#include <array>
#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

struct CategorySummary
{
    std::string key;
    std::string name;
    std::string kind;
    std::string logical_path;
    bool exists = false;
    bool lexists = false;
    bool is_dir = false;
    bool is_file = false;
    std::string resolved_path;
    std::uint64_t bytes = 0;
    std::string bytes_human;
    std::uint64_t file_count = 0;
    std::optional<std::string> latest_mtime;
    std::optional<std::string> oldest_mtime;
};

void to_json(nlohmann::json& j, const CategorySummary& c);

struct CategoryDef
{
    std::string_view key;
    std::string_view name;
    std::string_view rel_path;
    std::string_view kind;
    bool safe_delete;
};

const std::array<CategoryDef, 12>& categoryDefs();

CategorySummary scanCategory(const std::filesystem::path& baseDir, const CategoryDef& def);

class CacheScanner
{
public:
    static std::vector<CategorySummary> scanAll(const std::filesystem::path& baseDir);

    // forward declared in Report.h, but we expose buildReport here too for the host's IpcBridge to call.
    static nlohmann::json buildReport(const std::filesystem::path& baseDir);
};

} // namespace vrcsm::core
