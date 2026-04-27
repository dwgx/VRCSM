#pragma once

#include "Common.h"

#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

struct NetworkAdapter
{
    std::string name;
    std::string description;
    std::string ipAddress;
    bool isVirtual{false};
    bool isUp{false};
};

void to_json(nlohmann::json& j, const NetworkAdapter& a);

struct VrDiagResult
{
    // Network
    std::vector<NetworkAdapter> adapters;
    std::vector<std::string> networkWarnings;

    // SteamVR
    bool steamvrRunning{false};
    std::string hmdModel;
    std::string hmdDriver;
    int preferredRefreshRate{0};
    double supersampleScale{0};
    int targetBandwidth{0};
    bool motionSmoothing{false};
    bool allowSupersampleFiltering{false};
    std::string preferredCodec;

    // GPU (via DXGI)
    std::string gpuName;
    uint64_t gpuVramBytes{0};
    std::string gpuDriverVersion; // may be empty

    // Audio
    std::string defaultPlaybackDevice;
    std::string defaultRecordingDevice;
    bool steamSpeakersFound{false};
    bool steamMicFound{false};

    // vrlink
    std::vector<std::string> vrlinkErrors;
    int vrlinkBadLinkEvents{0};
    int vrlinkDroppedFrames{0};
    double vrlinkAvgBitrateMbps{0};
    double vrlinkMaxLatencyMs{0};
};

void to_json(nlohmann::json& j, const VrDiagResult& r);

class VrDiagnostics
{
public:
    static Result<VrDiagResult> RunDiagnostics();

    static Result<nlohmann::json> DiagnoseSteamLink();

    static Result<nlohmann::json> RepairSteamLink(const nlohmann::json& params);

    static Result<nlohmann::json> ListSteamLinkBackups();

    static Result<nlohmann::json> RestoreSteamLinkBackup(const nlohmann::json& params);

    static bool IsSteamLinkRestoreTargetAllowed(
        const std::filesystem::path& steamPath,
        const std::optional<std::filesystem::path>& localAppData,
        const std::filesystem::path& target);

    static bool IsSteamLinkBackupSourceAllowed(
        const std::filesystem::path& backupDir,
        const std::filesystem::path& source,
        bool requireCanonical);

    static Result<nlohmann::json> SwitchAudioDevice(
        const std::string& deviceId, const std::string& role);

    static std::vector<NetworkAdapter> ScanAdapters();

    static std::vector<std::string> ParseVrlinkErrors(
        const std::filesystem::path& logPath, int tailLines = 200);
};

} // namespace vrcsm::core
