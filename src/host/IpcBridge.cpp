#include "../pch.h"

#include "IpcBridge.h"

#include "StringUtil.h"
#include "WebViewHost.h"

#include "../core/AuthStore.h"
#include "../core/CacheIndex.h"
#include "../core/Database.h"
#include "../core/PathProbe.h"
#include "../core/ProcessGuard.h"

#include "../core/plugins/PluginRegistry.h"

#include <future>
#include <thread>
#include <unordered_set>

namespace
{

// ── Thread pool for async IPC handlers ──────────────────────────────
//
// Fixed-size pool (hardware_concurrency, clamped 2..8) shared across
// all IpcBridge instances. The process only ever creates one bridge.

class IpcThreadPool
{
public:
    IpcThreadPool()
    {
        unsigned n = std::thread::hardware_concurrency();
        if (n < 2) n = 2;
        if (n > 8) n = 8;
        for (unsigned i = 0; i < n; ++i)
        {
            m_workers.emplace_back([this]{ Worker(); });
        }
    }

    ~IpcThreadPool()
    {
        {
            std::lock_guard<std::mutex> lk(m_mutex);
            m_stopping = true;
        }
        m_cv.notify_all();
        for (auto& t : m_workers)
        {
            if (t.joinable()) t.join();
        }
    }

    void enqueue(std::function<void()> fn)
    {
        {
            std::lock_guard<std::mutex> lk(m_mutex);
            m_queue.push(std::move(fn));
        }
        m_cv.notify_one();
    }

private:
    void Worker()
    {
        for (;;)
        {
            std::function<void()> task;
            {
                std::unique_lock<std::mutex> lk(m_mutex);
                m_cv.wait(lk, [this]{ return m_stopping || !m_queue.empty(); });
                if (m_stopping && m_queue.empty()) return;
                task = std::move(m_queue.front());
                m_queue.pop();
            }
            try { task(); }
            catch (const std::exception& ex) { spdlog::error("[ipc-pool] unhandled exception in worker: {}", ex.what()); }
            catch (...) { spdlog::error("[ipc-pool] unhandled non-std exception in worker"); }
        }
    }

