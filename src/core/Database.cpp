#include "Database.h"

#include <sqlite3.h>
// SQLITE_CORE must be defined BEFORE sqlite-vec.h so it uses the direct
// sqlite3 API rather than the dynamic-extension shim (which would require
// a global sqlite3_api pointer we don't provide when statically linked).
#define SQLITE_CORE 1
#include "sqlite-vec.h"

#include <fmt/format.h>

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

    // Register sqlite-vec as an auto-extension the first time we open the
    // database. Once registered, every subsequent sqlite3_open_v2 on any
    // connection in this process loads it automatically. Guarded by a
    // static flag so the registration only happens once — registering
    // twice is harmless but sqlite3_auto_extension isn't documented as
    // idempotent for reference counting.
    static bool s_vecExtensionRegistered = false;
    if (!s_vecExtensionRegistered)
    {
        const int vecRc = sqlite3_auto_extension(
            reinterpret_cast<void(*)(void)>(sqlite3_vec_init));
        if (vecRc != SQLITE_OK)
        {
            return Error{
                "db_open_failed",
                fmt::format("sqlite3_auto_extension(sqlite3_vec_init) failed: {}", vecRc),
                0};
        }
        s_vecExtensionRegistered = true;
    }

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
    return getAppDataRoot() / L"vrcsm.db";
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
    // journal_mode and foreign_keys PRAGMAs must run OUTSIDE the DDL
    // transaction below — journal_mode switches to WAL out-of-band and
    // SQLite rejects the change from inside BEGIN/COMMIT; foreign_keys is
    // a per-connection runtime flag, not a schema change. Run them first
    // so the transactional DDL block below can safely roll back if any
    // CREATE/ALTER fails halfway.
    if (const auto r = ExecSimple("PRAGMA journal_mode = WAL;"); std::holds_alternative<Error>(r))
    {
        return std::get<Error>(r);
    }
    if (const auto r = ExecSimple("PRAGMA foreign_keys = ON;"); std::holds_alternative<Error>(r))
    {
        return std::get<Error>(r);
    }

    static constexpr const char* kSchemaSql = R"SQL(
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
    instance_id TEXT,
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

    // Wrap all DDL + migration steps in one transaction. The old flow ran
    // each step as an auto-commit statement, so a failure at (say) the
    // ALTER TABLE step would leave the database at a half-upgraded schema
    // version that no subsequent InitSchema call could repair — new CREATE
    // INDEX would run on an upgraded schema but user_version stayed at the
    // old value, confusing later migrations. With a single tx everything
    // either lands or the db stays at the prior known-good state.
    const auto beginResult = ExecSimple("BEGIN;");
    if (std::holds_alternative<Error>(beginResult))
    {
        return std::get<Error>(beginResult);
    }

    if (const auto r = ExecSimple(kSchemaSql); std::holds_alternative<Error>(r))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(r);
    }

    bool hasInstanceId = false;
    sqlite3_stmt* rawStmt = nullptr;
    if (sqlite3_prepare_v2(m_db, "PRAGMA table_info(player_events);", -1, &rawStmt, nullptr) != SQLITE_OK)
    {
        RollbackIfNeeded(m_db);
        return MakeError("db_prepare_failed");
    }
    StatementGuard stmt(rawStmt);

    int rc = SQLITE_OK;
    while ((rc = sqlite3_step(rawStmt)) == SQLITE_ROW)
    {
        const auto columnName = ColumnOptionalText(rawStmt, 1);
        if (columnName.has_value() && *columnName == "instance_id")
        {
            hasInstanceId = true;
            break;
        }
    }
    if (rc != SQLITE_ROW && rc != SQLITE_DONE)
    {
        RollbackIfNeeded(m_db);
        return MakeError("db_step_failed");
    }

    if (!hasInstanceId)
    {
        if (const auto r = ExecSimple("ALTER TABLE player_events ADD COLUMN instance_id TEXT;");
            std::holds_alternative<Error>(r))
        {
            RollbackIfNeeded(m_db);
            return std::get<Error>(r);
        }
    }

    if (const auto r = ExecSimple(
            "CREATE INDEX IF NOT EXISTS idx_player_events_instance_time "
            "ON player_events(instance_id, occurred_at);");
        std::holds_alternative<Error>(r))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(r);
    }

    // ── v3 → v4 migration: avatar embeddings (experimental visual search) ──
    // Regular metadata table stores model + timestamp; vec0 virtual table
    // does the actual nearest-neighbour search. Both are CREATE IF NOT
    // EXISTS so this block is safe on every startup for DBs already at v4
    // and for fresh DBs that never went through an older version.
    static const char* kSchemaV4Sql = R"SQL(
