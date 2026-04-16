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
    std::string avatar_name;
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
};

void to_json(nlohmann::json& j, const LogReport& r);

class LogParser
{
public:
    static LogReport parse(const std::filesystem::path& baseDir);
};

} // namespace vrcsm::core
