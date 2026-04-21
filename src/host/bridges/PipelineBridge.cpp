#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/AuthStore.h"
#include "../../core/DiscordRpc.h"
#include "../../core/OscBridge.h"
#include "../../core/Pipeline.h"
#include "../../core/PngMetadata.h"
#include "../../core/ScreenshotWatcher.h"
#include "../../core/VrcApi.h"

// ─────────────────────────────────────────────────────────────────────────
// Pipeline bridge — exposes the Pipeline WebSocket client + the VRChat
// notifications inbox API to the frontend. The Pipeline class lives as a
// member on IpcBridge so we can start/stop it lazily (no socket if the
// user never signs in). Events arrive on the pipeline thread and are
// forwarded to the UI via PostEventToUi("pipeline.event", ...).
// ─────────────────────────────────────────────────────────────────────────

namespace
{

// Map the internal ConnState enum to a stable string the frontend can
// render without depending on the numeric value.
const char* StateToString(vrcsm::core::Pipeline::ConnState s)
{
    switch (s)
    {
    case vrcsm::core::Pipeline::ConnState::Stopped:      return "stopped";
    case vrcsm::core::Pipeline::ConnState::Connecting:   return "connecting";
    case vrcsm::core::Pipeline::ConnState::Connected:    return "connected";
    case vrcsm::core::Pipeline::ConnState::Reconnecting: return "reconnecting";
    }
    return "unknown";
}

} // namespace

nlohmann::json IpcBridge::HandlePipelineStart(const nlohmann::json&, const std::optional<std::string>&)
{
    if (!m_pipeline)
    {
        m_pipeline = std::make_unique<vrcsm::core::Pipeline>();
    }

    if (m_pipeline->IsRunning())
    {
        return nlohmann::json{
            {"ok", true},
            {"state", StateToString(m_pipeline->State())},
            {"already", true},
        };
    }

    // The worker thread posts events back to the UI via the bridge's
    // PostEventToUi. We capture `this` rather than the alive atomic
    // because IpcBridge owns Pipeline — Stop() in the IpcBridge dtor
    // joins before `this` is destroyed.
    m_pipeline->Start(
        [this](const std::string& type, const nlohmann::json& content)
        {
            PostEventToUi("pipeline.event",
                nlohmann::json{{"type", type}, {"content", content}});
        },
        [this](vrcsm::core::Pipeline::ConnState state, const std::string& detail)
        {
            PostEventToUi("pipeline.state",
                nlohmann::json{{"state", StateToString(state)}, {"detail", detail}});
        });

    return nlohmann::json{{"ok", true}, {"state", StateToString(m_pipeline->State())}};
}

nlohmann::json IpcBridge::HandlePipelineStop(const nlohmann::json&, const std::optional<std::string>&)
{
    if (m_pipeline)
    {
        m_pipeline->Stop();
    }
    return nlohmann::json{{"ok", true}};
}

// ── Notifications inbox ─────────────────────────────────────────────────

nlohmann::json IpcBridge::HandleNotificationsList(const nlohmann::json& params, const std::optional<std::string>&)
{
    const int count = ParamInt(params, "count", 100);
    auto result = vrcsm::core::VrcApi::fetchNotifications(count);
    if (vrcsm::core::isOk(result))
    {
        nlohmann::json arr = nlohmann::json::array();
        for (auto& entry : std::get<std::vector<nlohmann::json>>(result))
        {
            arr.push_back(std::move(entry));
        }
        return nlohmann::json{{"notifications", arr}};
    }
    throw IpcException(std::move(std::get<vrcsm::core::Error>(result)));
}

nlohmann::json IpcBridge::HandleNotificationsAccept(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto id = JsonStringField(params, "notificationId");
    if (!id.has_value() || id->empty())
    {
        throw std::runtime_error("notifications.accept: missing 'notificationId'");
    }
    return unwrapResult(vrcsm::core::VrcApi::acceptFriendRequest(*id));
}

