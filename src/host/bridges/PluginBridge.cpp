#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/plugins/PluginFeed.h"
#include "../../core/plugins/PluginInstaller.h"
#include "../../core/plugins/PluginManifest.h"
#include "../../core/plugins/PluginRegistry.h"
#include "../../core/plugins/PluginStore.h"

#include <spdlog/spdlog.h>

#include <filesystem>
#include <fstream>

// Defined in IpcBridge.cpp — invokes a handler from m_handlers after the
// permission gate has allowed it. Declared here so PluginBridge doesn't
// need to see the anonymous namespace or the thread pool.
nlohmann::json InvokeHostHandler(IpcBridge& bridge,
                                  std::unordered_map<std::string, IpcBridge::Handler>& handlers,
                                  const std::string& method,
                                  const nlohmann::json& params,
                                  const std::optional<std::string>& id);

namespace
{

using vrcsm::core::Error;
using vrcsm::core::isOk;
using vrcsm::core::plugins::InstalledPlugin;
using vrcsm::core::plugins::InstallOptions;
using vrcsm::core::plugins::InstallReport;
using vrcsm::core::plugins::MarketEntry;
using vrcsm::core::plugins::MarketFeed;
using vrcsm::core::plugins::ManifestToJson;
using vrcsm::core::plugins::PluginRegistry;

// Shape enum → string. Mirrored on the JS side so the market UI can
// render a badge per shape without having to import the C++ enum.
std::string ShapeName(vrcsm::core::plugins::PluginShape s)
{
    switch (s)
    {
    case vrcsm::core::plugins::PluginShape::Panel:   return "panel";
    case vrcsm::core::plugins::PluginShape::Service: return "service";
    case vrcsm::core::plugins::PluginShape::App:     return "app";
    }
    return "panel";
}

nlohmann::json InstalledPluginToJson(const InstalledPlugin& p)
{
    auto m = ManifestToJson(p.manifest);
    m["enabled"] = p.enabled;
    m["bundled"] = p.bundled;
    m["installDir"] = p.installDir.u8string();
    m["dataDir"] = p.dataDir.u8string();
    m["virtualHost"] = p.manifest.hasPanel() && p.enabled
        ? PluginRegistry::HostNameFor(p.manifest.id)
        : std::string{};
    return m;
}

nlohmann::json MarketEntryToJson(const MarketEntry& e)
{
    nlohmann::json j{
        {"id", e.id},
        {"name", e.name},
        {"version", e.version.toString()},
        {"hostMin", e.hostMin.toString()},
        {"shape", ShapeName(e.shape)},
        {"description", e.description},
        {"homepage", e.homepage},
        {"authorName", e.authorName},
        {"authorUrl", e.authorUrl},
        {"iconUrl", e.iconUrl},
        {"download", e.download},
        {"sha256", e.sha256},
    };
    return j;
}

// Refuse any management call that came from inside a plugin iframe.
// Plugins cannot install/uninstall/toggle other plugins (or themselves),
// and they cannot browse the market feed. This is the second line of
// defence after DispatchFromOrigin's PluginReachableMethods gate — the
// first gate would already have rejected the call unless someone
// routed it through plugin.rpc, but a permission-granted plugin.rpc
// still lands here so we re-check.
void RejectPluginCaller(const std::string& caller, const char* method)
{
    if (!caller.empty())
    {
        throw IpcException(Error{
            "forbidden_caller",
            fmt::format("plugin '{}' may not call {}", caller, method),
            0});
    }
}

std::string OptStringParam(const nlohmann::json& p, const char* key)
{
    if (p.is_object() && p.contains(key) && p[key].is_string())
    {
        return p[key].get<std::string>();
    }
    return {};
}

bool OptBoolParam(const nlohmann::json& p, const char* key, bool def)
{
    if (p.is_object() && p.contains(key) && p[key].is_boolean())
    {
        return p[key].get<bool>();
    }
    return def;
}

} // namespace

// ── plugin.list ─────────────────────────────────────────────────────