CREATE TABLE IF NOT EXISTS avatar_embeddings_meta (
    avatar_id TEXT PRIMARY KEY NOT NULL,
    model_version TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE VIRTUAL TABLE IF NOT EXISTS avatar_embeddings_vec USING vec0(
    avatar_id TEXT PRIMARY KEY,
    embedding float[512]
);
)SQL";

    if (const auto r = ExecSimple(kSchemaV4Sql); std::holds_alternative<Error>(r))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(r);
    }

    if (const auto r = ExecSimple("PRAGMA user_version = 4;"); std::holds_alternative<Error>(r))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(r);
    }

    // ── Schema v5: rules engine ────────────────────────────────────
    static const char* kSchemaV5Sql = R"SQL(
CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    dsl_yaml TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_fired_at TEXT,
    fire_count INTEGER NOT NULL DEFAULT 0,
    cooldown_seconds INTEGER NOT NULL DEFAULT 5
);

CREATE TABLE IF NOT EXISTS rule_firings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER NOT NULL,
    fired_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    trigger_payload_json TEXT NOT NULL,
    action_result_code INTEGER,
    action_result_body TEXT,
    FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rule_firings_rule ON rule_firings(rule_id);
CREATE INDEX IF NOT EXISTS idx_rule_firings_time ON rule_firings(fired_at);
    )SQL";

    if (const auto r = ExecSimple(kSchemaV5Sql); std::holds_alternative<Error>(r))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(r);
    }

    // ── Schema v6: event recordings ─────────────────────────────
    static const char* kSchemaV6Sql = R"SQL(
CREATE TABLE IF NOT EXISTS event_recordings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    world_id TEXT,
    instance_id TEXT,
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ended_at TEXT,
    attendee_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS event_attendees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recording_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (recording_id) REFERENCES event_recordings(id) ON DELETE CASCADE,
    UNIQUE(recording_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_attendees_rec ON event_attendees(recording_id);
    )SQL";

    if (const auto r = ExecSimple(kSchemaV6Sql); std::holds_alternative<Error>(r))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(r);
    }

    if (const auto r = ExecSimple("PRAGMA user_version = 6;"); std::holds_alternative<Error>(r))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(r);
    }

    const auto commitResult = ExecSimple("COMMIT;");
    if (std::holds_alternative<Error>(commitResult))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(commitResult);
    }

    return std::monostate{};
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

// ─── Avatar embeddings (v0.11 experimental visual search) ───────────

