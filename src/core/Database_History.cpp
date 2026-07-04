#include "Database.h"

#include <sqlite3.h>

#include <fmt/format.h>

#include <array>
#include <algorithm>
#include <cctype>
#include <charconv>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <ctime>
#include <limits>
#include <set>
#include <string_view>
#include <system_error>
#include <unordered_map>
#include <unordered_set>

#include "Database_internal.h"

namespace vrcsm::core
{


Result<std::int64_t> Database::InsertWorldVisit(const WorldVisitInsert& v)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    const char* sql =
        "INSERT OR IGNORE INTO world_visits ("
        "world_id, instance_id, access_type, owner_id, region, joined_at"
        ") VALUES (?, ?, ?, ?, ?, ?);";

    const auto result = RunOnce(sql, [this, &v](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindText(stmt, 1, v.world_id) != SQLITE_OK ||
            BindText(stmt, 2, v.instance_id) != SQLITE_OK ||
            BindOptionalText(stmt, 3, v.access_type) != SQLITE_OK ||
            BindOptionalText(stmt, 4, v.owner_id) != SQLITE_OK ||
            BindOptionalText(stmt, 5, v.region) != SQLITE_OK ||
            BindText(stmt, 6, v.joined_at) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        return std::monostate{};
    });
    if (std::holds_alternative<Error>(result))
    {
        return std::get<Error>(result);
    }

    return static_cast<std::int64_t>(sqlite3_last_insert_rowid(m_db));
}


Result<std::monostate> Database::MarkVisitLeft(const std::string& world_id,
                                               const std::string& instance_id,
                                               const std::string& left_at)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    const char* sql =
        "UPDATE world_visits "
        "SET left_at = ? "
        "WHERE id = ("
        "    SELECT id FROM world_visits "
        "    WHERE world_id = ? AND instance_id = ? AND left_at IS NULL "
        "    ORDER BY joined_at DESC "
        "    LIMIT 1"
        ");";

    return RunOnce(sql, [this, &world_id, &instance_id, &left_at](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindText(stmt, 1, left_at) != SQLITE_OK ||
            BindText(stmt, 2, world_id) != SQLITE_OK ||
            BindText(stmt, 3, instance_id) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        return std::monostate{};
    });
}


Result<std::monostate> Database::CloseOpenWorldVisits(const std::string& left_at)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    const char* sql =
        "UPDATE world_visits "
        "SET left_at = ? "
        "WHERE left_at IS NULL;";

    return RunOnce(sql, [this, &left_at](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindText(stmt, 1, left_at) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        return std::monostate{};
    });
}


Result<nlohmann::json> Database::RecentWorldVisits(int limit, int offset)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (limit < 0 || offset < 0)
    {
        return MakeError("db_invalid_argument", "limit and offset must be non-negative");
    }
    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }

    const char* sql =
        "SELECT w.id, w.world_id, w.instance_id, w.access_type, w.owner_id, w.region, w.joined_at, w.left_at, "
        "       ("
        "           SELECT COUNT(DISTINCT COALESCE(NULLIF(pe.user_id, ''), pe.display_name)) "
        "           FROM player_events pe "
        "           WHERE pe.world_id = w.world_id "
        "             AND pe.instance_id = w.instance_id "
        "             AND pe.occurred_at >= w.joined_at "
        "             AND (w.left_at IS NULL OR pe.occurred_at <= w.left_at)"
        "       ) AS player_count, "
        "       ("
        "           SELECT COUNT(*) "
        "           FROM player_events pe "
        "           WHERE pe.world_id = w.world_id "
        "             AND pe.instance_id = w.instance_id "
        "             AND pe.occurred_at >= w.joined_at "
        "             AND (w.left_at IS NULL OR pe.occurred_at <= w.left_at)"
        "       ) AS player_event_count, "
        "       ("
        "           SELECT MAX(pe.occurred_at) "
        "           FROM player_events pe "
        "           WHERE pe.world_id = w.world_id "
        "             AND pe.instance_id = w.instance_id "
        "             AND pe.occurred_at >= w.joined_at "
        "             AND (w.left_at IS NULL OR pe.occurred_at <= w.left_at)"
        "       ) AS last_player_seen_at "
        "FROM world_visits w "
        "ORDER BY joined_at DESC "
        "LIMIT ? OFFSET ?;";

    sqlite3_stmt* rawStmt = nullptr;
    if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
    {
        return MakeError("db_prepare_failed");
    }
    StatementGuard stmt(rawStmt);

    if (BindInt(rawStmt, 1, limit) != SQLITE_OK || BindInt(rawStmt, 2, offset) != SQLITE_OK)
    {
        return MakeError("db_bind_failed");
    }

    nlohmann::json rows = nlohmann::json::array();
    int rc = SQLITE_OK;
    while ((rc = sqlite3_step(rawStmt)) == SQLITE_ROW)
    {
        nlohmann::json row = nlohmann::json::object();
        row["id"] = static_cast<std::int64_t>(sqlite3_column_int64(rawStmt, 0));
        row["world_id"] = ColumnTextOrNull(rawStmt, 1);
        row["instance_id"] = ColumnTextOrNull(rawStmt, 2);
        row["access_type"] = ColumnTextOrNull(rawStmt, 3);
        row["owner_id"] = ColumnTextOrNull(rawStmt, 4);
        row["region"] = ColumnTextOrNull(rawStmt, 5);
        row["joined_at"] = ColumnTextOrNull(rawStmt, 6);
        row["left_at"] = ColumnTextOrNull(rawStmt, 7);
        row["player_count"] = static_cast<std::int64_t>(sqlite3_column_int64(rawStmt, 8));
        row["player_event_count"] = static_cast<std::int64_t>(sqlite3_column_int64(rawStmt, 9));
        row["last_player_seen_at"] = ColumnTextOrNull(rawStmt, 10);
        rows.push_back(std::move(row));
    }

    if (rc != SQLITE_DONE)
    {
        return MakeError("db_step_failed");
    }

    return rows;
}


