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


// ── Rules CRUD ──────────────────────────────────────────────────────

Result<nlohmann::json> Database::InsertRule(const RuleInsert& r)
{
    std::lock_guard lock(m_mutex);
    const char* sql = "INSERT INTO rules (name, description, dsl_yaml, cooldown_seconds) VALUES (?, ?, ?, ?);";
    sqlite3_stmt* stmt = nullptr;
    int rc = sqlite3_prepare_v2(m_db, sql, -1, &stmt, nullptr);
    if (rc != SQLITE_OK) return MakeError("db_prepare", sqlite3_errmsg(m_db));

    sqlite3_bind_text(stmt, 1, r.name.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, r.description.value_or("").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, r.dsl_yaml.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt, 4, r.cooldown_seconds);

    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    if (rc != SQLITE_DONE) return MakeError("db_insert", sqlite3_errmsg(m_db));

    int64_t id = sqlite3_last_insert_rowid(m_db);
    return nlohmann::json{{"id", id}};
}


Result<nlohmann::json> Database::UpdateRule(int64_t id, const nlohmann::json& patch)
{
    std::lock_guard lock(m_mutex);
    std::string sets;
    if (patch.contains("name")) sets += "name = '" + patch["name"].get<std::string>() + "', ";
    if (patch.contains("description")) sets += "description = '" + patch["description"].get<std::string>() + "', ";
    if (patch.contains("dsl_yaml")) sets += "dsl_yaml = '" + patch["dsl_yaml"].get<std::string>() + "', ";
    if (patch.contains("cooldown_seconds")) sets += "cooldown_seconds = " + std::to_string(patch["cooldown_seconds"].get<int>()) + ", ";
    sets += "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

    std::string sql = "UPDATE rules SET " + sets + " WHERE id = " + std::to_string(id) + ";";
    const auto r = ExecSimple(sql.c_str());
    if (std::holds_alternative<Error>(r)) return std::get<Error>(r);
    return GetRule(id);
}


Result<std::monostate> Database::DeleteRule(int64_t id)
{
    std::lock_guard lock(m_mutex);
    std::string sql = "DELETE FROM rules WHERE id = " + std::to_string(id) + ";";
    return ExecSimple(sql.c_str());
}


Result<nlohmann::json> Database::GetRule(int64_t id)
{
    std::lock_guard lock(m_mutex);
    std::string sql = "SELECT id, name, description, enabled, dsl_yaml, created_at, updated_at, last_fired_at, fire_count, cooldown_seconds FROM rules WHERE id = " + std::to_string(id) + ";";
    sqlite3_stmt* stmt = nullptr;
    int rc = sqlite3_prepare_v2(m_db, sql.c_str(), -1, &stmt, nullptr);
    if (rc != SQLITE_OK) return MakeError("db_prepare");

    rc = sqlite3_step(stmt);
    if (rc != SQLITE_ROW) { sqlite3_finalize(stmt); return MakeError("not_found", "Rule not found"); }

    nlohmann::json rule = {
        {"id", sqlite3_column_int64(stmt, 0)},
        {"name", reinterpret_cast<const char*>(sqlite3_column_text(stmt, 1))},
        {"description", sqlite3_column_type(stmt, 2) == SQLITE_NULL ? "" : reinterpret_cast<const char*>(sqlite3_column_text(stmt, 2))},
        {"enabled", sqlite3_column_int(stmt, 3) != 0},
        {"dsl_yaml", reinterpret_cast<const char*>(sqlite3_column_text(stmt, 4))},
        {"created_at", reinterpret_cast<const char*>(sqlite3_column_text(stmt, 5))},
        {"updated_at", reinterpret_cast<const char*>(sqlite3_column_text(stmt, 6))},
        {"last_fired_at", sqlite3_column_type(stmt, 7) == SQLITE_NULL ? nullptr : nlohmann::json(reinterpret_cast<const char*>(sqlite3_column_text(stmt, 7)))},
        {"fire_count", sqlite3_column_int(stmt, 8)},
        {"cooldown_seconds", sqlite3_column_int(stmt, 9)},
    };
    sqlite3_finalize(stmt);
    return rule;
}


