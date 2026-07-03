#pragma once

#include "Common.h"

#include <filesystem>
#include <optional>
#include <string>
#include <utility>
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
    std::optional<std::string> localUrl;
    bool cached{false};
    bool imageCached{false};
    std::string source{"network"};
    std::optional<std::string> error;
};

void to_json(nlohmann::json& j, const ThumbnailResult& r);

// Generic VRChat image disk-cache result. Used for wearer profile/reference
// images that are not addressable by an avtr_/wrld_ id but should still load
// from VRCSM's own AppData cache on the next app start.
struct CachedImageResult
{
    std::string id;
    std::string url;
    std::optional<std::string> localUrl;
    bool imageCached{false};
    std::string source{"network"};
    std::optional<std::string> error;
};

void to_json(nlohmann::json& j, const CachedImageResult& r);

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
    static ThumbnailResult fetchThumbnail(const std::string& id, bool downloadImage = false);

    // Batch variant — returns results in the same order the caller asked
    // for. Used by the IPC batch handler so the frontend can request
    // everything visible on screen in one round-trip.
    static std::vector<ThumbnailResult> fetchThumbnails(
        const std::vector<std::string>& ids,
        bool downloadImages = false);

    static CachedImageResult cacheImageUrl(
        const std::string& id,
        const std::string& url);

    static std::vector<CachedImageResult> cacheImageUrls(
        const std::vector<std::pair<std::string, std::string>>& items);

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

    // GET /favorite/groups — the user's named favorite groups (avatars1..4,
    // worlds1..4, etc). Each row carries the internal `name` plus the
    // user-customisable `displayName`, so sync can label lists the way the
    // player sees them in-game.
    static Result<std::vector<nlohmann::json>> fetchFavoriteGroups();

    // GET /favorites?type=<type> — favorite records that map a target id
    // (`favoriteId`) to the group it lives in (carried in `tags`). This is the
    // only endpoint that exposes group membership; the detail endpoints above
    // do not. `type` is "avatar" or "world".
    static Result<std::vector<nlohmann::json>> fetchFavoriteRecords(const std::string& type);

    // GET /calendar — upcoming VRChat official events. Returns an array
    // of event objects (id, name, starts_at, ends_at, world_id, image_url,
    // region, etc). Public-ish endpoint but we still send the cookie so
    // users see region-appropriate / personalised events when signed in.
    static Result<std::vector<nlohmann::json>> fetchCalendar();

    // Downloads the resource at the specified VRChat Cloudflare URL directly to
    // the filesystem using the active WinHTTP authentication session.
    static bool downloadFile(const std::string& url, const std::filesystem::path& destPath);

    static bool isTrustedBundleFile(
        const std::string& url,
        const std::filesystem::path& path);

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

    /// Live instance record for a full location `wrld_*:instanceId`.
    /// Returns raw JSON from `/api/1/instances/{worldId}:{instanceId}`,
    /// whose `n_users` field is the canonical live occupant count
    /// (`users[]` is owner-only and must not be used for crowd counts).
    /// Caller passes the full colon-joined location string.
    static Result<nlohmann::json> fetchInstance(const std::string& location);

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

    /// Search users by display name via `GET /api/1/users?search=...`.
    /// Use only as an ambiguous fallback when logs have a display name
    /// but no stable usr_* id.
    static Result<nlohmann::json> searchUsers(
        const std::string& query, int count = 10, int offset = 0);

    /// Patch the authenticated user's profile via
    /// `PUT /api/1/users/{id}`. Only fields present in `patch` are sent;
    /// everything else is preserved server-side. Returns the updated
    /// user JSON on success, structured Error on auth failure.
    static Result<nlohmann::json> updateAuthUser(const nlohmann::json& patch);

    /// Self-invite to a friend's instance via POST /api/1/invite/myself.
    static Result<nlohmann::json> inviteSelf(const std::string& instanceLocation);

    /// Ask a friend to invite us to their instance via POST
    /// `/api/1/requestInvite/{userId}`. `requestSlot` is 0 for the default
    /// "please invite me" message; slots 1-n reference saved canned lines.
    /// VRChat drops this silently if the target isn't a friend.
    static Result<nlohmann::json> requestInvite(const std::string& targetUserId, int requestSlot = 0);

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

    /// Fetch the signed-in user's saved invite-message slots via
    /// `GET /api/1/message/{me}/{messageType}`. messageType is one of
    /// `invite`, `inviteResponse`, `requestInvite`, `requestInviteResponse`.
    /// Returns up to 4 entries with `slot`, `message`, `remainingCooldownMinutes`.
    /// These are user-defined text snippets configured in the VRChat client
    /// — VRCSM cannot edit them, but it can read them so the boop UI can
    /// preview which message will be attached to a given slot.
    static Result<nlohmann::json> fetchSavedMessages(
        const std::string& messageType);

    /// Fetch calendar discovery feed via GET /api/1/calendar/discover.
    static Result<std::vector<nlohmann::json>> fetchCalendarDiscover();

    /// Fetch featured calendar events via GET /api/1/calendar/featured.
    static Result<std::vector<nlohmann::json>> fetchCalendarFeatured();

    /// Fetch jams listing via GET /api/1/jams.
    static Result<nlohmann::json> fetchJams();

    /// Fetch single jam detail via GET /api/1/jams/{jamId}.
    static Result<nlohmann::json> fetchJamDetail(const std::string& jamId);

    /// Search public worlds via GET /api/1/worlds?search=...
    static Result<nlohmann::json> searchWorlds(
        const std::string& query, const std::string& sort = "relevance",
        int count = 20, int offset = 0);

    /// Remove a friend via DELETE /api/1/auth/user/friends/{userId}.
    static Result<nlohmann::json> unfriend(const std::string& userId);

    /// Fetch recently encountered players via GET /api/1/visits.
    /// Returns an array of {userId, displayName, userIcon, instanceId,
    /// worldId, worldName, joinTime, timesSeen}. This is VRChat's own
    /// "recently played with" list — more reliable than log parsing.
    static Result<std::vector<nlohmann::json>> fetchVisits();

    /// Send a friend request via POST /api/1/user/{userId}/friendRequest.
    static Result<nlohmann::json> sendFriendRequest(const std::string& userId);

    /// Toggle whether the signed-in user represents the given group via
    /// `PUT /api/1/groups/{groupId}/representation` with body
    /// `{"isRepresenting": bool}`. Setting true auto-unsets any other
    /// represented group server-side; setting false on the currently
    /// represented group clears representation. Returns `{ok:true}` on
    /// HTTP 2xx, structured Error otherwise.
    static Result<nlohmann::json> setGroupRepresentation(
        const std::string& groupId, bool isRepresenting);

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

    // ── Wave 2 / Section B: online social + VRC+ media ──────────────────
    //
    // A single multipart field (a form value, not a file). The file part is
    // modelled separately by MultipartFile.
    struct MultipartField
    {
        std::string name;
        std::string value;
    };

    // The binary file part of a multipart/form-data body. `bytes` is the raw
    // (already-decoded) file content — callers pass the decoded image bytes.
    struct MultipartFile
    {
        std::string fieldName;   // form field name, e.g. "file" or "image"
        std::string filename;    // e.g. "icon.png"
        std::string contentType; // e.g. "image/png"
        std::string bytes;       // raw binary content (binary-safe std::string)
    };

    // Result of building a multipart/form-data request: the raw body (which
    // is binary-safe in a std::string — WinHTTP sends .data()/.size()) plus
    // the matching `Content-Type` header value carrying the boundary.
    struct MultipartBody
    {
        std::string body;
        std::string contentType; // "multipart/form-data; boundary=..."
    };

    /// Build a multipart/form-data body. `boundary` must not appear in any
    /// field value or file content (callers use a random token). Pure
    /// string assembly — no network, fully unit-testable.
    static MultipartBody buildMultipartFormData(
        const std::string& boundary,
        const std::vector<MultipartField>& fields,
        const std::optional<MultipartFile>& file);

    /// Decode standard base64 (with optional `data:` URI prefix stripped by
    /// the caller) into raw bytes. Returns nullopt on malformed input.
    static std::optional<std::string> decodeBase64(const std::string& input);

    /// Send a boop to a user via POST `/api/1/users/{userId}/boop`.
    /// Body is `{}` or `{"emojiId": "..."}`. 400 if the users are not
    /// friends, 404 if the user does not exist. LIVE — lightweight,
    /// reversible social action.
    static Result<nlohmann::json> sendBoop(
        const std::string& userId,
        std::optional<std::string> emojiId = std::nullopt);

    /// List the signed-in user's inventory via GET `/api/1/inventory`.
    /// `types` is an optional comma-joined filter (`sticker`/`emoji`/`prop`).
    /// Returns the raw `{data:[...], totalCount}` payload. Read-only / LIVE.
    static Result<nlohmann::json> fetchInventory(
        std::optional<std::string> types = std::nullopt,
        int n = 100,
        int offset = 0);

    /// List the signed-in user's prints via GET `/api/1/prints/user/{selfId}`.
    /// Must be self (403 otherwise). Read-only / LIVE.
    static Result<std::vector<nlohmann::json>> fetchPrints();

    /// Fetch a single print via GET `/api/1/prints/{printId}`.
    static Result<nlohmann::json> fetchPrint(const std::string& printId);

    /// Upload a print via POST `/api/1/prints` (multipart/form-data).
    /// `imageBytes` is the raw PNG content. WRITE — explicit user action.
    static Result<nlohmann::json> uploadPrint(
        const std::string& imageBytes,
        const std::string& timestamp,
        std::optional<std::string> note = std::nullopt,
        std::optional<std::string> worldId = std::nullopt,
        std::optional<std::string> worldName = std::nullopt);

    /// Delete a print via DELETE `/api/1/prints/{printId}`. DESTRUCTIVE,
    /// not reversible — caller must double-confirm.
    static Result<nlohmann::json> deletePrint(const std::string& printId);

    /// List the signed-in user's files via GET `/api/1/files?tag=<tag>`.
    /// `tag` is e.g. `gallery` or `icon`. Read-only / LIVE.
    static Result<std::vector<nlohmann::json>> fetchFiles(const std::string& tag);

    /// Upload an image via POST `/api/1/file/image` (multipart/form-data).
    /// `tag` is an ImagePurpose enum value (gallery|sticker|emoji|
    /// emojianimated|icon|avatarimage). `matchingDimensions` forces square
    /// (stickers/emoji). Returns the created File object. WRITE — explicit
    /// user action.
    static Result<nlohmann::json> uploadImage(
        const std::string& imageBytes,
        const std::string& tag,
        bool matchingDimensions = false);

    /// Extra multipart fields for an *animated* emoji upload (tag ==
    /// `emojianimated`). VRChat treats the uploaded PNG as a vertical sprite
    /// sheet of `frames` cells played back at `framesOverTime` fps with the
    /// given `animationStyle` (e.g. "stop", "bounce"). All fields are required
    /// by the server when the tag is animated; ignored otherwise.
    struct AnimatedEmojiParams
    {
        int frames = 0;          ///< number of frames in the sprite sheet
        int framesOverTime = 0;  ///< playback fps
        std::string animationStyle; ///< VRChat animation style id
    };

    /// As uploadImage, but threads the animated-emoji sprite-sheet metadata
    /// into the multipart body. Use for tag == `emojianimated`. WRITE.
    static Result<nlohmann::json> uploadAnimatedEmoji(
        const std::string& imageBytes,
        const AnimatedEmojiParams& anim,
        bool matchingDimensions = true);


    /// Delete a file via DELETE `/api/1/file/{fileId}`. DESTRUCTIVE — not
    /// reversible for gallery/icon/print files; caller must double-confirm.
    static Result<nlohmann::json> deleteFile(const std::string& fileId);

    /// Update an avatar's image url via PUT `/api/1/avatars/{avatarId}` with
    /// body `{"imageUrl": "<url>"}`. Used by the model-management page after
    /// uploading a new avatarimage. WRITE — single confirm (reversible).
    static Result<nlohmann::json> updateAvatarImage(
        const std::string& avatarId,
        const std::string& imageUrl);

    // ─── Section C: model-management page (account-owned avatars) ───────

    /// List the signed-in user's own avatars via GET
    /// `/api/1/avatars?user=me&releaseStatus=<status>` (paginated).
    /// `releaseStatus` is one of `all|public|private|hidden`; the `user`
    /// query param only accepts `me`. Returns a normalized
    /// `{avatars:[...]}` array shape (same fields as searchAvatars plus
    /// `unityPackages`). Read-only / LIVE.
    static Result<nlohmann::json> fetchOwnedAvatars(
        const std::string& releaseStatus = "all",
        int count = 100,
        int offset = 0);

    /// Partial update of an owned avatar via PUT `/api/1/avatars/{avatarId}`.
    /// Only the fields present in `patch` are sent (name/description/
    /// releaseStatus/tags/imageUrl) — everything else is preserved
    /// server-side. WRITE — single confirm (reversible profile edit). The
    /// caller MUST gate this behind an explicit user action.
    static Result<nlohmann::json> updateAvatar(
        const std::string& avatarId,
        const nlohmann::json& patch);

    /// Delete an owned avatar via DELETE `/api/1/avatars/{avatarId}`.
    /// DESTRUCTIVE and effectively irreversible: VRChat performs a SOFT
    /// delete (sets releaseStatus=hidden, deletes the linked asset Files,
    /// and permanently reserves the avatar id). The caller MUST
    /// double-confirm naming the exact avatar before invoking. No
    /// ProcessGuard needed (online op, not a local-file mutation).
    static Result<nlohmann::json> deleteAvatar(const std::string& avatarId);
};

} // namespace vrcsm::core