Result<std::monostate> Database::UpsertAvatarEmbedding(const AvatarEmbeddingInsert& e)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_db == nullptr) return MakeError("db_not_open");
    if (e.avatar_id.empty()) return MakeError("db_invalid_argument", "avatar_id is empty");
    if (e.embedding.empty()) return MakeError("db_invalid_argument", "embedding is empty");

    // vec0 accepts the vector as a BLOB of little-endian float32. On x64
    // Windows that's the native layout, so we can pass the std::vector's
    // buffer directly without conversion.
    const auto embeddingBytes = static_cast<int>(e.embedding.size() * sizeof(float));
    const void* embeddingData = e.embedding.data();

    const auto beginResult = ExecSimple("BEGIN;");
    if (std::holds_alternative<Error>(beginResult)) return std::get<Error>(beginResult);

    // Metadata table (regular). INSERT OR REPLACE so a re-embed after
    // model upgrade cleanly replaces the older row.
    {
        const char* sql =
            "INSERT INTO avatar_embeddings_meta (avatar_id, model_version, created_at) "
            "VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) "
            "ON CONFLICT(avatar_id) DO UPDATE SET "
            "  model_version = excluded.model_version, "
            "  created_at = excluded.created_at;";
        sqlite3_stmt* rawStmt = nullptr;
        if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
        {
            RollbackIfNeeded(m_db);
            return MakeError("db_prepare_failed");
        }
        StatementGuard stmt(rawStmt);
        if (BindText(rawStmt, 1, e.avatar_id) != SQLITE_OK ||
            BindText(rawStmt, 2, e.model_version) != SQLITE_OK)
        {
            RollbackIfNeeded(m_db);
            return MakeError("db_bind_failed");
        }
        if (sqlite3_step(rawStmt) != SQLITE_DONE)
        {
            RollbackIfNeeded(m_db);
            return MakeError("db_step_failed");
        }
    }

    // Vec0 virtual table — delete any existing row first, then insert.
    // vec0 doesn't support ON CONFLICT so we do the two steps explicitly.
    {
        const char* delSql = "DELETE FROM avatar_embeddings_vec WHERE avatar_id = ?;";
        sqlite3_stmt* rawStmt = nullptr;
        if (sqlite3_prepare_v2(m_db, delSql, -1, &rawStmt, nullptr) != SQLITE_OK)
        {
            RollbackIfNeeded(m_db);
            return MakeError("db_prepare_failed");
        }
        StatementGuard stmt(rawStmt);
        if (BindText(rawStmt, 1, e.avatar_id) != SQLITE_OK)
        {
            RollbackIfNeeded(m_db);
            return MakeError("db_bind_failed");
        }
        if (sqlite3_step(rawStmt) != SQLITE_DONE)
        {
            RollbackIfNeeded(m_db);
            return MakeError("db_step_failed");
        }
    }
    {
        const char* insSql =
            "INSERT INTO avatar_embeddings_vec (avatar_id, embedding) VALUES (?, ?);";
        sqlite3_stmt* rawStmt = nullptr;
        if (sqlite3_prepare_v2(m_db, insSql, -1, &rawStmt, nullptr) != SQLITE_OK)
        {
            RollbackIfNeeded(m_db);
            return MakeError("db_prepare_failed");
        }
        StatementGuard stmt(rawStmt);
        if (BindText(rawStmt, 1, e.avatar_id) != SQLITE_OK ||
            sqlite3_bind_blob(rawStmt, 2, embeddingData, embeddingBytes, SQLITE_TRANSIENT) != SQLITE_OK)
        {
            RollbackIfNeeded(m_db);
            return MakeError("db_bind_failed");
        }
        if (sqlite3_step(rawStmt) != SQLITE_DONE)
        {
            RollbackIfNeeded(m_db);
            return MakeError("db_step_failed");
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

Result<std::vector<Database::AvatarEmbeddingMatch>> Database::SearchAvatarEmbeddings(
    const std::vector<float>& queryEmbedding, int k)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_db == nullptr) return MakeError("db_not_open");
    if (queryEmbedding.empty()) return MakeError("db_invalid_argument", "query is empty");
    if (k <= 0 || k > 1000) return MakeError("db_invalid_argument", "k out of range [1, 1000]");

    const char* sql =
        "SELECT avatar_id, distance FROM avatar_embeddings_vec "
        "WHERE embedding MATCH ? AND k = ? "
        "ORDER BY distance;";

    sqlite3_stmt* rawStmt = nullptr;
    if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
    {
        return MakeError("db_prepare_failed");
    }
    StatementGuard stmt(rawStmt);

    const auto qBytes = static_cast<int>(queryEmbedding.size() * sizeof(float));
    if (sqlite3_bind_blob(rawStmt, 1, queryEmbedding.data(), qBytes, SQLITE_TRANSIENT) != SQLITE_OK ||
        sqlite3_bind_int(rawStmt, 2, k) != SQLITE_OK)
    {
        return MakeError("db_bind_failed");
    }

    std::vector<AvatarEmbeddingMatch> out;
    out.reserve(static_cast<std::size_t>(k));
    int rc = SQLITE_OK;
    while ((rc = sqlite3_step(rawStmt)) == SQLITE_ROW)
    {
        AvatarEmbeddingMatch m;
        const auto* idText = reinterpret_cast<const char*>(sqlite3_column_text(rawStmt, 0));
        if (idText != nullptr) m.avatar_id = idText;
        m.distance = static_cast<float>(sqlite3_column_double(rawStmt, 1));
        out.push_back(std::move(m));
    }
    if (rc != SQLITE_DONE)
    {
        return MakeError("db_step_failed");
    }
    return out;
}

