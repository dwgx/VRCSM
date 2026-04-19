#pragma once

#include "../pch.h"

#include "../core/Common.h"
#include "../core/Database.h"
#include "../core/LogTailer.h"
#include "../core/TaskQueue.h"
#include "../core/VrcRadarEngine.h"

#include <future>

class WebViewHost;

class IpcBridge
{
public:
    explicit IpcBridge(WebViewHost& host);
    ~IpcBridge();

    IpcBridge(const IpcBridge&) = delete;
    IpcBridge& operator=(const IpcBridge&) = delete;

    // Dispatch a message whose origin is known. The origin is the URL
    // (or just the host) of the frame that sent the message —
    // `app.vrcsm` for the main SPA and `plugin.<id>.vrcsm` for a
    // plugin iframe. Messages from a plugin origin are routed through
    // the plugin-rpc permission gate; the main SPA retains full access
    // to every handler.
    void DispatchFromOrigin(const std::string& originUri, const std::string& jsonText);

    // Backwards-compatible entry: assumes host origin. Tests and the
    // legacy WebView2 message handler call this; production code uses
    // DispatchFromOrigin.
    void Dispatch(const std::string& jsonText)
    {
        DispatchFromOrigin("https://app.vrcsm/", jsonText);
    }

    // Exposed for InvokeHostHandler (free function in IpcBridge.cpp) that
    // needs to iterate m_handlers by reference. Kept as a class-scope alias
    // so the dispatch signature stays aligned with the registration map.
    using Handler = std::function<nlohmann::json(const nlohmann::json&, const std::optional<std::string>&)>;

private:
    void RegisterHandlers();
    nlohmann::json HandleAppVersion(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandlePathProbe(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleScan(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleBundlePreview(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleDeleteDryRun(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleDeleteExecute(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleProcessVrcRunning(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleSettingsReadAll(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleSettingsWriteOne(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleSettingsExportReg(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleMigratePreflight(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleMigrateExecute(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleJunctionRepair(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleShellPickFolder(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleShellOpenUrl(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFsListDir(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFsWritePlan(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleThumbnailsFetch(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleAuthStatus(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleAuthLogin(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleAuthVerify2FA(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleAuthLogout(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleAuthUser(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleAvatarPreviewRequest(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFriendsList(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleGroupsList(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleHwApplyPreset(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleHwDetect(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleHwRecommend(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleModerationsList(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleAvatarBundleDownload(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleAvatarDetails(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleWorldDetails(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleAvatarSelect(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleAvatarSearch(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleUserMe(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleUserGetProfile(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleUserUpdateProfile(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleUpdateCheck(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleUpdateDownload(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleUpdateGetState(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleUpdateInstall(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleUpdateSkipVersion(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleUpdateUnskipVersion(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleScreenshotsList(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleScreenshotsOpen(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleScreenshotsFolder(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleScreenshotsDelete(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleLogsStreamStart(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleLogsStreamStop(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleLogsFilesClear(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleConfigRead(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleConfigWrite(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleAppFactoryReset(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleSteamVrRead(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleSteamVrWrite(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleMemoryStatus(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleRadarPoll(const nlohmann::json& params, const std::optional<std::string>& id);

    // db.* / favorites.* / friendLog.* / friendNote.* — SQLite-backed
    // history + local-state endpoints. All are async (they touch the
    // DB connection serialised behind a mutex) so they don't block the
    // UI thread.
    nlohmann::json HandleDbWorldVisits(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleDbPlayerEvents(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleDbPlayerEncounters(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleDbAvatarHistory(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleDbStatsHeatmap(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleDbStatsOverview(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleDbHistoryClear(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFavoritesLists(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFavoritesItems(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFavoritesAdd(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFavoritesRemove(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFavoritesNoteSet(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFavoritesTagsSet(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFavoritesSyncOfficial(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFavoritesExport(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFavoritesImport(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFriendLogRecent(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFriendLogForUser(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFriendNoteGet(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFriendNoteSet(const nlohmann::json& params, const std::optional<std::string>& id);

    // Plugin system — implementations live in bridges/PluginBridge.cpp.
    // "callerPluginId" is non-empty only when the call originated
    // from a plugin iframe (via plugin.rpc); the market/enable/
    // uninstall methods reject non-empty caller ids.
    nlohmann::json HandlePluginList(const nlohmann::json& params, const std::optional<std::string>& id,
                                    const std::string& callerPluginId);
    nlohmann::json HandlePluginInstall(const nlohmann::json& params, const std::optional<std::string>& id,
                                       const std::string& callerPluginId);
    nlohmann::json HandlePluginUninstall(const nlohmann::json& params, const std::optional<std::string>& id,
                                         const std::string& callerPluginId);
    nlohmann::json HandlePluginEnable(const nlohmann::json& params, const std::optional<std::string>& id,
                                      const std::string& callerPluginId);
    nlohmann::json HandlePluginDisable(const nlohmann::json& params, const std::optional<std::string>& id,
                                       const std::string& callerPluginId);
    nlohmann::json HandlePluginMarketFeed(const nlohmann::json& params, const std::optional<std::string>& id,
                                          const std::string& callerPluginId);
    nlohmann::json HandlePluginRpc(const nlohmann::json& params, const std::optional<std::string>& id,
                                   const std::string& callerPluginId);

    void CloseTrackedWorldVisits(const std::string& leftAt);

    // `targetPluginId` (when non-empty) routes the response to the
    // specific plugin iframe that issued the call — required because
    // ICoreWebView2::PostWebMessageAsString only reaches the main
    // frame. Defaults to "" → main SPA.
    void PostResult(const std::optional<std::string>& id, const nlohmann::json& result,
                    const std::string& targetPluginId = {}) const;
    void PostEventToUi(std::string_view eventName, const nlohmann::json& data,
                       const std::string& targetPluginId = {}) const;
    void PostError(const std::optional<std::string>& id, std::string_view code, std::string_view message,
                   const std::string& targetPluginId = {}) const;
    void PostError(const std::optional<std::string>& id, const vrcsm::core::Error& err,
                   const std::string& targetPluginId = {}) const;

    // Plugin-aware handler signature — identical to Handler but with
    // the caller plugin id threaded through so bridges know whether a
    // request came from a plugin iframe (and which one).
    using PluginHandler = std::function<nlohmann::json(const nlohmann::json&,
                                                        const std::optional<std::string>&,
                                                        const std::string& /*callerPluginId*/)>;

    WebViewHost& m_host;
    std::shared_ptr<std::atomic<bool>> m_alive;
    std::unordered_map<std::string, Handler> m_handlers;
    std::unordered_map<std::string, PluginHandler> m_pluginHandlers;
    std::unique_ptr<vrcsm::core::LogTailer> m_logTailer;
    vrcsm::core::TaskQueue m_previewQueue;
    vrcsm::core::VrcRadarEngine m_radarEngine;

    // Tracked from the log stream so player join/leave rows can be
    // associated with the world the user is currently in. Kept as an
    // atomic-accessed plain string guarded by m_currentWorldMutex
    // because the LogTailer callback fires on its own thread.
    std::mutex m_currentWorldMutex;
    std::string m_currentWorldId;
    std::string m_currentInstanceId;

    // Coalesce same-avatar preview requests so repeated renders / panes
    // join the existing extraction instead of cancelling and restarting it.
    std::mutex m_previewSharedMutex;
    std::unordered_map<std::string, std::shared_future<std::string>> m_previewShared;
};
