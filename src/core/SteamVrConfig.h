#pragma once

#include <filesystem>
#include <optional>
#include <string>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

/// Parsed hardware info from steamvr.vrsettings (read-only sections).
struct SteamVrHardwareInfo
{
    std::string gpuVendor;
    int gpuHorsepower{0};
    std::string hmdModel;
    std::string hmdManufacturer;
    std::string hmdDriver;
    std::string hmdSerial;
};

void to_json(nlohmann::json& j, const SteamVrHardwareInfo& info);

/// Read/write helper for SteamVR's steamvr.vrsettings JSON file.
///
/// The vrsettings file lives at <SteamPath>/config/steamvr.vrsettings
/// and is a standard JSON object with top-level section keys
/// ("steamvr", "driver_vrlink", "GpuSpeed", "LastKnown", etc.).
///
/// Write operations use merge semantics — only the keys the caller
/// provides are overwritten; every other key in the file is preserved
/// byte-for-byte. Atomic write is ensured via .tmp → .bak → rename.
class SteamVrConfig
{
public:
    /// Detect the Steam installation path from the Windows registry.
    /// Returns empty path if Steam is not installed.
    static std::filesystem::path DetectSteamPath();

    /// Resolve the full path to steamvr.vrsettings.
    /// Returns nullopt if Steam is not installed or the file doesn't exist.
    static std::optional<std::filesystem::path> DetectVrSettingsPath();

    /// Read the entire vrsettings file as a JSON object.
    static nlohmann::json Read(const std::filesystem::path& path);

    /// Merge-write: reads existing file, deep-merges `updates` into it,
    /// then atomically writes back. Only touches keys present in `updates`.
    static nlohmann::json Write(const std::filesystem::path& path,
                                const nlohmann::json& updates);

    /// Extract hardware info from a parsed vrsettings JSON.
    static SteamVrHardwareInfo ExtractHardwareInfo(const nlohmann::json& doc);

    /// Check if SteamVR processes (vrmonitor.exe / vrserver.exe) are running.
    static bool IsSteamVrRunning();
};

} // namespace vrcsm::core
