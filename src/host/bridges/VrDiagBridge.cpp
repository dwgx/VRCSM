#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/VrDiagnostics.h"

nlohmann::json IpcBridge::HandleVrDiagnose(const nlohmann::json&, const std::optional<std::string>&)
{
    return unwrapResult(vrcsm::core::VrDiagnostics::RunDiagnostics());
}

nlohmann::json IpcBridge::HandleVrAudioSwitch(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto deviceId = JsonStringField(params, "deviceId");
    const auto role = JsonStringField(params, "role");
    if (!deviceId.has_value() || deviceId->empty())
        throw IpcException({"missing_field", "vr.audio.switch: missing 'deviceId'", 400});
    if (!role.has_value() || role->empty())
        throw IpcException({"missing_field", "vr.audio.switch: missing 'role'", 400});

    return unwrapResult(vrcsm::core::VrDiagnostics::SwitchAudioDevice(*deviceId, *role));
}
