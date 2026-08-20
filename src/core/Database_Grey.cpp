#include "Database.h"

#include <sqlite3.h>

#include "Database_internal.h"

#include "Common.h"

namespace vrcsm::core
{

Result<std::monostate> Database::InsertGreyAudit(
    const std::string& feature,
    const std::string& action,
    const nlohmann::json& detail)
{
    std::lock_guard lock(m_mutex);
    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }

    // Defense in depth: never persist secrets even if a caller slips.
    if (detail.is_object())
    {
        for (auto it = detail.begin(); it != detail.end(); ++it)
        {
            const auto& key = it.key();
            if (key == "password" || key == "imapPassword" || key == "cookie"
                || key == "otp" || key == "code")
            {
                return MakeError("invalid_argument", "grey_audit refuses secret fields");
            }
        }
    }

    const char* sql =
        "INSERT INTO grey_audit (at, feature, action, detail_json) VALUES (?, ?, ?, ?);";
    sqlite3_stmt* stmt = nullptr;
    int rc = sqlite3_prepare_v2(m_db, sql, -1, &stmt, nullptr);
    if (rc != SQLITE_OK) return MakeError("db_prepare_failed");

    detail::StatementGuard guard(stmt);
    const auto at = nowIso();
    const auto detailJson = detail.dump();
    if (detail::BindText(stmt, 1, at) != SQLITE_OK
        || detail::BindText(stmt, 2, feature) != SQLITE_OK
        || detail::BindText(stmt, 3, action) != SQLITE_OK
        || detail::BindText(stmt, 4, detailJson) != SQLITE_OK)
    {
        return MakeError("db_bind_failed");
    }
    rc = sqlite3_step(stmt);
    if (rc != SQLITE_DONE) return MakeError("db_step_failed");
    return std::monostate{};
}

} // namespace vrcsm::core
