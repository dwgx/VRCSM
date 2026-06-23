#pragma once

#include "Common.h"

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

struct LocalAvatarParameter
{
    std::string name;
    std::string valueType;
    nlohmann::json defaultValue;
};

void to_json(nlohmann::json& j, const LocalAvatarParameter& p);

struct LocalAvatarParametersReport
{
    std::string avatar_id;
    std::string user_id;
    std::string path;
    std::vector<LocalAvatarParameter> parameters;
};

void to_json(nlohmann::json& j, const LocalAvatarParametersReport& r);

class AvatarData
{
public:
    static LocalAvatarReport scan(const std::filesystem::path& baseDir);
    static Result<LocalAvatarParametersReport> readParameters(
        const std::filesystem::path& baseDir,
        std::string_view avatarId,
        std::string_view userId = {},
        std::size_t limit = 256);
};

} // namespace vrcsm::core
