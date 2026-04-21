#pragma once

#include "Common.h"

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

// Outcome of a native VRChat login attempt. Mirrors VRChat's own
// /api/1/auth/user contract: a successful password check either
// returns the full user object (logged in, no 2FA gate) or a
// `requiresTwoFactorAuth` array telling us which second factor to
// prompt for. Every other outcome (bad credentials, captcha, service
// down) surfaces as an `error`.
struct LoginResult
{
    enum class Status
    {
        Success,        // cookies captured + user payload present
        Requires2FA,    // need a second-factor code (totp/emailOtp/…)
        Error,          // everything else — surface `error` to the UI
    };

    Status status{Status::Error};
    // "totp", "emailOtp", "otp" — copied verbatim from the VRChat
    // `requiresTwoFactorAuth` array. First method is the primary
    // prompt the UI should show.
    std::vector<std::string> twoFactorMethods;
    // Full /auth/user payload. Populated on Success; on Requires2FA the
    // VRChat endpoint returns a stub ({ requiresTwoFactorAuth: [...] })
    // which we still forward for debugging but never render.
    std::optional<nlohmann::json> user;
    // Short, user-safe message. We try to lift VRChat's own `error.message`
    // when the response JSON includes one; otherwise a synthesised
    // "HTTP 500" style fallback.
    std::optional<std::string> error;
    // Populated when Status == Error and we could attribute it to HTTP —
    // helps the frontend distinguish "wrong password" (401) from
    // "service down" (5xx).
    int httpStatus{0};
};

