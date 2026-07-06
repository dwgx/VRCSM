#pragma once

#include "Common.h" // vrcsm::core::Result / Error

#include <string>

namespace vrcsm::core
{

// Snapshot of the system's currently-playing media, read via the Windows
// GlobalSystemMediaTransportControlsSessionManager (GSMTC). Purely a plain
// data struct — no Windows/WinRT types leak into this header so the rest of
// src/core (and the IPC layer) can consume it platform-agnostically.
struct NowPlayingSnapshot
{
    bool active = false; // is any media session present

    std::string title;
    std::string artist;
    std::string album;
    std::string status;  // "playing" | "paused" | "stopped"
    std::string appId;   // source AUMID, e.g. "Spotify.exe" / "msedge"
    std::string appName; // friendly form ("Spotify", "msedge")

    long long positionMs = 0;   // last-known playback position
    long long durationMs = 0;   // track length (0 if unknown)
    long long positionAtMs = 0; // epoch ms when position was sampled
    double playbackRate = 1.0;  // for client-side progress extrapolation

    bool hasThumbnail = false; // availability only (image out of scope)
};

// Read the current media session. A missing session is NOT an error — it
// returns a snapshot with active=false and empty/zero fields. WinRT init
// failure (or any unexpected WinRT error) returns Error{"nowplaying_unavailable"}.
// Never throws; never hangs (the underlying WinRT calls are cheap local ops).
Result<NowPlayingSnapshot> ReadNowPlaying();

} // namespace vrcsm::core
