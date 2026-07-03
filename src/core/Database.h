#pragma once

#include <cstdint>
#include <filesystem>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "Common.h"

// Forward-declare the sqlite3 handle so this header stays free of
// sqlite3.h (clients don't need to drag it in).
struct sqlite3;
struct sqlite3_stmt;

namespace vrcsm::core
{

// Single persistent SQLite store at
// `%LocalAppData%\VRCSM\vrcsm.db`, opened once at process start by
// IpcBridge and torn down on shutdown. The schema is created lazily
// on `Open()` via `CREATE TABLE IF NOT EXISTS`; `PRAGMA user_version`
// bookkeeping covers future migrations without pulling in a full
// migration framework.
//
// Every write path (log-event ingest, friend-snapshot diff, favorites
// CRUD) funnels through this one object. All public methods are
// thread-safe: a single connection serialised behind `m_mutex` is
// sufficient for this app's write volume (tailed log events cap out
// at a few hundred per minute even in a busy instance).
//
// No exceptions: every fallible method returns `Result<T>` from
// Common.h. Errors carry the sqlite error message in `Error.message`
// and a stable string code ("db_open_failed", "db_prepare_failed",
// "db_exec_failed", "db_bind_failed", "db_step_failed").
class Database
{
public:
    static Database& Instance();

    // Open the database at the given file path. Creates parent dirs
    // if needed. Idempotent — calling Open twice with the same path
    // is a no-op; calling with a different path is an error (we
    // don't support hot-swapping the store at runtime).
    Result<std::monostate> Open(const std::filesystem::path& dbPath);

    // Close the connection. Safe to call during shutdown even if
    // Open() was never called.
    void Close();

    bool IsOpen() const noexcept;

    // Resolve the default store path (`%LocalAppData%\VRCSM\vrcsm.db`).
    // Host normally passes this into Open() at boot.
    static std::filesystem::path DefaultDbPath();

    // ─── world_visits ────────────────────────────────────────────
    //
    // Called from IpcBridge's log-tailer callback on every
    // `WorldSwitchEvent`. Returns the new row id.
    struct WorldVisitInsert
    {
        std::string world_id;
        std::string instance_id;
        std::optional<std::string> access_type;
        std::optional<std::string> owner_id;
        std::optional<std::string> region;
        std::string joined_at;  // ISO8601
    };
    Result<std::int64_t> InsertWorldVisit(const WorldVisitInsert& v);

    // Mark the most recent still-open visit (same world+instance) as
    // left at `left_at`. No-op if no matching row.
    Result<std::monostate> MarkVisitLeft(const std::string& world_id,
                                         const std::string& instance_id,
                                         const std::string& left_at);

    // Mark every still-open visit as closed at `left_at`. Used as a
    // safety net when VRChat exits or when the host recovers from
    // previously interrupted tracking state.
    Result<std::monostate> CloseOpenWorldVisits(const std::string& left_at);

    // Recent visits ordered by joined_at desc, newest first.
    Result<nlohmann::json> RecentWorldVisits(int limit, int offset);

    // ─── player_events + player_encounters ───────────────────────

    struct PlayerEventInsert
    {
        std::string kind;            // "joined" | "left"
        std::optional<std::string> user_id;
        std::string display_name;
        std::optional<std::string> world_id;
        std::optional<std::string> instance_id;
        std::string occurred_at;
    };
    // Writes into player_events *and* upserts player_encounters in
    // one transaction (only when user_id + world_id are set — events
    // with no user_id have no canonical identity to aggregate).
    Result<std::monostate> RecordPlayerEvent(const PlayerEventInsert& e);

    // Chronological player events (latest first).
    Result<nlohmann::json> RecentPlayerEvents(
        int limit,
        int offset,
        std::optional<std::string> world_id = std::nullopt,
        std::optional<std::string> instance_id = std::nullopt,
        std::optional<std::string> occurred_after = std::nullopt,
        std::optional<std::string> occurred_before = std::nullopt);

    // All aggregated encounters for a given user (across worlds).
    Result<nlohmann::json> EncountersForUser(const std::string& user_id);

    // ─── Co-presence ego-network (Track 4 relationship graph) ───────
    //
    // Builds a co-presence graph centered on `center_user_id` (normally
    // the local user) from raw player_events. We reconstruct per-user
    // presence intervals within each (world_id, instance_id) session and
    // emit an edge between two users when their intervals overlap by at
    // least `min_overlap_sec`. Edges touching the center are "confirmed"
    // co-presence (we logged them entering our own instance); edges
    // between two non-center users are "co_presence" only — never a
    // confirmed-friendship claim (VRChat exposes no FoF data).
    //
    // Returns { center, nodes:[{user_id, display_name, sessions,
    //   total_seconds, last_seen}], edges:[{source, target, kind,
    //   overlap_count, overlap_seconds, last_overlap}] }.
    Result<nlohmann::json> CoPresenceEgoNetwork(
        const std::string& center_user_id,
        int since_days = 90,
        int min_overlap_sec = 60);

