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


// ── Event Recordings ────────────────────────────────────────────────

Result<nlohmann::json> Database::StartRecording(const EventRecordingInsert& e)
{
    std::lock_guard lock(m_mutex);
    const char* sql = "INSERT INTO event_recordings (name, world_id, instance_id) VALUES (?, ?, ?);";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(m_db, sql, -1, &stmt, nullptr) != SQLITE_OK)
        return MakeError("db_prepare");
    sqlite3_bind_text(stmt, 1, e.name.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, e.world_id.value_or("").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, e.instance_id.value_or("").c_str(), -1, SQLITE_TRANSIENT);
    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    if (rc != SQLITE_DONE) return MakeError("db_insert");
    return nlohmann::json{{"id", sqlite3_last_insert_rowid(m_db)}};
}


Result<std::monostate> Database::StopRecording(int64_t id)
{
    std::lock_guard lock(m_mutex);
    std::string sql = "UPDATE event_recordings SET ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = " + std::to_string(id) + ";";
    const auto r = ExecSimple(sql.c_str());
    if (std::holds_alternative<Error>(r)) return r;
    if (sqlite3_changes(m_db) == 0)
        return MakeError("not_found", "event.stop: no recording with that id");
    return std::monostate{};
}


Result<nlohmann::json> Database::ListRecordings(int limit)
{
    std::lock_guard lock(m_mutex);
    std::string sql = "SELECT id, name, world_id, instance_id, started_at, ended_at, attendee_count FROM event_recordings ORDER BY started_at DESC LIMIT " + std::to_string(limit) + ";";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(m_db, sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK)
        return MakeError("db_prepare");
    nlohmann::json arr = nlohmann::json::array();
    while (sqlite3_step(stmt) == SQLITE_ROW)
    {
        arr.push_back({
            {"id", sqlite3_column_int64(stmt, 0)},
            {"name", reinterpret_cast<const char*>(sqlite3_column_text(stmt, 1))},
            {"world_id", sqlite3_column_type(stmt, 2) == SQLITE_NULL ? "" : reinterpret_cast<const char*>(sqlite3_column_text(stmt, 2))},
            {"instance_id", sqlite3_column_type(stmt, 3) == SQLITE_NULL ? "" : reinterpret_cast<const char*>(sqlite3_column_text(stmt, 3))},
            {"started_at", reinterpret_cast<const char*>(sqlite3_column_text(stmt, 4))},
            {"ended_at", sqlite3_column_type(stmt, 5) == SQLITE_NULL ? nullptr : nlohmann::json(reinterpret_cast<const char*>(sqlite3_column_text(stmt, 5)))},
            {"attendee_count", sqlite3_column_int(stmt, 6)},
        });
    }
    sqlite3_finalize(stmt);
    return nlohmann::json{{"recordings", arr}};
}


Result<nlohmann::json> Database::RecordingAttendees(int64_t recording_id)
{
    std::lock_guard lock(m_mutex);
    std::string sql = "SELECT id, user_id, display_name, first_seen_at FROM event_attendees WHERE recording_id = " + std::to_string(recording_id) + " ORDER BY first_seen_at;";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(m_db, sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK)
        return MakeError("db_prepare");
    nlohmann::json arr = nlohmann::json::array();
    while (sqlite3_step(stmt) == SQLITE_ROW)
    {
        arr.push_back({
            {"id", sqlite3_column_int64(stmt, 0)},
            {"user_id", reinterpret_cast<const char*>(sqlite3_column_text(stmt, 1))},
            {"display_name", reinterpret_cast<const char*>(sqlite3_column_text(stmt, 2))},
            {"first_seen_at", reinterpret_cast<const char*>(sqlite3_column_text(stmt, 3))},
        });
    }
    sqlite3_finalize(stmt);
    return nlohmann::json{{"attendees", arr}};
}


Result<std::monostate> Database::DeleteRecording(int64_t id)
{
    std::lock_guard lock(m_mutex);
    // event_attendees FK cascade on delete handles attendee cleanup; this
    // single statement removes the recording row plus all its attendees.
    const std::string sql =
        "DELETE FROM event_recordings WHERE id = " + std::to_string(id) + ";";
    const auto r = ExecSimple(sql.c_str());
    if (std::holds_alternative<Error>(r)) return r;
    if (sqlite3_changes(m_db) == 0)
        return MakeError("not_found", "event.delete: no recording with that id");
    return std::monostate{};
}


Result<std::monostate> Database::AddAttendee(int64_t recording_id,
    const std::string& user_id, const std::string& display_name)
{
    std::lock_guard lock(m_mutex);
    // Plain INSERT (not OR IGNORE) so we can tell the two constraint outcomes
    // apart: a repeat attendee (UNIQUE) is the intended dedupe and stays a
    // success no-op, but an attendee for a nonexistent recording (FK) must
    // surface as not_found instead of being silently swallowed as {ok:true}.
    const char* sql = "INSERT INTO event_attendees (recording_id, user_id, display_name) VALUES (?, ?, ?);";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(m_db, sql, -1, &stmt, nullptr) != SQLITE_OK)
        return MakeError("db_prepare");
    sqlite3_bind_int64(stmt, 1, recording_id);
    sqlite3_bind_text(stmt, 2, user_id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, display_name.c_str(), -1, SQLITE_TRANSIENT);
    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE)
    {
        const int ext = sqlite3_extended_errcode(m_db);
        if (ext == SQLITE_CONSTRAINT_UNIQUE || ext == SQLITE_CONSTRAINT_PRIMARYKEY)
        {
            // Attendee already recorded — intended dedupe, report success.
            return std::monostate{};
        }
        if (ext == SQLITE_CONSTRAINT_FOREIGNKEY)
        {
            return MakeError("not_found", "event.addAttendee: no recording with that id");
        }
        return MakeError("db_insert");
    }

    std::string updateSql = "UPDATE event_recordings SET attendee_count = (SELECT COUNT(*) FROM event_attendees WHERE recording_id = " + std::to_string(recording_id) + ") WHERE id = " + std::to_string(recording_id) + ";";
    return ExecSimple(updateSql.c_str());
}

} // namespace vrcsm::core