    std::mutex m_mutex;
    std::condition_variable m_cv;
    std::queue<std::function<void()>> m_queue;
    std::vector<std::thread> m_workers;
    bool m_stopping{false};
};

// ── Async method registry ───────────────────────────────────────────
//
// Methods in this set run on the IpcThreadPool instead of the WebView2
// UI thread. Fast/UI-bound handlers stay inline to avoid a pointless
// thread hop.

const std::unordered_set<std::string>& AsyncMethodSet()
{
    static const std::unordered_set<std::string> kMethods = {
        "scan",
        "bundle.preview",
        "delete.dryRun",
        "delete.execute",
        "settings.readAll",
        "settings.writeOne",
        "settings.exportReg",
        "config.read",
        "config.write",
        "migrate.preflight",
        "junction.repair",
        "fs.listDir",
        "fs.writePlan",
        "thumbnails.fetch",
        "auth.status",
        "auth.user",
        "auth.logout",
        "auth.login",
        "auth.verify2FA",
        "friends.list",
        "groups.list",
        "groups.setRepresented",
        "moderations.list",
        "calendar.list",
        "calendar.discover",
        "calendar.featured",
        "jams.list",
        "jams.detail",
        "avatar.bundle.download",
        "avatar.details",
        "world.details",
        "avatar.preview",
        "avatar.preview.abort",
        "avatar.select",
        "avatar.search",
        "worlds.search",
        "friends.unfriend",
        "vr.diagnose",
        "vr.audio.switch",
        "event.start",
        "event.stop",
        "event.list",
        "event.attendees",
        "event.addAttendee",
        "rules.list",
        "rules.get",
        "rules.create",
        "rules.update",
        "rules.delete",
        "rules.setEnabled",
        "rules.history",
        "friends.request",
        "user.invite",
        "user.inviteTo",
        "user.requestInvite",
        "user.mute",
        "user.unmute",
        "user.block",
        "user.unblock",
        "user.me",
        "user.getProfile",
        "user.updateProfile",
        "screenshots.list",
        "logs.files.clear",
        "logs.stream.start",
        "logs.stream.stop",
        "app.factoryReset",
        "db.worldVisits.list",
        "db.playerEvents.list",
        "db.playerEncounters",
        "db.avatarHistory.list",
        "db.avatarHistory.count",
        "db.stats.heatmap",
        "db.stats.overview",
        "db.history.clear",
        "favorites.lists",
        "favorites.items",
        "favorites.add",
        "favorites.remove",
        "favorites.note.set",
        "favorites.tags.set",
        "favorites.syncOfficial",
        "favorites.export",
        "favorites.import",
        "friendLog.insert",
        "friendLog.recent",
        "friendLog.forUser",
        "friendNote.get",
        "friendNote.set",

        // Pipeline + notifications + DM send
        "pipeline.start",
        "pipeline.stop",
        "notifications.list",
        "notifications.accept",
        "notifications.respond",
        "notifications.see",
        "notifications.hide",
        "notifications.clear",
        "message.send",
        "discord.setActivity",
        "discord.clearActivity",
        "discord.status",
        "osc.send",
        "osc.listen.start",
        "osc.listen.stop",
        "screenshots.watcher.start",
        "screenshots.watcher.stop",
        "screenshots.injectMetadata",
        "screenshots.readMetadata",
        "hw.applyPreset",
        "hw.detect",
        "hw.recommend",
        "update.check",
        "update.download",

        // VRChat process-memory probes — must run off-UI or the WebView2
        // message loop stalls while we walk GB-scale address space.
        "memory.status",
        "radar.poll",

        // Experimental visual avatar search (v0.11). All four are DB-
        // backed and go through m_mutex, so keep them off the UI thread.
        "vector.upsertEmbedding",
        "vector.search",
        "vector.getUnindexed",
        "vector.removeEmbedding",

        // Plugin system — all async because they touch the filesystem,
        // network (market feed fetch), or spawn subprocesses (Phase B).
        "plugin.list",
        "plugin.install",
        "plugin.uninstall",
        "plugin.enable",
        "plugin.disable",
        "plugin.marketFeed",
        "plugin.rpc",
    };
    return kMethods;
}

// Methods reachable from inside a plugin iframe. Everything else
// must go through `plugin.rpc` which goes through the permission
// gate. This is the origin-security seam — a plugin that tries to
// call `delete.execute` directly gets a forbidden_origin error.
const std::unordered_set<std::string>& PluginReachableMethods()
{
    static const std::unordered_set<std::string> kMethods = {
        "plugin.rpc",
        "plugin.self.info",
        "plugin.self.i18n",
    };
    return kMethods;
}

// Structured exception carrying a full Error — the dispatch layer
// catches this to produce PostError(id, err.code, err.message) with
// the correct error code instead of the generic "handler_error".
// Declared here so bridges/*.cpp can also throw it via BridgeCommon.h.
struct IpcException : std::exception
{
    vrcsm::core::Error err;
    explicit IpcException(vrcsm::core::Error e) : err(std::move(e)) {}
    const char* what() const noexcept override { return err.message.c_str(); }
};

std::optional<std::string> ExtractId(const nlohmann::json& envelope)
{
    if (!envelope.contains("id") || envelope["id"].is_null())
    {
        return std::nullopt;
    }
    return envelope.at("id").get<std::string>();
}

std::optional<std::string> JsonStringField(const nlohmann::json& json, const char* key)
{
    if (json.contains(key) && json[key].is_string())
    {
        return json[key].get<std::string>();
    }
    return std::nullopt;
}

IpcThreadPool& GetIpcPool()
{
    static IpcThreadPool pool;
    return pool;
}

} // anonymous namespace

