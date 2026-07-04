#include "Database.h"

#include <sqlite3.h>

#include <fmt/format.h>

#include <Windows.h>
#include <KnownFolders.h>
#include <ShlObj.h>

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


Result<std::monostate> Database::UpsertOwnedAvatar(const OwnedAvatarUpsert& a)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }
    if (a.account_user_id.empty() || a.avatar_id.empty())
    {
        return MakeError("db_invalid_argument", "account_user_id and avatar_id are required");
    }

    const char* sql =
        "INSERT OR REPLACE INTO owned_avatars "
        "(account_user_id, avatar_id, name, description, image_url, release_status, version, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?);";

    return RunOnce(sql, [this, &a](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindText(stmt, 1, a.account_user_id) != SQLITE_OK ||
            BindText(stmt, 2, a.avatar_id) != SQLITE_OK ||
            BindOptionalText(stmt, 3, a.name) != SQLITE_OK ||
            BindOptionalText(stmt, 4, a.description) != SQLITE_OK ||
            BindOptionalText(stmt, 5, a.image_url) != SQLITE_OK ||
            BindOptionalText(stmt, 6, a.release_status) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        if (a.version.has_value())
        {
            if (BindInt(stmt, 7, *a.version) != SQLITE_OK) return MakeError("db_bind_failed");
        }
        else if (sqlite3_bind_null(stmt, 7) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        if (BindOptionalText(stmt, 8, a.updated_at) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        return std::monostate{};
    });
}


Result<std::monostate> Database::RecordAvatarSeen(const AvatarSeenInsert& a)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    // UPSERT semantics:
    //   - new info (release_status, user_id, author_name) wins when prior was NULL
    //   - empty/legacy first_seen_at gets healed once a real timestamp arrives
    //   - first_seen_on heals when prior was NULL or the new write supplies a
    //     non-empty wearer name (log backfill sometimes lacks an actor)
    //   - avatar_name preserves the first non-empty value rather than letting
    //     a later empty insert overwrite it
    const char* sql =
        "INSERT INTO avatar_history ("
        "avatar_id, avatar_name, author_name, first_seen_on, first_seen_at, release_status, first_seen_user_id"
        ") VALUES (?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(avatar_id) DO UPDATE SET "
        "release_status = COALESCE(excluded.release_status, release_status), "
        "avatar_name = COALESCE(excluded.avatar_name, avatar_name), "
        "author_name = COALESCE(excluded.author_name, author_name), "
        "first_seen_on = COALESCE(NULLIF(excluded.first_seen_on, ''), first_seen_on), "
        "first_seen_at = CASE WHEN first_seen_at IS NULL OR first_seen_at = '' "
        "                     THEN excluded.first_seen_at ELSE first_seen_at END, "
        "first_seen_user_id = COALESCE(excluded.first_seen_user_id, first_seen_user_id);";

    return RunOnce(sql, [this, &a](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindText(stmt, 1, a.avatar_id) != SQLITE_OK ||
            BindOptionalText(stmt, 2, a.avatar_name) != SQLITE_OK ||
            BindOptionalText(stmt, 3, a.author_name) != SQLITE_OK ||
            BindOptionalText(stmt, 4, a.first_seen_on) != SQLITE_OK ||
            BindText(stmt, 5, a.first_seen_at) != SQLITE_OK ||
            BindOptionalText(stmt, 6, a.release_status) != SQLITE_OK ||
            BindOptionalText(stmt, 7, a.first_seen_user_id) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        return std::monostate{};
    });
}


Result<nlohmann::json> Database::RecentAvatarHistory(int limit, int offset)
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
        "SELECT avatar_id, avatar_name, author_name, first_seen_on, first_seen_at, release_status, first_seen_user_id, "
        "resolved_avatar_id, resolved_thumbnail_url, resolved_image_url, resolution_source, resolution_status, resolved_at "
        "FROM avatar_history "
        "ORDER BY first_seen_at DESC "
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
        row["avatar_id"] = ColumnTextOrNull(rawStmt, 0);
        row["avatar_name"] = ColumnTextOrNull(rawStmt, 1);
        row["author_name"] = ColumnTextOrNull(rawStmt, 2);
        row["first_seen_on"] = ColumnTextOrNull(rawStmt, 3);
        row["first_seen_at"] = ColumnTextOrNull(rawStmt, 4);
        row["release_status"] = ColumnTextOrNull(rawStmt, 5);
        row["first_seen_user_id"] = ColumnTextOrNull(rawStmt, 6);
        row["resolved_avatar_id"] = ColumnTextOrNull(rawStmt, 7);
        row["resolved_thumbnail_url"] = ColumnTextOrNull(rawStmt, 8);
        row["resolved_image_url"] = ColumnTextOrNull(rawStmt, 9);
        row["resolution_source"] = ColumnTextOrNull(rawStmt, 10);
        row["resolution_status"] = ColumnTextOrNull(rawStmt, 11);
        row["resolved_at"] = ColumnTextOrNull(rawStmt, 12);
        rows.push_back(std::move(row));
    }

    if (rc != SQLITE_DONE)
    {
        return MakeError("db_step_failed");
    }

    return rows;
}


