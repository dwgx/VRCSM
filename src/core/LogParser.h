#pragma once

#include <cstddef>
#include <filesystem>
#include <map>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

/// Legacy cache-related settings kept for backwards compat with the older
/// dashboard UI. New code should read `LogReport::settings_sections`.
struct LogSettings
{
    std::optional<std::string> cache_directory;
    std::optional<int> cache_size_mb;
    std::optional<bool> clear_cache_on_start;
};

void to_json(nlohmann::json& j, const LogSettings& s);

/// Parsed fields from the `[UserInfoLogger] Environment Info:` block at the
/// top of every VRChat output log. Every field is optional — VRChat occasionally
/// omits entries based on the build/platform.
struct LogEnvironment
{
    std::optional<std::string> vrchat_build;
    std::optional<std::string> store;
    std::optional<std::string> platform;
    std::optional<std::string> device_model;
    std::optional<std::string> processor;
    std::optional<std::string> system_memory;
    std::optional<std::string> operating_system;
    std::optional<std::string> gpu_name;
    std::optional<std::string> gpu_api;
    std::optional<std::string> gpu_memory;
    std::optional<std::string> xr_device;
};

void to_json(nlohmann::json& j, const LogEnvironment& e);

/// One "section" inside the `[UserInfoLogger] User Settings Info:` block.
/// A section is named like "Graphics Settings" and contains an ordered list of
/// key → value rows (preserved in file order so the UI can render them the
/// same way VRChat writes them).
struct LogSettingsSection
{
    std::string name;
    std::vector<std::pair<std::string, std::string>> entries;
};

void to_json(nlohmann::json& j, const LogSettingsSection& s);

struct AvatarNameInfo
{
    std::string name;
    std::optional<std::string> author;
};

void to_json(nlohmann::json& j, const AvatarNameInfo& a);

/// `OnPlayerJoined` / `OnPlayerLeft` — every other player the local user saw
/// enter or leave an instance. Display name is always present; the `usr_` id
/// is only on joined lines and only when VRChat feels like including it
/// (older client builds omit the id entirely, newer ones put it in parens).
struct PlayerEvent
{
    std::string kind;           // "joined" | "left"
    std::optional<std::string> iso_time;
    std::string display_name;
    std::optional<std::string> user_id;
    std::optional<std::string> world_id;
    std::optional<std::string> instance_id;
};

void to_json(nlohmann::json& j, const PlayerEvent& e);

/// `[Behaviour] Switching <actor> to avatar <name>` — every time any player
/// (local or remote) swaps avatars. Useful both as a "who was I hanging out
/// with" record and as the audit trail behind an avatar id showing up in
/// `recent_avatar_ids` (so the UI can say "you saw this on Bob" instead of
/// just "this appeared once somewhere").
struct AvatarSwitchEvent
{
    std::optional<std::string> iso_time;
    std::string actor;
    std::optional<std::string> actor_user_id;  // resolved from prior OnPlayerJoined when the same name is seen
    std::string avatar_name;
    std::optional<std::string> author_name;
    std::optional<std::string> world_id;
    std::optional<std::string> instance_id;
};

void to_json(nlohmann::json& j, const AvatarSwitchEvent& e);

/// `[VRC Camera] Took screenshot to: <path>` — absolute path as VRChat wrote
/// it, not normalised. The UI can open the containing folder.
struct ScreenshotEvent
{
    std::optional<std::string> iso_time;
    std::string path;
};

void to_json(nlohmann::json& j, const ScreenshotEvent& e);

/// `[Video Playback] Attempting to resolve URL '<url>'` — a video player in the
/// instance started loading media. The URL is the raw resolve target (YouTube,
/// direct file, etc.); a title is not in the log without an external lookup.
struct VideoPlayEvent
{
    std::optional<std::string> iso_time;
    std::string url;
    std::optional<std::string> world_id;
    std::optional<std::string> instance_id;
};

void to_json(nlohmann::json& j, const VideoPlayEvent& e);

/// `[Behaviour] Instantiated a (Clone [N] Portals/PortalInternalDynamic)` — a
/// portal was dropped in the instance. Modern VRChat logs carry no dropper or
/// destination, so this is presence-of-event only.
struct PortalSpawnEvent
{
    std::optional<std::string> iso_time;
};

void to_json(nlohmann::json& j, const PortalSpawnEvent& e);

/// Vote-kick lifecycle. `phase` is "initiated" / "succeeded" (instance-wide, with
/// the target display name) or "self" (the local user was kicked; `message` set).
struct VoteKickEvent
{
    std::optional<std::string> iso_time;
    std::string phase;
    std::optional<std::string> target;
    std::optional<std::string> message;
};

