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

struct LocalAvatarItem
{
    std::string user_id;
    std::string avatar_id;
    std::string path;
    std::optional<double> eye_height;
    std::size_t parameter_count = 0;
    std::optional<std::string> modified_at;
};

void to_json(nlohmann::json& j, const LocalAvatarItem& a);

struct LocalAvatarReport
{
    std::size_t item_count = 0;
    std::vector<LocalAvatarItem> recent_items;
    std::map<std::string, std::size_t> parameter_count_histogram;
};

void to_json(nlohmann::json& j, const LocalAvatarReport& r);

class AvatarData
{
public:
    static LocalAvatarReport scan(const std::filesystem::path& baseDir);
};

} // namespace vrcsm::core