    // ─── log_events (Track L: video/portal/moderation/sticker) ──────

    struct LogEventInsert
    {
        std::string kind;            // "videoPlay" | "portalSpawn" | "voteKick" | "joinBlocked" | "stickerSpawn"
        std::optional<std::string> user_id;
        std::optional<std::string> display_name;
        std::optional<std::string> world_id;
        std::optional<std::string> instance_id;
        std::optional<std::string> detail;   // source-specific payload (url / reason / inv_…)
        std::string occurred_at;
    };
    // Append-only. Backs the 'log_event' branch of the unified feed.
    Result<std::monostate> RecordLogEvent(const LogEventInsert& e);

    // ─── notifications (schema v15) ───────────────────────────────
    // Account-scoped mirror of the VRChat notification inbox (friend
    // requests / invites / messages). INSERT OR IGNORE on the unique
    // (account_user_id, notification_id) key so re-seeding the inbox is
    // idempotent. The unified feed uses the generic log_event row for
    // notifications; this table backs the dedicated inbox view.
    struct NotificationInsert
    {
        std::string account_user_id;
        std::string notification_id;             // not_xxx
        std::string type;                        // friendRequest/invite/...
        std::optional<std::string> sender_id;
        std::optional<std::string> sender_name;
        std::optional<std::string> detail;       // raw type/message payload
        bool seen = false;
        std::string occurred_at;
    };
    Result<std::monostate> RecordNotification(const NotificationInsert& n);

    // ─── sessions (schema v15) ────────────────────────────────────
    // One row per VRChat run, used by session segmentation (mode/hmd,
    // graceful-quit detection). RecordSessionStart opens a row and returns
    // its rowid; RecordSessionMode patches the open session's mode/hmd;
    // RecordSessionEnd closes it (ended_at + closed_gracefully).
    struct SessionStartInsert
    {
        std::optional<std::string> account_user_id;
        std::string started_at;
        std::optional<std::string> mode;         // vr | desktop
        std::optional<std::string> hmd_model;
        std::optional<std::string> log_file;
    };
    Result<std::int64_t> RecordSessionStart(const SessionStartInsert& s);
    Result<std::monostate> RecordSessionMode(std::int64_t session_id,
                                             const std::optional<std::string>& mode,
                                             const std::optional<std::string>& hmd_model);
    Result<std::monostate> RecordSessionEnd(std::int64_t session_id,
                                            const std::string& ended_at,
                                            bool closed_gracefully);

    // ─── online entity caches (schema v16) ────────────────────────
    // Thin account-scoped REST-seed mirrors. NOT sources of truth — safe
    // to drop/rebuild, never surfaced in the unified feed. Each Upsert is
    // INSERT OR REPLACE on the composite primary key.
    struct OwnedAvatarUpsert
    {
        std::string account_user_id;
        std::string avatar_id;
        std::optional<std::string> name;
        std::optional<std::string> description;
        std::optional<std::string> image_url;
        std::optional<std::string> release_status;
        std::optional<int> version;
        std::optional<std::string> updated_at;
    };
    Result<std::monostate> UpsertOwnedAvatar(const OwnedAvatarUpsert& a);

    // ─── avatar_history ──────────────────────────────────────────

    struct AvatarSeenInsert
    {
        std::string avatar_id;
        std::optional<std::string> release_status;
        std::optional<std::string> avatar_name;
        std::optional<std::string> author_name;
        std::optional<std::string> first_seen_on;       // wearer display name
        std::optional<std::string> first_seen_user_id;  // wearer usr_xxx — set when pipeline knows it
        std::string first_seen_at;
    };
    struct AvatarResolveUpdate
    {
        std::string avatar_id;
        std::optional<std::string> resolved_avatar_id;
        std::optional<std::string> resolved_thumbnail_url;
        std::optional<std::string> resolved_image_url;
        std::optional<std::string> resolution_source;
        std::string resolution_status;
        std::string resolved_at;
    };
    // INSERT OR IGNORE — only records the first time each avatar_id
    // is seen. Matches antigravity's spec for the history table.
    Result<std::monostate> RecordAvatarSeen(const AvatarSeenInsert& a);
    Result<std::monostate> UpdateAvatarResolution(const AvatarResolveUpdate& u);

