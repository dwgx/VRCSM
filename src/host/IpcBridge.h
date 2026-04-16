#pragma once

#include "../pch.h"

#include "../core/Common.h"
#include "../core/LogTailer.h"
#include "../core/TaskQueue.h"

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
    nlohmann::json HandleLogsStreamStart(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleLogsStreamStop(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleAppFactoryReset(const nlohmann::json& params, const std::optional<std::string>& id);

    void PostResult(const std::optional<std::string>& id, const nlohmann::json& result) const;
    void PostError(const std::optional<std::string>& id, std::string_view code, std::string_view message) const;
    void PostError(const std::optional<std::string>& id, const vrcsm::core::Error& err) const;

    WebViewHost& m_host;
    std::unordered_map<std::string, Handler> m_handlers;
    std::unique_ptr<vrcsm::core::LogTailer> m_logTailer;
    vrcsm::core::TaskQueue m_previewQueue;
};
