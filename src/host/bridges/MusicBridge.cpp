#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/NowPlaying.h"

// music.nowPlaying — read the system's currently-playing media (GSMTC) and
// return it as a snake_case snapshot matching the IPC contract in
// docs/NOW-PLAYING-OSC-PLAN.md. Registered in AsyncMethodSet() because
// ReadNowPlaying() makes WinRT calls that must run off the WebView2 UI thread.
nlohmann::json IpcBridge::HandleMusicNowPlaying(const nlohmann::json&, const std::optional<std::string>&)
{
    auto result = vrcsm::core::ReadNowPlaying();
    if (!vrcsm::core::isOk(result))
    {
        throw IpcException(std::get<vrcsm::core::Error>(std::move(result)));
    }

    const auto& snap = std::get<vrcsm::core::NowPlayingSnapshot>(result);
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
