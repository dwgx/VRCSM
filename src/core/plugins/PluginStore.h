#pragma once

// PluginStore — owns the on-disk layout and persistent enable/disable
// state. Does NOT run plugins (that's PluginRegistry) and does NOT
// install them (that's PluginInstaller) — this type only knows where
// things live and whether each entry is enabled.
//
// Layout:
//   %LocalAppData%/VRCSM/plugins/<id>/       install dir (manifest.json + assets)
//   %LocalAppData%/VRCSM/plugin-data/<id>/   per-plugin data (configs, caches, logs)
//   %LocalAppData%/VRCSM/plugin-state.json   { enabled: {id: bool}, installed: {id: version} }
//
// Bundled plugins ship alongside VRCSM.exe under <exeDir>/plugins/ and
// are mirrored (never modified) into the LocalAppData install dir on
// first run. This lets the user uninstall them without requiring
// write access to Program Files.

#include "PluginManifest.h"

#include "../Common.h"

#include <filesystem>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace vrcsm::core::plugins
{

struct InstalledPlugin
{
    PluginManifest manifest;
    std::filesystem::path installDir;  // %LocalAppData%/VRCSM/plugins/<id>/
    std::filesystem::path dataDir;     // %LocalAppData%/VRCSM/plugin-data/<id>/
    bool enabled{true};
    bool bundled{false};  // true if mirrored from <exeDir>/plugins/ — cannot be fully uninstalled
};

class PluginStore
{
public:
    PluginStore();

    // Directory accessors. Create the directory on demand.
    static std::filesystem::path PluginsRoot();      // install parent
    static std::filesystem::path PluginDataRoot();   // data parent
    static std::filesystem::path StateFilePath();    // plugin-state.json

    // Scan disk + mirror bundled plugins + reconcile state file. Call
    // once at bridge construction. Safe to call again to refresh.
    Result<std::monostate> Reload();

    // Snapshot of installed plugins, sorted by id.
    std::vector<InstalledPlugin> List() const;

    // Find by id. Returns nullopt if not installed.
    std::optional<InstalledPlugin> Find(std::string_view id) const;

    // Toggle enabled flag. Persists immediately.
    Result<std::monostate> SetEnabled(std::string_view id, bool enabled);

    // Uninstall: wipe installDir, wipe dataDir, drop from state.
    // Fails with "plugin_bundled" for bundled plugins (we only
    // disable those, never remove — they'd be recreated next run
    // from the exe-dir source of truth).
    Result<std::monostate> Uninstall(std::string_view id);

    // Register a newly-installed plugin (the installer calls this
    // after successfully writing the install dir). Persists state.
    Result<std::monostate> RegisterInstalled(const PluginManifest& m, bool bundled);

private:
    Result<std::monostate> LoadState();
    Result<std::monostate> SaveStateLocked();
    void MirrorBundledLocked();
    void RescanLocked();

    mutable std::mutex m_mutex;
    std::unordered_map<std::string, InstalledPlugin> m_plugins;  // id → plugin
};

// Process-wide accessor. Constructs lazily on first access.
PluginStore& GetPluginStore();

} // namespace vrcsm::core::plugins
