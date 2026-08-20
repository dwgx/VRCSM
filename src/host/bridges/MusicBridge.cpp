#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/NowPlaying.h"

#include <vector>

namespace
{

nlohmann::json SnapshotToJson(const vrcsm::core::NowPlayingSnapshot& snap)
{
    return nlohmann::json{
        {"active", snap.active},
        {"title", snap.title},
        {"artist", snap.artist},
        {"album", snap.album},
        {"status", snap.status},
        {"app_id", snap.appId},
        {"app_name", snap.appName},
        {"position_ms", snap.positionMs},
        {"duration_ms", snap.durationMs},
        {"position_at_ms", snap.positionAtMs},
        {"playback_rate", snap.playbackRate},
        {"has_thumbnail", snap.hasThumbnail},
    };
}

nlohmann::json SessionToJson(const vrcsm::core::NowPlayingSnapshot& snap)
{
    // music.sessions lists the picker-facing subset. Emit both camelCase
    // (task contract) and snake_case (matches music.nowPlaying) so either
    // consumer can read it.
    return nlohmann::json{
        {"appId", snap.appId},
        {"appName", snap.appName},
        {"title", snap.title},
        {"artist", snap.artist},
        {"status", snap.status},
        {"app_id", snap.appId},
        {"app_name", snap.appName},
        {"album", snap.album},
        {"active", snap.active},
    };
}

std::string PreferredAppId(const nlohmann::json& params)
{
    if (!params.is_object())
    {
        return {};
    }
    if (auto appId = JsonStringField(params, "appId"))
    {
        return *appId;
    }
    if (auto appId = JsonStringField(params, "app_id"))
    {
        return *appId;
    }
    return {};
}

} // namespace

// music.nowPlaying — read the system's currently-playing media (GSMTC) and
// return it as a snake_case snapshot matching the IPC contract in
// docs/NOW-PLAYING-OSC-PLAN.md. Optional `{ appId }` / `{ app_id }` selects
// a session from GetSessions() instead of GetCurrentSession(). Registered
// in AsyncMethodSet() because ReadNowPlaying() makes WinRT calls that must
// run off the WebView2 UI thread.
nlohmann::json IpcBridge::HandleMusicNowPlaying(const nlohmann::json& params, const std::optional<std::string>&)
{
    const std::string appId = PreferredAppId(params);
    auto result = appId.empty()
        ? vrcsm::core::ReadNowPlaying()
        : vrcsm::core::ReadNowPlaying(appId);
    if (!vrcsm::core::isOk(result))
    {
        throw IpcException(std::get<vrcsm::core::Error>(std::move(result)));
    }

    return SnapshotToJson(std::get<vrcsm::core::NowPlayingSnapshot>(result));
}

// music.sessions — enumerate GSMTC sessions for the Now Playing picker.
nlohmann::json IpcBridge::HandleMusicSessions(const nlohmann::json&, const std::optional<std::string>&)
{
    auto result = vrcsm::core::ReadNowPlayingSessions();
    if (!vrcsm::core::isOk(result))
    {
        throw IpcException(std::get<vrcsm::core::Error>(std::move(result)));
    }

    nlohmann::json sessions = nlohmann::json::array();
    for (const auto& snap : std::get<std::vector<vrcsm::core::NowPlayingSnapshot>>(result))
    {
        sessions.push_back(SessionToJson(snap));
    }
    return nlohmann::json{{"sessions", std::move(sessions)}};
}
