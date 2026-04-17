#include "Database.h"

#include <sqlite3.h>

#include <Windows.h>
#include <KnownFolders.h>
#include <ShlObj.h>

#include <array>
#include <algorithm>
#include <cctype>
#include <charconv>
#include <cstdint>
#include <limits>
#include <string_view>
#include <system_error>

namespace vrcsm::core
{

namespace
{

class StatementGuard
{
public:
    explicit StatementGuard(sqlite3_stmt* stmt) noexcept
        : m_stmt(stmt)
    {
    }

    ~StatementGuard()
    {
        reset();
    }

    StatementGuard(const StatementGuard&) = delete;
    StatementGuard& operator=(const StatementGuard&) = delete;

    void reset() noexcept
    {
        if (m_stmt != nullptr)
        {
            sqlite3_finalize(m_stmt);
            m_stmt = nullptr;
        }
    }

private:
    sqlite3_stmt* m_stmt;
};

std::filesystem::path NormalizePath(const std::filesystem::path& path)
{
    std::error_code ec;
    auto absolutePath = std::filesystem::absolute(path, ec);
    if (ec)
    {
        return path.lexically_normal();
    }
    return absolutePath.lexically_normal();
}

std::string PathToUtf8(const std::filesystem::path& path)
{
    const auto utf8 = path.u8string();
    return std::string(reinterpret_cast<const char*>(utf8.data()), utf8.size());
}

int BindText(sqlite3_stmt* stmt, int index, const std::string& value)
{
    return sqlite3_bind_text(stmt, index, value.c_str(), -1, SQLITE_TRANSIENT);
}

int BindOptionalText(sqlite3_stmt* stmt, int index, const std::optional<std::string>& value)
{
    if (!value.has_value())
    {
        return sqlite3_bind_null(stmt, index);
    }
    return sqlite3_bind_text(stmt, index, value->c_str(), -1, SQLITE_TRANSIENT);
}

int BindInt(sqlite3_stmt* stmt, int index, int value)
{
    return sqlite3_bind_int(stmt, index, value);
}

std::optional<std::string> ColumnOptionalText(sqlite3_stmt* stmt, int index)
{
    if (sqlite3_column_type(stmt, index) == SQLITE_NULL)
    {
        return std::nullopt;
    }
    const auto* text = sqlite3_column_text(stmt, index);
    if (text == nullptr)
    {
        return std::string{};
    }
    return std::string(reinterpret_cast<const char*>(text));
}

nlohmann::json ColumnTextOrNull(sqlite3_stmt* stmt, int index)
{
    const auto value = ColumnOptionalText(stmt, index);
    if (!value.has_value())
    {
        return nullptr;
    }
    return *value;
}

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

bool JsonObjectInt(const nlohmann::json& obj, const char* key, int& out)
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
    if (const auto* signedPtr = it->get_ptr<const nlohmann::json::number_integer_t*>())
    {
        if (*signedPtr < std::numeric_limits<int>::min() || *signedPtr > std::numeric_limits<int>::max())
        {
            return false;
        }
        out = static_cast<int>(*signedPtr);
        return true;
    }
    if (const auto* unsignedPtr = it->get_ptr<const nlohmann::json::number_unsigned_t*>())
    {
        if (*unsignedPtr > static_cast<nlohmann::json::number_unsigned_t>(std::numeric_limits<int>::max()))
        {
            return false;
        }
        out = static_cast<int>(*unsignedPtr);
        return true;
    }
    return false;
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

std::string TrimAscii(std::string value)
{
    value.erase(
        value.begin(),
        std::find_if(value.begin(), value.end(), [](unsigned char ch)
        {
            return !std::isspace(ch);
        }));
    value.erase(
        std::find_if(value.rbegin(), value.rend(), [](unsigned char ch)
        {
            return !std::isspace(ch);
        }).base(),
        value.end());
    return value;
}

std::string LowerAscii(std::string_view value)
{
    std::string lowered;
    lowered.reserve(value.size());
    for (const unsigned char ch : value)
    {
        lowered.push_back(static_cast<char>(std::tolower(ch)));
    }
    return lowered;
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

void RollbackIfNeeded(sqlite3* db) noexcept
{
    if (db != nullptr)
    {
        sqlite3_exec(db, "ROLLBACK;", nullptr, nullptr, nullptr);
    }
}

} // namespace

Database& Database::Instance()
{
    static Database instance;
    return instance;
}

Database::~Database()
{
    Close();
}

Result<std::monostate> Database::Open(const std::filesystem::path& dbPath)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (dbPath.empty())
    {
        return MakeError("db_invalid_argument", "database path is empty");
    }

