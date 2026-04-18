#include "../pch.h"

#include "IpcBridge.h"

#include "StringUtil.h"
#include "WebViewHost.h"

#include "../core/AuthStore.h"
#include "../core/CacheIndex.h"
#include "../core/Database.h"
#include "../core/PathProbe.h"
#include "../core/ProcessGuard.h"

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
            try { task(); } catch (...) { /* swallow — bridge catches upstream */ }
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
        "thumbnails.fetch",
        "auth.status",
        "auth.user",
        "auth.logout",
        "auth.login",
        "auth.verify2FA",
        "friends.list",
        "groups.list",
        "moderations.list",
        "avatar.bundle.download",
        "avatar.details",
        "world.details",
        "avatar.preview",
        "avatar.preview.abort",
        "avatar.select",
        "user.me",
        "user.getProfile",
        "user.updateProfile",
        "screenshots.list",
        "logs.files.clear",
        "app.factoryReset",
        "db.worldVisits.list",
        "db.playerEvents.list",
        "db.playerEncounters",
        "db.avatarHistory.list",
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
        "friendLog.recent",
        "friendLog.forUser",
        "friendNote.get",
        "friendNote.set",
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

void IpcBridge::Dispatch(const std::string& jsonText)
{
    std::optional<std::string> id;

    try
    {
        const nlohmann::json envelope = nlohmann::json::parse(jsonText);
        id = ExtractId(envelope);

        const std::string method = envelope.at("method").get<std::string>();
        const nlohmann::json params = envelope.value("params", nlohmann::json::object());

        const auto it = m_handlers.find(method);
        if (it == m_handlers.end())
        {
            PostError(id, "method_not_found", fmt::format("Unknown IPC method: {}", method));
            return;
        }

        // Slow handlers run on the thread pool; fast/UI-bound ones inline.
        if (AsyncMethodSet().count(method) > 0)
        {
            auto handler = it->second;
            const auto capturedId = id;
            GetIpcPool().enqueue([this, handler = std::move(handler), params, capturedId, alive = m_alive, method]()
            {
                try
                {
                    auto result = handler(params, capturedId);
                    if (*alive) PostResult(capturedId, result);
                }
                catch (const IpcException& ex)
                {
                    if (*alive) PostError(capturedId, ex.err);
                }
                catch (const std::exception& ex)
                {
                    if (*alive) PostError(capturedId, "handler_error", ex.what());
                }
                catch (...)
                {
                    if (*alive) PostError(capturedId, "handler_error", "Unknown handler failure");
                }
            });
            return;
        }

        try
        {
            PostResult(id, it->second(params, id));
        }
        catch (const IpcException& ex)
        {
            PostError(id, ex.err);
        }
        catch (const std::exception& ex)
        {
            PostError(id, "handler_error", ex.what());
        }
        catch (...)
        {
            PostError(id, "handler_error", "Unknown handler failure");
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
    m_handlers.emplace("shell.pickFolder", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleShellPickFolder(p, id); });
    m_handlers.emplace("shell.openUrl", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleShellOpenUrl(p, id); });
    m_handlers.emplace("app.factoryReset", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleAppFactoryReset(p, id); });

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
    m_handlers.emplace("moderations.list", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleModerationsList(p, id); });
    m_handlers.emplace("avatar.bundle.download", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleAvatarBundleDownload(p, id); });
    m_handlers.emplace("avatar.details", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleAvatarDetails(p, id); });
    m_handlers.emplace("world.details", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleWorldDetails(p, id); });
    m_handlers.emplace("avatar.select", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleAvatarSelect(p, id); });
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

    // Radar / Memory
    m_handlers.emplace("memory.status", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleMemoryStatus(p, id); });
    m_handlers.emplace("radar.poll", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleRadarPoll(p, id); });

    // Database / Favorites / Friend Log
    m_handlers.emplace("db.worldVisits.list", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleDbWorldVisits(p, id); });
    m_handlers.emplace("db.playerEvents.list", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleDbPlayerEvents(p, id); });
    m_handlers.emplace("db.playerEncounters", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleDbPlayerEncounters(p, id); });
    m_handlers.emplace("db.avatarHistory.list", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleDbAvatarHistory(p, id); });
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
    m_handlers.emplace("friendLog.recent", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFriendLogRecent(p, id); });
    m_handlers.emplace("friendLog.forUser", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFriendLogForUser(p, id); });
    m_handlers.emplace("friendNote.get", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFriendNoteGet(p, id); });
    m_handlers.emplace("friendNote.set", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFriendNoteSet(p, id); });
}

// ── Post helpers ────────────────────────────────────────────────────

void IpcBridge::PostResult(const std::optional<std::string>& id, const nlohmann::json& result) const
{
    nlohmann::json response{
        {"result", result}
    };
    if (id.has_value())
    {
        response["id"] = *id;
    }

    m_host.PostMessageToWeb(response.dump());
}

void IpcBridge::PostError(const std::optional<std::string>& id, std::string_view code, std::string_view message) const
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

    m_host.PostMessageToWeb(response.dump());
}

void IpcBridge::PostError(const std::optional<std::string>& id, const vrcsm::core::Error& err) const
{
    nlohmann::json errJson;
    to_json(errJson, err);
    nlohmann::json response{{"error", errJson}};
    if (id.has_value())
    {
        response["id"] = *id;
    }
    m_host.PostMessageToWeb(response.dump());
}
