#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/Database.h"

nlohmann::json IpcBridge::HandleSearchGlobal(const nlohmann::json& params, const std::optional<std::string>&)
{
    auto res = vrcsm::core::Database::Instance().GlobalSearch(params);
    return unwrapResult(std::move(res));
}
