#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/JunctionUtil.h"
#include "../../core/Migrator.h"

nlohmann::json IpcBridge::HandleMigratePreflight(const nlohmann::json& params, const std::optional<std::string>&)
{
    return ToJson(vrcsm::core::Migrator::Preflight(params));
}

nlohmann::json IpcBridge::HandleMigrateExecute(const nlohmann::json& params, const std::optional<std::string>& id)
{
    const auto request = params;
    const auto requestId = id;

    if (!EnqueueAsync([this, request, requestId]()
    {
        try
        {
            auto progress = [this](const auto& update)
            {
                m_host.PostMessageToWeb(nlohmann::json{
                    {"event", "migrate.progress"},
                    {"data", ToJson(update)}
                }.dump());
            };

            const auto result = vrcsm::core::Migrator::Execute(request, progress);
            m_host.PostMessageToWeb(nlohmann::json{
                {"event", "migrate.done"},
                {"data", ToJson(result)}
            }.dump());
            PostResult(requestId, ToJson(result));
        }
        catch (const std::exception& ex)
        {
            PostError(requestId, "migrate_failed", ex.what());
        }
        catch (...)
        {
            PostError(requestId, "migrate_failed", "Unknown migration failure");
        }
    }))
    {
        throw std::runtime_error("migrate.execute: IPC bridge is shutting down");
    }

    return nlohmann::json{{"started", true}};
}

nlohmann::json IpcBridge::HandleJunctionRepair(const nlohmann::json& params, const std::optional<std::string>&)
{
    return ToJson(vrcsm::core::JunctionUtil::Repair(params));
}
