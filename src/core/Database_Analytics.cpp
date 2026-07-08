#include "Database.h"
#include "FriendAnalytics.h"

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

namespace
{
// Tables surfaced in the data-management panel's usage report. Fixed list;
// each is existence-checked before COUNT so an older schema (missing a
// table) is skipped rather than erroring.
constexpr std::array<std::string_view, 16> kUsageCountTables{
    "world_visits",
    "player_events",
    "player_encounters",
    "avatar_history",
    "friend_log",
    "sessions",
    "log_events",
    "friend_presence_events",
    "avatar_embeddings_meta",
    "asset_cache",
    "avatar_benchmark",
    "owned_avatars",
    "online_prints",
    "online_inventory",
    "online_files",
    "local_favorites",
};

// Allowlist of tables the data-management panel is permitted to bulk-DELETE.
// ClearTables validates every requested name against this set before any SQL
// is built — caller-supplied strings never reach a SQL literal directly.
bool isClearableTable(std::string_view name)
{
    static constexpr std::array<std::string_view, 19> kClearable{
        // rebuildable caches
        "asset_cache",
        "avatar_benchmark",
        "owned_avatars",
        "online_prints",
        "online_inventory",
        "online_files",
        // history
        "world_visits",
        "player_events",
        "player_encounters",
        "avatar_history",
        "friend_log",
        "friend_presence_events",
        "sessions",
        "log_events",
        // experimental embeddings
        "avatar_embeddings_meta",
        "avatar_embeddings_vec",
        // user assets (favorites)
        "local_favorites",
        "local_favorite_notes",
        "local_favorite_tags",
    };
    for (const auto& t : kClearable)
    {
        if (t == name) return true;
    }
    return false;
}
} // namespace


Result<nlohmann::json> Database::ClearHistory(bool include_friend_notes)
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

    nlohmann::json cleared = nlohmann::json::object();
    const auto deleteTable = [this, &cleared](const char* tableName) -> Result<std::monostate>
    {
        const std::string sql = std::string("DELETE FROM ") + tableName + ";";
        char* errorMessage = nullptr;
        const int rc = sqlite3_exec(m_db, sql.c_str(), nullptr, nullptr, &errorMessage);
        if (rc != SQLITE_OK)
        {
            std::string detail = errorMessage != nullptr ? errorMessage : sqlite3_errmsg(m_db);
            if (errorMessage != nullptr)
            {
                sqlite3_free(errorMessage);
            }
            return MakeError("db_exec_failed", detail);
        }
        cleared[tableName] = static_cast<std::int64_t>(sqlite3_changes(m_db));
        return std::monostate{};
    };

    for (const auto* table : {"player_events", "player_encounters", "world_visits", "avatar_history", "friend_log"})
    {
        const auto deleteResult = deleteTable(table);
        if (std::holds_alternative<Error>(deleteResult))
        {
            RollbackIfNeeded(m_db);
            return std::get<Error>(deleteResult);
        }
    }

    if (include_friend_notes)
    {
        const auto deleteResult = deleteTable("friend_notes");
        if (std::holds_alternative<Error>(deleteResult))
        {
            RollbackIfNeeded(m_db);
            return std::get<Error>(deleteResult);
        }
    }

    const auto resetSequenceResult = ExecSimple(
        "DELETE FROM sqlite_sequence "
        "WHERE name IN ('world_visits', 'player_events', 'friend_log');");
    if (std::holds_alternative<Error>(resetSequenceResult))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(resetSequenceResult);
    }

    const auto commitResult = ExecSimple("COMMIT;");
    if (std::holds_alternative<Error>(commitResult))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(commitResult);
    }

    return nlohmann::json{
        {"cleared", std::move(cleared)},
        {"include_friend_notes", include_friend_notes},
    };
}