// Wrapper so bridge files (MigrateBridge.cpp) can submit async work
// without coupling to IpcThreadPool which lives in the anon namespace.
void IpcEnqueueAsync(std::function<void()> fn)
{
    GetIpcPool().enqueue(std::move(fn));
}

// ── Constructor / Destructor ────────────────────────────────────────

IpcBridge::IpcBridge(WebViewHost& host)
    : m_host(host), m_alive(std::make_shared<std::atomic<bool>>(true))
{
    (void)vrcsm::core::AuthStore::Instance().Load();

    // Open the SQLite store used for history/favorites/friend log.
    auto dbRes = vrcsm::core::Database::Instance().Open(vrcsm::core::Database::DefaultDbPath());
    if (!vrcsm::core::isOk(dbRes))
    {
        spdlog::error("Database::Open failed: {}", vrcsm::core::error(dbRes).message);
    }

    RegisterHandlers();

    // Kick off background cache indexer.
    {
        const auto probe = vrcsm::core::PathProbe::Probe();
        const auto cwpDir = std::filesystem::path(probe.baseDir) / L"Cache-WindowsPlayer";
        vrcsm::core::CacheIndex::Instance().StartScan(cwpDir);
    }

    // Spin up the VRChat process watcher.
    vrcsm::core::ProcessGuard::StartWatcher([this](const vrcsm::core::ProcessStatus& status)
    {
        if (!status.running)
        {
            CloseTrackedWorldVisits(vrcsm::core::nowIso());
        }

        nlohmann::json envelope{
            {"event", "process.vrcStatusChanged"},
            {"data", nlohmann::json(status)},
        };
        m_host.PostMessageToWeb(envelope.dump());
    });
}

IpcBridge::~IpcBridge()
{
    *m_alive = false;
    if (m_pipeline)
    {
        m_pipeline->Stop();
    }
    if (m_discordRpc)
    {
        m_discordRpc->Stop();
    }
    if (m_osc)
    {
        m_osc->StopListen();
    }
    if (m_screenshotWatcher)
    {
        m_screenshotWatcher->Stop();
    }
    vrcsm::core::ProcessGuard::StopWatcher();
    vrcsm::core::Database::Instance().Close();
}

void IpcBridge::CloseTrackedWorldVisits(const std::string& leftAt)
{
    (void)vrcsm::core::Database::Instance().CloseOpenWorldVisits(leftAt);
    std::lock_guard<std::mutex> lk(m_currentWorldMutex);
    m_currentWorldId.clear();
    m_currentInstanceId.clear();
}

// ── Dispatch ────────────────────────────────────────────────────────

