#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/VrcSettings.h"
#include "../../core/VrcConfig.h"
#include "../../core/SteamVrConfig.h"

nlohmann::json IpcBridge::HandleSettingsReadAll(const nlohmann::json& params, const std::optional<std::string>&)
{
    return vrcsm::core::VrcSettings::ReadAllJson(params);
}

nlohmann::json IpcBridge::HandleSettingsWriteOne(const nlohmann::json& params, const std::optional<std::string>&)
{
    return vrcsm::core::VrcSettings::WriteOneJson(params);
}

nlohmann::json IpcBridge::HandleSettingsExportReg(const nlohmann::json& params, const std::optional<std::string>&)
{
    return vrcsm::core::VrcSettings::ExportRegJson(params);
}

nlohmann::json IpcBridge::HandleConfigRead(const nlohmann::json& params, const std::optional<std::string>&)
{
    return vrcsm::core::VrcConfig::ReadJson(params);
}

nlohmann::json IpcBridge::HandleConfigWrite(const nlohmann::json& params, const std::optional<std::string>&)
{
    return vrcsm::core::VrcConfig::WriteJson(params);
}

nlohmann::json IpcBridge::HandleSteamVrRead(const nlohmann::json& params, const std::optional<std::string>& id)
{
    (void)params;
    (void)id;
    auto path = vrcsm::core::SteamVrConfig::DetectVrSettingsPath();
    if (!path)
    {
        // Return structured error so the frontend can silently hide the tab.
        return nlohmann::json{
            {"error", {{"code", "not_found"}, {"message", "steamvr.vrsettings not found"}}}};
    }
    // Read() already returns { ok, path, hardware, driver_vrlink, steamvr,
    // steamvr_running, knownDevices } — hand it straight to the frontend.
    return vrcsm::core::SteamVrConfig::Read(*path);
}

nlohmann::json IpcBridge::HandleSteamVrWrite(const nlohmann::json& params, const std::optional<std::string>& id)
{
    (void)id;
    if (vrcsm::core::SteamVrConfig::IsSteamVrRunning()) {
        throw std::runtime_error("Cannot write SteamVR settings while SteamVR is running.");
    }
    
    auto path = vrcsm::core::SteamVrConfig::DetectVrSettingsPath();
    if (!path) {
        throw std::runtime_error("SteamVR settings file not found.");
    }

    vrcsm::core::SteamVrConfig::Write(*path, params);
    return nlohmann::json{
        {"success", true},
        {"message", "SteamVR settings written successfully."}
    };
}
