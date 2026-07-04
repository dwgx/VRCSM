#pragma once

// Platform-agnostic, sqlite-free analytics compute layer extracted from the
// Database god-object. The Database_*.cpp methods run the SQL under m_mutex,
// fill the row structs below, release the lock, then hand the rows to the
// free functions here for pure in-memory compute + JSON assembly.
//
// This header MUST NOT include Database.h, sqlite3.h, or <Windows.h> — that
// decoupling is the whole point. Only <string>/<vector>/<optional>/<ctime>/
// <cstdint> + nlohmann/json are permitted.

#include <cstdint>
#include <ctime>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace vrcsm::core::analytics
{

// ─── shared helpers ─────────────────────────────────────────────

// Parse a presence occurred_at string into an absolute UTC time_t. Handles
// trailing 'Z' (UTC), '±HH:MM' (offset), and no-designator (naive-local).
std::optional<std::time_t> parsePresenceInstant(const std::string& s);

// One reconstructed presence interval [start, end] in absolute seconds.
struct PresenceInterval
{
    std::time_t start = 0;
    std::time_t end = 0;
};

// Overlap in seconds between two intervals (0 if disjoint).
std::time_t intervalOverlap(const PresenceInterval& a, const PresenceInterval& b);

// Normalize a raw search query: collapse ASCII whitespace then lowercase.
std::string normalizeSearchQuery(const std::string& raw);

// ─── CoPresenceEgoNetwork ───────────────────────────────────────

// Raw player_events row (cols 0-5 of the co-presence SELECT). occurred_at is
// the raw ISO string; the compute parses it via parsePresenceInstant. Rows
// MUST be pre-sorted by (world_id, instance_id, occurred_at ASC) — the
// session grouping depends on that ordering.
struct PresenceEventRow
{
    std::string user_id;
    std::string display_name;
    std::string world_id;
    std::string instance_id;
    std::string kind;
    std::string occurred_at;
};

// since_days / min_overlap_sec are passed ALREADY CLAMPED by the caller.
// `now` is injected so sinceT is deterministic. Compute cannot fail.
nlohmann::json coPresenceEgoNetwork(const std::vector<PresenceEventRow>& rows,
                                    const std::string& center_user_id,
                                    int since_days,
                                    int min_overlap_sec,
                                    std::time_t now);

// ─── PredictFriendOnlineWindows ─────────────────────────────────

// Raw friend_presence_events row (event_type, occurred_at). occurred_at is
// the raw ISO string parsed by the compute; rows MUST be pre-sorted by
// occurred_at ASC.
struct PredictPresenceRow
{
    std::string event_type;
    std::string occurred_at;
};

// top_n / half_life_weeks default inside (3 / 4) to keep them entangled with
// the algorithm constants. `now` is injected; tz_offset_minutes replaces the
// in-body GetTimeZoneInformation() so this stays platform-free.
nlohmann::json predictFriendOnlineWindows(const std::vector<PredictPresenceRow>& rows,
                                          const std::string& user_id,
                                          int top_n,
                                          int half_life_weeks,
                                          std::time_t now,
                                          int tz_offset_minutes);

// ─── GlobalSearch ───────────────────────────────────────────────

struct FavoriteRow
{
    std::string type;
    std::string target_id;
    std::string list_name;
    std::string display_name;
    std::optional<std::string> thumbnail_url;
    std::optional<std::string> added_at;
    std::string note;
    std::string tags;
};

struct WorldVisitRow
{
    std::string world_id;
    int visit_count = 0;
    std::optional<std::string> first_seen;
    std::optional<std::string> last_seen;
    std::string instance_id;
    std::string access_type;
    std::string region;
    std::int64_t source_row_id = 0;
};

struct UserEncounterRow
{
    std::string user_id;
    std::string display_name;
    int encounter_count = 0;
    std::optional<std::string> first_seen;
    std::optional<std::string> last_seen;
    std::string worlds;
};

struct TimelineEventRow
{
    std::int64_t row_id = 0;
    std::string kind;
    std::optional<std::string> user_id;
    std::string display_name;
    std::string world_id;
    std::string instance_id;
    std::optional<std::string> occurred_at;
};

struct AvatarHistoryRow
{
    std::string avatar_id;
    std::string avatar_name;
    std::string author_name;
    std::string first_seen_on;
    std::optional<std::string> first_seen_at;
    std::string release_status;
    std::string wearer_user_id;
    std::string resolved_avatar_id;
    std::string resolved_thumb;
    std::string resolution_status;
    std::optional<std::string> resolved_at;
};

// All five fetched vectors bundled so one arg carries the whole fetch result.
struct GlobalSearchInput
{
    std::vector<FavoriteRow> favorites;
    std::vector<WorldVisitRow> worldVisits;
    std::vector<UserEncounterRow> userEncounters;
    std::vector<TimelineEventRow> timelineEvents;
    std::vector<AvatarHistoryRow> avatars;
};

// `request` is still needed for per-row SearchTypeAllowed re-checks. limit is
// already clamped to [1,50], offset >= 0. Returns the full
// {query, normalizedQuery, mode, items, nextOffset, diagnostics} envelope.
nlohmann::json globalSearch(const GlobalSearchInput& rows,
                            const nlohmann::json& request,
                            const std::string& rawQuery,
                            const std::string& normalizedQuery,
                            int limit,
                            int offset);

} // namespace vrcsm::core::analytics