Result<std::monostate> Database::RecordPlayerEvent(const PlayerEventInsert& e)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }

    const auto beginResult = ExecSimple("BEGIN;");
    if (std::holds_alternative<Error>(beginResult))
    {
        return std::get<Error>(beginResult);
    }

    const char* insertEventSql =
        "INSERT INTO player_events (kind, user_id, display_name, world_id, instance_id, occurred_at) "
        "VALUES (?, ?, ?, ?, ?, ?);";

    const auto insertEventResult =
        RunOnce(insertEventSql, [this, &e](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindText(stmt, 1, e.kind) != SQLITE_OK ||
            BindOptionalText(stmt, 2, e.user_id) != SQLITE_OK ||
            BindText(stmt, 3, e.display_name) != SQLITE_OK ||
            BindOptionalText(stmt, 4, e.world_id) != SQLITE_OK ||
            BindOptionalText(stmt, 5, e.instance_id) != SQLITE_OK ||
            BindText(stmt, 6, e.occurred_at) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        return std::monostate{};
    });
    if (std::holds_alternative<Error>(insertEventResult))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(insertEventResult);
    }

    if (e.user_id.has_value() && e.world_id.has_value() && e.kind == "joined")
    {
        const char* upsertEncounterSql =
            "INSERT INTO player_encounters ("
            "user_id, display_name, world_id, first_seen, last_seen, encounter_count"
            ") VALUES (?, ?, ?, ?, ?, 1) "
            "ON CONFLICT(user_id, world_id) DO UPDATE SET "
            "last_seen = excluded.last_seen, "
            "encounter_count = encounter_count + 1, "
            "display_name = excluded.display_name;";

        const auto upsertResult =
            RunOnce(upsertEncounterSql, [this, &e](sqlite3_stmt* stmt) -> Result<std::monostate>
        {
            if (BindText(stmt, 1, *e.user_id) != SQLITE_OK ||
                BindText(stmt, 2, e.display_name) != SQLITE_OK ||
                BindText(stmt, 3, *e.world_id) != SQLITE_OK ||
                BindText(stmt, 4, e.occurred_at) != SQLITE_OK ||
                BindText(stmt, 5, e.occurred_at) != SQLITE_OK)
            {
                return MakeError("db_bind_failed");
            }
            return std::monostate{};
        });
        if (std::holds_alternative<Error>(upsertResult))
        {
            RollbackIfNeeded(m_db);
            return std::get<Error>(upsertResult);
        }
    }

    const auto commitResult = ExecSimple("COMMIT;");
    if (std::holds_alternative<Error>(commitResult))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(commitResult);
    }

    return std::monostate{};
}


