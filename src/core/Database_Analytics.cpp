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

namespace
{
std::string CollapseWhitespaceAscii(std::string value)
{
    value = TrimAscii(std::move(value));

    std::string out;
    out.reserve(value.size());
    bool inWhitespace = false;
    for (const unsigned char ch : value)
    {
        if (std::isspace(ch))
        {
            if (!inWhitespace && !out.empty())
            {
                out.push_back(' ');
            }
            inWhitespace = true;
            continue;
        }
        out.push_back(static_cast<char>(ch));
        inWhitespace = false;
    }
    return out;
}

bool JsonStringArrayContains(const nlohmann::json& params, std::string_view value)
{
    if (!params.is_object() || !params.contains("types") || !params["types"].is_array())
    {
        return false;
    }
    for (const auto& item : params["types"])
    {
        if (item.is_string() && item.get<std::string>() == value)
        {
            return true;
        }
    }
    return false;
}

bool SearchTypeAllowed(const nlohmann::json& params, std::string_view type, bool favoriteBacked = false)
{
    if (!params.is_object() || !params.contains("types") || !params["types"].is_array() || params["types"].empty())
    {
        return true;
    }
    return JsonStringArrayContains(params, type) || (favoriteBacked && JsonStringArrayContains(params, "favorite"));
}

bool IsThumbLocalUrl(std::string_view url)
{
    const auto lowered = LowerAscii(url);
    return lowered == "thumb.local"
        || lowered.rfind("thumb.local/", 0) == 0
        || lowered.rfind("https://thumb.local/", 0) == 0
        || lowered.rfind("http://thumb.local/", 0) == 0;
}

std::string SearchRouteFor(std::string_view type, std::string_view id)
{
    if (type == "world")
    {
        return "/worlds?select=" + std::string(id);
    }
    if (type == "avatar")
    {
        return "/avatars?select=" + std::string(id);
    }
    if (type == "user")
    {
        return "/friends?select=" + std::string(id);
    }
    return "/logs";
}

std::string SearchPrimaryLabel(std::string_view type)
{
    if (type == "world") return "Open world";
    if (type == "avatar") return "Inspect avatar";
    if (type == "user") return "Open user";
    return "Inspect evidence";
}

double TextMatchScore(const std::string& normalizedQuery,
                      const std::string& id,
                      const std::string& displayName,
                      const std::string& extra = {})
{
    if (normalizedQuery.empty())
    {
        return 0.05;
    }

    const auto loweredId = LowerAscii(id);
    const auto loweredDisplay = LowerAscii(displayName);
    const auto loweredExtra = LowerAscii(extra);
    double score = 0.0;

    if (loweredId == normalizedQuery)
    {
        score += 0.45;
    }
    else if (loweredId.find(normalizedQuery) != std::string::npos)
    {
        score += 0.22;
    }

    if (!displayName.empty() && loweredDisplay == normalizedQuery)
    {
        score += 0.35;
    }
    else if (!displayName.empty() && loweredDisplay.rfind(normalizedQuery, 0) == 0)
    {
        score += 0.25;
    }
    else if (!displayName.empty() && loweredDisplay.find(normalizedQuery) != std::string::npos)
    {
        score += 0.15;
    }

    if (!extra.empty() && loweredExtra.find(normalizedQuery) != std::string::npos)
    {
        score += 0.08;
    }
    return score;
}

nlohmann::json SearchEvidence(std::string kind,
                              std::string label,
                              std::string detail,
                              std::string sourceId,
                              std::optional<std::string> observedAt,
                              std::string reliability,
                              std::string privacy)
{
    nlohmann::json item{
        {"kind", std::move(kind)},
        {"label", std::move(label)},
        {"detail", std::move(detail)},
        {"sourceId", std::move(sourceId)},
        {"reliability", std::move(reliability)},
        {"privacy", std::move(privacy)},
    };
    if (observedAt.has_value() && !observedAt->empty())
    {
        item["observedAt"] = *observedAt;
    }
    return item;
}

struct GlobalSearchCandidate
{
    std::string type;
    std::string id;
    std::string displayName;
    std::string subtitle;
    std::string sourceKind;
    std::string sourceLabel;
    std::string updatedAt;
    std::string thumbnailUrl;
    std::string thumbnailKind{"placeholder"};
    std::string thumbnailSource{"placeholder"};
    bool thumbnailVerified{false};
    std::vector<nlohmann::json> evidence;
    double score{0.0};
    bool isFavorite{false};
    bool hasLocalCache{false};
    bool has3dPreview{false};
    int visitCount{0};
    int encounterCount{0};
    std::optional<std::string> firstSeenAt;
    std::optional<std::string> lastSeenAt;
    std::set<std::string> warnings;
};

using SearchCandidateMap = std::unordered_map<std::string, GlobalSearchCandidate>;

std::string CandidateKey(std::string_view type, std::string_view id)
{
    return std::string(type) + ":" + std::string(id);
}

GlobalSearchCandidate& UpsertSearchCandidate(
    SearchCandidateMap& candidates,
    std::string type,
    std::string id,
    std::string displayName,
    std::string sourceKind,
    std::string sourceLabel,
    std::optional<std::string> updatedAt)
{
    auto& c = candidates[CandidateKey(type, id)];
    if (c.type.empty())
    {
        c.type = std::move(type);
        c.id = std::move(id);
        c.displayName = displayName.empty() ? c.id : std::move(displayName);
        c.sourceKind = std::move(sourceKind);
        c.sourceLabel = std::move(sourceLabel);
        if (updatedAt.has_value())
        {
            c.updatedAt = *updatedAt;
        }
        return c;
    }

    if ((c.displayName.empty() || c.displayName == c.id) && !displayName.empty())
    {
        c.displayName = std::move(displayName);
    }
    if (c.sourceKind != sourceKind)
    {
        c.sourceKind = "mixed";
        c.sourceLabel = "Mixed local evidence";
    }
    if (updatedAt.has_value() && *updatedAt > c.updatedAt)
    {
        c.updatedAt = *updatedAt;
    }
    return c;
}

nlohmann::json CandidateToJson(const GlobalSearchCandidate& c)
{
    const bool isAvatar = c.type == "avatar";
    const auto actionKind = isAvatar ? "inspect" : (c.type == "timeline_event" ? "focus-timeline" : "open");

    std::string state = "unknown";
    if (c.isFavorite) state = "favorite";
    else if (c.visitCount > 0) state = "visited";
    else if (c.encounterCount > 0) state = "encountered";
    else if (isAvatar) state = "seen-avatar";
    else if (c.hasLocalCache) state = "cached-asset";

    nlohmann::json warnings = nlohmann::json::array();
    for (const auto& warning : c.warnings)
    {
        warnings.push_back(warning);
    }

    nlohmann::json evidence = nlohmann::json::array();
    for (const auto& item : c.evidence)
    {
        evidence.push_back(item);
    }

    nlohmann::json thumbnail = {
        {"url", c.thumbnailUrl.empty() ? nlohmann::json(nullptr) : nlohmann::json(c.thumbnailUrl)},
        {"kind", c.thumbnailKind},
        {"source", c.thumbnailSource},
        {"verified", c.thumbnailVerified},
        {"alt", c.displayName.empty() ? c.id : c.displayName},
    };

    nlohmann::json localStatus{
        {"state", state},
        {"isFavorite", c.isFavorite},
        {"hasLocalCache", c.hasLocalCache},
        {"has3dPreview", c.has3dPreview},
    };
    if (c.visitCount > 0) localStatus["visitCount"] = c.visitCount;
    if (c.encounterCount > 0) localStatus["encounterCount"] = c.encounterCount;
    if (c.firstSeenAt.has_value()) localStatus["firstSeenAt"] = *c.firstSeenAt;
    if (c.lastSeenAt.has_value()) localStatus["lastSeenAt"] = *c.lastSeenAt;
    if (!warnings.empty()) localStatus["warnings"] = warnings;

    return nlohmann::json{
        {"type", c.type},
        {"id", c.id},
        {"displayName", c.displayName.empty() ? c.id : c.displayName},
        {"subtitle", c.subtitle.empty() ? (c.evidence.empty() ? "Local evidence" : c.evidence.front().value("detail", "Local evidence")) : c.subtitle},
        {"source", {
            {"kind", c.sourceKind.empty() ? "mixed" : c.sourceKind},
            {"label", c.sourceLabel.empty() ? "Local evidence" : c.sourceLabel},
            {"updatedAt", c.updatedAt.empty() ? nlohmann::json(nullptr) : nlohmann::json(c.updatedAt)},
        }},
        {"evidence", evidence},
        {"thumbnail", thumbnail},
        {"localStatus", localStatus},
        {"primaryAction", {
            {"kind", actionKind},
            {"label", SearchPrimaryLabel(c.type)},
            {"route", SearchRouteFor(c.type, c.id)},
            {"enabled", true},
        }},
        {"confidence", std::clamp(c.score, 0.0, 1.0)},
    };
}

} // namespace

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


