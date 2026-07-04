#include "Database.h"
#include "FriendAnalytics.h"

#include <sqlite3.h>

#include <fmt/format.h>

#include <Windows.h>   // GetTimeZoneInformation / TIME_ZONE_INFORMATION (local offset)

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


Result<std::monostate> Database::InsertFriendLog(const FriendLogInsert& e)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    const char* sql =
        "INSERT INTO friend_log (user_id, event_type, old_value, new_value, occurred_at, display_name) "
        "VALUES (?, ?, ?, ?, ?, ?);";

    return RunOnce(sql, [this, &e](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindText(stmt, 1, e.user_id) != SQLITE_OK ||
            BindText(stmt, 2, e.event_type) != SQLITE_OK ||
            BindOptionalText(stmt, 3, e.old_value) != SQLITE_OK ||
            BindOptionalText(stmt, 4, e.new_value) != SQLITE_OK ||
            BindText(stmt, 5, e.occurred_at) != SQLITE_OK ||
            BindOptionalText(stmt, 6, e.display_name) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        return std::monostate{};
    });
}


Result<nlohmann::json> Database::RecentFriendLog(int limit, int offset)
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
        "SELECT id, user_id, event_type, old_value, new_value, occurred_at, display_name "
        "FROM friend_log "
        "ORDER BY occurred_at DESC "
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
        row["user_id"] = ColumnTextOrNull(rawStmt, 1);
        row["event_type"] = ColumnTextOrNull(rawStmt, 2);
        row["old_value"] = ColumnTextOrNull(rawStmt, 3);
        row["new_value"] = ColumnTextOrNull(rawStmt, 4);
        row["occurred_at"] = ColumnTextOrNull(rawStmt, 5);
        row["display_name"] = ColumnTextOrNull(rawStmt, 6);
        rows.push_back(std::move(row));
    }

    if (rc != SQLITE_DONE)
    {
        return MakeError("db_step_failed");
    }

    return rows;
}


Result<nlohmann::json> Database::FriendLogForUser(const std::string& user_id,
                                                  int limit,
                                                  int offset)
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
        "SELECT id, user_id, event_type, old_value, new_value, occurred_at, display_name "
        "FROM friend_log "
        "WHERE user_id = ? "
        "ORDER BY occurred_at DESC "
        "LIMIT ? OFFSET ?;";

    sqlite3_stmt* rawStmt = nullptr;
    if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
    {
        return MakeError("db_prepare_failed");
    }
    StatementGuard stmt(rawStmt);

    if (BindText(rawStmt, 1, user_id) != SQLITE_OK ||
        BindInt(rawStmt, 2, limit) != SQLITE_OK ||
        BindInt(rawStmt, 3, offset) != SQLITE_OK)
    {
        return MakeError("db_bind_failed");
    }

    nlohmann::json rows = nlohmann::json::array();
    int rc = SQLITE_OK;
    while ((rc = sqlite3_step(rawStmt)) == SQLITE_ROW)
    {
        nlohmann::json row = nlohmann::json::object();
        row["id"] = static_cast<std::int64_t>(sqlite3_column_int64(rawStmt, 0));
        row["user_id"] = ColumnTextOrNull(rawStmt, 1);
        row["event_type"] = ColumnTextOrNull(rawStmt, 2);
        row["old_value"] = ColumnTextOrNull(rawStmt, 3);
        row["new_value"] = ColumnTextOrNull(rawStmt, 4);
        row["occurred_at"] = ColumnTextOrNull(rawStmt, 5);
        row["display_name"] = ColumnTextOrNull(rawStmt, 6);
        rows.push_back(std::move(row));
    }

    if (rc != SQLITE_DONE)
    {
        return MakeError("db_step_failed");
    }

    return rows;
}


Result<std::monostate> Database::RecordFriendPresenceEvent(const FriendPresenceEventInsert& e)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }
    if (e.user_id.empty())
    {
        return MakeError("db_invalid_argument", "user_id is empty");
    }
    if (e.event_type.empty())
    {
        return MakeError("db_invalid_argument", "event_type is empty");
    }

    const char* sql =
        "INSERT INTO friend_presence_events ("
        "user_id, display_name, event_type, world_id, instance_id, location, "
        "status, old_value, new_value, source, occurred_at"
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);";

    return RunOnce(sql, [this, &e](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindText(stmt, 1, e.user_id) != SQLITE_OK ||
            BindOptionalText(stmt, 2, e.display_name) != SQLITE_OK ||
            BindText(stmt, 3, e.event_type) != SQLITE_OK ||
            BindOptionalText(stmt, 4, e.world_id) != SQLITE_OK ||
            BindOptionalText(stmt, 5, e.instance_id) != SQLITE_OK ||
            BindOptionalText(stmt, 6, e.location) != SQLITE_OK ||
            BindOptionalText(stmt, 7, e.status) != SQLITE_OK ||
            BindOptionalText(stmt, 8, e.old_value) != SQLITE_OK ||
            BindOptionalText(stmt, 9, e.new_value) != SQLITE_OK ||
            BindOptionalText(stmt, 10, e.source) != SQLITE_OK ||
            BindText(stmt, 11, e.occurred_at) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        return std::monostate{};
    });
}


