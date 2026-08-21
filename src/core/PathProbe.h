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
    // Always the canonical `%LocalLow%\VRChat\VRChat\config.json` once
    // baseDir is known — even if the file has not been created yet.
    // VRChat only writes this file after the user changes engine settings;
    // treating "missing" as "undetectable" broke the Settings tab on most
    // machines.
    std::optional<std::filesystem::path> configJson;
    std::optional<std::filesystem::path> melonLoaderCfg;
    std::optional<std::filesystem::path> steamVrSettings;
    // Parent of Cache-WindowsPlayer. Equals baseDir unless config.json
    // names a custom cache_directory that actually exists.
    std::optional<std::filesystem::path> cacheRoot;
    bool baseDirExists = false;

    std::filesystem::path cacheWindowsPlayerDir() const;
};

void to_json(nlohmann::json& j, const PathProbeResult& r);

// Resolve a VRChat config.json `cache_directory` string to the folder that
// should contain Cache-WindowsPlayer. Accepts either the parent or the
// Cache-WindowsPlayer folder itself. Returns nullopt when the path is empty
// or does not exist.
std::optional<std::filesystem::path> ResolveVrchatCacheRoot(
    const std::filesystem::path& baseDir,
    const nlohmann::json& config);

class PathProbe
{
public:
    static PathProbeResult Probe();
};

} // namespace vrcsm::core