nlohmann::json IpcBridge::HandlePluginList(const nlohmann::json&,
                                            const std::optional<std::string>&,
                                            const std::string& callerPluginId)
{
    RejectPluginCaller(callerPluginId, "plugin.list");

    nlohmann::json arr = nlohmann::json::array();
    for (const auto& p : PluginRegistry::Instance().List())
    {
        arr.push_back(InstalledPluginToJson(p));
    }
    return nlohmann::json{{"plugins", arr}};
}

// ── plugin.install ──────────────────────────────────────────────────
//
// Accepts either:
//   {path: "C:\\...\\file.vrcsmplugin"}   — local file
//   {url:  "https://.../file.vrcsmplugin", sha256?: "..."}  — remote
//
// The remote path uses PluginFeed's WinHttp session to download the
// bytes into memory and forwards to InstallFromBytes. SHA-256 is
// required when the entry is being installed from the official market
// feed (the UI threads the hash through from MarketEntry); manual URL
// installs may pass it too but the handler does not mandate one.

nlohmann::json IpcBridge::HandlePluginInstall(const nlohmann::json& params,
                                               const std::optional<std::string>&,
                                               const std::string& callerPluginId)
{
    RejectPluginCaller(callerPluginId, "plugin.install");

    const auto localPath = OptStringParam(params, "path");
    const auto remoteUrl = OptStringParam(params, "url");
    const auto expectSha = OptStringParam(params, "sha256");

    if (localPath.empty() && remoteUrl.empty())
    {
        throw IpcException(Error{"invalid_params",
            "plugin.install requires either 'path' or 'url'", 0});
    }

    InstallOptions opts;
    if (!expectSha.empty()) opts.expectedSha256 = expectSha;
    opts.overwrite = OptBoolParam(params, "overwrite", true);

    vrcsm::core::Result<InstallReport> result = Error{"unknown", "no-op", 0};
    if (!localPath.empty())
    {
        std::filesystem::path archive = std::filesystem::u8path(localPath);
        result = vrcsm::core::plugins::InstallFromFile(archive, opts);
    }
    else
    {
        auto& feed = vrcsm::core::plugins::PluginFeed::Instance();
        auto bytes = feed.DownloadArchive(remoteUrl);
        if (!isOk(bytes)) throw IpcException(std::get<Error>(std::move(bytes)));
        result = vrcsm::core::plugins::InstallFromBytes(
            std::get<std::vector<std::byte>>(std::move(bytes)), opts);
    }

    if (!isOk(result)) throw IpcException(std::get<Error>(std::move(result)));
    const auto& report = std::get<InstallReport>(result);

    // Make the newly-installed plugin reachable from the SPA without a
    // host restart — refresh virtual-host mappings, which walks the
    // enabled-panels list and calls SetVirtualHostNameToFolderMapping
    // for each entry (idempotent; existing mappings are overwritten).
    m_host.RefreshPluginMappings();

    return nlohmann::json{
        {"id", report.id},
        {"version", report.version.toString()},
        {"installDir", report.installDir},
    };
}

// ── plugin.uninstall ────────────────────────────────────────────────

nlohmann::json IpcBridge::HandlePluginUninstall(const nlohmann::json& params,
                                                 const std::optional<std::string>&,
                                                 const std::string& callerPluginId)
{
    RejectPluginCaller(callerPluginId, "plugin.uninstall");

    const auto id = OptStringParam(params, "id");
    if (id.empty())
    {
        throw IpcException(Error{"invalid_params", "plugin.uninstall: missing 'id'", 0});
    }

    auto r = PluginRegistry::Instance().Uninstall(id);
    if (!isOk(r)) throw IpcException(std::get<Error>(std::move(r)));

    m_host.RefreshPluginMappings();
    return nlohmann::json{{"ok", true}, {"id", id}};
}

// ── plugin.enable / plugin.disable ──────────────────────────────────