void to_json(nlohmann::json& j, const VoteKickEvent& e);

/// Instance join problems. `reason_kind` is "failed" (carries `location` and an
/// optional `reason`) or "blocked" (master-timeout, no detail).
struct JoinBlockedEvent
{
    std::optional<std::string> iso_time;
    std::string reason_kind;
    std::optional<std::string> location;
    std::optional<std::string> reason;
};

void to_json(nlohmann::json& j, const JoinBlockedEvent& e);

/// `[StickersManager] User usr_… (Name) spawned sticker inv_…` — note the log
/// puts the user id before the display name (the opposite of join lines).
struct StickerSpawnEvent
{
    std::optional<std::string> iso_time;
    std::string user_id;
    std::string display_name;
    std::string inventory_id;
};

void to_json(nlohmann::json& j, const StickerSpawnEvent& e);

/// A1 — `[API] Received Notification: <...>`. Inbound friend request / invite /
/// message etc. Carries the sender id+name and the structured notification id.
struct NotificationEvent
{
    std::optional<std::string> iso_time;
    std::string sender_id;
    std::string sender_name;
    std::string type;              // friendRequest | invite | requestInvite | ...
    std::string notification_id;   // not_xxx
};

void to_json(nlohmann::json& j, const NotificationEvent& e);

/// A2 — `[Video Playback] ERROR:` / `[AVProVideo] Error:`. A video player in the
/// instance failed to load media. Complements the existing VideoPlayEvent.
struct VideoErrorEvent
{
    std::optional<std::string> iso_time;
    std::string error_message;
};

void to_json(nlohmann::json& j, const VideoErrorEvent& e);

/// A3 — Attributed video play (SDK2 / USharpVideo). Unlike the anonymous
/// VideoPlayEvent (resolve-URL), this carries the requesting user — a parity
/// win over the anonymous form. `requester` may be empty on some SDK shapes.
struct AttributedVideoEvent
{
    std::optional<std::string> iso_time;
    std::string url;
    std::optional<std::string> requester;
};

void to_json(nlohmann::json& j, const AttributedVideoEvent& e);

/// A3 — `[USharpVideo] Syncing video to <url>`. A sync (seek) event.
struct VideoSyncEvent
{
    std::optional<std::string> iso_time;
    std::string url;
};

void to_json(nlohmann::json& j, const VideoSyncEvent& e);

/// A4 — `[Network Processing] RPC invoked SwitchAvatar on AvatarPedestal for
/// <name>`. MEDIUM confidence (2021 sample). `user_id` is enriched (A9) when
/// the display name was seen joining.
struct AvatarPedestalEvent
{
    std::optional<std::string> iso_time;
    std::string display_name;
    std::optional<std::string> user_id;
};

void to_json(nlohmann::json& j, const AvatarPedestalEvent& e);

/// A5 — `VRCApplication: On/HandleApplicationQuit at <uptime>`. Session-end.
struct AppQuitEvent
{
    std::optional<std::string> iso_time;
    std::optional<std::string> uptime_seconds;
};

void to_json(nlohmann::json& j, const AppQuitEvent& e);

/// A6 — VR vs Desktop session marker. Low-frequency; not surfaced in the feed
/// by default (Logs filters / session metadata only).
struct SessionModeEvent
{
    std::optional<std::string> iso_time;
    std::string mode;                       // "vr" | "desktop"
    std::optional<std::string> hmd_model;
};

void to_json(nlohmann::json& j, const SessionModeEvent& e);

/// A7 — `Could not Start OSC: <reason>`. Diagnostic (default-off feed category).
struct OscFailEvent
{
    std::optional<std::string> iso_time;
    std::string reason;
};

void to_json(nlohmann::json& j, const OscFailEvent& e);

/// A7 — `VRC.Udon.VM.UdonVMException: <message>`. Diagnostic (default-off).
struct UdonExceptionEvent
{
    std::optional<std::string> iso_time;
    std::string message;
};

void to_json(nlohmann::json& j, const UdonExceptionEvent& e);

/// A7 — `[ModerationManager] This instance will be reset in <n> minutes ...`.
/// Feed category `moderation` (reuses the VoteKick/JoinBlocked family).
struct InstanceResetEvent
{
    std::optional<std::string> iso_time;
    std::string minutes;
};

void to_json(nlohmann::json& j, const InstanceResetEvent& e);

