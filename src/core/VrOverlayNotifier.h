#pragma once

#include <optional>
#include <string>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

// ─────────────────────────────────────────────────────────────────────────
// VrOverlayNotifier — delivers VRChat social events into the headset via an
// SteamVR overlay app's notification API. VRCX shows Action Center toasts,
// which are invisible while you're in VR; this side channel puts "X is now
// online" / invites / friend requests on your wrist or in your view instead.
//
// Target: XSOverlay's Notifications API — a JSON object sent over UDP to
// 127.0.0.1:42069 (localhost only, unauthenticated by design; see
// https://github.com/Xiexe/XSOverlay-Issue-Tracker/wiki/Notifications-API).
// We only ever SEND to loopback and never open a listener, so this adds no
// inbound attack surface.
//
// The formatting half is pure and overlay-agnostic so a second backend
// (OVR Toolkit's WebSocket API on :11450) can be added later by swapping only
// the transport, not the message-building. Mirrors the fire-and-forget posture
// of ToastNotifier/DiscordRpc: any failure is swallowed and logged.
// ─────────────────────────────────────────────────────────────────────────

// A formatted, ready-to-send VR overlay notification. UTF-8 throughout.
// Overlay-agnostic: BuildXsOverlayJson turns this into the XSOverlay wire
// shape; a future OVR Toolkit builder would consume the same struct.
struct OverlayNotification
{
    std::string title; // UTF-8
    std::string body;  // UTF-8
};

// Decide whether a VRChat Pipeline event should surface in VR and format it.
// Returns std::nullopt for non-notable types or when a required field (e.g. a
// display name) is missing. Delegates the event-shape parsing + gating rules
// to FormatPipelineToast so the desktop toast and the VR overlay never drift
// out of sync — they notify on exactly the same events. Pure; unit-tested.
std::optional<OverlayNotification> FormatOverlayNotification(
    const std::string& type, const nlohmann::json& content);

// Build the XSOverlay Notifications API payload for a notification. Produces
// the documented schema: messageType=1 (popup), title, content, timeout,
// height, volume, audioPath="default", sourceApp="VRCSM". Pure; unit-tested.
nlohmann::json BuildXsOverlayJson(const OverlayNotification& n);

class VrOverlayNotifier
{
public:
    // Serialize `payload` to UTF-8 JSON and send it as a single UDP datagram
    // to host:port (defaults to XSOverlay's 127.0.0.1:42069). No-throw;
    // returns false on any socket failure. Fire-and-forget.
    static bool SendXsOverlay(const nlohmann::json& payload,
                              const std::string& host = "127.0.0.1",
                              std::uint16_t port = 42069);

    // Convenience: format-build-send in one call. Returns false if the event
    // was not notable or the send failed.
    static bool Notify(const OverlayNotification& n,
                       const std::string& host = "127.0.0.1",
                       std::uint16_t port = 42069);
};

} // namespace vrcsm::core
