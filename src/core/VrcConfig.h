#pragma once

#include <filesystem>
#include <variant>

#include <nlohmann/json.hpp>

#include "Common.h"

namespace vrcsm::core
{

class VrcConfig
{
public:
    static Result<nlohmann::json> Read(const std::filesystem::path& configPath);

    static Result<std::monostate> Write(
        const std::filesystem::path& configPath,
        const nlohmann::json& config);

    // IPC facades
    static nlohmann::json ReadJson(const nlohmann::json& params);
    static nlohmann::json WriteJson(const nlohmann::json& params);
};

} // namespace vrcsm::core