    Result<nlohmann::json> RecentAvatarHistory(int limit, int offset);
    Result<std::int64_t> AvatarHistoryCount();

    // ─── avatar_benchmark (persisted parameter-count snapshots) ──────
    // Survives VRChat evicting the live local-avatar cache, so the benchmark
    // page can show previously measured avatars. UPSERT on avatar_id.
    struct AvatarBenchmarkInsert
    {
        std::string avatar_id;
        std::optional<std::string> user_id;
        int parameter_count = 0;
        std::optional<double> eye_height;
        std::string seen_at;
    };
    Result<std::monostate> RecordAvatarBenchmark(const AvatarBenchmarkInsert& a);
    Result<nlohmann::json> AvatarBenchmarks(int limit, int offset);

    // ─── friend_log + friend_notes ───────────────────────────────

    struct FriendLogInsert
    {
        std::string user_id;
        std::string event_type;
        std::optional<std::string> old_value;
        std::optional<std::string> new_value;
        std::string occurred_at;
        std::optional<std::string> display_name;
    };
    Result<std::monostate> InsertFriendLog(const FriendLogInsert& e);

    Result<nlohmann::json> RecentFriendLog(int limit, int offset);
    Result<nlohmann::json> FriendLogForUser(const std::string& user_id,
                                            int limit, int offset);

    Result<std::optional<std::string>> GetFriendNote(const std::string& user_id);
    // Batch read of every friend note, so a friend list can show inline
    // nicknames without firing one IPC per row. Returns an array of
    // { user_id, note } objects.
    Result<nlohmann::json> AllFriendNotes();
    Result<std::monostate> SetFriendNote(const std::string& user_id,
                                         const std::string& note,
                                         const std::string& updated_at);
    Result<nlohmann::json> ClearHistory(bool include_friend_notes = false);

    // ─── unified data-management panel (data.usage / data.clear) ─────
    //
    // Row counts for the tables surfaced in the data-management UI. Only
    // whitelisted table names are queried; a table that does not exist
    // (older schema) is skipped rather than erroring. Returns a JSON
    // object of { "<table>": count }.
    Result<nlohmann::json> TableCounts();

    // Bulk-DELETE the given tables inside a single transaction. Every
    // name is validated against an internal allowlist before any SQL is
    // built — callers never inject raw table names into SQL. An unknown
    // name aborts the whole call with `db_invalid_argument` before any
    // delete runs. Returns { "<table>": rowsDeleted } on success.
    Result<nlohmann::json> ClearTables(const std::vector<std::string>& tables);

    // ─── friend_presence_events + unified feed (Track B1) ────────
    // Durable presence/location/status/avatar-flip events for friends. This is
    // a superset of friend_log: friend_log only tracks confirmed-friendship
    // online/offline/name flips, while this captures per-instance location
    // moves and status changes so the feed can replay a friend's session.
    struct FriendPresenceEventInsert
    {
        std::string user_id;
        std::optional<std::string> display_name;
        std::string event_type;              // "online" | "offline" | "location" | "status" | "avatar"
        std::optional<std::string> world_id;
        std::optional<std::string> instance_id;
        std::optional<std::string> location; // raw VRChat location string when known
        std::optional<std::string> status;   // join-me/active/busy/ask-me/offline
        std::optional<std::string> old_value;
        std::optional<std::string> new_value;
        std::optional<std::string> source;   // "pipeline" | "logwatch" | "poll"
        std::string occurred_at;
    };
    Result<std::monostate> RecordFriendPresenceEvent(const FriendPresenceEventInsert& e);

    // Chronological presence events (latest first), optionally scoped to one user.
    Result<nlohmann::json> RecentFriendPresenceEvents(
        int limit,
        int offset,
        std::optional<std::string> user_id = std::nullopt,
        std::optional<std::string> event_type = std::nullopt,
        std::optional<std::string> occurred_after = std::nullopt,
        std::optional<std::string> occurred_before = std::nullopt);

    // Unified feed read model: UNION ALL across friend_log, player_events,
    // friend_presence_events and avatar_history into one time-ordered stream.
    // Each row carries a `source_kind` discriminator so the frontend can route
    // rendering. Filterable by kind and time window; paginated.
    Result<nlohmann::json> UnifiedFeed(
        int limit,
        int offset,
        std::optional<std::string> user_id = std::nullopt,
        std::optional<std::string> source_kind = std::nullopt,
        std::optional<std::string> occurred_after = std::nullopt,
        std::optional<std::string> occurred_before = std::nullopt);

