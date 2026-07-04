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

namespace
{
bool JsonObjectString(const nlohmann::json& obj, const char* key, std::string& out)
{
    if (!obj.is_object())
    {
        return false;
    }
    const auto it = obj.find(key);
    if (it == obj.end())
    {
        return false;
    }
    const auto* ptr = it->get_ptr<const nlohmann::json::string_t*>();
    if (ptr == nullptr)
    {
        return false;
    }
    out = *ptr;
    return true;
}

bool JsonObjectOptionalString(const nlohmann::json& obj,
                              const char* key,
                              std::optional<std::string>& out)
{
    if (!obj.is_object())
    {
        return false;
    }
    const auto it = obj.find(key);
    if (it == obj.end() || it->is_null())
    {
        out = std::nullopt;
        return true;
    }
    const auto* ptr = it->get_ptr<const nlohmann::json::string_t*>();
    if (ptr == nullptr)
    {
        return false;
    }
    out = *ptr;
    return true;
}

bool JsonObjectStringArray(const nlohmann::json& obj,
                           const char* key,
                           std::vector<std::string>& out)
{
    if (!obj.is_object())
    {
        return false;
    }
    const auto it = obj.find(key);
    if (it == obj.end() || it->is_null())
    {
        out.clear();
        return true;
    }
    if (!it->is_array())
    {
        return false;
    }

    out.clear();
    out.reserve(it->size());
    for (const auto& value : *it)
    {
        const auto* ptr = value.get_ptr<const nlohmann::json::string_t*>();
        if (ptr == nullptr)
        {
            return false;
        }
        out.push_back(*ptr);
    }
    return true;
}

Result<nlohmann::json> LoadFavoriteTags(sqlite3* db,
                                        const std::string& type,
                                        const std::string& targetId,
                                        const std::string& listName)
{
    const char* sql =
        "SELECT tag "
        "FROM local_favorite_tags "
        "WHERE type = ? AND target_id = ? AND list_name = ? "
        "ORDER BY tag COLLATE NOCASE ASC;";

    sqlite3_stmt* rawStmt = nullptr;
    if (sqlite3_prepare_v2(db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
    {
        return Error{"db_prepare_failed", sqlite3_errmsg(db), 0};
    }
    StatementGuard stmt(rawStmt);

    if (BindText(rawStmt, 1, type) != SQLITE_OK ||
        BindText(rawStmt, 2, targetId) != SQLITE_OK ||
        BindText(rawStmt, 3, listName) != SQLITE_OK)
    {
        return Error{"db_bind_failed", sqlite3_errmsg(db), 0};
    }

    nlohmann::json tags = nlohmann::json::array();
    int rc = SQLITE_OK;
    while ((rc = sqlite3_step(rawStmt)) == SQLITE_ROW)
    {
        tags.push_back(ColumnTextOrNull(rawStmt, 0));
    }

    if (rc != SQLITE_DONE)
    {
        return Error{"db_step_failed", sqlite3_errmsg(db), 0};
    }

    return tags;
}

Result<nlohmann::json> LoadFavoriteNote(sqlite3* db,
                                        const std::string& type,
                                        const std::string& targetId,
                                        const std::string& listName)
{
    const char* sql =
        "SELECT note, updated_at "
        "FROM local_favorite_notes "
        "WHERE type = ? AND target_id = ? AND list_name = ?;";

    sqlite3_stmt* rawStmt = nullptr;
    if (sqlite3_prepare_v2(db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
    {
        return Error{"db_prepare_failed", sqlite3_errmsg(db), 0};
    }
    StatementGuard stmt(rawStmt);

    if (BindText(rawStmt, 1, type) != SQLITE_OK ||
        BindText(rawStmt, 2, targetId) != SQLITE_OK ||
        BindText(rawStmt, 3, listName) != SQLITE_OK)
    {
        return Error{"db_bind_failed", sqlite3_errmsg(db), 0};
    }

    const int rc = sqlite3_step(rawStmt);
    if (rc == SQLITE_ROW)
    {
        return nlohmann::json{
            {"note", ColumnTextOrNull(rawStmt, 0)},
            {"note_updated_at", ColumnTextOrNull(rawStmt, 1)},
        };
    }
    if (rc == SQLITE_DONE)
    {
        return nlohmann::json{
            {"note", nullptr},
            {"note_updated_at", nullptr},
        };
    }
    return Error{"db_step_failed", sqlite3_errmsg(db), 0};
}

std::vector<std::string> NormalizeFavoriteTags(const std::vector<std::string>& tags)
{
    std::vector<std::string> normalized;
    normalized.reserve(tags.size());

    std::vector<std::string> seenKeys;
    seenKeys.reserve(tags.size());

    for (const auto& rawTag : tags)
    {
        std::string tag = TrimAscii(rawTag);
        if (tag.empty())
        {
            continue;
        }

        const auto key = LowerAscii(tag);
        if (std::find(seenKeys.begin(), seenKeys.end(), key) != seenKeys.end())
        {
            continue;
        }

        seenKeys.push_back(key);
        normalized.push_back(std::move(tag));
    }

    std::sort(normalized.begin(), normalized.end(), [](const std::string& a, const std::string& b)
    {
        return LowerAscii(a) < LowerAscii(b);
    });
    return normalized;
}

Result<std::monostate> UpsertFavoriteNote(sqlite3* db,
                                          const std::string& type,
                                          const std::string& targetId,
                                          const std::string& listName,
                                          const std::string& note,
                                          const std::string& updatedAt)
{
    const char* deleteSql =
        "DELETE FROM local_favorite_notes "
        "WHERE type = ? AND target_id = ? AND list_name = ?;";

    const char* upsertSql =
        "INSERT INTO local_favorite_notes (type, target_id, list_name, note, updated_at) "
        "VALUES (?, ?, ?, ?, ?) "
        "ON CONFLICT(type, target_id, list_name) DO UPDATE SET "
        "note = excluded.note, "
        "updated_at = excluded.updated_at;";

    const auto trimmedNote = TrimAscii(note);
    const char* sql = trimmedNote.empty() ? deleteSql : upsertSql;

    sqlite3_stmt* rawStmt = nullptr;
    if (sqlite3_prepare_v2(db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
    {
        return Error{"db_prepare_failed", sqlite3_errmsg(db), 0};
    }
    StatementGuard stmt(rawStmt);

    if (BindText(rawStmt, 1, type) != SQLITE_OK ||
        BindText(rawStmt, 2, targetId) != SQLITE_OK ||
        BindText(rawStmt, 3, listName) != SQLITE_OK)
    {
        return Error{"db_bind_failed", sqlite3_errmsg(db), 0};
    }

    if (!trimmedNote.empty())
    {
        if (BindText(rawStmt, 4, note) != SQLITE_OK ||
            BindText(rawStmt, 5, updatedAt) != SQLITE_OK)
        {
            return Error{"db_bind_failed", sqlite3_errmsg(db), 0};
        }
    }

    if (sqlite3_step(rawStmt) != SQLITE_DONE)
    {
        return Error{"db_step_failed", sqlite3_errmsg(db), 0};
    }

    return std::monostate{};
}

Result<std::monostate> ReplaceFavoriteTags(sqlite3* db,
                                           const std::string& type,
                                           const std::string& targetId,
                                           const std::string& listName,
                                           const std::vector<std::string>& tags,
                                           const std::string& updatedAt)
{
    const char* deleteSql =
        "DELETE FROM local_favorite_tags "
        "WHERE type = ? AND target_id = ? AND list_name = ?;";

    sqlite3_stmt* rawDeleteStmt = nullptr;
    if (sqlite3_prepare_v2(db, deleteSql, -1, &rawDeleteStmt, nullptr) != SQLITE_OK)
    {
        return Error{"db_prepare_failed", sqlite3_errmsg(db), 0};
    }
    StatementGuard deleteStmt(rawDeleteStmt);

    if (BindText(rawDeleteStmt, 1, type) != SQLITE_OK ||
        BindText(rawDeleteStmt, 2, targetId) != SQLITE_OK ||
        BindText(rawDeleteStmt, 3, listName) != SQLITE_OK)
    {
        return Error{"db_bind_failed", sqlite3_errmsg(db), 0};
    }
    if (sqlite3_step(rawDeleteStmt) != SQLITE_DONE)
    {
        return Error{"db_step_failed", sqlite3_errmsg(db), 0};
    }

    const auto normalizedTags = NormalizeFavoriteTags(tags);
    if (normalizedTags.empty())
    {
        return std::monostate{};
    }

    const char* insertSql =
        "INSERT INTO local_favorite_tags (type, target_id, list_name, tag, added_at) "
        "VALUES (?, ?, ?, ?, ?);";

    sqlite3_stmt* rawInsertStmt = nullptr;
    if (sqlite3_prepare_v2(db, insertSql, -1, &rawInsertStmt, nullptr) != SQLITE_OK)
    {
        return Error{"db_prepare_failed", sqlite3_errmsg(db), 0};
    }
    StatementGuard insertStmt(rawInsertStmt);

    for (const auto& tag : normalizedTags)
    {
        if (sqlite3_reset(rawInsertStmt) != SQLITE_OK ||
            sqlite3_clear_bindings(rawInsertStmt) != SQLITE_OK)
        {
            return Error{"db_step_failed", sqlite3_errmsg(db), 0};
        }

        if (BindText(rawInsertStmt, 1, type) != SQLITE_OK ||
            BindText(rawInsertStmt, 2, targetId) != SQLITE_OK ||
            BindText(rawInsertStmt, 3, listName) != SQLITE_OK ||
            BindText(rawInsertStmt, 4, tag) != SQLITE_OK ||
            BindText(rawInsertStmt, 5, updatedAt) != SQLITE_OK)
        {
            return Error{"db_bind_failed", sqlite3_errmsg(db), 0};
        }

        if (sqlite3_step(rawInsertStmt) != SQLITE_DONE)
        {
            return Error{"db_step_failed", sqlite3_errmsg(db), 0};
        }
    }

    return std::monostate{};
}

} // namespace


Result<std::monostate> Database::AddFavorite(const FavoriteInsert& f)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    const char* sql =
        "INSERT INTO local_favorites ("
        "type, target_id, list_name, display_name, thumbnail_url, added_at, sort_order, source"
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(type, target_id, list_name) DO UPDATE SET "
        "display_name = excluded.display_name, "
        "thumbnail_url = excluded.thumbnail_url, "
        "added_at = excluded.added_at, "
        "sort_order = excluded.sort_order, "
        "source = excluded.source;";

    return RunOnce(sql, [this, &f](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindText(stmt, 1, f.type) != SQLITE_OK ||
            BindText(stmt, 2, f.target_id) != SQLITE_OK ||
            BindText(stmt, 3, f.list_name) != SQLITE_OK ||
            BindOptionalText(stmt, 4, f.display_name) != SQLITE_OK ||
            BindOptionalText(stmt, 5, f.thumbnail_url) != SQLITE_OK ||
            BindText(stmt, 6, f.added_at) != SQLITE_OK ||
            BindInt(stmt, 7, f.sort_order) != SQLITE_OK ||
            BindText(stmt, 8, f.source) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        return std::monostate{};
    });
}


Result<std::monostate> Database::RemoveFavorite(const std::string& type,
                                                const std::string& target_id,
                                                const std::string& list_name)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    const char* sql =
        "DELETE FROM local_favorites "
        "WHERE type = ? AND target_id = ? AND list_name = ?;";

    return RunOnce(sql, [this, &type, &target_id, &list_name](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindText(stmt, 1, type) != SQLITE_OK ||
            BindText(stmt, 2, target_id) != SQLITE_OK ||
            BindText(stmt, 3, list_name) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        return std::monostate{};
    });
}


Result<std::monostate> Database::ClearFavoriteList(const std::string& list_name)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    const char* sql =
        "DELETE FROM local_favorites "
        "WHERE list_name = ?;";

    return RunOnce(sql, [this, &list_name](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindText(stmt, 1, list_name) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        return std::monostate{};
    });
}


Result<std::monostate> Database::ClearFavoritesBySource(const std::string& source)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    const char* sql =
        "DELETE FROM local_favorites "
        "WHERE source = ?;";

    return RunOnce(sql, [this, &source](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindText(stmt, 1, source) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        return std::monostate{};
    });
}


Result<std::monostate> Database::SetFavoriteNote(const std::string& type,
                                                 const std::string& target_id,
                                                 const std::string& list_name,
                                                 const std::string& note,
                                                 const std::string& updated_at)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    auto result = UpsertFavoriteNote(m_db, type, target_id, list_name, note, updated_at);
    if (std::holds_alternative<Error>(result))
    {
        return std::get<Error>(result);
    }
    return std::monostate{};
}


Result<std::monostate> Database::SetFavoriteTags(const std::string& type,
                                                 const std::string& target_id,
                                                 const std::string& list_name,
                                                 const std::vector<std::string>& tags,
                                                 const std::string& updated_at)
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

