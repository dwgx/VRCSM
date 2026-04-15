#pragma once

#include <nlohmann/json.hpp>

#include "LogTailer.h"

namespace vrcsm::core
{

/// Streaming classifier: given one tailed line from `LogTailer`, produce a
/// JSON event object if the line's body matches one of the known VRChat
/// event patterns (player join/leave, avatar switch, screenshot taken).
/// Returns `null` if the line is uninteresting (most are — only a few
/// percent of lines carry structured events).
///
/// Event shape:
///   { "kind": "player" | "avatarSwitch" | "screenshot",
///     "data": { ...same layout as the batch LogParser emits... } }
///
/// The frontend can cast the `data` field straight to the existing
/// `PlayerEvent` / `AvatarSwitchEvent` / `ScreenshotEvent` TypeScript types
/// and prepend the result to its local state, which is how the Logs page
/// grows its 3 panels in real time without a full re-scan.
///
/// Stateless: classification uses only the line's own body + iso_time, no
/// cross-line pairing. VRChat embeds enough context in each event line
/// (e.g., `Switching <actor> to avatar <name>`) that we don't need the
/// batch parser's running `avatar_names` cache just to emit the event.
nlohmann::json ClassifyStreamLine(const LogTailLine& line);

} // namespace vrcsm::core