Result<nlohmann::json> Database::RecentFriendPresenceEvents(
    int limit,
    int offset,
    std::optional<std::string> user_id,
    std::optional<std::string> event_type,
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
        "SELECT id, user_id, display_name, event_type, world_id, instance_id, "
        "       location, status, old_value, new_value, source, occurred_at "
        "FROM friend_presence_events "
        "WHERE (?1 IS NULL OR user_id = ?2) "
        "  AND (?3 IS NULL OR event_type = ?4) "
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

    if (BindOptionalText(rawStmt, 1, user_id) != SQLITE_OK
        || BindOptionalText(rawStmt, 2, user_id) != SQLITE_OK
        || BindOptionalText(rawStmt, 3, event_type) != SQLITE_OK
        || BindOptionalText(rawStmt, 4, event_type) != SQLITE_OK
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
        row["user_id"] = ColumnTextOrNull(rawStmt, 1);
        row["display_name"] = ColumnTextOrNull(rawStmt, 2);
        row["event_type"] = ColumnTextOrNull(rawStmt, 3);
        row["world_id"] = ColumnTextOrNull(rawStmt, 4);
        row["instance_id"] = ColumnTextOrNull(rawStmt, 5);
        row["location"] = ColumnTextOrNull(rawStmt, 6);
        row["status"] = ColumnTextOrNull(rawStmt, 7);
        row["old_value"] = ColumnTextOrNull(rawStmt, 8);
        row["new_value"] = ColumnTextOrNull(rawStmt, 9);
        row["source"] = ColumnTextOrNull(rawStmt, 10);
        row["occurred_at"] = ColumnTextOrNull(rawStmt, 11);
        rows.push_back(std::move(row));
    }

    if (rc != SQLITE_DONE)
    {
        return MakeError("db_step_failed");
    }

    return rows;
}


Result<nlohmann::json> Database::CoPresenceEgoNetwork(
    const std::string& center_user_id,
    int since_days,
    int min_overlap_sec)
{
    std::vector<analytics::PresenceEventRow> rows;
    std::time_t nowT = 0;

    {
        std::lock_guard<std::mutex> lock(m_mutex);

        if (m_db == nullptr)
        {
            return MakeError("db_not_open");
        }
        if (center_user_id.empty())
        {
            return MakeError("db_invalid_argument", "center_user_id is empty");
        }

        // Clamp inputs to sane bounds so a malformed request can't ask for an
        // unbounded scan or a negative window.
        if (since_days <= 0) since_days = 90;
        if (since_days > 3650) since_days = 3650;
        if (min_overlap_sec < 0) min_overlap_sec = 0;

        // Lower time bound anchor. player_events.occurred_at is wall-clock ISO.
        nowT = std::time(nullptr);

        // Pull raw join/left events newest-last so we can pair them per user
        // within each instance session. We over-fetch a little (no lexical
        // cutoff that could drop a session straddling the boundary) and apply
        // the time window during pairing instead.
        const char* sql =
            "SELECT user_id, display_name, world_id, instance_id, kind, occurred_at "
            "FROM player_events "
            "WHERE user_id IS NOT NULL AND world_id IS NOT NULL AND instance_id IS NOT NULL "
            "ORDER BY world_id, instance_id, occurred_at ASC;";

        sqlite3_stmt* rawStmt = nullptr;
        if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
        {
            return MakeError("db_prepare_failed");
        }
        StatementGuard stmt(rawStmt);

        int rc = SQLITE_OK;
        while ((rc = sqlite3_step(rawStmt)) == SQLITE_ROW)
        {
            analytics::PresenceEventRow row;
            const auto uJson = ColumnTextOrNull(rawStmt, 0);
            row.user_id = uJson.is_string() ? uJson.get<std::string>() : std::string();
            const auto dnJson = ColumnTextOrNull(rawStmt, 1);
            row.display_name = dnJson.is_string() ? dnJson.get<std::string>() : std::string();
            const auto wJson = ColumnTextOrNull(rawStmt, 2);
            row.world_id = wJson.is_string() ? wJson.get<std::string>() : std::string();
            const auto iJson = ColumnTextOrNull(rawStmt, 3);
            row.instance_id = iJson.is_string() ? iJson.get<std::string>() : std::string();
            const auto kJson = ColumnTextOrNull(rawStmt, 4);
            row.kind = kJson.is_string() ? kJson.get<std::string>() : std::string();
            const auto tJson = ColumnTextOrNull(rawStmt, 5);
            row.occurred_at = tJson.is_string() ? tJson.get<std::string>() : std::string();
            rows.push_back(std::move(row));
        }

        if (rc != SQLITE_DONE)
        {
            return MakeError("db_step_failed");
        }
    } // release m_mutex before pure compute

    return analytics::coPresenceEgoNetwork(rows, center_user_id, since_days, min_overlap_sec, nowT);
}