Result<nlohmann::json> Database::TableCounts()
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }

    // Prepared existence probe reused across all tables. sqlite_master lists
    // ordinary, virtual, and view objects, so vec0 virtual tables show up too.
    const char* existsSql =
        "SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?;";
    sqlite3_stmt* rawExists = nullptr;
    if (sqlite3_prepare_v2(m_db, existsSql, -1, &rawExists, nullptr) != SQLITE_OK)
    {
        return MakeError("db_prepare_failed");
    }
    StatementGuard existsGuard(rawExists);

    nlohmann::json counts = nlohmann::json::object();
    for (const auto tableView : kUsageCountTables)
    {
        const std::string table(tableView);

        sqlite3_reset(rawExists);
        sqlite3_clear_bindings(rawExists);
        if (BindText(rawExists, 1, table) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        if (sqlite3_step(rawExists) != SQLITE_ROW)
        {
            continue; // table absent on this schema; skip silently
        }

        // Table name comes from the compile-time allowlist above, never from
        // caller input, so string-building the COUNT statement is safe here.
        const std::string countSql = "SELECT COUNT(*) FROM \"" + table + "\";";
        sqlite3_stmt* rawCount = nullptr;
        if (sqlite3_prepare_v2(m_db, countSql.c_str(), -1, &rawCount, nullptr) != SQLITE_OK)
        {
            return MakeError("db_prepare_failed");
        }
        StatementGuard countGuard(rawCount);
        if (sqlite3_step(rawCount) != SQLITE_ROW)
        {
            return MakeError("db_step_failed");
        }
        counts[table] = static_cast<std::int64_t>(sqlite3_column_int64(rawCount, 0));
    }

    return counts;
}


Result<nlohmann::json> Database::ClearTables(const std::vector<std::string>& tables)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }

    // Validate the entire request against the allowlist *before* touching the
    // DB. An unknown name is a hard error — we never silently ignore it here
    // (the IPC layer maps target keys → known tables; anything else is a bug).
    for (const auto& table : tables)
    {
        if (!isClearableTable(table))
        {
            return MakeError("db_invalid_argument", "Table not clearable: " + table);
        }
    }

    if (tables.empty())
    {
        return nlohmann::json::object();
    }

    const auto beginResult = ExecSimple("BEGIN;");
    if (std::holds_alternative<Error>(beginResult))
    {
        return std::get<Error>(beginResult);
    }

    nlohmann::json cleared = nlohmann::json::object();
    for (const auto& table : tables)
    {
        // Skip a table that doesn't exist on this schema without failing the
        // transaction (e.g. embeddings tables on a pre-v4 DB).
        const char* existsSql =
            "SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?;";
        sqlite3_stmt* rawExists = nullptr;
        if (sqlite3_prepare_v2(m_db, existsSql, -1, &rawExists, nullptr) != SQLITE_OK)
        {
            RollbackIfNeeded(m_db);
            return MakeError("db_prepare_failed");
        }
        StatementGuard existsGuard(rawExists);
        if (BindText(rawExists, 1, table) != SQLITE_OK)
        {
            RollbackIfNeeded(m_db);
            return MakeError("db_bind_failed");
        }
        if (sqlite3_step(rawExists) != SQLITE_ROW)
        {
            cleared[table] = 0;
            continue;
        }

        // Table name is allowlisted above, so quoting it into the statement is
        // safe — no caller-controlled text reaches the SQL literal.
        const std::string sql = "DELETE FROM \"" + table + "\";";
        char* errorMessage = nullptr;
        const int rc = sqlite3_exec(m_db, sql.c_str(), nullptr, nullptr, &errorMessage);
        if (rc != SQLITE_OK)
        {
            std::string detail = errorMessage != nullptr ? errorMessage : sqlite3_errmsg(m_db);
            if (errorMessage != nullptr)
            {
                sqlite3_free(errorMessage);
            }
            RollbackIfNeeded(m_db);
            return MakeError("db_exec_failed", detail);
        }
        cleared[table] = static_cast<std::int64_t>(sqlite3_changes(m_db));
    }

    // Reset AUTOINCREMENT counters for any cleared table that has one. Harmless
    // if the table isn't in sqlite_sequence.
    (void)ExecSimple("DELETE FROM sqlite_sequence "
                     "WHERE name IN ('world_visits','player_events','friend_log',"
                     "'sessions','log_events','friend_presence_events');");

    const auto commitResult = ExecSimple("COMMIT;");
    if (std::holds_alternative<Error>(commitResult))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(commitResult);
    }

    return cleared;
}


