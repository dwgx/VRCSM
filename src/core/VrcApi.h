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

    /// Patch the authenticated user's profile via
    /// `PUT /api/1/users/{id}`. Only fields present in `patch` are sent;
    /// everything else is preserved server-side. Returns the updated
    /// user JSON on success, structured Error on auth failure.
    static Result<nlohmann::json> updateAuthUser(const nlohmann::json& patch);
};

} // namespace vrcsm::core
