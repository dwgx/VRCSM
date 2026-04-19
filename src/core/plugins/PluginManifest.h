#pragma once

// Plugin manifest: the canonical schema for every VRCSM plugin, first-
// party or third-party. Must be present at <pluginDir>/manifest.json.
// Parsed by PluginStore when scanning the plugins directory and by
// PluginInstaller when accepting a .vrcsmplugin package.
//
// The schema is deliberately strict: missing/unknown fields fail the
// load, and we refuse to ship unsigned plugins by host-min mismatch.
// This is the **only** contract third-party authors must follow, so
// changes here are breaking changes to the plugin API.

#include "../Common.h"

#include <nlohmann/json.hpp>

#include <optional>
#include <string>
#include <unordered_set>
#include <vector>

namespace vrcsm::core::plugins
{

enum class PluginShape
{
    Panel,    // iframe-hosted UI only, no backing process
    Service,  // long-running child process, no UI
    App,      // panel + service (e.g. VRC-Auto-Uploader)
};

struct SemVer
{
    int major{0};
    int minor{0};
    int patch{0};
    std::string pre;  // optional pre-release suffix (e.g. "rc.1")

    // Lexicographic compare following SemVer 2.0 (pre < release).
    bool operator<(const SemVer& other) const;
    bool operator==(const SemVer& other) const;
    bool operator<=(const SemVer& other) const { return *this < other || *this == other; }
    bool operator>=(const SemVer& other) const { return !(*this < other); }

    std::string toString() const;
    static std::optional<SemVer> parse(std::string_view text);
};

struct PluginAuthor
{
    std::string name;
    std::string url;  // optional
};

struct PluginManifest
{
    // Reverse-DNS identifier. Must match [a-z0-9._-]+ and be globally
    // unique. The directory on disk MUST equal the id after
    // sanitisation (see Sanitize()).
    std::string id;

    // Human-readable display name. May contain any Unicode.
    std::string name;

    SemVer version;
    SemVer hostMin;  // minimum VRCSM version required

    PluginShape shape{PluginShape::Panel};

    // Relative paths (from the plugin root) to the entry points for
    // each component. Presence depends on shape:
    //   panel/app: entryPanel MUST be non-empty (e.g. "index.html")
    //   service/app: entryService MUST be non-empty (e.g. "bin/svc.exe")
    std::string entryPanel;
    std::string entryService;

    // Permission tokens granted to the plugin. The PluginBridge checks
    // these before forwarding IPC calls. Unknown tokens are silently
    // dropped (not an error — forward compat with future permissions).
    std::vector<std::string> permissions;

    PluginAuthor author;
    std::string homepage;  // optional
    std::string icon;      // relative path to icon PNG (optional)
    std::string description;  // optional short blurb shown in the market

    // Optional i18n table keyed by locale → key → translated string.
    // Surfaced to the plugin via the SDK (i18n.t("x")) rather than
    // imposing i18next inside the plugin.
    nlohmann::json i18n;

    bool hasPanel() const noexcept
    {
        return shape == PluginShape::Panel || shape == PluginShape::App;
    }
    bool hasService() const noexcept
    {
        return shape == PluginShape::Service || shape == PluginShape::App;
    }
    bool hasPermission(std::string_view token) const noexcept;
};

// Normalise a raw id into an on-disk-safe directory name. Drops every
// character not in [a-z0-9._-]. Used both when installing (to pick the
// target directory) and when validating that the disk layout matches
// the declared id.
std::string SanitizePluginId(std::string_view raw);

// Parse a manifest.json file. The caller is responsible for reading
// the file bytes — this separation exists so tests can feed strings
// directly without touching the filesystem.
Result<PluginManifest> ParsePluginManifest(const nlohmann::json& doc);

// Serialise a manifest back to JSON (used by the test-extract tool
// and by the installer when writing a canonical copy after validation).
nlohmann::json ManifestToJson(const PluginManifest& m);

} // namespace vrcsm::core::plugins