void IpcBridge::DispatchFromOrigin(const std::string& originUri, const std::string& jsonText)
{
    std::optional<std::string> id;

    try
    {
        const nlohmann::json envelope = nlohmann::json::parse(jsonText);
        id = ExtractId(envelope);

        const std::string method = envelope.at("method").get<std::string>();
        const nlohmann::json params = envelope.value("params", nlohmann::json::object());

        // ── Origin classification ──
        // Empty caller id means "host SPA" (app.vrcsm) — full access.
        // Non-empty means "plugin iframe <id>" — everything except the
        // plugin-self whitelist must tunnel through plugin.rpc.
        std::string callerPluginId;
        if (auto pid = vrcsm::core::plugins::PluginRegistry::PluginIdFromOrigin(originUri))
        {
            callerPluginId = *pid;
        }

        if (!callerPluginId.empty() && PluginReachableMethods().count(method) == 0)
        {
            PostError(id, "forbidden_origin",
                      fmt::format("plugin iframe may not call '{}' directly — "
                                  "wrap the call with plugin.rpc", method),
                      callerPluginId);
            return;
        }

        // ── Plugin-handler path (takes callerPluginId) ──
        if (auto pit = m_pluginHandlers.find(method); pit != m_pluginHandlers.end())
        {
            auto handler = pit->second;
            const auto capturedId = id;
            GetIpcPool().enqueue([this, handler = std::move(handler), params, capturedId,
                                   alive = m_alive, callerPluginId]()
            {
                try
                {
                    auto result = handler(params, capturedId, callerPluginId);
                    if (*alive) PostResult(capturedId, result, callerPluginId);
                }
                catch (const IpcException& ex)
                {
                    if (*alive) PostError(capturedId, ex.err, callerPluginId);
                }
                catch (const std::exception& ex)
                {
                    if (*alive) PostError(capturedId, "handler_error", ex.what(), callerPluginId);
                }
                catch (...)
                {
                    if (*alive) PostError(capturedId, "handler_error", "Unknown handler failure", callerPluginId);
                }
            });
            return;
        }

        // ── Regular handler path ──
        const auto it = m_handlers.find(method);
        if (it == m_handlers.end())
        {
            PostError(id, "method_not_found", fmt::format("Unknown IPC method: {}", method), callerPluginId);
            return;
        }

        // Slow handlers run on the thread pool; fast/UI-bound ones inline.
        if (AsyncMethodSet().count(method) > 0)
        {
            auto handler = it->second;
            const auto capturedId = id;
            GetIpcPool().enqueue([this, handler = std::move(handler), params, capturedId, alive = m_alive, method, callerPluginId]()
            {
                try
                {
                    auto result = handler(params, capturedId);
                    if (*alive) PostResult(capturedId, result, callerPluginId);
                }
                catch (const IpcException& ex)
                {
                    if (*alive) PostError(capturedId, ex.err, callerPluginId);
                }
                catch (const std::exception& ex)
                {
                    if (*alive) PostError(capturedId, "handler_error", ex.what(), callerPluginId);
                }
                catch (...)
                {
                    if (*alive) PostError(capturedId, "handler_error", "Unknown handler failure", callerPluginId);
                }
            });
            return;
        }

        try
        {
            PostResult(id, it->second(params, id), callerPluginId);
        }
        catch (const IpcException& ex)
        {
            PostError(id, ex.err, callerPluginId);
        }
        catch (const std::exception& ex)
        {
            PostError(id, "handler_error", ex.what(), callerPluginId);
        }
        catch (...)
        {
            PostError(id, "handler_error", "Unknown handler failure", callerPluginId);
        }
    }
    catch (const std::exception& ex)
    {
        PostError(id, "invalid_request", ex.what());
    }
    catch (...)
    {
        PostError(id, "invalid_request", "Unknown dispatch failure");
    }
}

// Dispatch a plain method by name from within the host (used by
// plugin.rpc to invoke a whitelisted inner method on behalf of a
// plugin after the permission gate has allowed it). Runs on the
// calling thread — the caller is already off the UI thread.
//
// Defined here because it needs access to m_handlers which is a
// private member. Exposed to PluginBridge.cpp via a declaration at
// the top of that file.
nlohmann::json InvokeHostHandler(IpcBridge& bridge,
                                  std::unordered_map<std::string, IpcBridge::Handler>& handlers,
                                  const std::string& method,
                                  const nlohmann::json& params,
                                  const std::optional<std::string>& id)
{
    (void)bridge;
    const auto it = handlers.find(method);
    if (it == handlers.end())
    {
        throw IpcException(vrcsm::core::Error{
            "method_not_found", fmt::format("plugin.rpc: unknown method '{}'", method), 0});
    }
    return it->second(params, id);
}

// ── Handler Registration ────────────────────────────────────────────
//
// Handler implementations live in bridges/*.cpp — this method only
// wires them to their IPC method names.

