#include "Database.h"

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

namespace
{
    // Parse a friend_presence_events.occurred_at string into an absolute UTC time_t.
    // Three encodings are produced in the wild (see
    // docs/wave2-research/own-overlap-algorithm-design.md §2):
    //   - trailing 'Z'        → UTC wall-clock (frontend new Date().toISOString())
    //   - trailing '±HH:MM'   → offset wall-clock (subtract offset to reach UTC)
    //   - no designator       → already-local wall-clock (C++ nowIso fallback)
    std::optional<std::time_t> ParsePresenceInstant(const std::string& s)
    {
        if (s.size() < 19)
        {
            return std::nullopt;
        }
        int year = 0, mon = 0, day = 0, hour = 0, minute = 0, sec = 0;
        if (sscanf_s(s.c_str(), "%d-%d-%dT%d:%d:%d", &year, &mon, &day, &hour, &minute, &sec) != 6)
        {
            return std::nullopt;
        }

        std::tm tm{};
        tm.tm_year = year - 1900;
        tm.tm_mon = mon - 1;
        tm.tm_mday = day;
        tm.tm_hour = hour;
        tm.tm_min = minute;
        tm.tm_sec = sec;
        tm.tm_isdst = -1; // let mktime resolve DST for the naive-local path

        const bool isUtcZ = s.back() == 'Z' || s.back() == 'z';
        int offsetMinutes = 0;
        bool hasOffset = false;
        if (!isUtcZ)
        {
            const std::size_t tpos = s.find('T');
            if (tpos != std::string::npos)
            {
                for (std::size_t i = tpos + 1; i < s.size(); ++i)
                {
                    const char c = s[i];
                    if (c == '+' || c == '-')
                    {
                        int oh = 0, om = 0;
                        if (sscanf_s(s.c_str() + i + 1, "%d:%d", &oh, &om) >= 1)
                        {
                            offsetMinutes = oh * 60 + om;
                            if (c == '-')
                            {
                                offsetMinutes = -offsetMinutes;
                            }
                            hasOffset = true;
                        }
                        break;
                    }
                }
            }
        }

        if (isUtcZ)
        {
            return _mkgmtime(&tm);
        }
        if (hasOffset)
        {
            const std::time_t asUtc = _mkgmtime(&tm);
            if (asUtc == static_cast<std::time_t>(-1))
            {
                return std::nullopt;
            }
            return asUtc - static_cast<std::time_t>(offsetMinutes) * 60;
        }
        // Naive local wall-clock: mktime interprets tm as local time.
        return mktime(&tm);
    }
}

namespace
{
    // One reconstructed presence interval for a user inside a single
    // (world_id, instance_id) session: [start, end] in absolute seconds.
    struct PresenceInterval
    {
        std::time_t start = 0;
        std::time_t end = 0;
    };

