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
};

void to_json(nlohmann::json& j, const LogReport& r);

class LogParser
{
public:
    static LogReport parse(const std::filesystem::path& baseDir);
};

} // namespace vrcsm::core
