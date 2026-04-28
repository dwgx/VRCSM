#include "PluginRegistry.h"

#include <fmt/format.h>

#include <algorithm>
#include <unordered_set>

namespace vrcsm::core::plugins
{

namespace
{

// Method tokens every plugin may call without declaring a permission.
// These are pure-read endpoints that never mutate user state.
const std::unordered_set<std::string>& FreeMethods()
{
    static const std::unordered_set<std::string> s = {
        "app.version",
        "path.probe",
        "process.vrcRunning",
    };
    return s;
}

// Map from permission token → method names the token grants. Kept
// coarse on purpose: plugin authors declare intent ("read cache",
// "list avatars"), not individual RPCs. If a method is not covered
// by any declared token and is not in FreeMethods(), the bridge
// refuses the call.
const std::unordered_map<std::string, std::unordered_set<std::string>>& PermissionTable()
{
    static const std::unordered_map<std::string, std::unordered_set<std::string>> s = {
        {"ipc:vrc:scan", {"scan", "bundle.preview"}},
        {"ipc:vrc:cache", {"scan", "bundle.preview", "delete.dryRun"}},
        {"ipc:vrc:auth", {"auth.status", "auth.user", "user.me"}},
        {"ipc:vrc:api", {"avatar.details", "world.details", "friends.list",
                          "groups.list", "user.me", "user.getProfile"}},
        {"ipc:logs", {"logs.stream.start", "logs.stream.stop"}},
        {"ipc:screenshots", {"screenshots.list", "screenshots.folder", "screenshots.open"}},
        {"ipc:settings", {"settings.readAll", "settings.writeOne"}},
        {"ipc:shell:pickFolder", {"shell.pickFolder"}},
        {"ipc:shell:openUrl", {"shell.openUrl"}},
        {"ipc:fs:listDir", {"fs.listDir"}},
        {"ipc:fs:writePlan", {"fs.writePlan"}},
        {"ipc:fs:appDataDir", {"fs.appDataDir"}},
        // Compatibility only: old broad ipc:shell manifests keep URL/picker
        // access, but no longer inherit filesystem read/write surfaces.
        {"ipc:shell", {"shell.pickFolder", "shell.openUrl"}},
    };
    return s;
}

std::string SanitiseForHostLabel(std::string_view id)
{
    // Virtual host labels must be DNS-safe. Lowercase, dots replaced
    // with dashes so the format stays predictable for the React iframe
    // URL builder.
    std::string out(id);
    for (auto& c : out) if (c == '.') c = '-';
    return out;
}

} // namespace

PluginRegistry& PluginRegistry::Instance()
{
    static PluginRegistry r;
    return r;
}

std::string PluginRegistry::HostNameFor(std::string_view id)
{
    return fmt::format("plugin.{}.vrcsm", SanitiseForHostLabel(id));
}

std::optional<std::string> PluginRegistry::PluginIdFromOrigin(std::string_view origin)
{
    // Accept either a bare host label or a full URL. The WebView2
    // args->get_Source() API returns a URI ("https://…/path"), so we
    // strip scheme + trailing path before matching.
    std::string host(origin);
    const auto schemeEnd = host.find("://");
    if (schemeEnd != std::string::npos) host.erase(0, schemeEnd + 3);
    const auto slash = host.find('/');
    if (slash != std::string::npos) host.erase(slash);
    const auto colon = host.find(':');
    if (colon != std::string::npos) host.erase(colon);

    constexpr std::string_view kPrefix = "plugin.";
    constexpr std::string_view kSuffix = ".vrcsm";
    if (host.size() <= kPrefix.size() + kSuffix.size()) return std::nullopt;
    if (host.compare(0, kPrefix.size(), kPrefix) != 0) return std::nullopt;
    if (host.compare(host.size() - kSuffix.size(), kSuffix.size(), kSuffix) != 0) return std::nullopt;

    auto label = host.substr(kPrefix.size(), host.size() - kPrefix.size() - kSuffix.size());
    // Reverse the dash-for-dot transform from HostNameFor.
    for (auto& c : label) if (c == '-') c = '.';

    // Find the installed plugin whose sanitised label matches — we
    // cannot rely on the label being the id verbatim because an id
    // can legitimately contain dashes that would also have become
    // dashes in the label. The id-in-label ambiguity is resolved by
    // preferring an exact match if one exists.
    auto& store = GetPluginStore();
    for (const auto& p : store.List())
    {
        if (SanitiseForHostLabel(p.manifest.id) ==
            SanitiseForHostLabel(label))
        {
            return p.manifest.id;
        }
    }
    return std::nullopt;
}

std::vector<PluginHostMapping> PluginRegistry::EnabledPanelMappings() const
{
    std::vector<PluginHostMapping> out;
    for (const auto& p : GetPluginStore().List())
    {
        if (!p.enabled) continue;
        if (!p.manifest.hasPanel()) continue;
        PluginHostMapping m;
        m.virtualHost = HostNameFor(p.manifest.id);
        m.folder = p.installDir;
        out.push_back(std::move(m));
    }
    return out;
}

PermissionDecision PluginRegistry::CanInvoke(std::string_view pluginId,
                                             std::string_view method) const
{
    const auto plugin = GetPluginStore().Find(pluginId);
    if (!plugin)
    {
        return {false, fmt::format("plugin '{}' not installed", pluginId)};
    }
    if (!plugin->enabled)
    {
        return {false, fmt::format("plugin '{}' is disabled", pluginId)};
    }

    auto decision = CanPermissionsInvoke(plugin->manifest.permissions, method);
    if (!decision.allowed && decision.reason.empty())
    {
        decision.reason = fmt::format("plugin '{}' lacks permission for '{}'", pluginId, method);
    }
    return decision;
}

PermissionDecision PluginRegistry::CanPermissionsInvoke(
    const std::vector<std::string>& permissions,
    std::string_view method)
{
    if (FreeMethods().count(std::string(method)) > 0) return {true, {}};

    // Any explicit plugin.* call is blocked — plugins cannot manage
    // other plugins. The market UI enforces this from the host side
    // too but belt-and-braces here.
    if (method.substr(0, 7) == "plugin.")
    {
        return {false, "plugins may not invoke plugin.* methods"};
    }

    const auto& table = PermissionTable();
    for (const auto& token : permissions)
    {
        const auto it = table.find(token);
        if (it == table.end()) continue;
        if (it->second.count(std::string(method)) > 0) return {true, {}};
    }
    return {false, {}};
}

} // namespace vrcsm::core::plugins