    // Overlap in seconds between two intervals (0 if disjoint).
    std::time_t IntervalOverlap(const PresenceInterval& a, const PresenceInterval& b)
    {
        const std::time_t lo = std::max(a.start, b.start);
        const std::time_t hi = std::min(a.end, b.end);
        return hi > lo ? hi - lo : 0;
    }
}


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

    // Lower time bound. player_events.occurred_at is wall-clock ISO; we
    // filter loosely in SQL by lexical comparison (ISO sorts lexically)
    // and rely on ParsePresenceInstant for exact overlap math.
    const std::time_t nowT = std::time(nullptr);
    const std::time_t sinceT = nowT - static_cast<std::time_t>(since_days) * 86400;

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

    // Per-(world,instance) accumulation of each user's intervals.
    struct UserPresence
    {
        std::string display_name;
        std::vector<PresenceInterval> intervals;
        // Open "joined" awaiting a matching "left" within this session.
        std::optional<std::time_t> openStart;
    };

    // Edge accumulator keyed by ordered user pair.
    struct EdgeAccum
    {
        std::int64_t overlapCount = 0;
        std::time_t overlapSeconds = 0;
        std::time_t lastOverlap = 0;
        bool touchesCenter = false;
    };

    // Node accumulator keyed by user_id.
    struct NodeAccum
    {
        std::string display_name;
        std::int64_t sessions = 0;
        std::time_t totalSeconds = 0;
        std::time_t lastSeen = 0;
    };

    std::unordered_map<std::string, NodeAccum> nodes;
    std::map<std::pair<std::string, std::string>, EdgeAccum> edges;

    // Default interval length when a "left" is missing (crash / lost log):
    // cap an open session at this many seconds so a dropped left can't
    // stretch a presence to infinity and over-connect the graph.
    const std::time_t kMaxOpenSessionSec = 4 * 3600;

    std::string curWorld;
    std::string curInstance;
    // user_id -> presence within the current session.
    std::unordered_map<std::string, UserPresence> sessionUsers;

    auto flushSession = [&]()
    {
        if (sessionUsers.empty())
        {
            curWorld.clear();
            curInstance.clear();
            return;
        }

        // Close any still-open intervals with the capped fallback end.
        for (auto& [uid, up] : sessionUsers)
        {
            if (up.openStart.has_value())
            {
                up.intervals.push_back(
                    PresenceInterval{*up.openStart, *up.openStart + kMaxOpenSessionSec});
                up.openStart.reset();
            }
        }

        // Keep only users with at least one interval inside the window.
        // Build a flat list for pairwise comparison.
        std::vector<std::string> uids;
        uids.reserve(sessionUsers.size());
        for (auto& [uid, up] : sessionUsers)
        {
            // Drop intervals entirely before the time window.
            std::vector<PresenceInterval> kept;
            kept.reserve(up.intervals.size());
            for (const auto& iv : up.intervals)
            {
                if (iv.end >= sinceT)
                {
                    kept.push_back(iv);
                }
            }
            up.intervals = std::move(kept);
            if (!up.intervals.empty())
            {
                uids.push_back(uid);
            }
        }

        // Node-level rollup: one "session" credit per user present here,
        // plus their summed in-session seconds and latest end.
        for (const auto& uid : uids)
        {
            const auto& up = sessionUsers[uid];
            auto& node = nodes[uid];
            if (node.display_name.empty()) node.display_name = up.display_name;
            else node.display_name = up.display_name; // prefer most recent
            node.sessions += 1;
            for (const auto& iv : up.intervals)
            {
                node.totalSeconds += (iv.end - iv.start);
                node.lastSeen = std::max(node.lastSeen, iv.end);
            }
        }

        // Pairwise overlap → edges.
        for (std::size_t i = 0; i < uids.size(); ++i)
        {
            for (std::size_t j = i + 1; j < uids.size(); ++j)
            {
                const auto& a = sessionUsers[uids[i]];
                const auto& b = sessionUsers[uids[j]];
                std::time_t best = 0;
                std::time_t lastEnd = 0;
                for (const auto& ia : a.intervals)
                {
                    for (const auto& ib : b.intervals)
                    {
                        const std::time_t ov = IntervalOverlap(ia, ib);
                        if (ov > 0)
                        {
                            best += ov;
                            lastEnd = std::max(lastEnd, std::min(ia.end, ib.end));
                        }
                    }
                }
                if (best < min_overlap_sec || best == 0)
                {
                    continue;
                }
                // Order the pair deterministically.
                std::string s = uids[i];
                std::string t = uids[j];
                if (s > t) std::swap(s, t);
                auto& edge = edges[{s, t}];
                edge.overlapCount += 1;
                edge.overlapSeconds += best;
                edge.lastOverlap = std::max(edge.lastOverlap, lastEnd);
                if (s == center_user_id || t == center_user_id)
                {
                    edge.touchesCenter = true;
                }
            }
        }

        sessionUsers.clear();
        curWorld.clear();
        curInstance.clear();
    };

    int rc = SQLITE_OK;
    while ((rc = sqlite3_step(rawStmt)) == SQLITE_ROW)
    {
        const std::string userId = ColumnTextOrNull(rawStmt, 0).is_string()
            ? ColumnTextOrNull(rawStmt, 0).get<std::string>() : std::string();
        const auto dnJson = ColumnTextOrNull(rawStmt, 1);
        const std::string displayName = dnJson.is_string() ? dnJson.get<std::string>() : std::string();
        const auto wJson = ColumnTextOrNull(rawStmt, 2);
        const std::string worldId = wJson.is_string() ? wJson.get<std::string>() : std::string();
        const auto iJson = ColumnTextOrNull(rawStmt, 3);
        const std::string instanceId = iJson.is_string() ? iJson.get<std::string>() : std::string();
        const auto kJson = ColumnTextOrNull(rawStmt, 4);
        const std::string kind = kJson.is_string() ? kJson.get<std::string>() : std::string();
        const auto tJson = ColumnTextOrNull(rawStmt, 5);
        const std::string occurredAt = tJson.is_string() ? tJson.get<std::string>() : std::string();

        if (userId.empty() || worldId.empty() || instanceId.empty())
        {
            continue;
        }

        // Boundary between sessions = change in (world,instance). Rows are
        // ordered by (world,instance,time), so a key change flushes.
        if (worldId != curWorld || instanceId != curInstance)
        {
            flushSession();
            curWorld = worldId;
            curInstance = instanceId;
        }

        const auto instant = ParsePresenceInstant(occurredAt);
        if (!instant.has_value())
        {
            continue;
        }

        auto& up = sessionUsers[userId];
        if (up.display_name.empty() || !displayName.empty())
        {
            up.display_name = displayName.empty() ? up.display_name : displayName;
        }

        if (kind == "joined")
        {
            // A second "joined" with no intervening "left" closes the prior
            // open interval with the capped fallback, then opens a new one.
            if (up.openStart.has_value())
            {
                const std::time_t cappedEnd =
                    std::min(*instant, *up.openStart + kMaxOpenSessionSec);
                up.intervals.push_back(PresenceInterval{*up.openStart, cappedEnd});
            }
            up.openStart = *instant;
        }
        else if (kind == "left")
        {
            if (up.openStart.has_value())
            {
                std::time_t end = *instant;
                if (end < *up.openStart) end = *up.openStart; // clock skew guard
                if (end - *up.openStart > kMaxOpenSessionSec)
                {
                    end = *up.openStart + kMaxOpenSessionSec;
                }
                up.intervals.push_back(PresenceInterval{*up.openStart, end});
                up.openStart.reset();
            }
            // A "left" with no matching "joined" is dropped (we never saw
            // them arrive — likely a session that began before our window).
        }
    }
    flushSession();

    if (rc != SQLITE_DONE)
    {
        return MakeError("db_step_failed");
    }

    // Materialize JSON. Only keep nodes that are the center or are linked
    // to it by at least one edge path of length 1 OR appear in any edge —
    // we expose the full co-presence graph (center + its instance-mates +
    // the mates' mutual co-presence) which is exactly the ego-network.
    nlohmann::json nodesJson = nlohmann::json::array();
    for (const auto& [uid, node] : nodes)
    {
        nlohmann::json n = nlohmann::json::object();
        n["user_id"] = uid;
        n["display_name"] = node.display_name;
        n["sessions"] = node.sessions;
        n["total_seconds"] = static_cast<std::int64_t>(node.totalSeconds);
        n["last_seen"] = static_cast<std::int64_t>(node.lastSeen);
        n["is_center"] = (uid == center_user_id);
        nodesJson.push_back(std::move(n));
    }

    nlohmann::json edgesJson = nlohmann::json::array();
    for (const auto& [pair, edge] : edges)
    {
        nlohmann::json e = nlohmann::json::object();
        e["source"] = pair.first;
        e["target"] = pair.second;
        // Honest labeling: edges that include the center are confirmed
        // co-presence (we logged it from our own instance); edges between
        // two others are co-presence inference only.
        e["kind"] = edge.touchesCenter ? "confirmed" : "co_presence";
        e["overlap_count"] = edge.overlapCount;
        e["overlap_seconds"] = static_cast<std::int64_t>(edge.overlapSeconds);
        e["last_overlap"] = static_cast<std::int64_t>(edge.lastOverlap);
        edgesJson.push_back(std::move(e));
    }

    nlohmann::json out = nlohmann::json::object();
    out["center"] = center_user_id;
    out["since_days"] = since_days;
    out["min_overlap_sec"] = min_overlap_sec;
    out["nodes"] = std::move(nodesJson);
    out["edges"] = std::move(edgesJson);
    return out;
}