    auto replaceResult = ReplaceFavoriteTags(m_db, type, target_id, list_name, tags, updated_at);
    if (std::holds_alternative<Error>(replaceResult))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(replaceResult);
    }

    const auto commitResult = ExecSimple("COMMIT;");
    if (std::holds_alternative<Error>(commitResult))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(commitResult);
    }

    return std::monostate{};
}


Result<nlohmann::json> Database::FavoriteLists()
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }

    const char* sql =
        "SELECT list_name, type, COUNT(*) AS item_count, MAX(added_at) AS latest_added_at, "
        "MAX(source) AS source "
        "FROM local_favorites "
        "GROUP BY list_name, type "
        "ORDER BY latest_added_at DESC;";

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
        const auto listName = ColumnTextOrNull(rawStmt, 0);
        row["list_name"] = listName;
        row["name"] = listName;
        row["type"] = ColumnTextOrNull(rawStmt, 1);
        row["item_count"] = static_cast<std::int64_t>(sqlite3_column_int64(rawStmt, 2));
        row["latest_added_at"] = ColumnTextOrNull(rawStmt, 3);
        row["source"] = ColumnTextOrNull(rawStmt, 4);
        rows.push_back(std::move(row));
    }

    if (rc != SQLITE_DONE)
    {
        return MakeError("db_step_failed");
    }

    return rows;
}


