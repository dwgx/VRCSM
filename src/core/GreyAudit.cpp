#include "GreyAudit.h"

#include "Database.h"

#include <spdlog/spdlog.h>

namespace vrcsm::core
{

Result<std::monostate> AppendGreyAudit(
    std::string_view feature,
    std::string_view action,
    const nlohmann::json& detail)
{
    if (!Database::Instance().IsOpen())
    {
        spdlog::warn("grey audit skipped (database not open): {} {}", feature, action);
        return std::monostate{};
    }
    return Database::Instance().InsertGreyAudit(std::string(feature), std::string(action), detail);
}

} // namespace vrcsm::core