Result<std::vector<std::string>> Database::GetUnindexedAvatarIds()
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_db == nullptr) return MakeError("db_not_open");

    // Sources of known avatars: avatar_history (every avatar we've seen)
    // + avatar-typed favorites. Dedup via UNION. Exclude any already in
    // avatar_embeddings_meta.
    const char* sql =
        "SELECT DISTINCT avatar_id FROM ("
        "    SELECT avatar_id FROM avatar_history"
        "    UNION"
        "    SELECT target_id AS avatar_id FROM local_favorites WHERE type = 'avatar'"
        ") AS known "
        "WHERE avatar_id NOT IN (SELECT avatar_id FROM avatar_embeddings_meta) "
        "ORDER BY avatar_id;";

    sqlite3_stmt* rawStmt = nullptr;
    if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
    {
        return MakeError("db_prepare_failed");
    }
    StatementGuard stmt(rawStmt);

    std::vector<std::string> out;
    int rc = SQLITE_OK;
    while ((rc = sqlite3_step(rawStmt)) == SQLITE_ROW)
    {
        const auto* idText = reinterpret_cast<const char*>(sqlite3_column_text(rawStmt, 0));
        if (idText != nullptr && *idText != '\0')
        {
            out.emplace_back(idText);
        }
    }
    if (rc != SQLITE_DONE)
    {
        return MakeError("db_step_failed");
    }
    return out;
}

Result<std::monostate> Database::DeleteAvatarEmbedding(const std::string& avatar_id)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_db == nullptr) return MakeError("db_not_open");
    if (avatar_id.empty()) return MakeError("db_invalid_argument", "avatar_id is empty");

    const auto beginResult = ExecSimple("BEGIN;");
    if (std::holds_alternative<Error>(beginResult)) return std::get<Error>(beginResult);

    for (const char* sql : {
             "DELETE FROM avatar_embeddings_meta WHERE avatar_id = ?;",
             "DELETE FROM avatar_embeddings_vec  WHERE avatar_id = ?;"
         })
    {
        sqlite3_stmt* rawStmt = nullptr;
        if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK)
        {
            RollbackIfNeeded(m_db);
            return MakeError("db_prepare_failed");
        }
        StatementGuard stmt(rawStmt);
        if (BindText(rawStmt, 1, avatar_id) != SQLITE_OK)
        {
            RollbackIfNeeded(m_db);
            return MakeError("db_bind_failed");
        }
        if (sqlite3_step(rawStmt) != SQLITE_DONE)
        {
            RollbackIfNeeded(m_db);
            return MakeError("db_step_failed");
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
    return ExecSimple(sql.c_str());
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

Result<std::monostate> Database::AddAttendee(int64_t recording_id,
    const std::string& user_id, const std::string& display_name)
{
    std::lock_guard lock(m_mutex);
    const char* sql = "INSERT OR IGNORE INTO event_attendees (recording_id, user_id, display_name) VALUES (?, ?, ?);";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(m_db, sql, -1, &stmt, nullptr) != SQLITE_OK)
        return MakeError("db_prepare");
    sqlite3_bind_int64(stmt, 1, recording_id);
    sqlite3_bind_text(stmt, 2, user_id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, display_name.c_str(), -1, SQLITE_TRANSIENT);
    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    if (rc != SQLITE_DONE) return MakeError("db_insert");

    std::string updateSql = "UPDATE event_recordings SET attendee_count = (SELECT COUNT(*) FROM event_attendees WHERE recording_id = " + std::to_string(recording_id) + ") WHERE id = " + std::to_string(recording_id) + ";";
    return ExecSimple(updateSql.c_str());
}

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
