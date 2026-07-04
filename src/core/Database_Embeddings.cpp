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

} // namespace vrcsm::core