Result<nlohmann::json> Database::FavoriteItems(const std::string& list_name)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }

    const char* sql =
        "SELECT type, target_id, list_name, display_name, thumbnail_url, added_at, sort_order "
        "FROM local_favorites "
        "WHERE list_name = ? "
        "ORDER BY sort_order ASC, added_at ASC;";

    sqlite3_stmt* rawStmt = nullptr;
    if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
    {
        return MakeError("db_prepare_failed");
    }
    StatementGuard stmt(rawStmt);

    if (BindText(rawStmt, 1, list_name) != SQLITE_OK)
    {
        return MakeError("db_bind_failed");
    }

    nlohmann::json rows = nlohmann::json::array();
    int rc = SQLITE_OK;
    while ((rc = sqlite3_step(rawStmt)) == SQLITE_ROW)
    {
        nlohmann::json row = nlohmann::json::object();
        const auto type = ColumnOptionalText(rawStmt, 0).value_or("");
        const auto targetId = ColumnOptionalText(rawStmt, 1).value_or("");
        const auto listName = ColumnOptionalText(rawStmt, 2).value_or("");
        row["type"] = type;
        row["target_id"] = targetId;
        row["list_name"] = listName;
        row["display_name"] = ColumnTextOrNull(rawStmt, 3);
        row["thumbnail_url"] = ColumnTextOrNull(rawStmt, 4);
        row["added_at"] = ColumnTextOrNull(rawStmt, 5);
        row["sort_order"] = sqlite3_column_int(rawStmt, 6);

        auto tagsRes = LoadFavoriteTags(m_db, type, targetId, listName);
        if (!isOk(tagsRes))
        {
            return error(tagsRes);
        }
        row["tags"] = value(tagsRes);

        auto noteRes = LoadFavoriteNote(m_db, type, targetId, listName);
        if (!isOk(noteRes))
        {
            return error(noteRes);
        }
        const auto& noteObj = value(noteRes);
        row["note"] = noteObj.contains("note") ? noteObj.at("note") : nlohmann::json(nullptr);
        row["note_updated_at"] = noteObj.contains("note_updated_at") ? noteObj.at("note_updated_at") : nlohmann::json(nullptr);
        rows.push_back(std::move(row));
    }

    if (rc != SQLITE_DONE)
    {
        return MakeError("db_step_failed");
    }

    return rows;
}


