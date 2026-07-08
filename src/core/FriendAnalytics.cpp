#include "FriendAnalytics.h"

#include <fmt/format.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <map>
#include <set>
#include <string_view>
#include <unordered_map>
#include <utility>

namespace vrcsm::core::analytics
{

// ─── shared helpers ─────────────────────────────────────────────

std::optional<std::time_t> parsePresenceInstant(const std::string& s)
{
    if (s.size() < 19)
    {
        return std::nullopt;
    }
    int year = 0, mon = 0, day = 0, hour = 0, minute = 0, sec = 0;
    // Two timestamp shapes reach this function:
    //   ISO  "YYYY-MM-DDTHH:MM:SS" (friend_log, and any RFC3339 source), and
    //   DOT  "YYYY.MM.DD HH:MM:SS" (VRChat log-derived player_events/log_events/
    //        world_visits — the majority of rows).
    // The old parser only accepted the ISO shape, so every DOT row failed and
    // co-presence analytics silently dropped all real data. Accept both: the
    // digits sit at identical offsets, only the separators differ.
    const bool parsedIso =
        sscanf_s(s.c_str(), "%d-%d-%dT%d:%d:%d", &year, &mon, &day, &hour, &minute, &sec) == 6;
    if (!parsedIso)
    {
        year = mon = day = hour = minute = sec = 0;
        const bool parsedDot =
            sscanf_s(s.c_str(), "%d.%d.%d %d:%d:%d", &year, &mon, &day, &hour, &minute, &sec) == 6;
        if (!parsedDot)
        {
            return std::nullopt;
        }
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

std::time_t intervalOverlap(const PresenceInterval& a, const PresenceInterval& b)
{
    const std::time_t lo = std::max(a.start, b.start);
    const std::time_t hi = std::min(a.end, b.end);
    return hi > lo ? hi - lo : 0;
}

// Private copies of the tiny ASCII helpers used by GlobalSearch. These are
// duplicated from Database_internal.h's detail:: namespace deliberately —
// pulling that header in would re-couple this module to Database.h + sqlite3.
namespace
{
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
} // namespace

std::string normalizeSearchQuery(const std::string& raw)
{
    return LowerAscii(CollapseWhitespaceAscii(raw));
}

// ─── CoPresenceEgoNetwork ───────────────────────────────────────

nlohmann::json coPresenceEgoNetwork(const std::vector<PresenceEventRow>& rows,
                                    const std::string& center_user_id,
                                    int since_days,
                                    int min_overlap_sec,
                                    std::time_t now)
{
    // Lower time bound. player_events.occurred_at is wall-clock ISO; we
    // filter loosely in SQL by lexical comparison (ISO sorts lexically)
    // and rely on parsePresenceInstant for exact overlap math.
    const std::time_t sinceT = now - static_cast<std::time_t>(since_days) * 86400;

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
                        const std::time_t ov = intervalOverlap(ia, ib);
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

    for (const auto& row : rows)
    {
        const std::string& userId = row.user_id;
        const std::string& displayName = row.display_name;
        const std::string& worldId = row.world_id;
        const std::string& instanceId = row.instance_id;
        const std::string& kind = row.kind;
        const std::string& occurredAt = row.occurred_at;

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

        const auto instant = parsePresenceInstant(occurredAt);
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

// ─── PredictFriendOnlineWindows ─────────────────────────────────

nlohmann::json predictFriendOnlineWindows(const std::vector<PredictPresenceRow>& inputRows,
                                          const std::string& user_id,
                                          int top_n,
                                          int half_life_weeks,
                                          std::time_t now,
                                          int tz_offset_minutes)
{
    // Tunables (kCamelCase per coding standards).
    constexpr double kMaxSessionHours = 12.0;     // cap a missed-offline session
    constexpr double kPulseMinutes = 5.0;         // liveness pulse for orphan location/status
    constexpr int kMinObservationDays = 7;        // sufficiency gate (distinct days)
    constexpr double kMinOnlineMinutes = 120.0;   // sufficiency gate (total minutes)
    constexpr int kMinBucketObservations = 2;     // a slot needs ≥2 distinct days to rank
    constexpr double kWindowJoinThreshold = 0.6;  // merge adjacent buckets ≥0.6 of peak
    const double halfLifeWeeks = half_life_weeks > 0 ? static_cast<double>(half_life_weeks) : 4.0;
    const int topN = top_n > 0 ? top_n : 3;

    struct Row
    {
        std::string event_type;
        std::time_t instant;
    };
    std::vector<Row> rows;
    rows.reserve(inputRows.size());
    for (const auto& r : inputRows)
    {
        const auto inst = parsePresenceInstant(r.occurred_at);
        if (!inst)
        {
            continue;
        }
        rows.push_back(Row{r.event_type, *inst});
    }

    const std::time_t nowTt = now;

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
    out["timezone_offset_minutes"] = tz_offset_minutes;

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

// ─── GlobalSearch ───────────────────────────────────────────────

namespace
{
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

nlohmann::json globalSearch(const GlobalSearchInput& rows,
                            const nlohmann::json& request,
                            const std::string& rawQuery,
                            const std::string& normalizedQuery,
                            int limit,
                            int offset)
{
    SearchCandidateMap candidates;

    if (SearchTypeAllowed(request, "world", true)
        || SearchTypeAllowed(request, "avatar", true)
        || SearchTypeAllowed(request, "user", true))
    {
        for (const auto& row : rows.favorites)
        {
            const auto& type = row.type;
            if (!SearchTypeAllowed(request, type, true))
            {
                continue;
            }
            const auto& targetId = row.target_id;
            if (targetId.empty())
            {
                continue;
            }
            const auto& listName = row.list_name;
            const auto& displayName = row.display_name;
            const auto& thumbnailUrl = row.thumbnail_url;
            const auto& addedAt = row.added_at;
            const auto& note = row.note;
            const auto& tags = row.tags;

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
    }

    if (SearchTypeAllowed(request, "world"))
    {
        for (const auto& row : rows.worldVisits)
        {
            const auto& worldId = row.world_id;
            if (worldId.empty())
            {
                continue;
            }
            const auto visitCount = row.visit_count;
            const auto& firstSeen = row.first_seen;
            const auto& lastSeen = row.last_seen;
            const auto& instanceId = row.instance_id;
            const auto& accessType = row.access_type;
            const auto& region = row.region;
            const auto sourceId = fmt::format("world_visits:{}", row.source_row_id);

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
    }

    if (SearchTypeAllowed(request, "user"))
    {
        for (const auto& row : rows.userEncounters)
        {
            const auto& userId = row.user_id;
            if (userId.empty())
            {
                continue;
            }
            const auto& displayName = row.display_name;
            const auto encounterCount = row.encounter_count;
            const auto& firstSeen = row.first_seen;
            const auto& lastSeen = row.last_seen;
            const auto& worlds = row.worlds;

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
    }

    if (SearchTypeAllowed(request, "timeline_event"))
    {
        for (const auto& row : rows.timelineEvents)
        {
            const auto rowId = row.row_id;
            const auto& kind = row.kind;
            const auto& userId = row.user_id;
            const auto& displayName = row.display_name;
            const auto& worldId = row.world_id;
            const auto& instanceId = row.instance_id;
            const auto& occurredAt = row.occurred_at;
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
    }

    if (SearchTypeAllowed(request, "avatar"))
    {
        for (const auto& row : rows.avatars)
        {
            const auto& avatarId = row.avatar_id;
            if (avatarId.empty())
            {
                continue;
            }
            const auto& avatarName = row.avatar_name;
            const auto& authorName = row.author_name;
            const auto& firstSeenOn = row.first_seen_on;
            const auto& firstSeenAt = row.first_seen_at;
            const auto& releaseStatus = row.release_status;
            const auto& wearerUserId = row.wearer_user_id;
            const auto& resolvedAvatarId = row.resolved_avatar_id;
            const auto& resolvedThumb = row.resolved_thumb;
            const auto& resolutionStatus = row.resolution_status;
            const auto& resolvedAt = row.resolved_at;

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

} // namespace vrcsm::core::analytics
