#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/VrDiagnostics.h"

nlohmann::json IpcBridge::HandleVrDiagnose(const nlohmann::json&, const std::optional<std::string>&)
{
    auto res = vrcsm::core::VrDiagnostics::RunDiagnostics();
    if (std::holds_alternative<vrcsm::core::Error>(res))
        throw IpcException(std::get<vrcsm::core::Error>(res));
    nlohmann::json j;
    vrcsm::core::to_json(j, std::get<vrcsm::core::VrDiagResult>(res));
    return j;
}

nlohmann::json IpcBridge::HandleVrAudioSwitch(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto deviceId = JsonStringField(params, "deviceId");
    const auto role = JsonStringField(params, "role");
    if (!deviceId.has_value() || deviceId->empty())
        throw IpcException({"missing_field", "vr.audio.switch: missing 'deviceId'", 400});
    if (!role.has_value() || role->empty())
        throw IpcException({"missing_field", "vr.audio.switch: missing 'role'", 400});

    auto res = vrcsm::core::VrDiagnostics::SwitchAudioDevice(*deviceId, *role);
    if (std::holds_alternative<vrcsm::core::Error>(res))
        throw IpcException(std::get<vrcsm::core::Error>(res));
    return std::get<nlohmann::json>(res);
}