    const auto normalizedPath = NormalizePath(dbPath);
    if (m_db != nullptr)
    {
        if (m_path == normalizedPath)
        {
            return std::monostate{};
        }
        return MakeError("db_invalid_argument", "database already open with a different path");
    }

    const auto parent = normalizedPath.parent_path();
    if (!parent.empty())
    {
        std::error_code ec;
        std::filesystem::create_directories(parent, ec);
        if (ec)
        {
            return Error{"db_open_failed", ec.message(), 0};
        }
    }

    sqlite3* db = nullptr;
    const std::string dbPathUtf8 = PathToUtf8(normalizedPath);
    const int rc = sqlite3_open_v2(
        dbPathUtf8.c_str(),
        &db,
        SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE,
        nullptr);
    if (rc != SQLITE_OK || db == nullptr)
    {
        std::string detail = "sqlite3_open_v2 failed";
        if (db != nullptr)
        {
            const char* message = sqlite3_errmsg(db);
            if (message != nullptr)
            {
                detail = message;
            }
            sqlite3_close_v2(db);
        }
        return Error{"db_open_failed", detail, 0};
    }

    m_db = db;
    m_path = normalizedPath;
    sqlite3_extended_result_codes(m_db, 1);

    const auto initResult = InitSchema();
    if (std::holds_alternative<Error>(initResult))
    {
        const auto err = std::get<Error>(initResult);
        sqlite3_close_v2(m_db);
        m_db = nullptr;
        m_path.clear();
        return err;
    }

    return std::monostate{};
}

void Database::Close()
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_db != nullptr)
    {
        sqlite3_close_v2(m_db);
        m_db = nullptr;
    }
    m_path.clear();
}

bool Database::IsOpen() const noexcept
{
    return m_db != nullptr;
}

std::filesystem::path Database::DefaultDbPath()
{
    PWSTR raw = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &raw)) && raw != nullptr)
    {
        std::filesystem::path base(raw);
        CoTaskMemFree(raw);
        return base / L"VRCSM" / L"vrcsm.db";
    }

    if (raw != nullptr)
    {
        CoTaskMemFree(raw);
    }

    std::error_code ec;
    auto temp = std::filesystem::temp_directory_path(ec);
    if (ec)
    {
        temp = std::filesystem::path(L".");
    }
    return temp / L"VRCSM" / L"vrcsm.db";
}

