#pragma once

#include "../pch.h"

#include "../core/Common.h"
#include "../core/Database.h"
#include "../core/LogTailer.h"
#include "../core/TaskQueue.h"
#include "../core/VrcRadarEngine.h"

class WebViewHost;

class IpcBridge
{
public:
    explicit IpcBridge(WebViewHost& host);
    ~IpcBridge();

    IpcBridge(const IpcBridge&) = delete;
    IpcBridge& operator=(const IpcBridge&) = delete;

    void Dispatch(const std::string& jsonText);

private:
    using Handler = std::function<nlohmann::json(const nlohmann::json&, const std::optional<std::string>&)>;

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
    nlohmann::json HandleThumbnailsFetch(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleAuthStatus(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleAuthLogin(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleAuthVerify2FA(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleAuthLogout(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleAuthUser(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleAvatarPreviewRequest(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFriendsList(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleAvatarDetails(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleWorldDetails(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleAvatarSelect(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleUserMe(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleUserGetProfile(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleUserUpdateProfile(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleScreenshotsList(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleScreenshotsOpen(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleScreenshotsFolder(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleScreenshotsDelete(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleLogsStreamStart(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleLogsStreamStop(const nlohmann::json& params, const std::optional<std::string>& id);
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
    nlohmann::json HandleFavoritesLists(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFavoritesItems(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFavoritesAdd(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFavoritesRemove(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFavoritesNoteSet(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFavoritesTagsSet(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFavoritesExport(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFavoritesImport(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFriendLogRecent(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFriendLogForUser(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFriendNoteGet(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleFriendNoteSet(const nlohmann::json& params, const std::optional<std::string>& id);

    void PostResult(const std::optional<std::string>& id, const nlohmann::json& result) const;
    void PostError(const std::optional<std::string>& id, std::string_view code, std::string_view message) const;
    void PostError(const std::optional<std::string>& id, const vrcsm::core::Error& err) const;

    WebViewHost& m_host;
    std::shared_ptr<std::atomic<bool>> m_alive;
    std::unordered_map<std::string, Handler> m_handlers;
    std::unique_ptr<vrcsm::core::LogTailer> m_logTailer;
    vrcsm::core::TaskQueue m_previewQueue;
    vrcsm::core::VrcRadarEngine m_radarEngine;

    // Tracked from the log stream so player join/leave rows can be
    // associated with the world the user is currently in. Kept as an
    // atomic-accessed plain string guarded by m_currentWorldMutex
    // because the LogTailer callback fires on its own thread.
    std::mutex m_currentWorldMutex;
    std::string m_currentWorldId;
};
