#pragma once

// PluginRegistry — the in-memory coordinator the IpcBridge talks to.
// Wraps PluginStore for enumeration and layers on:
//   - route descriptors surfaced to the React shell (nav items, icon
//     URLs) so Sidebar/CommandPalette/MenuBar can stay dumb and just
//     render what the host hands them,
//   - permission lookups (the gate used by PluginBridge::rpc before
//     forwarding calls on behalf of a plugin panel),
//   - the set of virtual host → folder mappings that WebViewHost
//     should install for every enabled panel plugin.
//
// Kept deliberately side-effect-free: enabling/disabling a plugin
// persists via the PluginStore, and the WebViewHost polls for the
// current mapping set on demand — no observer/event plumbing for now.

#include "PluginManifest.h"
#include "PluginStore.h"

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace vrcsm::core::plugins
{

// One entry per enabled panel plugin. Consumed by WebViewHost.
struct PluginHostMapping
{
    std::string virtualHost;        // e.g. "plugin.dev.vrcsm.hello.vrcsm"
    std::filesystem::path folder;   // the plugin install dir
};

// A permission decision for a single IPC call.
struct PermissionDecision
{
    bool allowed{false};
    std::string reason;  // populated when !allowed
};

class PluginRegistry
{
public:
    static PluginRegistry& Instance();

    // Forwarders that just delegate to the store. Kept here so the
    // bridge layer has a single facade to talk to.
    std::vector<InstalledPlugin> List() const { return GetPluginStore().List(); }
    std::optional<InstalledPlugin> Find(std::string_view id) const { return GetPluginStore().Find(id); }
    Result<std::monostate> SetEnabled(std::string_view id, bool enabled) { return GetPluginStore().SetEnabled(id, enabled); }
    Result<std::monostate> Uninstall(std::string_view id) { return GetPluginStore().Uninstall(id); }

    // All currently-enabled plugins that declare a panel entry. This
    // is the canonical list for deciding which iframes to permit and
    // which virtual hosts to map into WebView2.
    std::vector<PluginHostMapping> EnabledPanelMappings() const;

    // Compute the virtual host name for a plugin id. Mapping format:
    //   plugin.<sanitised-id>.vrcsm
    // where sanitised-id is the manifest id with dots replaced by
    // dashes (virtual hosts must be valid DNS labels per segment).
    static std::string HostNameFor(std::string_view id);

    // Decide whether a plugin is allowed to invoke a host method via
    // PluginBridge::rpc. The method name is matched against both the
    // explicit `permissions` array in the manifest and a small core
    // allowlist that every plugin gets for free (e.g. `app.version`).
    PermissionDecision CanInvoke(std::string_view pluginId, std::string_view method) const;

    // Pure permission-table seam for regression tests. Does not check
    // whether a plugin exists or is enabled.
    static PermissionDecision CanPermissionsInvoke(
        const std::vector<std::string>& permissions,
        std::string_view method);

    // Parse a plugin virtual host origin into the underlying plugin
    // id, returning nullopt if the origin is not a plugin iframe. The
    // input may be either the bare host ("plugin.x.vrcsm") or a full
    // URL ("https://plugin.x.vrcsm/whatever").
    static std::optional<std::string> PluginIdFromOrigin(std::string_view origin);
};

} // namespace vrcsm::core::plugins
