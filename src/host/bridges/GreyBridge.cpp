#include "../../pch.h"
#include "BridgeCommon.h"
#include "GreyBridge.h"

#include "../../core/GreyAudit.h"
#include "../../core/GreyPrefs.h"
#include "../../core/InviteSlots.h"
#include "../../core/PlayspaceOffset.h"
#include "../../core/VrcApi.h"

#include <mutex>

namespace
{

using vrcsm::core::Error;
using vrcsm::core::isOk;
using vrcsm::core::value;
using vrcsm::core::error;

Error GreyDisabledError()
{
    return Error{"grey_disabled", "Optional social/VR helpers are disabled", 403};
}

vrcsm::core::GreyPrefs LoadOrThrow()
{
    auto loaded = vrcsm::core::LoadGreyPrefs();
    if (!isOk(loaded))
    {
        throw IpcException(error(loaded));
    }
    return value(loaded);
}

void RequireGreyEnabled()
{
    if (!LoadOrThrow().greyEnabled)
    {
        throw IpcException(GreyDisabledError());
    }
}

nlohmann::json MessagesEnvelope(const nlohmann::json& raw)
{
    return nlohmann::json{{"messages", vrcsm::core::NormalizeInviteSlotMessages(raw)}};
}

void AuditBestEffort(std::string_view action, const nlohmann::json& detail)
{
    (void)vrcsm::core::AppendGreyAudit("inviteSlots", action, detail);
}

} // namespace

nlohmann::json IpcBridge::HandleGreyPrefsGet(const nlohmann::json&, const std::optional<std::string>&)
{
    const auto prefs = LoadOrThrow();
    return nlohmann::json{{"prefs", vrcsm::core::GreyPrefsToJson(prefs)}};
}

nlohmann::json IpcBridge::HandleGreyPrefsSet(const nlohmann::json& params, const std::optional<std::string>&)
{
    nlohmann::json patch = nlohmann::json::object();
    if (params.is_object() && params.contains("patch"))
    {
        patch = params["patch"];
    }
    else if (params.is_object())
    {
        patch = params;
        patch.erase("id");
    }

    const auto current = LoadOrThrow();
    auto merged = vrcsm::core::MergeGreyPrefsPatch(current, patch);
    if (!isOk(merged))
    {
        throw IpcException(error(merged));
    }
    const auto saved = vrcsm::core::SaveGreyPrefs(value(merged));
    if (!isOk(saved))
    {
        throw IpcException(error(saved));
    }
    GreyOnPrefsChanged(value(merged));
    return nlohmann::json{{"prefs", vrcsm::core::GreyPrefsStore::Redact(value(merged))}};
}

nlohmann::json IpcBridge::HandleInviteSlotsList(const nlohmann::json& params, const std::optional<std::string>&)
{
    RequireGreyEnabled();
    const auto type = JsonStringField(params, "type");
    if (!type.has_value() || type->empty())
    {
        throw IpcException(Error{"invalid_params", "inviteSlots.list: missing 'type'", 400});
    }
    if (!vrcsm::core::IsLiveInviteSlotType(*type))
    {
        throw IpcException(Error{"invalid_params", "inviteSlots.list: unknown type", 400});
    }
    return MessagesEnvelope(unwrapResult(vrcsm::core::VrcApi::fetchSavedMessages(*type)));
}

nlohmann::json IpcBridge::HandleInviteSlotsUpdate(const nlohmann::json& params, const std::optional<std::string>&)
{
    RequireGreyEnabled();
    const auto type = JsonStringField(params, "type");
    const auto message = JsonStringField(params, "message");
    if (!type.has_value() || !message.has_value())
    {
        throw IpcException(Error{"invalid_params", "inviteSlots.update: type and message required", 400});
    }
    const int slot = ParamInt(params, "slot", -1);
    unwrapResult(vrcsm::core::VrcApi::updateSavedMessage(*type, slot, *message));
    AuditBestEffort("slots.update", nlohmann::json{{"type", *type}, {"slot", slot}});
    return MessagesEnvelope(unwrapResult(vrcsm::core::VrcApi::fetchSavedMessages(*type)));
}

nlohmann::json IpcBridge::HandleInviteSlotsReset(const nlohmann::json& params, const std::optional<std::string>&)
{
    RequireGreyEnabled();
    const auto type = JsonStringField(params, "type");
    if (!type.has_value())
    {
        throw IpcException(Error{"invalid_params", "inviteSlots.reset: type required", 400});
    }
    const int slot = ParamInt(params, "slot", -1);
    unwrapResult(vrcsm::core::VrcApi::resetSavedMessage(*type, slot));
    AuditBestEffort("slots.reset", nlohmann::json{{"type", *type}, {"slot", slot}});
    return MessagesEnvelope(unwrapResult(vrcsm::core::VrcApi::fetchSavedMessages(*type)));
}

