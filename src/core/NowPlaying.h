#pragma once

#include "Common.h" // vrcsm::core::Result / Error

#include <string>
#include <string_view>
#include <vector>

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

// Read the current (or preferred) media session. A missing session is NOT
// an error — it returns a snapshot with active=false and empty/zero fields.
// WinRT init failure (or any unexpected WinRT error) returns
// Error{"nowplaying_unavailable"}. Never throws. The underlying GSMTC async
// calls round-trip into the media source app and can stall, so each is
// bounded by an internal timeout (~1.5s); on timeout the call degrades to
// empty/partial data rather than blocking the caller's thread. Intended to
// be invoked off the UI thread.
//
// When `preferredAppId` is empty, this is GetCurrentSession() (the OS
// "now playing" session). When set, GetSessions() is searched for a matching
// AUMID and that session is used; if none match, falls back to current.
Result<NowPlayingSnapshot> ReadNowPlaying();
Result<NowPlayingSnapshot> ReadNowPlaying(std::string_view preferredAppId);

// Enumerate every GSMTC session (title/artist/status/app id). An empty
// list is NOT an error — CI / no-media returns ok + empty vector. Same
// timeout rail as ReadNowPlaying(); per-session property failures skip
// that session rather than failing the whole call.
Result<std::vector<NowPlayingSnapshot>> ReadNowPlayingSessions();

} // namespace vrcsm::core