Result<nlohmann::json> Database::PredictFriendOnlineWindows(
    const std::string& user_id,
    int top_n,
    int half_life_weeks)
{
    std::vector<analytics::PredictPresenceRow> rows;

    {
        std::lock_guard<std::mutex> lock(m_mutex);

        if (m_db == nullptr)
        {
            return MakeError("db_not_open");
        }
        if (user_id.empty())
        {
            return MakeError("db_invalid_argument", "user_id is empty");
        }

        const char* sql =
            "SELECT event_type, occurred_at "
            "FROM friend_presence_events "
            "WHERE user_id = ?1 "
            "  AND event_type IN ('online','offline','location','status') "
            "ORDER BY occurred_at ASC;";

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

        int rc = SQLITE_OK;
        while ((rc = sqlite3_step(rawStmt)) == SQLITE_ROW)
        {
            const char* etRaw = reinterpret_cast<const char*>(sqlite3_column_text(rawStmt, 0));
            const char* atRaw = reinterpret_cast<const char*>(sqlite3_column_text(rawStmt, 1));
            if (etRaw == nullptr || atRaw == nullptr)
            {
                continue;
            }
            rows.push_back(analytics::PredictPresenceRow{etRaw, atRaw});
        }
        if (rc != SQLITE_DONE)
        {
            return MakeError("db_step_failed");
        }
    } // release m_mutex before pure compute

    const std::time_t nowTt = std::time(nullptr);

    // local offset (minutes) currently in effect, for display only. Lifted out
    // of the pure compute so FriendAnalytics stays Win32-free.
    int tzOffsetMinutes = 0;
    {
        TIME_ZONE_INFORMATION tz{};
        GetTimeZoneInformation(&tz);
        tzOffsetMinutes = -tz.Bias;
    }

    return analytics::predictFriendOnlineWindows(rows, user_id, top_n, half_life_weeks, nowTt, tzOffsetMinutes);
}