Result<nlohmann::json> Database::ActivityHeatmap(int days)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (days < 0)
    {
        return MakeError("db_invalid_argument", "days must be non-negative");
    }
    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }

    // world_visits.joined_at is stored in VRChat's DOT format
    // "YYYY.MM.DD HH:MM:SS", which SQLite's date functions do NOT understand
    // (strftime/datetime return NULL). Normalize the date dots to dashes inline
    // so strftime/datetime work; there are no dots in the HH:MM:SS part, so a
    // blanket replace('.','-') is safe. An already-ISO value is unaffected.
    const char* sql =
        "SELECT strftime('%w', replace(joined_at, '.', '-')) AS dow, "
        "strftime('%H', replace(joined_at, '.', '-')) AS hr, "
        "COUNT(*) "
        "FROM world_visits "
        "WHERE replace(joined_at, '.', '-') >= datetime('now', '-' || ? || ' days') "
        "GROUP BY dow, hr;";

    sqlite3_stmt* rawStmt = nullptr;
    if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
    {
        return MakeError("db_prepare_failed");
    }
    StatementGuard stmt(rawStmt);

    if (BindInt(rawStmt, 1, days) != SQLITE_OK)
    {
        return MakeError("db_bind_failed");
    }

    std::array<std::array<std::int64_t, 24>, 7> heatmap{};
    int rc = SQLITE_OK;
    while ((rc = sqlite3_step(rawStmt)) == SQLITE_ROW)
    {
        const auto dowText = ColumnOptionalText(rawStmt, 0);
        const auto hrText = ColumnOptionalText(rawStmt, 1);
        if (!dowText.has_value() || !hrText.has_value())
        {
            continue;
        }

        int dow = -1;
        int hour = -1;
        const auto* dowBegin = dowText->data();
        const auto* dowEnd = dowBegin + dowText->size();
        const auto* hrBegin = hrText->data();
        const auto* hrEnd = hrBegin + hrText->size();
        const auto dowParse = std::from_chars(dowBegin, dowEnd, dow);
        const auto hrParse = std::from_chars(hrBegin, hrEnd, hour);
        if (dowParse.ec != std::errc{} || hrParse.ec != std::errc{})
        {
            continue;
        }
        if (dow < 0 || dow >= 7 || hour < 0 || hour >= 24)
        {
            continue;
        }

        heatmap[static_cast<std::size_t>(dow)][static_cast<std::size_t>(hour)] =
            static_cast<std::int64_t>(sqlite3_column_int64(rawStmt, 2));
    }

    if (rc != SQLITE_DONE)
    {
        return MakeError("db_step_failed");
    }

    nlohmann::json result = nlohmann::json::array();
    for (const auto& day : heatmap)
    {
        nlohmann::json row = nlohmann::json::array();
        for (const auto count : day)
        {
            row.push_back(count);
        }
        result.push_back(std::move(row));
    }

    return result;
}


Result<nlohmann::json> Database::StatsOverview()
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }

    const char* sql =
        "SELECT "
        "(SELECT COUNT(*) FROM world_visits) AS total_world_visits, "
        "(SELECT COUNT(DISTINCT user_id) FROM player_encounters) AS total_players_encountered, "
        "(SELECT COUNT(*) FROM avatar_history) AS total_avatars_seen, "
        "("
        // NOTE: total dwell hours is intentionally left on the raw columns for
        // now. world_visits stores MIXED timestamp formats in the same column
        // (joined_at is DOT-local "YYYY.MM.DD HH:MM:SS" while some left_at rows
        // are ISO with a +09:00-style offset). A naive julianday() over both
        // mismatches naive-vs-UTC and yields negative intervals, which is worse
        // than the prior 0. A correct fix must normalize offset-aware values to
        // a common zone first — tracked as a separate follow-up so this batch
        // ships only the verified heatmap + parser fixes.
        "    SELECT COALESCE(SUM(julianday(left_at) - julianday(joined_at)) * 24, 0.0) "
        "    FROM world_visits "
        "    WHERE left_at IS NOT NULL"
        ") AS total_hours_in_world;";

    sqlite3_stmt* rawStmt = nullptr;
    if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
    {
        return MakeError("db_prepare_failed");
    }
    StatementGuard stmt(rawStmt);

    const int rc = sqlite3_step(rawStmt);
    if (rc != SQLITE_ROW)
    {
        return MakeError("db_step_failed");
    }

    nlohmann::json result = nlohmann::json::object();
    result["total_world_visits"] = static_cast<std::int64_t>(sqlite3_column_int64(rawStmt, 0));
    result["total_players_encountered"] = static_cast<std::int64_t>(sqlite3_column_int64(rawStmt, 1));
    result["total_avatars_seen"] = static_cast<std::int64_t>(sqlite3_column_int64(rawStmt, 2));
    result["total_hours_in_world"] = sqlite3_column_double(rawStmt, 3);
    return result;
}


