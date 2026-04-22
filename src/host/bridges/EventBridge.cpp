#include "../../pch.h"
#include "BridgeCommon.h"
#include "../../core/Database.h"

nlohmann::json IpcBridge::HandleEventStart(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto name = JsonStringField(params, "name");
    if (!name.has_value() || name->empty())
        throw IpcException({"missing_field", "event.start: missing 'name'", 400});

    vrcsm::core::Database::EventRecordingInsert e;
    e.name = *name;
    if (params.contains("world_id") && params["world_id"].is_string())
        e.world_id = params["world_id"].get<std::string>();
    if (params.contains("instance_id") && params["instance_id"].is_string())
        e.instance_id = params["instance_id"].get<std::string>();

    return unwrapResult(vrcsm::core::Database::Instance().StartRecording(e));
}

nlohmann::json IpcBridge::HandleEventStop(const nlohmann::json& params, const std::optional<std::string>&)
{
    const int64_t id = ParamInt(params, "id", 0);
    if (id <= 0) throw IpcException({"missing_field", "event.stop: missing 'id'", 400});
    const auto r = vrcsm::core::Database::Instance().StopRecording(id);
    if (std::holds_alternative<vrcsm::core::Error>(r))
        throw IpcException(std::get<vrcsm::core::Error>(r));
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleEventList(const nlohmann::json&, const std::optional<std::string>&)
{
    return unwrapResult(vrcsm::core::Database::Instance().ListRecordings());
}

nlohmann::json IpcBridge::HandleEventAttendees(const nlohmann::json& params, const std::optional<std::string>&)
{
    const int64_t id = ParamInt(params, "recording_id", 0);
    if (id <= 0) throw IpcException({"missing_field", "event.attendees: missing 'recording_id'", 400});
    return unwrapResult(vrcsm::core::Database::Instance().RecordingAttendees(id));
}

nlohmann::json IpcBridge::HandleEventAddAttendee(const nlohmann::json& params, const std::optional<std::string>&)
{
    const int64_t recId = ParamInt(params, "recording_id", 0);
    const auto userId = JsonStringField(params, "user_id");
    const auto displayName = JsonStringField(params, "display_name");
    if (recId <= 0 || !userId.has_value() || !displayName.has_value())
        throw IpcException({"missing_field", "event.addAttendee: missing required fields", 400});

    const auto r = vrcsm::core::Database::Instance().AddAttendee(recId, *userId, *displayName);
    if (std::holds_alternative<vrcsm::core::Error>(r))
        throw IpcException(std::get<vrcsm::core::Error>(r));
    return nlohmann::json{{"ok", true}};
}
