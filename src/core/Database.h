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
    // INSERT OR IGNORE — only records the first time each avatar_id
    // is seen. Matches antigravity's spec for the history table.
    Result<std::monostate> RecordAvatarSeen(const AvatarSeenInsert& a);

    Result<nlohmann::json> RecentAvatarHistory(int limit, int offset);
    Result<std::int64_t> AvatarHistoryCount();

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
    Result<std::monostate> SetFriendNote(const std::string& user_id,
                                         const std::string& note,
                                         const std::string& updated_at);
    Result<nlohmann::json> ClearHistory(bool include_friend_notes = false);

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
    };
    Result<std::monostate> AddFavorite(const FavoriteInsert& f);
    Result<std::monostate> RemoveFavorite(const std::string& type,
                                          const std::string& target_id,
                                          const std::string& list_name);
    Result<std::monostate> ClearFavoriteList(const std::string& list_name);

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