nlohmann::json IpcBridge::HandleNotificationsRespond(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto id = JsonStringField(params, "notificationId");
    if (!id.has_value() || id->empty())
    {
        throw std::runtime_error("notifications.respond: missing 'notificationId'");
    }
    const int slot = ParamInt(params, "slot", 0);
    const auto message = JsonStringField(params, "message").value_or("");
    return unwrapResult(vrcsm::core::VrcApi::respondNotification(*id, slot, message));
}

nlohmann::json IpcBridge::HandleNotificationsSee(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto id = JsonStringField(params, "notificationId");
    if (!id.has_value() || id->empty())
    {
        throw std::runtime_error("notifications.see: missing 'notificationId'");
    }
    return unwrapResult(vrcsm::core::VrcApi::seeNotification(*id));
}

nlohmann::json IpcBridge::HandleNotificationsHide(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto id = JsonStringField(params, "notificationId");
    if (!id.has_value() || id->empty())
    {
        throw std::runtime_error("notifications.hide: missing 'notificationId'");
    }
    return unwrapResult(vrcsm::core::VrcApi::hideNotification(*id));
}

nlohmann::json IpcBridge::HandleNotificationsClear(const nlohmann::json&, const std::optional<std::string>&)
{
    return unwrapResult(vrcsm::core::VrcApi::clearNotifications());
}

nlohmann::json IpcBridge::HandleMessageSend(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto userId = JsonStringField(params, "userId");
    const auto message = JsonStringField(params, "message");
    if (!userId.has_value() || userId->empty())
    {
        throw std::runtime_error("message.send: missing 'userId'");
    }
    if (!message.has_value() || message->empty())
    {
        throw std::runtime_error("message.send: missing 'message'");
    }
    return unwrapResult(vrcsm::core::VrcApi::sendUserMessage(*userId, *message));
}

// ── Discord Rich Presence ───────────────────────────────────────────────

namespace
{
// Discord application id. There is intentionally no built-in default —
// every user must register their own app at
// https://discord.com/developers/applications and pass the snowflake
// through `params.clientId` (the frontend persists it to VrcConfig).
// Refusing the connection without a real id avoids "why does my
// Discord show generic VRCSM" complaints when the project hasn't
// shipped its own published app yet.

}

nlohmann::json IpcBridge::HandleDiscordSetActivity(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto overrideId = JsonStringField(params, "clientId");
    if (!overrideId.has_value() || overrideId->empty())
    {
        throw IpcException(vrcsm::core::Error{
            "discord_not_configured",
            "Discord application client_id missing — set it under Settings → Discord",
            0});
    }

    if (!m_discordRpc)
    {
        m_discordRpc = std::make_unique<vrcsm::core::DiscordRpc>();
        m_discordRpc->SetClientId(*overrideId);
        m_discordRpc->Start();
    }

    // Caller may pass either the full activity at the top level of
    // `params`, or a nested `activity` object. Accept both.
    nlohmann::json activity;
    if (params.contains("activity") && params["activity"].is_object())
    {
        activity = params["activity"];
    }
    else if (params.is_object())
    {
        activity = params;
        activity.erase("clientId"); // not part of the activity schema
    }

    m_discordRpc->SetActivity(std::move(activity));
    return nlohmann::json{{"ok", true}, {"connected", m_discordRpc->IsConnected()}};
}