Result<nlohmann::json> Database::ExportFavoriteList(const std::string& list_name)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }

    const char* sql =
        "SELECT type, target_id, list_name, display_name, thumbnail_url, added_at, sort_order "
        "FROM local_favorites "
        "WHERE list_name = ? "
        "ORDER BY sort_order ASC, added_at ASC;";

    sqlite3_stmt* rawStmt = nullptr;
    if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
    {
        return MakeError("db_prepare_failed");
    }
    StatementGuard stmt(rawStmt);

    if (BindText(rawStmt, 1, list_name) != SQLITE_OK)
    {
        return MakeError("db_bind_failed");
    }

    nlohmann::json items = nlohmann::json::array();
    int rc = SQLITE_OK;
    while ((rc = sqlite3_step(rawStmt)) == SQLITE_ROW)
    {
        nlohmann::json row = nlohmann::json::object();
        const auto type = ColumnOptionalText(rawStmt, 0).value_or("");
        const auto targetId = ColumnOptionalText(rawStmt, 1).value_or("");
        const auto listName = ColumnOptionalText(rawStmt, 2).value_or("");
        row["type"] = type;
        row["target_id"] = targetId;
        row["list_name"] = listName;
        row["display_name"] = ColumnTextOrNull(rawStmt, 3);
        row["thumbnail_url"] = ColumnTextOrNull(rawStmt, 4);
        row["added_at"] = ColumnTextOrNull(rawStmt, 5);
        row["sort_order"] = sqlite3_column_int(rawStmt, 6);

        auto tagsRes = LoadFavoriteTags(m_db, type, targetId, listName);
        if (!isOk(tagsRes))
        {
            return error(tagsRes);
        }
        row["tags"] = value(tagsRes);

        auto noteRes = LoadFavoriteNote(m_db, type, targetId, listName);
        if (!isOk(noteRes))
        {
            return error(noteRes);
        }
        const auto& noteObj = value(noteRes);
        row["note"] = noteObj.contains("note") ? noteObj.at("note") : nlohmann::json(nullptr);
        row["note_updated_at"] = noteObj.contains("note_updated_at") ? noteObj.at("note_updated_at") : nlohmann::json(nullptr);
        items.push_back(std::move(row));
    }

    if (rc != SQLITE_DONE)
    {
        return MakeError("db_step_failed");
    }

    nlohmann::json payload = nlohmann::json::object();
    payload["schema_version"] = 2;
    payload["list_name"] = list_name;
    payload["exported_at"] = nowIso();
    payload["items"] = std::move(items);
    return payload;
}