void IpcBridge::RegisterHandlers()
{
    // Shell / App
    m_handlers.emplace("app.version", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleAppVersion(p, id); });
    m_handlers.emplace("path.probe", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandlePathProbe(p, id); });
    m_handlers.emplace("process.vrcRunning", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleProcessVrcRunning(p, id); });
    m_handlers.emplace("autoStart.get", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleAutoStartGet(p, id); });
    m_handlers.emplace("autoStart.set", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleAutoStartSet(p, id); });
    m_handlers.emplace("vr.diagnose", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleVrDiagnose(p, id); });
    m_handlers.emplace("vr.audio.switch", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleVrAudioSwitch(p, id); });
    m_handlers.emplace("event.start", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleEventStart(p, id); });
    m_handlers.emplace("event.stop", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleEventStop(p, id); });
    m_handlers.emplace("event.list", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleEventList(p, id); });
    m_handlers.emplace("event.attendees", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleEventAttendees(p, id); });
    m_handlers.emplace("event.addAttendee", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleEventAddAttendee(p, id); });
    m_handlers.emplace("rules.list", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleRulesList(p, id); });
    m_handlers.emplace("rules.get", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleRulesGet(p, id); });
    m_handlers.emplace("rules.create", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleRulesCreate(p, id); });
    m_handlers.emplace("rules.update", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleRulesUpdate(p, id); });
    m_handlers.emplace("rules.delete", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleRulesDelete(p, id); });
    m_handlers.emplace("rules.setEnabled", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleRulesSetEnabled(p, id); });
    m_handlers.emplace("rules.history", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleRulesHistory(p, id); });
    m_handlers.emplace("shell.pickFolder", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleShellPickFolder(p, id); });
    m_handlers.emplace("shell.openUrl", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleShellOpenUrl(p, id); });
    m_handlers.emplace("fs.listDir", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFsListDir(p, id); });
    m_handlers.emplace("fs.writePlan", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFsWritePlan(p, id); });
    m_handlers.emplace("app.factoryReset", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleAppFactoryReset(p, id); });
    m_handlers.emplace("update.check", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleUpdateCheck(p, id); });
    m_handlers.emplace("update.download", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleUpdateDownload(p, id); });
    m_handlers.emplace("update.install", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleUpdateInstall(p, id); });
    m_handlers.emplace("update.skipVersion", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleUpdateSkipVersion(p, id); });
    m_handlers.emplace("update.unskipVersion", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleUpdateUnskipVersion(p, id); });
    m_handlers.emplace("update.getState", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleUpdateGetState(p, id); });

    // Cache
    m_handlers.emplace("scan", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleScan(p, id); });
    m_handlers.emplace("bundle.preview", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleBundlePreview(p, id); });
    m_handlers.emplace("delete.dryRun", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleDeleteDryRun(p, id); });
    m_handlers.emplace("delete.execute", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleDeleteExecute(p, id); });

    // Settings / Config / SteamVR
    m_handlers.emplace("settings.readAll", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleSettingsReadAll(p, id); });
    m_handlers.emplace("settings.writeOne", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleSettingsWriteOne(p, id); });
    m_handlers.emplace("settings.exportReg", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleSettingsExportReg(p, id); });
    m_handlers.emplace("config.read", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleConfigRead(p, id); });
    m_handlers.emplace("config.write", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleConfigWrite(p, id); });
    m_handlers.emplace("steamvr.read", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleSteamVrRead(p, id); });
    m_handlers.emplace("steamvr.write", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleSteamVrWrite(p, id); });

    // Migration
    m_handlers.emplace("migrate.preflight", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleMigratePreflight(p, id); });
    m_handlers.emplace("migrate.execute", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleMigrateExecute(p, id); });
    m_handlers.emplace("junction.repair", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleJunctionRepair(p, id); });

    // Thumbnails / Auth
    m_handlers.emplace("thumbnails.fetch", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleThumbnailsFetch(p, id); });
    m_handlers.emplace("auth.status", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleAuthStatus(p, id); });
    m_handlers.emplace("auth.login", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleAuthLogin(p, id); });
    m_handlers.emplace("auth.verify2FA", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleAuthVerify2FA(p, id); });
    m_handlers.emplace("auth.logout", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleAuthLogout(p, id); });
    m_handlers.emplace("auth.user", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleAuthUser(p, id); });

    // VRChat API
    m_handlers.emplace("avatar.preview", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleAvatarPreviewRequest(p, id); });
    m_handlers.emplace("avatar.preview.abort", [this](const nlohmann::json& p, const std::optional<std::string>&) -> nlohmann::json
    {
        const auto avatarId = JsonStringField(p, "avatarId").value_or("");
        if (!avatarId.empty())
        {
            m_previewQueue.Cancel(avatarId);
        }
        return nlohmann::json{{"ok", true}};
    });
    m_handlers.emplace("friends.list", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFriendsList(p, id); });
    m_handlers.emplace("groups.list", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleGroupsList(p, id); });
    m_handlers.emplace("groups.setRepresented", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleGroupsSetRepresented(p, id); });
    m_handlers.emplace("hw.applyPreset", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleHwApplyPreset(p, id); });
    m_handlers.emplace("hw.detect", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleHwDetect(p, id); });
    m_handlers.emplace("hw.recommend", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleHwRecommend(p, id); });
    m_handlers.emplace("moderations.list", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleModerationsList(p, id); });
    m_handlers.emplace("calendar.list", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleCalendarList(p, id); });
    m_handlers.emplace("calendar.discover", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleCalendarDiscover(p, id); });
    m_handlers.emplace("calendar.featured", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleCalendarFeatured(p, id); });
    m_handlers.emplace("jams.list", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleJamsList(p, id); });
    m_handlers.emplace("jams.detail", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleJamDetail(p, id); });
    m_handlers.emplace("avatar.bundle.download", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleAvatarBundleDownload(p, id); });
    m_handlers.emplace("avatar.details", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleAvatarDetails(p, id); });
    m_handlers.emplace("world.details", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleWorldDetails(p, id); });
    m_handlers.emplace("avatar.select", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleAvatarSelect(p, id); });
    m_handlers.emplace("avatar.search", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleAvatarSearch(p, id); });
    m_handlers.emplace("worlds.search", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleWorldsSearch(p, id); });
    m_handlers.emplace("friends.unfriend", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFriendsUnfriend(p, id); });
    m_handlers.emplace("friends.request", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFriendsRequest(p, id); });
    m_handlers.emplace("user.invite", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleUserInvite(p, id); });
    m_handlers.emplace("user.inviteTo", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleUserInviteTo(p, id); });
    m_handlers.emplace("user.requestInvite", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleUserRequestInvite(p, id); });
    m_handlers.emplace("user.mute", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleUserMute(p, id); });
    m_handlers.emplace("user.unmute", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleUserUnmute(p, id); });
    m_handlers.emplace("user.block", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleUserBlock(p, id); });
    m_handlers.emplace("user.unblock", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleUserUnblock(p, id); });
    m_handlers.emplace("user.me", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleUserMe(p, id); });
    m_handlers.emplace("user.getProfile", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleUserGetProfile(p, id); });
    m_handlers.emplace("user.updateProfile", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleUserUpdateProfile(p, id); });

    // Screenshots
    m_handlers.emplace("screenshots.list", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleScreenshotsList(p, id); });
    m_handlers.emplace("screenshots.open", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleScreenshotsOpen(p, id); });
    m_handlers.emplace("screenshots.folder", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleScreenshotsFolder(p, id); });
    m_handlers.emplace("screenshots.delete", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleScreenshotsDelete(p, id); });

    // Logs
    m_handlers.emplace("logs.stream.start", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleLogsStreamStart(p, id); });
    m_handlers.emplace("logs.stream.stop", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleLogsStreamStop(p, id); });
    m_handlers.emplace("logs.files.clear", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleLogsFilesClear(p, id); });

    // Pipeline + notifications — real-time event stream and inbox.
    m_handlers.emplace("pipeline.start", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandlePipelineStart(p, id); });
    m_handlers.emplace("pipeline.stop", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandlePipelineStop(p, id); });
    m_handlers.emplace("notifications.list", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleNotificationsList(p, id); });
    m_handlers.emplace("notifications.accept", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleNotificationsAccept(p, id); });
    m_handlers.emplace("notifications.respond", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleNotificationsRespond(p, id); });
    m_handlers.emplace("notifications.see", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleNotificationsSee(p, id); });
    m_handlers.emplace("notifications.hide", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleNotificationsHide(p, id); });
    m_handlers.emplace("notifications.clear", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleNotificationsClear(p, id); });
    m_handlers.emplace("message.send", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleMessageSend(p, id); });
    m_handlers.emplace("discord.setActivity", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleDiscordSetActivity(p, id); });
    m_handlers.emplace("discord.clearActivity", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleDiscordClearActivity(p, id); });
    m_handlers.emplace("discord.status", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleDiscordStatus(p, id); });
    m_handlers.emplace("osc.send", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleOscSend(p, id); });
    m_handlers.emplace("osc.listen.start", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleOscListenStart(p, id); });
    m_handlers.emplace("osc.listen.stop", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleOscListenStop(p, id); });
    m_handlers.emplace("screenshots.watcher.start", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleScreenshotsWatcherStart(p, id); });
    m_handlers.emplace("screenshots.watcher.stop", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleScreenshotsWatcherStop(p, id); });
    m_handlers.emplace("screenshots.injectMetadata", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleScreenshotsInjectMetadata(p, id); });
    m_handlers.emplace("screenshots.readMetadata", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleScreenshotsReadMetadata(p, id); });

    // Radar / Memory
    m_handlers.emplace("memory.status", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleMemoryStatus(p, id); });
    m_handlers.emplace("radar.poll", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleRadarPoll(p, id); });

    // Database / Favorites / Friend Log
    m_handlers.emplace("db.worldVisits.list", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleDbWorldVisits(p, id); });
    m_handlers.emplace("db.playerEvents.list", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleDbPlayerEvents(p, id); });
    m_handlers.emplace("db.playerEncounters", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleDbPlayerEncounters(p, id); });
    m_handlers.emplace("db.avatarHistory.list", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleDbAvatarHistory(p, id); });
    m_handlers.emplace("db.avatarHistory.count", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleDbAvatarHistoryCount(p, id); });
    m_handlers.emplace("db.avatarHistory.record", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleDbAvatarHistoryRecord(p, id); });
    m_handlers.emplace("db.stats.heatmap", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleDbStatsHeatmap(p, id); });
    m_handlers.emplace("db.stats.overview", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleDbStatsOverview(p, id); });
    m_handlers.emplace("db.history.clear", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleDbHistoryClear(p, id); });
    m_handlers.emplace("favorites.lists", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFavoritesLists(p, id); });
    m_handlers.emplace("favorites.items", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFavoritesItems(p, id); });
    m_handlers.emplace("favorites.add", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFavoritesAdd(p, id); });
    m_handlers.emplace("favorites.remove", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFavoritesRemove(p, id); });
    m_handlers.emplace("favorites.note.set", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFavoritesNoteSet(p, id); });
    m_handlers.emplace("favorites.tags.set", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFavoritesTagsSet(p, id); });
    m_handlers.emplace("favorites.syncOfficial", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFavoritesSyncOfficial(p, id); });
    m_handlers.emplace("favorites.export", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFavoritesExport(p, id); });
    m_handlers.emplace("favorites.import", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFavoritesImport(p, id); });
    m_handlers.emplace("friendLog.insert", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFriendLogInsert(p, id); });
    m_handlers.emplace("friendLog.recent", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFriendLogRecent(p, id); });
    m_handlers.emplace("friendLog.forUser", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFriendLogForUser(p, id); });
    m_handlers.emplace("friendNote.get", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFriendNoteGet(p, id); });
    m_handlers.emplace("friendNote.set", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFriendNoteSet(p, id); });

    // Experimental visual avatar search (v0.11) — guarded on the frontend
    // by the avatarVisualSearch experimental flag. The handlers are always
    // registered; if the flag is off the frontend simply never calls them.
    m_handlers.emplace("vector.upsertEmbedding", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleVectorUpsertEmbedding(p, id); });
    m_handlers.emplace("vector.search",          [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleVectorSearch(p, id); });
    m_handlers.emplace("vector.getUnindexed",    [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleVectorGetUnindexed(p, id); });
    m_handlers.emplace("vector.removeEmbedding", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleVectorRemoveEmbedding(p, id); });

    // Plugin system — registered in the separate plugin-handlers map
    // because they take a third parameter (callerPluginId) so
    // DispatchFromOrigin can thread the origin through.
    m_pluginHandlers.emplace("plugin.list", [this](const nlohmann::json& p, const std::optional<std::string>& id, const std::string& c) { return HandlePluginList(p, id, c); });
    m_pluginHandlers.emplace("plugin.install", [this](const nlohmann::json& p, const std::optional<std::string>& id, const std::string& c) { return HandlePluginInstall(p, id, c); });
    m_pluginHandlers.emplace("plugin.uninstall", [this](const nlohmann::json& p, const std::optional<std::string>& id, const std::string& c) { return HandlePluginUninstall(p, id, c); });
    m_pluginHandlers.emplace("plugin.enable", [this](const nlohmann::json& p, const std::optional<std::string>& id, const std::string& c) { return HandlePluginEnable(p, id, c); });
    m_pluginHandlers.emplace("plugin.disable", [this](const nlohmann::json& p, const std::optional<std::string>& id, const std::string& c) { return HandlePluginDisable(p, id, c); });
    m_pluginHandlers.emplace("plugin.marketFeed", [this](const nlohmann::json& p, const std::optional<std::string>& id, const std::string& c) { return HandlePluginMarketFeed(p, id, c); });
    m_pluginHandlers.emplace("plugin.rpc", [this](const nlohmann::json& p, const std::optional<std::string>& id, const std::string& c) { return HandlePluginRpc(p, id, c); });
}