nlohmann::json IpcBridge::HandleDiscordClearActivity(const nlohmann::json&, const std::optional<std::string>&)
{
    if (m_discordRpc)
    {
        m_discordRpc->ClearActivity();
    }
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleDiscordStatus(const nlohmann::json&, const std::optional<std::string>&)
{
    return nlohmann::json{
        {"running", m_discordRpc != nullptr},
        {"connected", m_discordRpc && m_discordRpc->IsConnected()},
    };
}

// ── OSC bridge ──────────────────────────────────────────────────────────

nlohmann::json IpcBridge::HandleOscSend(const nlohmann::json& params, const std::optional<std::string>&)
{
    if (!m_osc) m_osc = std::make_unique<vrcsm::core::OscBridge>();

    const auto address = JsonStringField(params, "address");
    if (!address.has_value() || address->empty() || (*address)[0] != '/')
    {
        throw std::runtime_error("osc.send: 'address' must be an OSC address starting with '/'");
    }

    const std::string host = JsonStringField(params, "host").value_or("127.0.0.1");
    const std::uint16_t port = static_cast<std::uint16_t>(ParamInt(params, "port", 9000));

    std::vector<vrcsm::core::OscArgument> args;
    if (params.contains("args") && params["args"].is_array())
    {
        args = vrcsm::core::OscArgumentsFromJson(params["args"]);
    }

    const bool ok = m_osc->Send(*address, args, host, port);
    return nlohmann::json{{"ok", ok}};
}

nlohmann::json IpcBridge::HandleOscListenStart(const nlohmann::json& params, const std::optional<std::string>&)
{
    if (!m_osc) m_osc = std::make_unique<vrcsm::core::OscBridge>();

    const std::uint16_t port = static_cast<std::uint16_t>(ParamInt(params, "port", 9001));

    // Capture `this` because IpcBridge owns the OscBridge — the Stop()
    // in the dtor joins before `this` is destroyed.
    const bool ok = m_osc->StartListen(
        [this](const std::string& address,
               const std::vector<vrcsm::core::OscArgument>& args)
        {
            PostEventToUi("osc.message",
                nlohmann::json{
                    {"address", address},
                    {"args", vrcsm::core::OscArgumentsToJson(args)},
                });
        },
        port);
    return nlohmann::json{{"ok", ok}, {"port", port}};
}

nlohmann::json IpcBridge::HandleOscListenStop(const nlohmann::json&, const std::optional<std::string>&)
{
    if (m_osc) m_osc->StopListen();
    return nlohmann::json{{"ok", true}};
}

// ── Screenshot metadata ─────────────────────────────────────────────────

nlohmann::json IpcBridge::HandleScreenshotsWatcherStart(const nlohmann::json& params, const std::optional<std::string>&)
{
    if (!m_screenshotWatcher)
    {
        m_screenshotWatcher = std::make_unique<vrcsm::core::ScreenshotWatcher>();
    }

    std::filesystem::path folder;
    if (auto explicitPath = JsonStringField(params, "folder"); explicitPath.has_value() && !explicitPath->empty())
    {
        folder = std::filesystem::path(vrcsm::core::toWide(*explicitPath));
    }
    else
    {
        folder = vrcsm::core::ScreenshotWatcher::DefaultScreenshotsFolder();
    }

    if (folder.empty())
    {
        throw std::runtime_error("screenshots.watcher.start: unable to resolve VRChat screenshots folder");
    }

    // Auto-inject can be disabled per call — useful if a plugin wants
    // to handle metadata itself and only needs the watcher notification.
    const bool autoInject =
        !(params.is_object() &&
          params.contains("autoInject") &&
          params["autoInject"].is_boolean() &&
          !params["autoInject"].get<bool>());

    const bool ok = m_screenshotWatcher->Start(folder,
        [this, autoInject](const std::filesystem::path& path)
        {
            nlohmann::json metadata;

            if (autoInject)
            {
                // Pull the current radar snapshot so world/instance/player
                // data from the moment of capture survives into the PNG —
                // matching VRCX's signature feature. Radar is
                // process-memory-read only; if VRChat isn't attached we
                // just skip the VRC fields.
                try
                {
                    const auto snap = m_radarEngine.PollOnce();
                    if (snap.vrcAttached)
                    {
                        if (!snap.worldId.empty()) metadata["vrcsm:world"] = snap.worldId;
                        if (!snap.instanceId.empty()) metadata["vrcsm:instance"] = snap.instanceId;

                        auto players = nlohmann::json::array();
                        std::string playerNames;
                        for (const auto& p : snap.players)
                        {
                            nlohmann::json entry{
                                {"displayName", p.displayName},
                                {"userId", p.userId},
                                {"isLocal", p.isLocal},
                            };
                            players.push_back(std::move(entry));
                            if (!playerNames.empty()) playerNames += ", ";
                            playerNames += p.displayName;
                        }
                        metadata["vrcsm:players"] = players.dump();
                        if (!playerNames.empty())
                        {
                            // Also provide a pre-flattened human-readable
                            // player list so tools like exiftool show
                            // something useful without JSON parsing.
                            metadata["Description"] =
                                fmt::format("Players: {}", playerNames);
                        }
                    }
                }
                catch (const std::exception& ex)
                {
                    spdlog::warn("screenshots.auto-inject: radar poll failed: {}", ex.what());
                }

                // Always stamp when + by whom regardless of radar state.
                metadata["vrcsm:capturedAt"] = vrcsm::core::nowIso();
                metadata["vrcsm:app"] = "VRCSM " VRCSM_VERSION_STRING;
                metadata["Software"] = "VRCSM " VRCSM_VERSION_STRING;

                (void)vrcsm::core::InjectPngTextFromJson(path, metadata);
            }

            // Fire the UI event after (best-effort) injection so Screenshots.tsx
            // can show the image with metadata already in place.
            PostEventToUi("screenshots.new",
                nlohmann::json{
                    {"path", vrcsm::core::toUtf8(path.wstring())},
                    {"metadata", std::move(metadata)},
                });
        });

    return nlohmann::json{
        {"ok", ok},
        {"folder", vrcsm::core::toUtf8(folder.wstring())},
    };
}

nlohmann::json IpcBridge::HandleScreenshotsWatcherStop(const nlohmann::json&, const std::optional<std::string>&)
{
    if (m_screenshotWatcher) m_screenshotWatcher->Stop();
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleScreenshotsInjectMetadata(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto rawPath = JsonStringField(params, "path");
    if (!rawPath.has_value() || rawPath->empty())
    {
        throw std::runtime_error("screenshots.injectMetadata: missing 'path'");
    }
    if (!params.contains("metadata") || !params["metadata"].is_object())
    {
        throw std::runtime_error("screenshots.injectMetadata: missing 'metadata' object");
    }

    const std::filesystem::path pngPath(vrcsm::core::toWide(*rawPath));
    const bool ok = vrcsm::core::InjectPngTextFromJson(pngPath, params["metadata"]);
    return nlohmann::json{{"ok", ok}};
}

nlohmann::json IpcBridge::HandleScreenshotsReadMetadata(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto rawPath = JsonStringField(params, "path");
    if (!rawPath.has_value() || rawPath->empty())
    {
        throw std::runtime_error("screenshots.readMetadata: missing 'path'");
    }

    const auto chunks = vrcsm::core::ReadPngTextChunks(std::filesystem::path(vrcsm::core::toWide(*rawPath)));
    nlohmann::json out = nlohmann::json::object();
    // Duplicate keys get the last-wins treatment so the UI sees the
    // most recent injection when VRCSM has been stamping the same
    // image repeatedly (e.g. user re-ran the watcher on a folder).
    for (const auto& [k, v] : chunks)
    {
        out[k] = v;
    }
    return nlohmann::json{{"metadata", out}};
}

nlohmann::json IpcBridge::HandleUserInviteTo(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto userId = JsonStringField(params, "userId");
    const auto location = JsonStringField(params, "location");
    if (!userId.has_value() || userId->empty())
    {
        throw std::runtime_error("user.inviteTo: missing 'userId'");
    }
    if (!location.has_value() || location->empty())
    {
        throw std::runtime_error("user.inviteTo: missing 'location'");
    }
    const int slot = ParamInt(params, "slot", 0);
    return unwrapResult(vrcsm::core::VrcApi::inviteUser(*userId, *location, slot));
}
