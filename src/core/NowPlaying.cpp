// NowPlaying.cpp — read the system's currently-playing media via the Windows
// GlobalSystemMediaTransportControlsSessionManager (GSMTC) using the modern
// C++/WinRT projection.
//
// Include order matters: this project's pch.h already pulls in <Windows.h>
// with WIN32_LEAN_AND_MEAN + NOMINMAX. C++/WinRT headers must compile after
// those macros are set, so we (re)assert them here and include the winrt
// projection headers *before* any project header. We deliberately do NOT
// include pch.h to avoid dragging in wrl.h / WebView2 alongside the cppwinrt
// projection.

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <winerror.h> // RPC_E_CHANGED_MODE

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Media.Control.h>
#include <winrt/Windows.Storage.Streams.h>

#include "NowPlaying.h"

#include <cctype>
#include <chrono>
#include <string>
#include <string_view>

namespace wmc = winrt::Windows::Media::Control;

namespace vrcsm::core
{

namespace
{

// Ensure a WinRT apartment exists on the calling thread. init_apartment
// throws hresult_error(RPC_E_CHANGED_MODE) when the thread was already
// initialized in a different apartment model — that is fine, the thread is
// usable either way, so we swallow that specific error and continue. Any
// other failure is rethrown to the caller's try/catch.
void EnsureApartment()
{
    try
    {
        winrt::init_apartment(winrt::apartment_type::multi_threaded);
    }
    catch (const winrt::hresult_error& ex)
    {
        if (ex.code() != RPC_E_CHANGED_MODE)
        {
            throw;
        }
        // Already initialized in another apartment — safe to proceed.
    }
}

long long TimeSpanToMs(const winrt::Windows::Foundation::TimeSpan& ts)
{
    return std::chrono::duration_cast<std::chrono::milliseconds>(ts).count();
}

long long NowEpochMs()
{
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

std::string StatusToString(wmc::GlobalSystemMediaTransportControlsSessionPlaybackStatus status)
{
    using Status = wmc::GlobalSystemMediaTransportControlsSessionPlaybackStatus;
    switch (status)
    {
    case Status::Playing:
        return "playing";
    case Status::Paused:
        return "paused";
    case Status::Stopped:
    case Status::Closed:
        return "stopped";
    default:
        // Changing / Opened and any future value — treat as paused so the UI
        // shows a neutral, non-terminal state rather than an empty string.
        return "paused";
    }
}

// Derive a friendly app name from the source AUMID. GSMTC hands us values
// like "Spotify.exe" or "308046B0AF4A39CB" (a packaged app family). Keep it
// simple: strip a trailing ".exe" if present, otherwise pass the id through.
std::string FriendlyAppName(const std::string& appId)
{
    constexpr std::string_view kExe = ".exe";
    if (appId.size() > kExe.size())
    {
        const auto tail = appId.substr(appId.size() - kExe.size());
        std::string lowered;
        lowered.reserve(tail.size());
        for (char c : tail)
        {
            lowered.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
        }
        if (lowered == kExe)
        {
            return appId.substr(0, appId.size() - kExe.size());
        }
    }
    return appId;
}

} // namespace

Result<NowPlayingSnapshot> ReadNowPlaying()
{
    try
    {
        EnsureApartment();

        NowPlayingSnapshot snap;

        auto mgr = wmc::GlobalSystemMediaTransportControlsSessionManager::RequestAsync().get();
        if (!mgr)
        {
            return snap; // no manager — treat as no session, not an error
        }

        auto session = mgr.GetCurrentSession();
        if (!session)
        {
            return snap; // active stays false — this is the CI / no-media case
        }

        snap.active = true;

        // Media properties: title / artist / album / thumbnail availability.
        try
        {
            auto props = session.TryGetMediaPropertiesAsync().get();
            if (props)
            {
                snap.title = winrt::to_string(props.Title());
                snap.artist = winrt::to_string(props.Artist());
                snap.album = winrt::to_string(props.AlbumTitle());
                snap.hasThumbnail = props.Thumbnail() != nullptr;
            }
        }
        catch (const winrt::hresult_error&)
        {
            // Some sources fail this async even while a session exists; leave
            // the string fields empty rather than failing the whole read.
        }

        // Timeline: position / duration + the sample time for extrapolation.
        try
        {
            auto tl = session.GetTimelineProperties();
            snap.durationMs = TimeSpanToMs(tl.EndTime());
            snap.positionMs = TimeSpanToMs(tl.Position());
            snap.positionAtMs = NowEpochMs();
        }
        catch (const winrt::hresult_error&)
        {
        }

        // Playback info: status + rate.
        try
        {
            auto pi = session.GetPlaybackInfo();
            snap.status = StatusToString(pi.PlaybackStatus());
            if (auto rate = pi.PlaybackRate())
            {
                snap.playbackRate = rate.Value();
            }
        }
        catch (const winrt::hresult_error&)
        {
        }

        // Source app identity.
        snap.appId = winrt::to_string(session.SourceAppUserModelId());
        snap.appName = FriendlyAppName(snap.appId);

        return snap;
    }
    catch (const winrt::hresult_error& ex)
    {
        return Error{"nowplaying_unavailable", winrt::to_string(ex.message()), 0};
    }
    catch (const std::exception& ex)
    {
        return Error{"nowplaying_unavailable", ex.what(), 0};
    }
    catch (...)
    {
        return Error{"nowplaying_unavailable", "Unknown GSMTC failure", 0};
    }
}

} // namespace vrcsm::core
