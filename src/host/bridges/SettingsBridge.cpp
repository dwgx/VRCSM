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
    if (!path) {
        throw std::runtime_error("SteamVR settings file not found.");
    }
    
    nlohmann::json doc = vrcsm::core::SteamVrConfig::Read(*path);
    auto hw = vrcsm::core::SteamVrConfig::ExtractHardwareInfo(doc);

    return nlohmann::json{
        {"steamvr", doc.value("steamvr", nlohmann::json::object())},
        {"driver_vrlink", doc.value("driver_vrlink", nlohmann::json::object())},
        {"hardware", {
            {"gpuVendor", hw.gpuVendor},
            {"gpuHorsepower", hw.gpuHorsepower},
            {"hmdModel", hw.hmdModel},
            {"hmdManufacturer", hw.hmdManufacturer},
            {"hmdDriver", hw.hmdDriver}
        }}
    };
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
