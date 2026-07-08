#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/LyricsProxy.h"

// lyrics.fetch — proxy a plain HTTPS GET through the host so the web lyrics
// chain (LRCLIB + NetEase) can bypass WebView2's CORS/Referer restrictions.
// Registered in AsyncMethodSet() because it performs network I/O and must run
// off the WebView2 UI thread.
//
// Params:  { url: string, referer?: string }
// Returns: { status: number, body: string }
// Throws IpcException on the SSRF-rail rejection or a hard WinHTTP failure so
// the frontend receives a structured error (never a partial success).
nlohmann::json IpcBridge::HandleLyricsFetch(const nlohmann::json& params, const std::optional<std::string>&)
{
    if (!params.is_object() || !params.contains("url") || !params["url"].is_string())
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_params", "lyrics.fetch: missing 'url'", 0});
    }

    const std::string url = params["url"].get<std::string>();
    const std::string referer =
        (params.contains("referer") && params["referer"].is_string())
            ? params["referer"].get<std::string>()
            : std::string{};

    const auto res = vrcsm::core::LyricsFetch(url, referer);
    if (!res.error.empty())
    {
        // SSRF-rail rejection and hard WinHTTP failures both surface here with
        // status 0. Convert to a structured IPC error the frontend can treat
        // as "provider unavailable" and fall through gracefully.
        throw IpcException(vrcsm::core::Error{
            "lyrics_fetch_failed", res.error, 0});
    }

    return nlohmann::json{
        {"status", res.status},
        {"body", res.body},
    };
}
