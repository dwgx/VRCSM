#pragma once

#include <optional>
#include <string>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

// Which toast-worthy social event a formatted toast represents. The host
// uses this to consult the matching per-type user toggle before showing.
enum class ToastKind
{
    FriendOnline,
    Invite,
    FriendRequest,
};

// A formatted, ready-to-show toast. Strings are UTF-8; the WinRT layer
// converts to wide at the boundary. `launchArg` (when set) is placed on
// the toast's `launch` attribute so the Activated handler can route
// (e.g. "vrcsm://user/usr_abc").
struct ToastContent
{
    ToastKind kind;
    std::string title;                    // UTF-8
    std::string body;                     // UTF-8
    std::optional<std::string> launchArg; // UTF-8, e.g. "vrcsm://user/usr_abc"
};

// ── Pure framing / formatting helpers (no WinRT, unit-testable) ───────────
// Split out from the I/O path so the message-formatting + XML can be tested
// without a live Action Center (tests/CommonTests.cpp).

// Decide whether a VRChat Pipeline event should raise a toast and format it.
// Returns std::nullopt for non-toast-worthy types or when a required field
// (e.g. a display name) is missing — a nameless toast carries no signal.
//
// This does NOT consult user toggles: the caller gates on the per-kind
// enable flag using the returned ToastContent::kind. Treats `content` as
// untrusted data (validates every field, never assumes a shape).
//
// Verified content shapes (web/src/lib/friends-pipeline.ts,
// components/NotificationsInbox.tsx):
//   - friend-online: { userId, user: { displayName, ... } }
//   - notification / notification-v2: VRChat NotificationEntry —
//       { id, senderUserId?, senderUsername?, type, message? } where
//       inner `type` is "invite" or "friendRequest".
std::optional<ToastContent> FormatPipelineToast(const std::string& type,
                                                const nlohmann::json& content);

// Escape a string for safe insertion into toast XML (handles & < > " ').
std::string XmlEscape(const std::string& raw);

// Build the ToastText02 toast XML (one bold heading + one wrapped body).
// Adds a `launch` attribute on <toast> only when launchArg is present.
std::string BuildToastXml(const ToastContent& content);

// Fire-and-forget native Windows toast over WinRT
// ToastNotificationManager. No-throw; logs + returns false on any failure
// (notifications disabled, RoActivateInstance fail, missing shortcut).
//
// Requires SetCurrentProcessExplicitAppUserModelID + a Start-menu shortcut
// carrying the same AUMID to have run first — call EnsureSetup() once at
// startup. Mirrors the fire-and-forget posture of DiscordRpc: the rest of
// the app never sees a toast failure.
class ToastNotifier
{
public:
    // Idempotent startup setup: sets the process AUMID and creates the
    // Start-menu .lnk carrying System.AppUserModel.ID if it does not
    // already exist. Best-effort; returns false on failure.
    static bool EnsureSetup();

    // Show a text toast. Returns false if the toast could not be shown.
    static bool ShowToast(const std::wstring& title,
                          const std::wstring& body,
                          const std::optional<std::wstring>& launchArg = std::nullopt);

    // Convenience overload: convert a UTF-8 ToastContent and show it.
    static bool ShowToast(const ToastContent& content);
};

} // namespace vrcsm::core