Result<std::int64_t> Database::InsertWorldVisit(const WorldVisitInsert& v)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    const char* sql =
        "INSERT INTO world_visits ("
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
        "SELECT id, world_id, instance_id, access_type, owner_id, region, joined_at, left_at "
        "FROM world_visits "
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
        "INSERT INTO player_events (kind, user_id, display_name, world_id, occurred_at) "
        "VALUES (?, ?, ?, ?, ?);";

    const auto insertEventResult =
        RunOnce(insertEventSql, [this, &e](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindText(stmt, 1, e.kind) != SQLITE_OK ||
            BindOptionalText(stmt, 2, e.user_id) != SQLITE_OK ||
            BindText(stmt, 3, e.display_name) != SQLITE_OK ||
            BindOptionalText(stmt, 4, e.world_id) != SQLITE_OK ||
            BindText(stmt, 5, e.occurred_at) != SQLITE_OK)
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

Result<nlohmann::json> Database::RecentPlayerEvents(int limit, int offset)
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
        "SELECT id, kind, user_id, display_name, world_id, occurred_at "
        "FROM player_events "
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
        row["kind"] = ColumnTextOrNull(rawStmt, 1);
        row["user_id"] = ColumnTextOrNull(rawStmt, 2);
        row["display_name"] = ColumnTextOrNull(rawStmt, 3);
        row["world_id"] = ColumnTextOrNull(rawStmt, 4);
        row["occurred_at"] = ColumnTextOrNull(rawStmt, 5);
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

Result<std::monostate> Database::RecordAvatarSeen(const AvatarSeenInsert& a)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    const char* sql =
        "INSERT OR IGNORE INTO avatar_history ("
        "avatar_id, avatar_name, author_name, first_seen_on, first_seen_at"
        ") VALUES (?, ?, ?, ?, ?);";

    return RunOnce(sql, [this, &a](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindText(stmt, 1, a.avatar_id) != SQLITE_OK ||
            BindOptionalText(stmt, 2, a.avatar_name) != SQLITE_OK ||
            BindOptionalText(stmt, 3, a.author_name) != SQLITE_OK ||
            BindOptionalText(stmt, 4, a.first_seen_on) != SQLITE_OK ||
            BindText(stmt, 5, a.first_seen_at) != SQLITE_OK)
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
        "SELECT avatar_id, avatar_name, author_name, first_seen_on, first_seen_at "
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
        rows.push_back(std::move(row));
    }

    if (rc != SQLITE_DONE)
    {
        return MakeError("db_step_failed");
    }

    return rows;
}