Result<nlohmann::json> Database::UnifiedFeed(
    int limit,
    int offset,
    std::optional<std::string> user_id,
    std::optional<std::string> source_kind,
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

    // UNION ALL the event sources into one column shape:
    //   source_kind, event_id, user_id, display_name, event_type,
    //   world_id, instance_id, detail, occurred_at
    // `detail` carries the source-specific payload (new_value, kind, location,
    // avatar name) so the frontend can render without a second round-trip.
    // The outer WHERE filters on the unified columns; named params are reused
    // by position so each bound value maps to one ?N placeholder.
    const char* sql =
        "SELECT * FROM ("
        "  SELECT 'friend_log' AS source_kind, fl.id AS event_id, fl.user_id AS user_id, "
        "         fl.display_name AS display_name, fl.event_type AS event_type, "
        "         NULL AS world_id, NULL AS instance_id, fl.new_value AS detail, "
        "         fl.occurred_at AS occurred_at "
        "  FROM friend_log fl "
        "  UNION ALL "
        "  SELECT 'presence', fpe.id, fpe.user_id, fpe.display_name, fpe.event_type, "
        "         fpe.world_id, fpe.instance_id, "
        "         COALESCE(fpe.new_value, fpe.status, fpe.location), fpe.occurred_at "
        "  FROM friend_presence_events fpe "
        "  UNION ALL "
        "  SELECT 'player_event', pe.id, pe.user_id, pe.display_name, pe.kind, "
        "         pe.world_id, pe.instance_id, NULL, pe.occurred_at "
        "  FROM player_events pe "
        "  UNION ALL "
        "  SELECT 'avatar', ah.rowid, ah.first_seen_user_id, ah.first_seen_on, 'avatar', "
        "         NULL, NULL, ah.avatar_name, ah.first_seen_at "
        "  FROM avatar_history ah "
        "  UNION ALL "
        "  SELECT 'log_event', le.id, le.user_id, le.display_name, le.kind, "
        "         le.world_id, le.instance_id, le.detail, le.occurred_at "
        "  FROM log_events le "
        ") feed "
        "WHERE (?1 IS NULL OR feed.user_id = ?2) "
        "  AND (?3 IS NULL OR feed.source_kind = ?4) "
        "  AND (?5 IS NULL OR feed.occurred_at >= ?6) "
        "  AND (?7 IS NULL OR feed.occurred_at < ?8) "
        "ORDER BY feed.occurred_at DESC "
        "LIMIT ?9 OFFSET ?10;";

    sqlite3_stmt* rawStmt = nullptr;
    if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
    {
        return MakeError("db_prepare_failed");
    }
    StatementGuard stmt(rawStmt);

    if (BindOptionalText(rawStmt, 1, user_id) != SQLITE_OK
        || BindOptionalText(rawStmt, 2, user_id) != SQLITE_OK
        || BindOptionalText(rawStmt, 3, source_kind) != SQLITE_OK
        || BindOptionalText(rawStmt, 4, source_kind) != SQLITE_OK
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
        row["source_kind"] = ColumnTextOrNull(rawStmt, 0);
        row["event_id"] = static_cast<std::int64_t>(sqlite3_column_int64(rawStmt, 1));
        row["user_id"] = ColumnTextOrNull(rawStmt, 2);
        row["display_name"] = ColumnTextOrNull(rawStmt, 3);
        row["event_type"] = ColumnTextOrNull(rawStmt, 4);
        row["world_id"] = ColumnTextOrNull(rawStmt, 5);
        row["instance_id"] = ColumnTextOrNull(rawStmt, 6);
        row["detail"] = ColumnTextOrNull(rawStmt, 7);
        row["occurred_at"] = ColumnTextOrNull(rawStmt, 8);
        rows.push_back(std::move(row));
    }

    if (rc != SQLITE_DONE)
    {
        return MakeError("db_step_failed");
    }

    return rows;
}


Result<std::optional<std::string>> Database::GetFriendNote(const std::string& user_id)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }

    const char* sql = "SELECT note FROM friend_notes WHERE user_id = ?;";
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

    const int rc = sqlite3_step(rawStmt);
    if (rc == SQLITE_DONE)
    {
        return std::optional<std::string>{std::nullopt};
    }
    if (rc != SQLITE_ROW)
    {
        return MakeError("db_step_failed");
    }

    return ColumnOptionalText(rawStmt, 0);
}


Result<nlohmann::json> Database::AllFriendNotes()
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }

    // Only rows with a non-empty note are worth shipping — empties would just
    // bloat the payload the list ignores anyway.
    const char* sql =
        "SELECT user_id, note FROM friend_notes "
        "WHERE note IS NOT NULL AND note != '';";
    sqlite3_stmt* rawStmt = nullptr;
    if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
    {
        return MakeError("db_prepare_failed");
    }
    StatementGuard stmt(rawStmt);

    nlohmann::json rows = nlohmann::json::array();
    int rc = SQLITE_OK;
    while ((rc = sqlite3_step(rawStmt)) == SQLITE_ROW)
    {
        nlohmann::json row = nlohmann::json::object();
        row["user_id"] = ColumnTextOrNull(rawStmt, 0);
        row["note"] = ColumnTextOrNull(rawStmt, 1);
        rows.push_back(std::move(row));
    }

    if (rc != SQLITE_DONE)
    {
        return MakeError("db_step_failed");
    }

    return rows;
}


Result<std::monostate> Database::SetFriendNote(const std::string& user_id,
                                               const std::string& note,
                                               const std::string& updated_at)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    const char* sql =
        "INSERT INTO friend_notes (user_id, note, updated_at) "
        "VALUES (?, ?, ?) "
        "ON CONFLICT(user_id) DO UPDATE SET "
        "note = excluded.note, "
        "updated_at = excluded.updated_at;";

    return RunOnce(sql, [this, &user_id, &note, &updated_at](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindText(stmt, 1, user_id) != SQLITE_OK ||
            BindText(stmt, 2, note) != SQLITE_OK ||
            BindText(stmt, 3, updated_at) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        return std::monostate{};
    });
}

} // namespace vrcsm::core