// ── Post helpers ────────────────────────────────────────────────────

void IpcBridge::PostResult(const std::optional<std::string>& id, const nlohmann::json& result,
                           const std::string& targetPluginId) const
{
    nlohmann::json response{
        {"result", result}
    };
    if (id.has_value())
    {
        response["id"] = *id;
    }

    m_host.PostMessageToWeb(response.dump(), targetPluginId);
}

void IpcBridge::PostEventToUi(std::string_view eventName, const nlohmann::json& data,
                              const std::string& targetPluginId) const
{
    nlohmann::json envelope{
        {"event", eventName},
        {"data", data}
    };
    m_host.PostMessageToWeb(envelope.dump(), targetPluginId);
}

void IpcBridge::PostError(const std::optional<std::string>& id, std::string_view code, std::string_view message,
                          const std::string& targetPluginId) const
{
    nlohmann::json response{
        {"error", {
            {"code", code},
            {"message", message}
        }}
    };
    if (id.has_value())
    {
        response["id"] = *id;
    }

    m_host.PostMessageToWeb(response.dump(), targetPluginId);
}

void IpcBridge::PostError(const std::optional<std::string>& id, const vrcsm::core::Error& err,
                          const std::string& targetPluginId) const
{
    nlohmann::json errJson;
    to_json(errJson, err);
    nlohmann::json response{{"error", errJson}};
    if (id.has_value())
    {
        response["id"] = *id;
    }
    m_host.PostMessageToWeb(response.dump(), targetPluginId);
}