// Outcome of a 2FA code verification. Success means the
// `twoFactorAuth` cookie is now persisted in AuthStore and the
// normal `fetchCurrentUser()` probe will succeed; failure means the
// code was wrong, expired, or VRChat rejected it for some other
// reason we surface in `error`.
struct VerifyResult
{
    bool ok{false};
    std::optional<std::string> error;
    int httpStatus{0};
};

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
    // session cookie in the `AuthStore`, which is populated by the
    // native password/2FA flow (`loginWithPassword` + `verifyTwoFactor`
    // below). `fetchCurrentUser` uses nullopt specifically for the
    // "session expired / not logged in" case so callers can sign out
    // cleanly without guessing from exception strings.
    static Result<nlohmann::json> fetchCurrentUser();
    static Result<std::vector<nlohmann::json>> fetchFriends(bool offline);
    static Result<std::vector<nlohmann::json>> fetchGroups();
    static Result<std::vector<nlohmann::json>> fetchPlayerModerations();
    static Result<std::vector<nlohmann::json>> fetchFavoritedAvatars();
    static Result<std::vector<nlohmann::json>> fetchFavoritedWorlds();

    // GET /calendar — upcoming VRChat official events. Returns an array
    // of event objects (id, name, starts_at, ends_at, world_id, image_url,
    // region, etc). Public-ish endpoint but we still send the cookie so
    // users see region-appropriate / personalised events when signed in.
    static Result<std::vector<nlohmann::json>> fetchCalendar();

    // Downloads the resource at the specified VRChat Cloudflare URL directly to
    // the filesystem using the active WinHTTP authentication session.
    static bool downloadFile(const std::string& url, const std::filesystem::path& destPath);

    /// Native VRChat login — /api/1/auth/user with HTTP Basic auth.
    /// Captures the `auth` cookie into AuthStore on success, or returns
    /// `Requires2FA` when VRChat gates us behind TOTP / email OTP. On
    /// any other failure (bad password, captcha wall, service down) the
    /// result carries a user-safe error string and we leave AuthStore
    /// alone — no partial state.
    static LoginResult loginWithPassword(
        const std::string& username,
        const std::string& password);

    /// Verify a 2FA code against one of the `twoFactorMethods` VRChat
    /// returned from `loginWithPassword`. `method` is "totp" or
    /// "emailOtp" (maps 1:1 to the /api/1/auth/twofactorauth/<method>/
    /// verify endpoint). Success stores the returned `twoFactorAuth`
    /// cookie alongside the existing `auth` cookie — after that,
    /// `fetchCurrentUser()` will return the full user record.
    static VerifyResult verifyTwoFactor(
        const std::string& method,
        const std::string& code);

    /// Full avatar detail record for an `avtr_*` id. Returns the raw JSON
    /// from `/api/1/avatars/{id}` so the frontend can show whatever
    /// fields are populated (description, author, tags, release status,
    /// unity packages, version, etc.) without a second round-trip.
    /// `nullopt` on 401 / 404 — anonymous callers and private-avatar
    /// misses both resolve to "nothing to show" rather than raising.
    static Result<nlohmann::json> fetchAvatarDetails(const std::string& avatarId);

    /// Full world detail record for a `wrld_*` id. Returns raw JSON
    /// from `/api/1/worlds/{id}`. Error on 401/404 with structured code.
    static Result<nlohmann::json> fetchWorldDetails(const std::string& worldId);

    /// Look up a user by id via `/api/1/users/{id}`. Raw payload is passed
    /// through for the frontend. Returns structured Error on 401/404/network.
    static Result<nlohmann::json> fetchUser(const std::string& userId);

    /// Switch the current session's active avatar via
    /// `PUT /api/1/avatars/{id}/select`. Returns `{ok:true}` on success,
    /// structured Error on auth/network failure.
    static Result<nlohmann::json> selectAvatar(const std::string& avatarId);

    /// Search public avatars via `GET /api/1/avatars?releaseStatus=public&search=...`.
    static Result<nlohmann::json> searchAvatars(
        const std::string& query, int count = 20, int offset = 0);

    /// Patch the authenticated user's profile via
    /// `PUT /api/1/users/{id}`. Only fields present in `patch` are sent;
    /// everything else is preserved server-side. Returns the updated
    /// user JSON on success, structured Error on auth failure.
    static Result<nlohmann::json> updateAuthUser(const nlohmann::json& patch);

    /// Self-invite to a friend's instance via POST /api/1/invite/myself.
    static Result<nlohmann::json> inviteSelf(const std::string& instanceLocation);

    /// Add a player moderation (mute or block) via POST /api/1/auth/user/playermoderations.
    static Result<nlohmann::json> addPlayerModeration(const std::string& type, const std::string& targetUserId);

    /// Remove a player moderation via DELETE /api/1/auth/user/playermoderations/{id}.
    static Result<nlohmann::json> removePlayerModeration(const std::string& moderationId);

    /// List notifications for the signed-in user via GET
    /// `/api/1/auth/user/notifications?type=all&hidden=false&n=100`. VRChat
    /// returns entries with `{id, senderUserId, senderUsername, type,
    /// message, details, seen, created_at}`. `type` covers invite,
    /// requestInvite, inviteResponse, friendRequest, message, votetokick,
    /// etc. Returns raw array for the frontend to render.
    static Result<std::vector<nlohmann::json>> fetchNotifications(int count = 100);

    /// Accept a pending friend request (the notification `type` must be
    /// `friendRequest`) via PUT
    /// `/api/1/auth/user/notifications/{id}/accept`. Returns VRChat's
    /// confirmation payload.
    static Result<nlohmann::json> acceptFriendRequest(const std::string& notificationId);

    /// Respond to an invite / requestInvite notification via POST
    /// `/api/1/invite/{notificationId}/response` — VRChat's own endpoint
    /// the official client uses to send yes/no. `responseSlot` is an
    /// index into the user's saved response messages (0-n), `message` is
    /// the free-text body.
    static Result<nlohmann::json> respondNotification(
        const std::string& notificationId,
        int responseSlot,
        const std::string& message);

    /// Mark a notification as seen (unread → read) via PUT
    /// `/api/1/auth/user/notifications/{id}/see`. Fire-and-forget —
    /// lets the inbox badge reset on other clients.
    static Result<nlohmann::json> seeNotification(const std::string& notificationId);

    /// Mark a notification hidden (delete from inbox) via PUT
    /// `/api/1/auth/user/notifications/{id}/hide`.
    static Result<nlohmann::json> hideNotification(const std::string& notificationId);

    /// Clear *all* notifications of a given type (or every type when
    /// `type` is empty) via PUT `/api/1/auth/user/notifications/clear`.
    static Result<nlohmann::json> clearNotifications();

    /// Send a direct message to another user's inbox via POST
    /// `/api/1/message/{userId}/message`. `type` is "message" (plain text)
    /// or "invite" (world deep-link) — we only expose plain text for now.
    /// Note: VRChat silently drops messages between non-friends.
    static Result<nlohmann::json> sendUserMessage(
        const std::string& targetUserId,
        const std::string& message);

    /// Fetch a short-lived WebSocket auth token via GET `/api/1/auth`.
    /// VRChat returns `{ok: true, token: "..."}` on success. The token
    /// is what `wss://pipeline.vrchat.cloud/?auth=<token>` expects —
    /// using the raw session cookie directly will get the connection
    /// rejected even though it works for the REST API.
    static Result<std::string> fetchPipelineToken();

    /// Send an invite to a specific user via POST `/api/1/invite/{userId}`.
    /// `instanceLocation` is the full `wrld_xxx:0000~region(us)` string.
    /// `messageSlot` picks which saved invite message (0-n) to attach.
    static Result<nlohmann::json> inviteUser(
        const std::string& targetUserId,
        const std::string& instanceLocation,
        int messageSlot = 0);
};

} // namespace vrcsm::core
