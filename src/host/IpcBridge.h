#pragma once

#include "../pch.h"

class WebViewHost;

class IpcBridge
{
public:
    explicit IpcBridge(WebViewHost& host);

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
    nlohmann::json HandleMigratePreflight(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleMigrateExecute(const nlohmann::json& params, const std::optional<std::string>& id);
    nlohmann::json HandleJunctionRepair(const nlohmann::json& params, const std::optional<std::string>& id);

    void PostResult(const std::optional<std::string>& id, const nlohmann::json& result) const;
    void PostError(const std::optional<std::string>& id, std::string_view code, std::string_view message) const;

    WebViewHost& m_host;
    std::unordered_map<std::string, Handler> m_handlers;
};