Result<nlohmann::json> Database::GlobalSearch(const nlohmann::json& request)
{
    analytics::GlobalSearchInput input;

    std::string rawQuery;
    std::string normalizedQuery;
    int limit = 20;
    int offset = 0;

    {
        std::lock_guard<std::mutex> lock(m_mutex);

        if (m_db == nullptr)
        {
            return MakeError("db_not_open");
        }

        if (!request.is_null() && !request.is_object())
        {
            return MakeError("db_invalid_argument", "search.global params must be an object");
        }

        rawQuery = request.is_object() && request.contains("query") && request["query"].is_string()
            ? request["query"].get<std::string>()
            : std::string{};
        normalizedQuery = analytics::normalizeSearchQuery(rawQuery);
        const auto likeQuery = "%" + normalizedQuery + "%";

        limit = 20;
        offset = 0;
        if (request.is_object())
        {
            (void)JsonObjectInt(request, "limit", limit);
            (void)JsonObjectInt(request, "offset", offset);
        }
        limit = std::clamp(limit, 1, 50);
        offset = std::max(offset, 0);

        auto bindQueryPair = [&](sqlite3_stmt* stmt, int firstIndex) -> bool
        {
            return BindText(stmt, firstIndex, normalizedQuery) == SQLITE_OK
                && BindText(stmt, firstIndex + 1, likeQuery) == SQLITE_OK;
        };

        // local_favorites
        {
            const char* sql =
                "SELECT f.type, f.target_id, f.list_name, f.display_name, f.thumbnail_url, f.added_at, "
                "       n.note, COALESCE(group_concat(t.tag, ' '), '') AS tags "
                "FROM local_favorites f "
                "LEFT JOIN local_favorite_notes n "
                "  ON n.type = f.type AND n.target_id = f.target_id AND n.list_name = f.list_name "
                "LEFT JOIN local_favorite_tags t "
                "  ON t.type = f.type AND t.target_id = f.target_id AND t.list_name = f.list_name "
                "WHERE (?1 = '' "
                "   OR lower(f.type) LIKE ?2 "
                "   OR lower(f.target_id) LIKE ?2 "
                "   OR lower(COALESCE(f.display_name, '')) LIKE ?2 "
                "   OR lower(f.list_name) LIKE ?2 "
                "   OR lower(COALESCE(n.note, '')) LIKE ?2 "
                "   OR lower(COALESCE(t.tag, '')) LIKE ?2) "
                "GROUP BY f.type, f.target_id, f.list_name, f.display_name, f.thumbnail_url, f.added_at, n.note "
                "ORDER BY f.added_at DESC "
                "LIMIT 200;";

            sqlite3_stmt* rawStmt = nullptr;
            if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
            {
                return MakeError("db_prepare_failed");
            }
            StatementGuard stmt(rawStmt);
            if (!bindQueryPair(rawStmt, 1))
            {
                return MakeError("db_bind_failed");
            }

            int rc = SQLITE_OK;
            while ((rc = sqlite3_step(rawStmt)) == SQLITE_ROW)
            {
                analytics::FavoriteRow row;
                row.type = ColumnOptionalText(rawStmt, 0).value_or("other");
                row.target_id = ColumnOptionalText(rawStmt, 1).value_or("");
                row.list_name = ColumnOptionalText(rawStmt, 2).value_or("Library");
                row.display_name = ColumnOptionalText(rawStmt, 3).value_or(row.target_id);
                row.thumbnail_url = ColumnOptionalText(rawStmt, 4);
                row.added_at = ColumnOptionalText(rawStmt, 5);
                row.note = ColumnOptionalText(rawStmt, 6).value_or("");
                row.tags = ColumnOptionalText(rawStmt, 7).value_or("");
                input.favorites.push_back(std::move(row));
            }
            if (rc != SQLITE_DONE)
            {
                return MakeError("db_step_failed");
            }
        }

        // world_visits
        {
            const char* sql =
                "SELECT w.world_id, COUNT(*) AS visit_count, MIN(w.joined_at), MAX(w.joined_at), "
                "       (SELECT instance_id FROM world_visits w2 WHERE w2.world_id = w.world_id ORDER BY joined_at DESC LIMIT 1), "
                "       (SELECT access_type FROM world_visits w2 WHERE w2.world_id = w.world_id ORDER BY joined_at DESC LIMIT 1), "
                "       (SELECT region FROM world_visits w2 WHERE w2.world_id = w.world_id ORDER BY joined_at DESC LIMIT 1), "
                "       MAX(w.id) "
                "FROM world_visits w "
                "WHERE (?1 = '' "
                "   OR lower(w.world_id) LIKE ?2 "
                "   OR lower(w.instance_id) LIKE ?2 "
                "   OR lower(COALESCE(w.access_type, '')) LIKE ?2 "
                "   OR lower(COALESCE(w.owner_id, '')) LIKE ?2 "
                "   OR lower(COALESCE(w.region, '')) LIKE ?2 "
                "   OR EXISTS ("
                "       SELECT 1 FROM local_favorites f "
                "       WHERE f.type = 'world' AND f.target_id = w.world_id "
                "         AND (lower(COALESCE(f.display_name, '')) LIKE ?2 "
                "              OR lower(f.list_name) LIKE ?2))) "
                "GROUP BY w.world_id "
                "ORDER BY MAX(w.joined_at) DESC "
                "LIMIT 200;";

            sqlite3_stmt* rawStmt = nullptr;
            if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
            {
                return MakeError("db_prepare_failed");
            }
            StatementGuard stmt(rawStmt);
            if (!bindQueryPair(rawStmt, 1))
            {
                return MakeError("db_bind_failed");
            }

            int rc = SQLITE_OK;
            while ((rc = sqlite3_step(rawStmt)) == SQLITE_ROW)
            {
                analytics::WorldVisitRow row;
                row.world_id = ColumnOptionalText(rawStmt, 0).value_or("");
                row.visit_count = sqlite3_column_int(rawStmt, 1);
                row.first_seen = ColumnOptionalText(rawStmt, 2);
                row.last_seen = ColumnOptionalText(rawStmt, 3);
                row.instance_id = ColumnOptionalText(rawStmt, 4).value_or("");
                row.access_type = ColumnOptionalText(rawStmt, 5).value_or("");
                row.region = ColumnOptionalText(rawStmt, 6).value_or("");
                row.source_row_id = sqlite3_column_int64(rawStmt, 7);
                input.worldVisits.push_back(std::move(row));
            }
            if (rc != SQLITE_DONE)
            {
                return MakeError("db_step_failed");
            }
        }

        // player_encounters
        {
            const char* sql =
                "SELECT user_id, display_name, SUM(encounter_count), MIN(first_seen), MAX(last_seen), "
                "       COALESCE(group_concat(DISTINCT world_id), '') "
                "FROM player_encounters "
                "WHERE (?1 = '' "
                "   OR lower(user_id) LIKE ?2 "
                "   OR lower(display_name) LIKE ?2 "
                "   OR lower(world_id) LIKE ?2) "
                "GROUP BY user_id, display_name "
                "ORDER BY MAX(last_seen) DESC "
                "LIMIT 200;";

            sqlite3_stmt* rawStmt = nullptr;
            if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
            {
                return MakeError("db_prepare_failed");
            }
            StatementGuard stmt(rawStmt);
            if (!bindQueryPair(rawStmt, 1))
            {
                return MakeError("db_bind_failed");
            }

            int rc = SQLITE_OK;
            while ((rc = sqlite3_step(rawStmt)) == SQLITE_ROW)
            {
                analytics::UserEncounterRow row;
                row.user_id = ColumnOptionalText(rawStmt, 0).value_or("");
                row.display_name = ColumnOptionalText(rawStmt, 1).value_or(row.user_id);
                row.encounter_count = sqlite3_column_int(rawStmt, 2);
                row.first_seen = ColumnOptionalText(rawStmt, 3);
                row.last_seen = ColumnOptionalText(rawStmt, 4);
                row.worlds = ColumnOptionalText(rawStmt, 5).value_or("");
                input.userEncounters.push_back(std::move(row));
            }
            if (rc != SQLITE_DONE)
            {
                return MakeError("db_step_failed");
            }
        }

        // player_events (timeline)
        {
            const char* sql =
                "SELECT id, kind, user_id, display_name, world_id, instance_id, occurred_at "
                "FROM player_events "
                "WHERE (?1 = '' "
                "   OR lower(COALESCE(user_id, '')) LIKE ?2 "
                "   OR lower(display_name) LIKE ?2 "
                "   OR lower(COALESCE(world_id, '')) LIKE ?2 "
                "   OR lower(COALESCE(instance_id, '')) LIKE ?2 "
                "   OR lower(kind) LIKE ?2) "
                "ORDER BY occurred_at DESC "
                "LIMIT 100;";

            sqlite3_stmt* rawStmt = nullptr;
            if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
            {
                return MakeError("db_prepare_failed");
            }
            StatementGuard stmt(rawStmt);
            if (!bindQueryPair(rawStmt, 1))
            {
                return MakeError("db_bind_failed");
            }

            int rc = SQLITE_OK;
            while ((rc = sqlite3_step(rawStmt)) == SQLITE_ROW)
            {
                analytics::TimelineEventRow row;
                row.row_id = sqlite3_column_int64(rawStmt, 0);
                row.kind = ColumnOptionalText(rawStmt, 1).value_or("event");
                row.user_id = ColumnOptionalText(rawStmt, 2);
                row.display_name = ColumnOptionalText(rawStmt, 3).value_or("Player event");
                row.world_id = ColumnOptionalText(rawStmt, 4).value_or("");
                row.instance_id = ColumnOptionalText(rawStmt, 5).value_or("");
                row.occurred_at = ColumnOptionalText(rawStmt, 6);
                input.timelineEvents.push_back(std::move(row));
            }
            if (rc != SQLITE_DONE)
            {
                return MakeError("db_step_failed");
            }
        }

        // avatar_history
        {
            const char* sql =
                "SELECT avatar_id, avatar_name, author_name, first_seen_on, first_seen_at, release_status, first_seen_user_id, "
                "       resolved_avatar_id, resolved_thumbnail_url, resolution_status, resolved_at "
                "FROM avatar_history "
                "WHERE (?1 = '' "
                "   OR lower(avatar_id) LIKE ?2 "
                "   OR lower(COALESCE(avatar_name, '')) LIKE ?2 "
                "   OR lower(COALESCE(author_name, '')) LIKE ?2 "
                "   OR lower(COALESCE(first_seen_on, '')) LIKE ?2 "
                "   OR lower(COALESCE(first_seen_user_id, '')) LIKE ?2 "
                "   OR EXISTS ("
                "       SELECT 1 FROM local_favorites f "
                "       WHERE f.type = 'avatar' AND f.target_id = avatar_history.avatar_id "
                "         AND (lower(COALESCE(f.display_name, '')) LIKE ?2 "
                "              OR lower(f.list_name) LIKE ?2))) "
                "ORDER BY first_seen_at DESC "
                "LIMIT 200;";

            sqlite3_stmt* rawStmt = nullptr;
            if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
            {
                return MakeError("db_prepare_failed");
            }
            StatementGuard stmt(rawStmt);
            if (!bindQueryPair(rawStmt, 1))
            {
                return MakeError("db_bind_failed");
            }

            int rc = SQLITE_OK;
            while ((rc = sqlite3_step(rawStmt)) == SQLITE_ROW)
            {
                analytics::AvatarHistoryRow row;
                row.avatar_id = ColumnOptionalText(rawStmt, 0).value_or("");
                row.avatar_name = ColumnOptionalText(rawStmt, 1).value_or(row.avatar_id);
                row.author_name = ColumnOptionalText(rawStmt, 2).value_or("");
                row.first_seen_on = ColumnOptionalText(rawStmt, 3).value_or("");
                row.first_seen_at = ColumnOptionalText(rawStmt, 4);
                row.release_status = ColumnOptionalText(rawStmt, 5).value_or("");
                row.wearer_user_id = ColumnOptionalText(rawStmt, 6).value_or("");
                row.resolved_avatar_id = ColumnOptionalText(rawStmt, 7).value_or("");
                row.resolved_thumb = ColumnOptionalText(rawStmt, 8).value_or("");
                row.resolution_status = ColumnOptionalText(rawStmt, 9).value_or("");
                row.resolved_at = ColumnOptionalText(rawStmt, 10);
                input.avatars.push_back(std::move(row));
            }
            if (rc != SQLITE_DONE)
            {
                return MakeError("db_step_failed");
            }
        }
    } // release m_mutex before pure compute

    return analytics::globalSearch(input, request, rawQuery, normalizedQuery, limit, offset);
}

} // namespace vrcsm::core