nlohmann::json IpcBridge::HandlePluginEnable(const nlohmann::json& params,
                                              const std::optional<std::string>&,
                                              const std::string& callerPluginId)
{
    RejectPluginCaller(callerPluginId, "plugin.enable");

    const auto id = OptStringParam(params, "id");
    if (id.empty())
    {
        throw IpcException(Error{"invalid_params", "plugin.enable: missing 'id'", 0});
    }
    auto r = PluginRegistry::Instance().SetEnabled(id, true);
    if (!isOk(r)) throw IpcException(std::get<Error>(std::move(r)));
    m_host.RefreshPluginMappings();
    return nlohmann::json{{"ok", true}, {"id", id}, {"enabled", true}};
}

nlohmann::json IpcBridge::HandlePluginDisable(const nlohmann::json& params,
                                               const std::optional<std::string>&,
                                               const std::string& callerPluginId)
{
    RejectPluginCaller(callerPluginId, "plugin.disable");

    const auto id = OptStringParam(params, "id");
    if (id.empty())
    {
        throw IpcException(Error{"invalid_params", "plugin.disable: missing 'id'", 0});
    }
    auto r = PluginRegistry::Instance().SetEnabled(id, false);
    if (!isOk(r)) throw IpcException(std::get<Error>(std::move(r)));
    m_host.RefreshPluginMappings();
    return nlohmann::json{{"ok", true}, {"id", id}, {"enabled", false}};
}

// ── plugin.marketFeed ───────────────────────────────────────────────

nlohmann::json IpcBridge::HandlePluginMarketFeed(const nlohmann::json& params,
                                                  const std::optional<std::string>&,
                                                  const std::string& callerPluginId)
{
    RejectPluginCaller(callerPluginId, "plugin.marketFeed");

    const bool force = OptBoolParam(params, "force", false);
    auto res = vrcsm::core::plugins::PluginFeed::Instance().Fetch(force);
    if (!isOk(res)) throw IpcException(std::get<Error>(std::move(res)));

    const auto& feed = std::get<MarketFeed>(res);
    nlohmann::json plugins = nlohmann::json::array();
    for (const auto& e : feed.plugins) plugins.push_back(MarketEntryToJson(e));

    return nlohmann::json{
        {"version", feed.version},
        {"generated", feed.generated},
        {"plugins", std::move(plugins)},
    };
}

// ── plugin.rpc ──────────────────────────────────────────────────────
//
// The single entry point plugin iframes use to reach host handlers.
// The permission gate fires here: every plugin-origin IPC call hits
// DispatchFromOrigin → plugin.rpc → permission check → InvokeHostHandler.

nlohmann::json IpcBridge::HandlePluginRpc(const nlohmann::json& params,
                                           const std::optional<std::string>& id,
                                           const std::string& callerPluginId)
{
    if (callerPluginId.empty())
    {
        throw IpcException(Error{
            "invalid_caller",
            "plugin.rpc may only be called from a plugin iframe", 0});
    }

    const auto method = OptStringParam(params, "method");
    if (method.empty())
    {
        throw IpcException(Error{"invalid_params", "plugin.rpc: missing 'method'", 0});
    }

    // Plugins cannot call plugin.rpc recursively nor any plugin.* method
    // — the permission table explicitly rejects plugin.* tokens, but we
    // short-circuit here so the error message is clearer.
    if (method.rfind("plugin.", 0) == 0)
    {
        throw IpcException(Error{
            "forbidden_method",
            fmt::format("plugin.rpc: '{}' is not reachable", method), 0});
    }

    auto decision = PluginRegistry::Instance().CanInvoke(callerPluginId, method);
    if (!decision.allowed)
    {
        throw IpcException(Error{"permission_denied", decision.reason, 0});
    }

    const nlohmann::json innerParams = params.contains("params")
        ? params["params"]
        : nlohmann::json::object();

    spdlog::debug("[plugin.rpc] '{}' → {}", callerPluginId, method);
    return InvokeHostHandler(*this, m_handlers, method, innerParams, id);
}