Result<nlohmann::json> Database::GlobalSearch(const nlohmann::json& request)
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

    const auto rawQuery = request.is_object() && request.contains("query") && request["query"].is_string()
        ? request["query"].get<std::string>()
        : std::string{};
    const auto normalizedQuery = LowerAscii(CollapseWhitespaceAscii(rawQuery));
    const auto likeQuery = "%" + normalizedQuery + "%";

    int limit = 20;
    int offset = 0;
    if (request.is_object())
    {
        (void)JsonObjectInt(request, "limit", limit);
        (void)JsonObjectInt(request, "offset", offset);
    }
    limit = std::clamp(limit, 1, 50);
    offset = std::max(offset, 0);

    SearchCandidateMap candidates;

    auto bindQueryPair = [&](sqlite3_stmt* stmt, int firstIndex) -> bool
    {
        return BindText(stmt, firstIndex, normalizedQuery) == SQLITE_OK
            && BindText(stmt, firstIndex + 1, likeQuery) == SQLITE_OK;
    };

    if (SearchTypeAllowed(request, "world", true)
        || SearchTypeAllowed(request, "avatar", true)
        || SearchTypeAllowed(request, "user", true))
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
            const auto type = ColumnOptionalText(rawStmt, 0).value_or("other");
            if (!SearchTypeAllowed(request, type, true))
            {
                continue;
            }
            const auto targetId = ColumnOptionalText(rawStmt, 1).value_or("");
            if (targetId.empty())
            {
                continue;
            }
            const auto listName = ColumnOptionalText(rawStmt, 2).value_or("Library");
            const auto displayName = ColumnOptionalText(rawStmt, 3).value_or(targetId);
            const auto thumbnailUrl = ColumnOptionalText(rawStmt, 4);
            const auto addedAt = ColumnOptionalText(rawStmt, 5);
            const auto note = ColumnOptionalText(rawStmt, 6).value_or("");
            const auto tags = ColumnOptionalText(rawStmt, 7).value_or("");

            auto& c = UpsertSearchCandidate(
                candidates,
                type,
                targetId,
                displayName,
                "local.favorite",
                "Local favorite",
                addedAt);
            c.isFavorite = true;
            c.score += 0.20 + TextMatchScore(normalizedQuery, targetId, displayName, listName + " " + note + " " + tags);
            c.subtitle = "Favorite in " + listName;
            if (thumbnailUrl.has_value() && !thumbnailUrl->empty() && c.thumbnailUrl.empty())
            {
                c.thumbnailUrl = *thumbnailUrl;
                c.thumbnailKind = IsThumbLocalUrl(*thumbnailUrl) ? "local-thumb" : "remote-cdn";
                c.thumbnailSource = IsThumbLocalUrl(*thumbnailUrl) ? "thumb.local" : "vrc-api";
                c.thumbnailVerified = true;
            }
            c.evidence.push_back(SearchEvidence(
                "favorite",
                "Favorite",
                "Saved in " + listName + (note.empty() ? "" : " with note"),
                "local_favorites:" + type + ":" + targetId + ":" + listName,
                addedAt,
                "verified",
                "local-only"));
        }
        if (rc != SQLITE_DONE)
        {
            return MakeError("db_step_failed");
        }
    }

    if (SearchTypeAllowed(request, "world"))
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
            const auto worldId = ColumnOptionalText(rawStmt, 0).value_or("");
            if (worldId.empty())
            {
                continue;
            }
            const auto visitCount = sqlite3_column_int(rawStmt, 1);
            const auto firstSeen = ColumnOptionalText(rawStmt, 2);
            const auto lastSeen = ColumnOptionalText(rawStmt, 3);
            const auto instanceId = ColumnOptionalText(rawStmt, 4).value_or("");
            const auto accessType = ColumnOptionalText(rawStmt, 5).value_or("");
            const auto region = ColumnOptionalText(rawStmt, 6).value_or("");
            const auto sourceId = fmt::format("world_visits:{}", sqlite3_column_int64(rawStmt, 7));

            auto& c = UpsertSearchCandidate(
                candidates,
                "world",
                worldId,
                worldId,
                "local.world_visit",
                "World visits",
                lastSeen);
            c.visitCount += visitCount;
            c.firstSeenAt = firstSeen;
            c.lastSeenAt = lastSeen;
            c.score += 0.12 + std::min(0.15, static_cast<double>(visitCount) * 0.03)
                + TextMatchScore(normalizedQuery, worldId, worldId, instanceId + " " + accessType + " " + region);
            c.subtitle = fmt::format("Visited {} time{}{}", visitCount, visitCount == 1 ? "" : "s",
                                     lastSeen.has_value() ? ", last " + *lastSeen : "");
            c.evidence.push_back(SearchEvidence(
                "world_visit",
                fmt::format("Visited {}x", visitCount),
                instanceId.empty() ? "World visit history" : "Latest instance " + instanceId,
                sourceId,
                lastSeen,
                "verified",
                "local-only"));
        }
        if (rc != SQLITE_DONE)
        {
            return MakeError("db_step_failed");
        }
    }

    if (SearchTypeAllowed(request, "user"))
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
            const auto userId = ColumnOptionalText(rawStmt, 0).value_or("");
            if (userId.empty())
            {
                continue;
            }
            const auto displayName = ColumnOptionalText(rawStmt, 1).value_or(userId);
            const auto encounterCount = sqlite3_column_int(rawStmt, 2);
            const auto firstSeen = ColumnOptionalText(rawStmt, 3);
            const auto lastSeen = ColumnOptionalText(rawStmt, 4);
            const auto worlds = ColumnOptionalText(rawStmt, 5).value_or("");

            auto& c = UpsertSearchCandidate(
                candidates,
                "user",
                userId,
                displayName,
                "local.player_encounter",
                "Player encounters",
                lastSeen);
            c.encounterCount += encounterCount;
            c.firstSeenAt = firstSeen;
            c.lastSeenAt = lastSeen;
            c.score += 0.12 + std::min(0.15, static_cast<double>(encounterCount) * 0.02)
                + TextMatchScore(normalizedQuery, userId, displayName, worlds);
            c.subtitle = fmt::format("Encountered {} time{}{}", encounterCount, encounterCount == 1 ? "" : "s",
                                     lastSeen.has_value() ? ", last " + *lastSeen : "");
            c.evidence.push_back(SearchEvidence(
                "player_encounter",
                fmt::format("Seen {}x", encounterCount),
                worlds.empty() ? "Local player encounter history" : "Seen in worlds " + worlds,
                "player_encounters:" + userId,
                lastSeen,
                "verified",
                "local-only"));
        }
        if (rc != SQLITE_DONE)
        {
            return MakeError("db_step_failed");
        }
    }

    if (SearchTypeAllowed(request, "timeline_event"))
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
            const auto rowId = sqlite3_column_int64(rawStmt, 0);
            const auto kind = ColumnOptionalText(rawStmt, 1).value_or("event");
            const auto userId = ColumnOptionalText(rawStmt, 2);
            const auto displayName = ColumnOptionalText(rawStmt, 3).value_or("Player event");
            const auto worldId = ColumnOptionalText(rawStmt, 4).value_or("");
            const auto instanceId = ColumnOptionalText(rawStmt, 5).value_or("");
            const auto occurredAt = ColumnOptionalText(rawStmt, 6);
            const auto resultId = userId.has_value() && !userId->empty()
                ? *userId
                : fmt::format("timeline:player_events:{}", rowId);
            const auto resultType = userId.has_value() && !userId->empty() ? "user" : "timeline_event";
            if (!SearchTypeAllowed(request, resultType))
            {
                continue;
            }

            auto& c = UpsertSearchCandidate(
                candidates,
                resultType,
                resultId,
                displayName,
                "local.player_event",
                "Player events",
                occurredAt);
            c.score += 0.06 + TextMatchScore(normalizedQuery, resultId, displayName, worldId + " " + instanceId + " " + kind);
            if (c.subtitle.empty())
            {
                c.subtitle = kind + (worldId.empty() ? "" : " in " + worldId);
            }
            c.evidence.push_back(SearchEvidence(
                kind == "left" ? "player_leave" : "player_join",
                kind == "left" ? "Left" : "Joined",
                displayName + " " + kind + (worldId.empty() ? "" : " in " + worldId),
                fmt::format("player_events:{}", rowId),
                occurredAt,
                "verified",
                "local-only"));
        }
        if (rc != SQLITE_DONE)
        {
            return MakeError("db_step_failed");
        }
    }

    if (SearchTypeAllowed(request, "avatar"))
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
            const auto avatarId = ColumnOptionalText(rawStmt, 0).value_or("");
            if (avatarId.empty())
            {
                continue;
            }
            const auto avatarName = ColumnOptionalText(rawStmt, 1).value_or(avatarId);
            const auto authorName = ColumnOptionalText(rawStmt, 2).value_or("");
            const auto firstSeenOn = ColumnOptionalText(rawStmt, 3).value_or("");
            const auto firstSeenAt = ColumnOptionalText(rawStmt, 4);
            const auto releaseStatus = ColumnOptionalText(rawStmt, 5).value_or("");
            const auto wearerUserId = ColumnOptionalText(rawStmt, 6).value_or("");
            const auto resolvedAvatarId = ColumnOptionalText(rawStmt, 7).value_or("");
            const auto resolvedThumb = ColumnOptionalText(rawStmt, 8).value_or("");
            const auto resolutionStatus = ColumnOptionalText(rawStmt, 9).value_or("");
            const auto resolvedAt = ColumnOptionalText(rawStmt, 10);

            auto& c = UpsertSearchCandidate(
                candidates,
                "avatar",
                avatarId,
                avatarName,
                "local.avatar_history",
                "Avatar history",
                firstSeenAt);
            c.firstSeenAt = firstSeenAt;
            c.lastSeenAt = firstSeenAt;
            c.score += 0.14 + TextMatchScore(
                normalizedQuery,
                avatarId,
                avatarName,
                authorName + " " + firstSeenOn + " " + wearerUserId + " " + releaseStatus);
            c.subtitle = firstSeenOn.empty()
                ? "Seen in local avatar history"
                : "Seen on " + firstSeenOn;

            if (resolutionStatus == "resolved" && resolvedAvatarId == avatarId && !resolvedThumb.empty() && c.thumbnailUrl.empty())
            {
                c.thumbnailUrl = resolvedThumb;
                c.thumbnailKind = IsThumbLocalUrl(resolvedThumb) ? "local-thumb" : "remote-cdn";
                c.thumbnailSource = IsThumbLocalUrl(resolvedThumb) ? "thumb.local" : "vrc-api";
                c.thumbnailVerified = true;
            }
            else if (resolutionStatus == "resolved" && !resolvedThumb.empty())
            {
                c.warnings.insert("thumbnail-reference-only");
            }

            c.evidence.push_back(SearchEvidence(
                "avatar_seen",
                "Seen avatar",
                firstSeenOn.empty()
                    ? "Log-derived avatar history"
                    : "Log-derived avatar row seen on " + firstSeenOn,
                "avatar_history:" + avatarId,
                firstSeenAt,
                "verified",
                resolvedAt.has_value() ? "local-cache" : "local-only"));
        }
        if (rc != SQLITE_DONE)
        {
            return MakeError("db_step_failed");
        }
    }

    std::vector<GlobalSearchCandidate> sorted;
    sorted.reserve(candidates.size());
    for (auto& [_, candidate] : candidates)
    {
        if (candidate.evidence.empty())
        {
            continue;
        }
        sorted.push_back(std::move(candidate));
    }

    std::sort(sorted.begin(), sorted.end(), [](const GlobalSearchCandidate& a, const GlobalSearchCandidate& b)
    {
        if (a.score != b.score)
        {
            return a.score > b.score;
        }
        if (a.updatedAt != b.updatedAt)
        {
            return a.updatedAt > b.updatedAt;
        }
        return a.displayName < b.displayName;
    });

    nlohmann::json items = nlohmann::json::array();
    const auto start = static_cast<std::size_t>(std::min<int>(offset, static_cast<int>(sorted.size())));
    const auto end = std::min(sorted.size(), start + static_cast<std::size_t>(limit));
    for (std::size_t i = start; i < end; ++i)
    {
        items.push_back(CandidateToJson(sorted[i]));
    }

    nlohmann::json diagnostics{
        {"localSources", nlohmann::json::array({"local_favorites", "world_visits", "player_events", "player_encounters", "avatar_history"})},
        {"remoteSources", nlohmann::json::array()},
        {"cacheHit", false},
        {"remoteSuppressedReason", "disabled"},
    };

    return nlohmann::json{
        {"query", rawQuery},
        {"normalizedQuery", normalizedQuery},
        {"mode", "local"},
        {"items", items},
        {"nextOffset", end < sorted.size() ? nlohmann::json(static_cast<int>(end)) : nlohmann::json(nullptr)},
        {"diagnostics", diagnostics},
    };
}

} // namespace vrcsm::core