Result<std::monostate> Database::InsertFriendLog(const FriendLogInsert& e)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    const char* sql =
        "INSERT INTO friend_log (user_id, event_type, old_value, new_value, occurred_at) "
        "VALUES (?, ?, ?, ?, ?);";

    return RunOnce(sql, [this, &e](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindText(stmt, 1, e.user_id) != SQLITE_OK ||
            BindText(stmt, 2, e.event_type) != SQLITE_OK ||
            BindOptionalText(stmt, 3, e.old_value) != SQLITE_OK ||
            BindOptionalText(stmt, 4, e.new_value) != SQLITE_OK ||
            BindText(stmt, 5, e.occurred_at) != SQLITE_OK)
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
        "SELECT id, user_id, event_type, old_value, new_value, occurred_at "
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
        "SELECT id, user_id, event_type, old_value, new_value, occurred_at "
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

Result<std::monostate> Database::AddFavorite(const FavoriteInsert& f)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    const char* sql =
        "INSERT INTO local_favorites ("
        "type, target_id, list_name, display_name, thumbnail_url, added_at, sort_order"
        ") VALUES (?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(type, target_id, list_name) DO UPDATE SET "
        "display_name = excluded.display_name, "
        "thumbnail_url = excluded.thumbnail_url, "
        "added_at = excluded.added_at, "
        "sort_order = excluded.sort_order;";

    return RunOnce(sql, [this, &f](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindText(stmt, 1, f.type) != SQLITE_OK ||
            BindText(stmt, 2, f.target_id) != SQLITE_OK ||
            BindText(stmt, 3, f.list_name) != SQLITE_OK ||
            BindOptionalText(stmt, 4, f.display_name) != SQLITE_OK ||
            BindOptionalText(stmt, 5, f.thumbnail_url) != SQLITE_OK ||
            BindText(stmt, 6, f.added_at) != SQLITE_OK ||
            BindInt(stmt, 7, f.sort_order) != SQLITE_OK)
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
        "SELECT list_name, type, COUNT(*) AS item_count, MAX(added_at) AS latest_added_at "
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

    const char* sql =
        "SELECT strftime('%w', joined_at) AS dow, "
        "strftime('%H', joined_at) AS hr, "
        "COUNT(*) "
        "FROM world_visits "
        "WHERE joined_at >= datetime('now', '-' || ? || ' days') "
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

Result<std::monostate> Database::InitSchema()
{
    static constexpr const char* kSchemaSql = R"SQL(
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA user_version = 2;

CREATE TABLE IF NOT EXISTS world_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    access_type TEXT,
    owner_id TEXT,
    region TEXT,
    joined_at TEXT NOT NULL,
    left_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_world_visits_world_id ON world_visits(world_id);
CREATE INDEX IF NOT EXISTS idx_world_visits_joined_at ON world_visits(joined_at);

CREATE TABLE IF NOT EXISTS player_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    user_id TEXT,
    display_name TEXT NOT NULL,
    world_id TEXT,
    occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_player_events_time ON player_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_player_events_user ON player_events(user_id);

CREATE TABLE IF NOT EXISTS player_encounters (
    user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    world_id TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    encounter_count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, world_id)
);

CREATE TABLE IF NOT EXISTS avatar_history (
    avatar_id TEXT PRIMARY KEY,
    avatar_name TEXT,
    author_name TEXT,
    first_seen_on TEXT,
    first_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS friend_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_friend_log_user ON friend_log(user_id);
CREATE INDEX IF NOT EXISTS idx_friend_log_time ON friend_log(occurred_at);

CREATE TABLE IF NOT EXISTS friend_notes (
    user_id TEXT PRIMARY KEY,
    note TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_favorites (
    type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    list_name TEXT NOT NULL,
    display_name TEXT,
    thumbnail_url TEXT,
    added_at TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    PRIMARY KEY (type, target_id, list_name)
);
CREATE INDEX IF NOT EXISTS idx_local_favorites_list ON local_favorites(list_name, sort_order);

CREATE TABLE IF NOT EXISTS local_favorite_notes (
    type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    list_name TEXT NOT NULL,
    note TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (type, target_id, list_name),
    FOREIGN KEY (type, target_id, list_name)
        REFERENCES local_favorites(type, target_id, list_name)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS local_favorite_tags (
    type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    list_name TEXT NOT NULL,
    tag TEXT NOT NULL,
    added_at TEXT NOT NULL,
    PRIMARY KEY (type, target_id, list_name, tag),
    FOREIGN KEY (type, target_id, list_name)
        REFERENCES local_favorites(type, target_id, list_name)
        ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_local_favorite_tags_lookup ON local_favorite_tags(list_name, tag);
)SQL";

    return ExecSimple(kSchemaSql);
}

Result<std::monostate> Database::ExecSimple(const char* sql)
{
    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }

    char* errorMessage = nullptr;
    const int rc = sqlite3_exec(m_db, sql, nullptr, nullptr, &errorMessage);
    if (rc != SQLITE_OK)
    {
        std::string detail;
        if (errorMessage != nullptr)
        {
            detail = errorMessage;
            sqlite3_free(errorMessage);
        }
        else
        {
            detail = sqlite3_errmsg(m_db);
        }
        return MakeError("db_exec_failed", detail);
    }
    return std::monostate{};
}

template <typename BindFn>
Result<std::monostate> Database::RunOnce(const char* sql, BindFn bind)
{
    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }

    sqlite3_stmt* rawStmt = nullptr;
    if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
    {
        return MakeError("db_prepare_failed");
    }
    StatementGuard stmt(rawStmt);

    const auto bindResult = bind(rawStmt);
    if (std::holds_alternative<Error>(bindResult))
    {
        return std::get<Error>(bindResult);
    }

    const int rc = sqlite3_step(rawStmt);
    if (rc != SQLITE_DONE)
    {
        return MakeError("db_step_failed");
    }

    return std::monostate{};
}

Error Database::MakeError(std::string_view code) const
{
    if (code == "db_not_open")
    {
        return Error{std::string(code), "database is not open", 0};
    }

    const char* message = nullptr;
    if (m_db != nullptr)
    {
        message = sqlite3_errmsg(m_db);
    }
    if (message == nullptr || *message == '\0')
    {
        message = "database operation failed";
    }

    return Error{std::string(code), message, 0};
}

Error Database::MakeError(std::string_view code, std::string_view detail) const
{
    if (!detail.empty())
    {
        return Error{std::string(code), std::string(detail), 0};
    }
    return MakeError(code);
}

} // namespace vrcsm::core
