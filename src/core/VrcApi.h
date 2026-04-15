#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

// One thumbnail lookup — URL is the best image we could resolve for an
// avatar/world id, or std::nullopt when the remote API had nothing to say.
// `cached` means "served from local disk cache, no network hit".
struct ThumbnailResult
{
    std::string id;
    std::optional<std::string> url;
    bool cached{false};
    std::optional<std::string> error;
};

void to_json(nlohmann::json& j, const ThumbnailResult& r);

/// Public VRChat API lookup for avatar + world thumbnails.
///
/// Every call consults an on-disk JSON cache under %LocalAppData%\VRCSM
/// before hitting the network — once an id has been resolved we never call
/// out again unless the user manually invalidates the cache. Worlds are
/// straightforward (public endpoint, reliable `thumbnailImageUrl`). Most
/// user avatars are private and will return 401 from the VRChat API — we
/// remember the miss so the frontend can gracefully fall back to the
/// procedural cube preview without hammering the API on every scroll.
class VrcApi
{
public:
    // Single id lookup. Prefix is auto-detected (`wrld_*` or `avtr_*`).
    static ThumbnailResult fetchThumbnail(const std::string& id);

    // Batch variant — returns results in the same order the caller asked
    // for. Used by the IPC batch handler so the frontend can request
    // everything visible on screen in one round-trip.
    static std::vector<ThumbnailResult> fetchThumbnails(const std::vector<std::string>& ids);

    // Auth-gated VRChat endpoints. They require a real VRChat browser
    // session cookie in the `AuthStore`, which is populated by the host's
    // WebView2 login window (see `AuthLoginWindow`) — VRCSM does not run
    // its own password / 2FA / Steam-OAuth flow. `fetchCurrentUser` uses
    // nullopt specifically for the "session expired / not logged in" case
    // so callers can sign out cleanly without guessing from exception
    // strings.
    static std::optional<nlohmann::json> fetchCurrentUser();
    static std::vector<nlohmann::json> fetchFriends(bool offline);

    /// Full avatar detail record for an `avtr_*` id. Returns the raw JSON
    /// from `/api/1/avatars/{id}` so the frontend can show whatever
    /// fields are populated (description, author, tags, release status,
    /// unity packages, version, etc.) without a second round-trip.
    /// `nullopt` on 401 / 404 — anonymous callers and private-avatar
    /// misses both resolve to "nothing to show" rather than raising.
    static std::optional<nlohmann::json> fetchAvatarDetails(const std::string& avatarId);
};

} // namespace vrcsm::core