Result<std::monostate> Database::RecordLogEvent(const LogEventInsert& e)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }

    const char* sql =
        "INSERT INTO log_events (kind, user_id, display_name, world_id, instance_id, detail, occurred_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?);";

    return RunOnce(sql, [this, &e](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindText(stmt, 1, e.kind) != SQLITE_OK ||
            BindOptionalText(stmt, 2, e.user_id) != SQLITE_OK ||
            BindOptionalText(stmt, 3, e.display_name) != SQLITE_OK ||
            BindOptionalText(stmt, 4, e.world_id) != SQLITE_OK ||
            BindOptionalText(stmt, 5, e.instance_id) != SQLITE_OK ||
            BindOptionalText(stmt, 6, e.detail) != SQLITE_OK ||
            BindText(stmt, 7, e.occurred_at) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        return std::monostate{};
    });
}


Result<std::monostate> Database::RecordNotification(const NotificationInsert& n)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }
    if (n.account_user_id.empty() || n.notification_id.empty())
    {
        return MakeError("db_invalid_argument", "account_user_id and notification_id are required");
    }

    const char* sql =
        "INSERT OR IGNORE INTO notifications "
        "(account_user_id, notification_id, type, sender_id, sender_name, detail, seen, occurred_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?);";

    return RunOnce(sql, [this, &n](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindText(stmt, 1, n.account_user_id) != SQLITE_OK ||
            BindText(stmt, 2, n.notification_id) != SQLITE_OK ||
            BindText(stmt, 3, n.type) != SQLITE_OK ||
            BindOptionalText(stmt, 4, n.sender_id) != SQLITE_OK ||
            BindOptionalText(stmt, 5, n.sender_name) != SQLITE_OK ||
            BindOptionalText(stmt, 6, n.detail) != SQLITE_OK ||
            BindInt(stmt, 7, n.seen ? 1 : 0) != SQLITE_OK ||
            BindText(stmt, 8, n.occurred_at) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        return std::monostate{};
    });
}


Result<std::int64_t> Database::RecordSessionStart(const SessionStartInsert& s)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }
    if (s.started_at.empty())
    {
        return MakeError("db_invalid_argument", "started_at is required");
    }

    const char* sql =
        "INSERT INTO sessions (account_user_id, started_at, mode, hmd_model, log_file) "
        "VALUES (?, ?, ?, ?, ?);";

    const auto inserted = RunOnce(sql, [this, &s](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindOptionalText(stmt, 1, s.account_user_id) != SQLITE_OK ||
            BindText(stmt, 2, s.started_at) != SQLITE_OK ||
            BindOptionalText(stmt, 3, s.mode) != SQLITE_OK ||
            BindOptionalText(stmt, 4, s.hmd_model) != SQLITE_OK ||
            BindOptionalText(stmt, 5, s.log_file) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        return std::monostate{};
    });
    if (std::holds_alternative<Error>(inserted))
    {
        return std::get<Error>(inserted);
    }
    return static_cast<std::int64_t>(sqlite3_last_insert_rowid(m_db));
}


Result<std::monostate> Database::RecordSessionMode(
    std::int64_t session_id,
    const std::optional<std::string>& mode,
    const std::optional<std::string>& hmd_model)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }

    // COALESCE keeps the existing column when a field is not supplied, so
    // a mode-only update never clobbers a previously-detected hmd_model.
    const char* sql =
        "UPDATE sessions SET mode = COALESCE(?, mode), "
        "hmd_model = COALESCE(?, hmd_model) WHERE id = ?;";

    return RunOnce(sql, [&](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindOptionalText(stmt, 1, mode) != SQLITE_OK ||
            BindOptionalText(stmt, 2, hmd_model) != SQLITE_OK ||
            sqlite3_bind_int64(stmt, 3, session_id) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        return std::monostate{};
    });
}


Result<std::monostate> Database::RecordSessionEnd(
    std::int64_t session_id,
    const std::string& ended_at,
    bool closed_gracefully)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }

    const char* sql =
        "UPDATE sessions SET ended_at = ?, closed_gracefully = ? WHERE id = ?;";

    return RunOnce(sql, [&](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindText(stmt, 1, ended_at) != SQLITE_OK ||
            BindInt(stmt, 2, closed_gracefully ? 1 : 0) != SQLITE_OK ||
            sqlite3_bind_int64(stmt, 3, session_id) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        return std::monostate{};
    });
}

