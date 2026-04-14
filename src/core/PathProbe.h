#pragma once

#include <filesystem>
#include <optional>
#include <string>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

struct PathProbeResult
{
    std::filesystem::path baseDir;
    std::optional<std::filesystem::path> vrchatExe;
    std::optional<std::filesystem::path> configJson;
    std::optional<std::filesystem::path> melonLoaderCfg;
    bool baseDirExists = false;
};

void to_json(nlohmann::json& j, const PathProbeResult& r);

class PathProbe
{
public:
    static PathProbeResult Probe();
};

} // namespace vrcsm::core