    // Predict a friend's likely-online hour-of-week distribution from their
    // friend_presence_events online/offline brackets. This is an original analytic
    // layer (no VRCX equivalent): online sessions are bracketed, split across a
    // 168-bucket hour-of-week histogram in local time, weighted by exponential
    // recency decay, and the top contiguous windows are ranked. Returns the JSON
    // shape documented in docs/wave2-research/own-overlap-algorithm-design.md §4,
    // or {"status":"insufficient_data"} when there is not enough observed signal.
    Result<nlohmann::json> PredictFriendOnlineWindows(
        const std::string& user_id,
        int top_n = 3,
        int half_life_weeks = 4);

    // ─── local_favorites ─────────────────────────────────────────

    struct FavoriteInsert
    {
        std::string type;            // 'world' | 'avatar' | 'user'
        std::string target_id;
        std::string list_name;
        std::optional<std::string> display_name;
        std::optional<std::string> thumbnail_url;
        std::string added_at;
        int sort_order{0};
        std::string source{"local"}; // 'local' (user-curated) | 'official' (VRChat sync)
    };
    Result<std::monostate> AddFavorite(const FavoriteInsert& f);
    Result<std::monostate> RemoveFavorite(const std::string& type,
                                          const std::string& target_id,
                                          const std::string& list_name);
    Result<std::monostate> ClearFavoriteList(const std::string& list_name);

    // Removes every favorite tagged with the given origin ('official' wipes all
    // VRChat-synced groups regardless of their current displayName). Used by
    // official sync to replace the previous snapshot before re-importing.
    Result<std::monostate> ClearFavoritesBySource(const std::string& source);

    // All distinct list names (plus item counts per list), grouped by
    // type. Shape: [{ name, type, item_count, latest_added_at }, ...]
    Result<nlohmann::json> FavoriteLists();

    // Items in a specific list, ordered by sort_order asc, added_at asc.
    Result<nlohmann::json> FavoriteItems(const std::string& list_name);

    Result<std::monostate> SetFavoriteNote(const std::string& type,
                                           const std::string& target_id,
                                           const std::string& list_name,
                                           const std::string& note,
                                           const std::string& updated_at);

    Result<std::monostate> SetFavoriteTags(const std::string& type,
                                           const std::string& target_id,
                                           const std::string& list_name,
                                           const std::vector<std::string>& tags,
                                           const std::string& updated_at);

    // Export one list as a canonical JSON payload (for user-driven
    // backup). The shape is identical to FavoriteItems() but with
    // a `schema_version` header so imports can detect format changes.
    Result<nlohmann::json> ExportFavoriteList(const std::string& list_name);

    // Import a previously-exported JSON payload. Rows are added with
    // ON CONFLICT (type, target_id, list_name) DO NOTHING so re-importing
    // the same file is idempotent.
    Result<int> ImportFavoriteList(const nlohmann::json& payload);

    // ─── stats ───────────────────────────────────────────────────

    // Hour-of-week activity heatmap (7 rows × 24 cols). Each cell is
    // the count of distinct world_visits that started in that hour
    // over the last `days` days (default 30). Used by Dashboard.
    Result<nlohmann::json> ActivityHeatmap(int days);

    // Aggregate overview counters for Dashboard:
    //   { total_world_visits, total_players_encountered,
    //     total_avatars_seen, total_hours_in_world }
    Result<nlohmann::json> StatsOverview();

    // Evidence-first global search over local VRCSM data only. This is
    // intentionally local-only in v1: no VRChat API calls, no cache fanout,
    // and no destructive/account-changing actions.
    Result<nlohmann::json> GlobalSearch(const nlohmann::json& request);

    // ─── asset_cache ─────────────────────────────────────────────
    //
    // Stable, cross-page metadata cache for VRChat worlds, avatars, and users.
    // It stores names, image URLs, local cached image URLs, provenance, and
    // confidence so UI pages can render fast local data while background refresh
    // gently improves it. Lower-confidence hints never overwrite higher-
    // confidence data.
    struct AssetCacheUpsert
    {
        std::string type; // "world" | "avatar" | "user"
        std::string id;
        std::optional<std::string> display_name;
        std::optional<std::string> subtitle;
        std::optional<std::string> thumbnail_url;
        std::optional<std::string> image_url;
        std::optional<std::string> local_thumbnail_url;
        nlohmann::json payload_json = nlohmann::json::object();
        std::string source{"hint"};
        std::string confidence{"placeholder"};
        std::string fetched_at;
        std::optional<std::string> expires_at;
        std::optional<std::string> negative_until;
    };
    Result<std::monostate> UpsertAssetCache(const AssetCacheUpsert& item);
    Result<nlohmann::json> ResolveAssetCache(const nlohmann::json& request);
    Result<std::monostate> TouchAssetCache(const std::string& type, const std::vector<std::string>& ids);
    Result<std::monostate> InvalidateAssetCache(std::optional<std::string> type = std::nullopt,
                                                std::optional<std::string> id = std::nullopt);