nlohmann::json IpcBridge::HandleInviteSlotsSendInvite(const nlohmann::json& params, const std::optional<std::string>&)
{
    RequireGreyEnabled();
    const auto userId = JsonStringField(params, "userId");
    const auto location = JsonStringField(params, "location");
    if (!userId.has_value() || userId->empty())
    {
        throw IpcException(Error{"invalid_params", "inviteSlots.sendInvite: missing 'userId'", 400});
    }
    if (!location.has_value() || location->empty())
    {
        throw IpcException(Error{"invalid_params", "inviteSlots.sendInvite: missing 'location'", 400});
    }
    const int slot = ParamInt(params, "slot", 0);
    if (slot < 0 || slot > 11)
    {
        throw IpcException(Error{"invalid_params", "slot must be an integer in 0..11", 400});
    }
    if (const auto gate = vrcsm::core::ConsumeInviteSlotSendGate(); !isOk(gate))
    {
        throw IpcException(error(gate));
    }
    unwrapResult(vrcsm::core::VrcApi::inviteUser(*userId, *location, slot));
    AuditBestEffort("slots.send", nlohmann::json{
        {"kind", "invite"},
        {"userId", *userId},
        {"slot", slot},
    });
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleInviteSlotsSendRequest(const nlohmann::json& params, const std::optional<std::string>&)
{
    RequireGreyEnabled();
    const auto userId = JsonStringField(params, "userId");
    if (!userId.has_value() || userId->empty())
    {
        throw IpcException(Error{"invalid_params", "inviteSlots.sendRequest: missing 'userId'", 400});
    }
    const int slot = ParamInt(params, "slot", 0);
    if (slot < 0 || slot > 11)
    {
        throw IpcException(Error{"invalid_params", "slot must be an integer in 0..11", 400});
    }
    if (const auto gate = vrcsm::core::ConsumeInviteSlotSendGate(); !isOk(gate))
    {
        throw IpcException(error(gate));
    }
    unwrapResult(vrcsm::core::VrcApi::requestInvite(*userId, slot));
    AuditBestEffort("slots.send", nlohmann::json{
        {"kind", "request"},
        {"userId", *userId},
        {"slot", slot},
    });
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleInviteSlotsRespond(const nlohmann::json& params, const std::optional<std::string>&)
{
    RequireGreyEnabled();
    const auto notificationId = JsonStringField(params, "notificationId");
    if (!notificationId.has_value() || notificationId->empty())
    {
        throw IpcException(Error{"invalid_params", "inviteSlots.respond: missing 'notificationId'", 400});
    }
    const int slot = ParamInt(params, "slot", 0);
    const std::string message = JsonStringField(params, "message").value_or("");
    unwrapResult(vrcsm::core::VrcApi::respondNotification(*notificationId, slot, message));
    AuditBestEffort("slots.send", nlohmann::json{
        {"kind", "respond"},
        {"notificationId", *notificationId},
        {"slot", slot},
    });
    return nlohmann::json{{"ok", true}};
}

namespace
{

vrcsm::core::PlayspaceOffset& PlayspaceInstance()
{
    static vrcsm::core::PlayspaceOffset inst;
    return inst;
}

nlohmann::json PlayspaceStatusOrThrow(vrcsm::core::Result<vrcsm::core::PlayspaceStatus> r)
{
    if (!isOk(r)) throw IpcException(error(r));
    nlohmann::json j;
    to_json(j, value(r));
    return j;
}

} // namespace

nlohmann::json IpcBridge::HandlePlayspaceStatus(const nlohmann::json&, const std::optional<std::string>&)
{
    RequireGreyEnabled();
    return PlayspaceInstance().statusJson();
}

nlohmann::json IpcBridge::HandlePlayspaceStart(const nlohmann::json&, const std::optional<std::string>&)
{
    RequireGreyEnabled();
    return PlayspaceStatusOrThrow(PlayspaceInstance().start(true));
}

nlohmann::json IpcBridge::HandlePlayspaceStop(const nlohmann::json&, const std::optional<std::string>&)
{
    RequireGreyEnabled();
    return PlayspaceStatusOrThrow(PlayspaceInstance().stop());
}

nlohmann::json IpcBridge::HandlePlayspaceSetLocks(const nlohmann::json& params, const std::optional<std::string>&)
{
    RequireGreyEnabled();
    std::optional<bool> x, y, z;
    if (params.is_object())
    {
        if (params.contains("lockX") && params["lockX"].is_boolean()) x = params["lockX"].get<bool>();
        if (params.contains("lockY") && params["lockY"].is_boolean()) y = params["lockY"].get<bool>();
        if (params.contains("lockZ") && params["lockZ"].is_boolean()) z = params["lockZ"].get<bool>();
    }
    auto r = PlayspaceInstance().setLocks(x, y, z);
    if (!isOk(r)) throw IpcException(error(r));
    nlohmann::json locks;
    to_json(locks, value(r));
    return nlohmann::json{{"locks", locks}};
}

nlohmann::json IpcBridge::HandlePlayspaceNudge(const nlohmann::json& params, const std::optional<std::string>&)
{
    RequireGreyEnabled();
    const float dx = params.is_object() && params.contains("dx") && params["dx"].is_number()
        ? params["dx"].get<float>() : 0.f;
    const float dy = params.is_object() && params.contains("dy") && params["dy"].is_number()
        ? params["dy"].get<float>() : 0.f;
    const float dz = params.is_object() && params.contains("dz") && params["dz"].is_number()
        ? params["dz"].get<float>() : 0.f;
    auto r = PlayspaceInstance().nudge(dx, dy, dz);
    if (!isOk(r)) throw IpcException(error(r));
    nlohmann::json offset;
    to_json(offset, value(r));
    return nlohmann::json{{"offset", offset}};
}

nlohmann::json IpcBridge::HandlePlayspaceReset(const nlohmann::json&, const std::optional<std::string>&)
{
    RequireGreyEnabled();
    auto r = PlayspaceInstance().reset();
    if (!isOk(r)) throw IpcException(error(r));
    nlohmann::json offset;
    to_json(offset, value(r));
    return nlohmann::json{{"offset", offset}};
}