Result<int> Database::ImportFavoriteList(const nlohmann::json& payload)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }
    if (!payload.is_object())
    {
        return MakeError("db_invalid_argument", "payload must be an object");
    }

    int schemaVersion = 0;
    if (!JsonObjectInt(payload, "schema_version", schemaVersion) ||
        (schemaVersion != 1 && schemaVersion != 2))
    {
        return MakeError("db_invalid_argument", "schema_version must be 1 or 2");
    }

    const auto itemsIt = payload.find("items");
    if (itemsIt == payload.end() || !itemsIt->is_array())
    {
        return MakeError("db_invalid_argument", "items must be an array");
    }

    std::string defaultListName;
    const bool hasDefaultListName = JsonObjectString(payload, "list_name", defaultListName);

    const auto beginResult = ExecSimple("BEGIN;");
    if (std::holds_alternative<Error>(beginResult))
    {
        return std::get<Error>(beginResult);
    }

    const char* sql =
        "INSERT INTO local_favorites ("
        "type, target_id, list_name, display_name, thumbnail_url, added_at, sort_order"
        ") VALUES (?, ?, ?, ?, ?, ?, ?);";

    int insertedCount = 0;
    for (const auto& item : *itemsIt)
    {
        if (!item.is_object())
        {
            RollbackIfNeeded(m_db);
            return MakeError("db_invalid_argument", "each favorite item must be an object");
        }

        std::string type;
        std::string targetId;
        std::string listName;
        std::string addedAt;
        std::optional<std::string> note;
        std::optional<std::string> noteUpdatedAt;
        std::optional<std::string> displayName;
        std::optional<std::string> thumbnailUrl;
        std::vector<std::string> tags;
        int sortOrder = 0;

        if (!JsonObjectString(item, "type", type) ||
            !JsonObjectString(item, "target_id", targetId) ||
            !JsonObjectString(item, "added_at", addedAt))
        {
            RollbackIfNeeded(m_db);
            return MakeError("db_invalid_argument", "favorite item is missing required string fields");
        }

        if (!JsonObjectString(item, "list_name", listName))
        {
            if (!hasDefaultListName)
            {
                RollbackIfNeeded(m_db);
                return MakeError("db_invalid_argument", "favorite item is missing list_name");
            }
            listName = defaultListName;
        }

        if (!JsonObjectOptionalString(item, "display_name", displayName) ||
            !JsonObjectOptionalString(item, "thumbnail_url", thumbnailUrl))
        {
            RollbackIfNeeded(m_db);
            return MakeError("db_invalid_argument", "favorite item has invalid optional string fields");
        }
        if (schemaVersion >= 2)
        {
            if (!JsonObjectOptionalString(item, "note", note) ||
                !JsonObjectOptionalString(item, "note_updated_at", noteUpdatedAt) ||
                !JsonObjectStringArray(item, "tags", tags))
            {
                RollbackIfNeeded(m_db);
                return MakeError("db_invalid_argument", "favorite item has invalid note or tags fields");
            }
        }

        const auto sortOrderIt = item.find("sort_order");
        if (sortOrderIt != item.end() && !sortOrderIt->is_null())
        {
            if (!JsonObjectInt(item, "sort_order", sortOrder))
            {
                RollbackIfNeeded(m_db);
                return MakeError("db_invalid_argument", "favorite item has invalid sort_order");
            }
        }

        sqlite3_stmt* rawStmt = nullptr;
        if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
        {
            RollbackIfNeeded(m_db);
            return MakeError("db_prepare_failed");
        }
        StatementGuard stmt(rawStmt);

        if (BindText(rawStmt, 1, type) != SQLITE_OK ||
            BindText(rawStmt, 2, targetId) != SQLITE_OK ||
            BindText(rawStmt, 3, listName) != SQLITE_OK ||
            BindOptionalText(rawStmt, 4, displayName) != SQLITE_OK ||
            BindOptionalText(rawStmt, 5, thumbnailUrl) != SQLITE_OK ||
            BindText(rawStmt, 6, addedAt) != SQLITE_OK ||
            BindInt(rawStmt, 7, sortOrder) != SQLITE_OK)
        {
            stmt.reset();
            RollbackIfNeeded(m_db);
            return MakeError("db_bind_failed");
        }

        const int rc = sqlite3_step(rawStmt);
        if (rc == SQLITE_DONE)
        {
            insertedCount += sqlite3_changes(m_db);
        }
        else
        {
            const int extendedCode = sqlite3_extended_errcode(m_db);
            if (extendedCode != SQLITE_CONSTRAINT_PRIMARYKEY &&
                extendedCode != SQLITE_CONSTRAINT_UNIQUE)
            {
                stmt.reset();
                RollbackIfNeeded(m_db);
                return MakeError("db_step_failed");
            }
        }

        if (schemaVersion >= 2)
        {
            const auto effectiveNoteUpdatedAt = noteUpdatedAt.value_or(addedAt);

            auto noteResult = UpsertFavoriteNote(
                m_db,
                type,
                targetId,
                listName,
                note.value_or(""),
                effectiveNoteUpdatedAt);
            if (std::holds_alternative<Error>(noteResult))
            {
                RollbackIfNeeded(m_db);
                return std::get<Error>(noteResult);
            }

            auto tagsResult = ReplaceFavoriteTags(
                m_db,
                type,
                targetId,
                listName,
                tags,
                effectiveNoteUpdatedAt);
            if (std::holds_alternative<Error>(tagsResult))
            {
                RollbackIfNeeded(m_db);
                return std::get<Error>(tagsResult);
            }
        }
    }

    const auto commitResult = ExecSimple("COMMIT;");
    if (std::holds_alternative<Error>(commitResult))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(commitResult);
    }

    return insertedCount;
}

} // namespace vrcsm::core
