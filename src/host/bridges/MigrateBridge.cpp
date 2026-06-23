#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/JunctionUtil.h"
#include "../../core/Migrator.h"

nlohmann::json IpcBridge::HandleMigratePreflight(const nlohmann::json& params, const std::optional<std::string>&)
{
    return ToJson(vrcsm::core::Migrator::Preflight(params));
}

nlohmann::json IpcBridge::HandleMigrateExecute(const nlohmann::json& params, const std::optional<std::string>&)
{
    auto progress = [this](const auto& update)
    {
        m_host.PostMessageToWeb(nlohmann::json{
            {"event", "migrate.progress"},
            {"data", ToJson(update)}
        }.dump());
    };

    const auto result = vrcsm::core::Migrator::Execute(params, progress);
    m_host.PostMessageToWeb(nlohmann::json{
        {"event", "migrate.done"},
        {"data", ToJson(result)}
    }.dump());
    return ToJson(result);
}

nlohmann::json IpcBridge::HandleJunctionRepair(const nlohmann::json& params, const std::optional<std::string>&)
{
    return ToJson(vrcsm::core::JunctionUtil::Repair(params));
}