Result<nlohmann::json> Database::ListRules()
{
    std::lock_guard lock(m_mutex);
    const char* sql = "SELECT id, name, description, enabled, dsl_yaml, created_at, updated_at, last_fired_at, fire_count, cooldown_seconds FROM rules ORDER BY created_at DESC;";
    sqlite3_stmt* stmt = nullptr;
    int rc = sqlite3_prepare_v2(m_db, sql, -1, &stmt, nullptr);
    if (rc != SQLITE_OK) return MakeError("db_prepare");

    nlohmann::json arr = nlohmann::json::array();
    while ((rc = sqlite3_step(stmt)) == SQLITE_ROW)
    {
        arr.push_back({
            {"id", sqlite3_column_int64(stmt, 0)},
            {"name", reinterpret_cast<const char*>(sqlite3_column_text(stmt, 1))},
            {"description", sqlite3_column_type(stmt, 2) == SQLITE_NULL ? "" : reinterpret_cast<const char*>(sqlite3_column_text(stmt, 2))},
            {"enabled", sqlite3_column_int(stmt, 3) != 0},
            {"dsl_yaml", reinterpret_cast<const char*>(sqlite3_column_text(stmt, 4))},
            {"created_at", reinterpret_cast<const char*>(sqlite3_column_text(stmt, 5))},
            {"updated_at", reinterpret_cast<const char*>(sqlite3_column_text(stmt, 6))},
            {"last_fired_at", sqlite3_column_type(stmt, 7) == SQLITE_NULL ? nullptr : nlohmann::json(reinterpret_cast<const char*>(sqlite3_column_text(stmt, 7)))},
            {"fire_count", sqlite3_column_int(stmt, 8)},
            {"cooldown_seconds", sqlite3_column_int(stmt, 9)},
        });
    }
    sqlite3_finalize(stmt);
    return nlohmann::json{{"rules", arr}};
}


Result<std::monostate> Database::SetRuleEnabled(int64_t id, bool enabled)
{
    std::lock_guard lock(m_mutex);
    std::string sql = "UPDATE rules SET enabled = " + std::to_string(enabled ? 1 : 0) + ", updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = " + std::to_string(id) + ";";
    return ExecSimple(sql.c_str());
}


Result<std::monostate> Database::RecordRuleFiring(int64_t rule_id,
    const std::string& trigger_payload, int result_code, const std::string& result_body)
{
    std::lock_guard lock(m_mutex);
    const char* sql = "INSERT INTO rule_firings (rule_id, trigger_payload_json, action_result_code, action_result_body) VALUES (?, ?, ?, ?);";
    sqlite3_stmt* stmt = nullptr;
    int rc = sqlite3_prepare_v2(m_db, sql, -1, &stmt, nullptr);
    if (rc != SQLITE_OK) return MakeError("db_prepare");

    sqlite3_bind_int64(stmt, 1, rule_id);
    sqlite3_bind_text(stmt, 2, trigger_payload.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt, 3, result_code);
    sqlite3_bind_text(stmt, 4, result_body.c_str(), -1, SQLITE_TRANSIENT);

    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    if (rc != SQLITE_DONE) return MakeError("db_insert");

    std::string updateSql = "UPDATE rules SET fire_count = fire_count + 1, last_fired_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = " + std::to_string(rule_id) + ";";
    return ExecSimple(updateSql.c_str());
}


Result<nlohmann::json> Database::RuleFiringHistory(int64_t rule_id, int limit)
{
    std::lock_guard lock(m_mutex);
    std::string sql = "SELECT id, rule_id, fired_at, trigger_payload_json, action_result_code, action_result_body FROM rule_firings WHERE rule_id = " + std::to_string(rule_id) + " ORDER BY fired_at DESC LIMIT " + std::to_string(limit) + ";";
    sqlite3_stmt* stmt = nullptr;
    int rc = sqlite3_prepare_v2(m_db, sql.c_str(), -1, &stmt, nullptr);
    if (rc != SQLITE_OK) return MakeError("db_prepare");

    nlohmann::json arr = nlohmann::json::array();
    while ((rc = sqlite3_step(stmt)) == SQLITE_ROW)
    {
        arr.push_back({
            {"id", sqlite3_column_int64(stmt, 0)},
            {"rule_id", sqlite3_column_int64(stmt, 1)},
            {"fired_at", reinterpret_cast<const char*>(sqlite3_column_text(stmt, 2))},
            {"trigger_payload", reinterpret_cast<const char*>(sqlite3_column_text(stmt, 3))},
            {"result_code", sqlite3_column_int(stmt, 4)},
            {"result_body", sqlite3_column_type(stmt, 5) == SQLITE_NULL ? "" : reinterpret_cast<const char*>(sqlite3_column_text(stmt, 5))},
        });
    }
    sqlite3_finalize(stmt);
    return nlohmann::json{{"firings", arr}};
}

} // namespace vrcsm::core