/// A8 — shader global keyword limit exceeded. Emitted once per world context
/// (dedupe is done in the caller). Diagnostic (default-off).
struct ShaderKeywordEvent
{
    std::optional<std::string> iso_time;
};

void to_json(nlohmann::json& j, const ShaderKeywordEvent& e);

/// A8 — `[Always] uSpeak: SetInputDevice 0 (<n> total) '<device>'`. Only
/// emitted when the device differs from the last one seen. Diagnostic.
struct AudioDeviceEvent
{
    std::optional<std::string> iso_time;
    std::string device_name;
};

void to_json(nlohmann::json& j, const AudioDeviceEvent& e);

/// Detailed instance connection tracking for the worlds tab.
struct WorldSwitchEvent
{
    std::optional<std::string> iso_time;
    std::string world_id;       // The base wrld_xxx ID
    std::string instance_id;    // The full wrld_...:port~tags connection string
    std::string access_type;    // "public", "hidden", "friends", "private", "group"
    std::optional<std::string> owner_id; // Room owner (usr_xxx) or group owner (grp_xxx)
    std::optional<std::string> region;   // Server region (jp, us, eu, etc)
};

void to_json(nlohmann::json& j, const WorldSwitchEvent& e);

struct LogReport
{
    std::vector<std::string> log_files;
    std::size_t log_count = 0;

    // Legacy — only the 3 cache fields from the AssetBundleDownloadManager lines.
    LogSettings settings;

    // Structured UserInfoLogger blocks.
    LogEnvironment environment;
    std::vector<LogSettingsSection> settings_sections;

    // Local player identity, pulled from `User Authenticated: <name> (<id>)`.
    std::optional<std::string> local_user_name;
    std::optional<std::string> local_user_id;

    // Recent activity (deduped, preserving first-seen order).
    std::vector<std::string> recent_world_ids;
    std::vector<std::string> recent_avatar_ids;

    // id → display name. World names come from `Entering Room:` / `Joining or
    // Creating Room:`. Avatar names come from the
    // `Switching <local> to avatar <name>` → `Unpacking Avatar (<name> by
    // <author>)` → `Loading Avatar Data:<id>` pairing chain.
    std::map<std::string, std::string> world_names;
    std::map<std::string, AvatarNameInfo> avatar_names;

    // Real event counts — only hits on "join" / "switch" lines, not every
    // incidental wrld_/avtr_ substring match.
    std::size_t world_event_count = 0;
    std::size_t avatar_event_count = 0;

    // VRCX-parity event streams. Capped per-report so an 8-hour log with
    // thousands of joins doesn't balloon the IPC payload. Chronological order
    // is preserved across files (oldest file first). See kMaxEventsPerKind.
    std::vector<PlayerEvent> player_events;
    std::vector<AvatarSwitchEvent> avatar_switches;
    std::vector<ScreenshotEvent> screenshots;
    std::vector<WorldSwitchEvent> world_switches;

    // Track L event streams (video/portal/moderation/sticker). Same per-report
    // cap and chronological ordering as the four streams above.
    std::vector<VideoPlayEvent> video_plays;
    std::vector<PortalSpawnEvent> portal_spawns;
    std::vector<VoteKickEvent> vote_kicks;
    std::vector<JoinBlockedEvent> join_blocked;
    std::vector<StickerSpawnEvent> sticker_spawns;

    // Wave 2 Section A streams. Same per-report cap + chronological ordering.
    std::vector<NotificationEvent> notifications;
    std::vector<VideoErrorEvent> video_errors;
    std::vector<AttributedVideoEvent> attributed_video_plays;
    std::vector<VideoSyncEvent> video_syncs;
    std::vector<AvatarPedestalEvent> avatar_pedestals;
    std::vector<AppQuitEvent> app_quits;
    std::vector<SessionModeEvent> session_modes;
    std::vector<OscFailEvent> osc_fails;
    std::vector<UdonExceptionEvent> udon_exceptions;
    std::vector<InstanceResetEvent> instance_resets;
    std::vector<ShaderKeywordEvent> shader_keywords;
    std::vector<AudioDeviceEvent> audio_devices;
};

void to_json(nlohmann::json& j, const LogReport& r);

class LogParser
{
public:
    static LogReport parse(const std::filesystem::path& baseDir);
};

/// Strip trailing hex hash suffixes VRChat appends to display names when
/// a player's profile hasn't been loaded (non-friend / rate-limited).
/// Called by both the batch LogParser and the live LogEventClassifier.
std::string stripUnresolvedHashSuffix(std::string name);

} // namespace vrcsm::core