Result<std::monostate> Database::UpdateAvatarResolution(const AvatarResolveUpdate& u)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (u.avatar_id.empty())
    {
        return MakeError("db_invalid_argument", "avatar_id is empty");
    }
    if (u.resolution_status.empty())
    {
        return MakeError("db_invalid_argument", "resolution_status is empty");
    }

    const char* sql =
        "UPDATE avatar_history SET "
        "resolved_avatar_id = ?, "
        "resolved_thumbnail_url = ?, "
        "resolved_image_url = ?, "
        "resolution_source = ?, "
        "resolution_status = ?, "
        "resolved_at = ? "
        "WHERE avatar_id = ?;";

    return RunOnce(sql, [this, &u](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindOptionalText(stmt, 1, u.resolved_avatar_id) != SQLITE_OK ||
            BindOptionalText(stmt, 2, u.resolved_thumbnail_url) != SQLITE_OK ||
            BindOptionalText(stmt, 3, u.resolved_image_url) != SQLITE_OK ||
            BindOptionalText(stmt, 4, u.resolution_source) != SQLITE_OK ||
            BindText(stmt, 5, u.resolution_status) != SQLITE_OK ||
            BindText(stmt, 6, u.resolved_at) != SQLITE_OK ||
            BindText(stmt, 7, u.avatar_id) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        return std::monostate{};
    });
}


Result<std::int64_t> Database::AvatarHistoryCount()
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }
    sqlite3_stmt* rawStmt = nullptr;
    if (sqlite3_prepare_v2(m_db, "SELECT COUNT(*) FROM avatar_history;", -1, &rawStmt, nullptr) != SQLITE_OK)
    {
        return MakeError("db_prepare_failed");
    }
    StatementGuard stmt(rawStmt);
    if (sqlite3_step(rawStmt) != SQLITE_ROW)
    {
        return MakeError("db_step_failed");
    }
    return static_cast<std::int64_t>(sqlite3_column_int64(rawStmt, 0));
}


Result<std::monostate> Database::RecordAvatarBenchmark(const AvatarBenchmarkInsert& a)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (a.avatar_id.empty())
    {
        return MakeError("db_invalid_argument", "avatar_id is empty");
    }

    // UPSERT: refresh the parameter_count/eye_height/last_seen_at on every
    // measurement, but preserve the earliest first_seen_at we ever recorded.
    const char* sql =
        "INSERT INTO avatar_benchmark "
        "(avatar_id, user_id, parameter_count, eye_height, first_seen_at, last_seen_at) "
        "VALUES (?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(avatar_id) DO UPDATE SET "
        "user_id = COALESCE(excluded.user_id, user_id), "
        "parameter_count = excluded.parameter_count, "
        "eye_height = COALESCE(excluded.eye_height, eye_height), "
        "last_seen_at = excluded.last_seen_at;";

    return RunOnce(sql, [this, &a](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindText(stmt, 1, a.avatar_id) != SQLITE_OK ||
            BindOptionalText(stmt, 2, a.user_id) != SQLITE_OK ||
            BindInt(stmt, 3, a.parameter_count) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        if (a.eye_height.has_value()
                ? sqlite3_bind_double(stmt, 4, *a.eye_height) != SQLITE_OK
                : sqlite3_bind_null(stmt, 4) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        if (BindText(stmt, 5, a.seen_at) != SQLITE_OK ||
            BindText(stmt, 6, a.seen_at) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        return std::monostate{};
    });
}


Result<nlohmann::json> Database::AvatarBenchmarks(int limit, int offset)
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
        "SELECT avatar_id, user_id, parameter_count, eye_height, first_seen_at, last_seen_at "
        "FROM avatar_benchmark "
        "ORDER BY parameter_count DESC, last_seen_at DESC "
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
        row["avatar_id"] = ColumnTextOrNull(rawStmt, 0);
        row["user_id"] = ColumnTextOrNull(rawStmt, 1);
        row["parameter_count"] = sqlite3_column_int(rawStmt, 2);
        row["eye_height"] = sqlite3_column_type(rawStmt, 3) == SQLITE_NULL
            ? nlohmann::json(nullptr)
            : nlohmann::json(sqlite3_column_double(rawStmt, 3));
        row["first_seen_at"] = ColumnTextOrNull(rawStmt, 4);
        row["last_seen_at"] = ColumnTextOrNull(rawStmt, 5);
        rows.push_back(std::move(row));
    }

    if (rc != SQLITE_DONE)
    {
        return MakeError("db_step_failed");
    }

    return rows;
}

} // namespace vrcsm::core