Result<nlohmann::json> Database::PredictFriendOnlineWindows(
    const std::string& user_id,
    int top_n,
    int half_life_weeks)
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

    // Tunables (kCamelCase per coding standards).
    constexpr double kMaxSessionHours = 12.0;     // cap a missed-offline session
    constexpr double kPulseMinutes = 5.0;         // liveness pulse for orphan location/status
    constexpr int kMinObservationDays = 7;        // sufficiency gate (distinct days)
    constexpr double kMinOnlineMinutes = 120.0;   // sufficiency gate (total minutes)
    constexpr int kMinBucketObservations = 2;     // a slot needs ≥2 distinct days to rank
    constexpr double kWindowJoinThreshold = 0.6;  // merge adjacent buckets ≥0.6 of peak
    const double halfLifeWeeks = half_life_weeks > 0 ? static_cast<double>(half_life_weeks) : 4.0;
    const int topN = top_n > 0 ? top_n : 3;

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

    struct Row
    {
        std::string event_type;
        std::time_t instant;
    };
    std::vector<Row> rows;
    int rc = SQLITE_OK;
    while ((rc = sqlite3_step(rawStmt)) == SQLITE_ROW)
    {
        const char* etRaw = reinterpret_cast<const char*>(sqlite3_column_text(rawStmt, 0));
        const char* atRaw = reinterpret_cast<const char*>(sqlite3_column_text(rawStmt, 1));
        if (etRaw == nullptr || atRaw == nullptr)
        {
            continue;
        }
        const auto inst = ParsePresenceInstant(atRaw);
        if (!inst)
        {
            continue;
        }
        rows.push_back(Row{etRaw, *inst});
    }
    if (rc != SQLITE_DONE)
    {
        return MakeError("db_step_failed");
    }

    const std::time_t nowTt = std::time(nullptr);

    // 168 hour-of-week buckets: index = localDayOfWeek(0=Sun)*24 + localHour.
    std::array<double, 168> weighted{};
    std::array<std::set<int>, 168> bucketDays; // distinct local calendar days per bucket
    std::set<int> observationDays;             // distinct local calendar days overall
    double totalMinutes = 0.0;

    // Attribute an online interval [startTt, endTt) across local hour buckets,
    // weighting each minute by exponential recency decay on the session start.
    auto attribute = [&](std::time_t startTt, std::time_t endTt)
    {
        if (endTt <= startTt)
        {
            return;
        }
        const double maxSeconds = kMaxSessionHours * 3600.0;
        if (static_cast<double>(endTt - startTt) > maxSeconds)
        {
            endTt = startTt + static_cast<std::time_t>(maxSeconds);
        }
        const double ageWeeks = static_cast<double>(nowTt - startTt) / (7.0 * 86400.0);
        const double weight = std::pow(0.5, (ageWeeks > 0 ? ageWeeks : 0.0) / halfLifeWeeks);

        std::time_t t = startTt;
        while (t < endTt)
        {
            std::tm lt{};
            localtime_s(&lt, &t);
            const int secsIntoHour = lt.tm_min * 60 + lt.tm_sec;
            const std::time_t nextHour = t + (3600 - secsIntoHour);
            const std::time_t segEnd = nextHour < endTt ? nextHour : endTt;
            const double minutes = static_cast<double>(segEnd - t) / 60.0;
            const int bucket = lt.tm_wday * 24 + lt.tm_hour;
            const int dayKey = (lt.tm_year + 1900) * 1000 + lt.tm_yday;
            if (bucket >= 0 && bucket < 168)
            {
                weighted[bucket] += minutes * weight;
                bucketDays[bucket].insert(dayKey);
            }
            observationDays.insert(dayKey);
            totalMinutes += minutes;
            t = segEnd;
        }
    };

    // Walk the ordered stream applying the session-bracketing rules (§1).
    bool haveOpen = false;
    std::time_t openStart = 0;
    for (const auto& r : rows)
    {
        if (r.event_type == "online")
        {
            if (haveOpen)
            {
                attribute(openStart, r.instant); // duplicate online re-affirms; close prior
            }
            openStart = r.instant;
            haveOpen = true;
        }
        else if (r.event_type == "offline")
        {
            if (haveOpen)
            {
                attribute(openStart, r.instant);
                haveOpen = false;
            }
            // dangling offline (no preceding online): nothing to attribute.
        }
        else
        {
            // location / status: liveness only.
            if (!haveOpen)
            {
                attribute(r.instant, r.instant + static_cast<std::time_t>(kPulseMinutes * 60.0));
            }
            // within an open online interval it is already covered.
        }
    }
    if (haveOpen)
    {
        // Dangling open online: cap at now (attribute() also caps at kMaxSessionHours).
        attribute(openStart, nowTt);
    }

    nlohmann::json out = nlohmann::json::object();
    out["user_id"] = user_id;
    out["half_life_weeks"] = static_cast<int>(halfLifeWeeks);
    out["total_online_minutes"] = totalMinutes;
    out["observation_days"] = static_cast<int>(observationDays.size());

    // local offset (minutes) currently in effect, for display only.
    {
        TIME_ZONE_INFORMATION tz{};
        GetTimeZoneInformation(&tz);
        out["timezone_offset_minutes"] = -tz.Bias;
    }

    if (static_cast<int>(observationDays.size()) < kMinObservationDays
        || totalMinutes < kMinOnlineMinutes)
    {
        out["status"] = "insufficient_data";
        out["heatmap"] = nlohmann::json::array();
        out["top_windows"] = nlohmann::json::array();
        return out;
    }

    const double peak = *std::max_element(weighted.begin(), weighted.end());
    nlohmann::json heatmap = nlohmann::json::array();
    for (double w : weighted)
    {
        heatmap.push_back(peak > 0.0 ? w / peak : 0.0);
    }
    out["status"] = "ok";
    out["heatmap"] = std::move(heatmap);

    // Merge adjacent same-day hour buckets that clear the join threshold and have
    // enough distinct-day observations, then rank merged windows by summed weight.
    struct Window
    {
        int day;
        int startHour;
        int endHour; // exclusive
        double score;
        int observationDays;
    };
    std::vector<Window> windows;
    for (int d = 0; d < 7; ++d)
    {
        int h = 0;
        while (h < 24)
        {
            const int idx = d * 24 + h;
            const double norm = peak > 0.0 ? weighted[idx] / peak : 0.0;
            const bool eligible = norm >= kWindowJoinThreshold
                && static_cast<int>(bucketDays[idx].size()) >= kMinBucketObservations;
            if (!eligible)
            {
                ++h;
                continue;
            }
            Window win{d, h, h, 0.0, 0};
            while (h < 24)
            {
                const int j = d * 24 + h;
                const double jn = peak > 0.0 ? weighted[j] / peak : 0.0;
                const bool jEligible = jn >= kWindowJoinThreshold
                    && static_cast<int>(bucketDays[j].size()) >= kMinBucketObservations;
                if (!jEligible)
                {
                    break;
                }
                win.score += weighted[j];
                win.observationDays = std::max(win.observationDays,
                    static_cast<int>(bucketDays[j].size()));
                ++h;
            }
            win.endHour = h;
            windows.push_back(win);
        }
    }

    std::sort(windows.begin(), windows.end(),
        [](const Window& a, const Window& b) { return a.score > b.score; });

    const double topScore = windows.empty() ? 0.0 : windows.front().score;
    nlohmann::json topWindows = nlohmann::json::array();
    for (int i = 0; i < topN && i < static_cast<int>(windows.size()); ++i)
    {
        const Window& w = windows[static_cast<std::size_t>(i)];
        nlohmann::json jw = nlohmann::json::object();
        jw["day_of_week"] = w.day;
        jw["start_hour"] = w.startHour;
        jw["end_hour"] = w.endHour;
        jw["score"] = topScore > 0.0 ? w.score / topScore : 0.0;
        jw["observation_days"] = w.observationDays;
        jw["label_key"] = "predictor.window";
        topWindows.push_back(std::move(jw));
    }
    out["top_windows"] = std::move(topWindows);

    return out;
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