Result<nlohmann::json> Database::RecentPlayerEvents(
    int limit,
    int offset,
    std::optional<std::string> world_id,
    std::optional<std::string> instance_id,
    std::optional<std::string> occurred_after,
    std::optional<std::string> occurred_before)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (limit < 0 || offset < 0)
    {
        return MakeError("db_invalid_argument", "limit and offset must be non-negative");
    }
    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }

    const char* sql =
        "SELECT id, kind, user_id, display_name, world_id, instance_id, occurred_at "
        "FROM player_events "
        "WHERE (?1 IS NULL OR world_id = ?2) "
        "  AND (?3 IS NULL OR instance_id = ?4) "
        "  AND (?5 IS NULL OR occurred_at >= ?6) "
        "  AND (?7 IS NULL OR occurred_at < ?8) "
        "ORDER BY occurred_at DESC "
        "LIMIT ?9 OFFSET ?10;";

    sqlite3_stmt* rawStmt = nullptr;
    if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
    {
        return MakeError("db_prepare_failed");
    }
    StatementGuard stmt(rawStmt);

    if (BindOptionalText(rawStmt, 1, world_id) != SQLITE_OK
        || BindOptionalText(rawStmt, 2, world_id) != SQLITE_OK
        || BindOptionalText(rawStmt, 3, instance_id) != SQLITE_OK
        || BindOptionalText(rawStmt, 4, instance_id) != SQLITE_OK
        || BindOptionalText(rawStmt, 5, occurred_after) != SQLITE_OK
        || BindOptionalText(rawStmt, 6, occurred_after) != SQLITE_OK
        || BindOptionalText(rawStmt, 7, occurred_before) != SQLITE_OK
        || BindOptionalText(rawStmt, 8, occurred_before) != SQLITE_OK
        || BindInt(rawStmt, 9, limit) != SQLITE_OK
        || BindInt(rawStmt, 10, offset) != SQLITE_OK)
    {
        return MakeError("db_bind_failed");
    }

    nlohmann::json rows = nlohmann::json::array();
    int rc = SQLITE_OK;
    while ((rc = sqlite3_step(rawStmt)) == SQLITE_ROW)
    {
        nlohmann::json row = nlohmann::json::object();
        row["id"] = static_cast<std::int64_t>(sqlite3_column_int64(rawStmt, 0));
        row["kind"] = ColumnTextOrNull(rawStmt, 1);
        row["user_id"] = ColumnTextOrNull(rawStmt, 2);
        row["display_name"] = ColumnTextOrNull(rawStmt, 3);
        row["world_id"] = ColumnTextOrNull(rawStmt, 4);
        row["instance_id"] = ColumnTextOrNull(rawStmt, 5);
        row["occurred_at"] = ColumnTextOrNull(rawStmt, 6);
        rows.push_back(std::move(row));
    }

    if (rc != SQLITE_DONE)
    {
        return MakeError("db_step_failed");
    }

    return rows;
}


Result<nlohmann::json> Database::EncountersForUser(const std::string& user_id)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }

    const char* sql =
        "SELECT user_id, display_name, world_id, first_seen, last_seen, encounter_count "
        "FROM player_encounters "
        "WHERE user_id = ? "
        "ORDER BY last_seen DESC;";

    sqlite3_stmt* rawStmt = nullptr;
    if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
    {
        return MakeError("db_prepare_failed");
    }
    StatementGuard stmt(rawStmt);

    if (BindText(rawStmt, 1, user_id) != SQLITE_OK)
    {
        return MakeError("db_bind_failed");
    }

    nlohmann::json rows = nlohmann::json::array();
    int rc = SQLITE_OK;
    while ((rc = sqlite3_step(rawStmt)) == SQLITE_ROW)
    {
        nlohmann::json row = nlohmann::json::object();
        row["user_id"] = ColumnTextOrNull(rawStmt, 0);
        row["display_name"] = ColumnTextOrNull(rawStmt, 1);
        row["world_id"] = ColumnTextOrNull(rawStmt, 2);
        row["first_seen"] = ColumnTextOrNull(rawStmt, 3);
        row["last_seen"] = ColumnTextOrNull(rawStmt, 4);
        row["encounter_count"] = sqlite3_column_int(rawStmt, 5);
        rows.push_back(std::move(row));
    }

    if (rc != SQLITE_DONE)
    {
        return MakeError("db_step_failed");
    }

    return rows;
}

} // namespace vrcsm::core