    // ─── avatar_embeddings (v0.11 experimental visual search) ────
    //
    // `avatar_embeddings_meta` is a plain table (avatar_id + model +
    // created_at). `avatar_embeddings_vec` is a vec0 virtual table doing
    // the actual nearest-neighbour search. We keep them in sync by
    // avatar_id rather than rowid so callers don't need to thread an
    // integer around. Only populated when the Visual Avatar Search
    // experimental flag is on in the frontend — the host always has
    // the schema ready so toggling never requires a restart.

    struct AvatarEmbeddingInsert
    {
        std::string avatar_id;
        // Model output vector. For CLIP ViT-B/32 this is 512 floats.
        // Stored as a raw BLOB (little-endian float32 array).
        std::vector<float> embedding;
        std::string model_version;  // e.g. "clip-vit-b32-quant-v1"
    };
    Result<std::monostate> UpsertAvatarEmbedding(const AvatarEmbeddingInsert& e);

    struct AvatarEmbeddingMatch
    {
        std::string avatar_id;
        float distance;
    };
    Result<std::vector<AvatarEmbeddingMatch>> SearchAvatarEmbeddings(
        const std::vector<float>& queryEmbedding,
        int k);

    // Avatar IDs we know about (avatar_history + avatar-typed favorites)
    // but haven't embedded yet. Frontend uses this to drive its
    // background indexing queue.
    Result<std::vector<std::string>> GetUnindexedAvatarIds();

    Result<std::monostate> DeleteAvatarEmbedding(const std::string& avatar_id);

    // ─── event_recordings (attendance tracker) ────────────────

    struct EventRecordingInsert
    {
        std::string name;
        std::optional<std::string> world_id;
        std::optional<std::string> instance_id;
    };
    Result<nlohmann::json> StartRecording(const EventRecordingInsert& e);
    Result<std::monostate> StopRecording(int64_t id);
    Result<nlohmann::json> ListRecordings(int limit = 50);
    Result<nlohmann::json> RecordingAttendees(int64_t recording_id);
    Result<std::monostate> AddAttendee(int64_t recording_id,
        const std::string& user_id, const std::string& display_name);
    /// Cascades to event_attendees via the FK ON DELETE CASCADE.
    Result<std::monostate> DeleteRecording(int64_t id);

    // ─── rules (automation engine) ─────────────────────────────

    struct RuleInsert
    {
        std::string name;
        std::string dsl_yaml;
        std::optional<std::string> description;
        int cooldown_seconds{5};
    };
    Result<nlohmann::json> InsertRule(const RuleInsert& r);
    Result<nlohmann::json> UpdateRule(int64_t id, const nlohmann::json& patch);
    Result<std::monostate> DeleteRule(int64_t id);
    Result<nlohmann::json> GetRule(int64_t id);
    Result<nlohmann::json> ListRules();
    Result<std::monostate> SetRuleEnabled(int64_t id, bool enabled);
    Result<std::monostate> RecordRuleFiring(int64_t rule_id,
        const std::string& trigger_payload, int result_code,
        const std::string& result_body);
    Result<nlohmann::json> RuleFiringHistory(int64_t rule_id, int limit = 50);

    ~Database();
    Database(const Database&) = delete;
    Database& operator=(const Database&) = delete;

private:
    Database() = default;

    // Helpers (all called with m_mutex held).
    Result<std::monostate> InitSchema();
    Result<std::monostate> ExecSimple(const char* sql);
    Result<std::monostate> UpsertAssetCacheLocked(const AssetCacheUpsert& item);

    // Prepares a statement, binds args via a supplied lambda, and
    // runs it to completion. Used for one-shot writes where we don't
    // need to cache the statement.
    template <typename BindFn>
    Result<std::monostate> RunOnce(const char* sql, BindFn bind);

    // Wrap a sqlite error into a structured Error with code + message.
    Error MakeError(std::string_view code) const;
    Error MakeError(std::string_view code, std::string_view detail) const;

    mutable std::mutex m_mutex;
    sqlite3* m_db{nullptr};
    std::filesystem::path m_path;
};

} // namespace vrcsm::core
