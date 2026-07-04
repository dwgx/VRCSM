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
    if (sqlite3_busy_timeout(m_db, 5000) != SQLITE_OK)
    {
        const std::string detail = sqlite3_errmsg(m_db);
        sqlite3_close_v2(m_db);
        m_db = nullptr;
        m_path.clear();
        return MakeError("db_open_failed", detail);
    }

    const auto initResult = InitSchema();
    if (std::holds_alternative<Error>(initResult))
    {
        const auto err = std::get<Error>(initResult);
        sqlite3_close_v2(m_db);
        m_db = nullptr;
        m_path.clear();
        return err;
    }

    // Best-effort statistics maintenance. This keeps the planner fresh on
    // long-lived user DBs but must not make startup fail if SQLite declines it.
    (void)ExecSimple("PRAGMA optimize;");

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
CREATE INDEX IF NOT EXISTS idx_player_events_instance_time ON player_events(world_id, instance_id, occurred_at);

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
    first_seen_at TEXT NOT NULL,
    resolved_avatar_id TEXT,
    resolved_thumbnail_url TEXT,
    resolved_image_url TEXT,
    resolution_source TEXT,
    resolution_status TEXT,
    resolved_at TEXT
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
    source TEXT NOT NULL DEFAULT 'local',
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

    static constexpr const char* kDedupeWorldVisitsSql = R"SQL(
DELETE FROM world_visits
WHERE id NOT IN (
    SELECT keep_id
    FROM (
        SELECT
            CASE
                WHEN SUM(CASE WHEN left_at IS NOT NULL AND left_at <> '' THEN 1 ELSE 0 END) > 0
                    THEN MIN(CASE WHEN left_at IS NOT NULL AND left_at <> '' THEN id END)
                ELSE MIN(id)
            END AS keep_id
        FROM world_visits
        GROUP BY world_id, instance_id, joined_at
    )
);
)SQL";

    if (const auto r = ExecSimple(kDedupeWorldVisitsSql); std::holds_alternative<Error>(r))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(r);
    }

    if (const auto r = ExecSimple(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_world_visits "
            "ON world_visits(world_id, instance_id, joined_at);");
        std::holds_alternative<Error>(r))
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

    // ── Schema v7: add display_name to friend_log ───────────────
    static const char* kSchemaV7Sql = R"SQL(
ALTER TABLE friend_log ADD COLUMN display_name TEXT;
    )SQL";

    {
        // ALTER TABLE is a no-op if column already exists; ignore error
        sqlite3_exec(m_db, kSchemaV7Sql, nullptr, nullptr, nullptr);
    }

    if (const auto r = ExecSimple("PRAGMA user_version = 7;"); std::holds_alternative<Error>(r))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(r);
    }

    // ── Schema v8: add release_status to avatar_history ─────────
    {
        // ALTER TABLE is a no-op if column already exists; ignore error
        sqlite3_exec(m_db, "ALTER TABLE avatar_history ADD COLUMN release_status TEXT;",
                     nullptr, nullptr, nullptr);
    }

    // ── Schema v9: add first_seen_user_id (wearer usr_xxx) ─────
    {
        sqlite3_exec(m_db, "ALTER TABLE avatar_history ADD COLUMN first_seen_user_id TEXT;",
                     nullptr, nullptr, nullptr);
    }

    // ── Schema v10: index avatar_history.first_seen_at for paged ORDER BY
    {
        sqlite3_exec(m_db,
                     "CREATE INDEX IF NOT EXISTS idx_avatar_history_first_seen_at "
                     "ON avatar_history(first_seen_at DESC);",
                     nullptr, nullptr, nullptr);
    }

    // ── Schema v11: persisted thumbnail resolution for log-only avatars
    {
        sqlite3_exec(m_db, "ALTER TABLE avatar_history ADD COLUMN resolved_avatar_id TEXT;",
                     nullptr, nullptr, nullptr);
        sqlite3_exec(m_db, "ALTER TABLE avatar_history ADD COLUMN resolved_thumbnail_url TEXT;",
                     nullptr, nullptr, nullptr);
        sqlite3_exec(m_db, "ALTER TABLE avatar_history ADD COLUMN resolved_image_url TEXT;",
                     nullptr, nullptr, nullptr);
        sqlite3_exec(m_db, "ALTER TABLE avatar_history ADD COLUMN resolution_source TEXT;",
                     nullptr, nullptr, nullptr);
        sqlite3_exec(m_db, "ALTER TABLE avatar_history ADD COLUMN resolution_status TEXT;",
                     nullptr, nullptr, nullptr);
        sqlite3_exec(m_db, "ALTER TABLE avatar_history ADD COLUMN resolved_at TEXT;",
                     nullptr, nullptr, nullptr);
    }

    if (const auto r = ExecSimple("PRAGMA user_version = 11;"); std::holds_alternative<Error>(r))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(r);
    }

    // ── Schema v12: cross-page asset metadata cache ───────────────
    static const char* kSchemaV12Sql = R"SQL(
CREATE TABLE IF NOT EXISTS asset_cache (
    type TEXT NOT NULL,
    id TEXT NOT NULL,
    display_name TEXT,
    subtitle TEXT,
    thumbnail_url TEXT,
    image_url TEXT,
    local_thumbnail_url TEXT,
    payload_json TEXT,
    source TEXT NOT NULL DEFAULT 'hint',
    confidence TEXT NOT NULL DEFAULT 'placeholder',
    fetched_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL,
    expires_at TEXT,
    negative_until TEXT,
    PRIMARY KEY (type, id)
);
CREATE INDEX IF NOT EXISTS idx_asset_cache_type_used ON asset_cache(type, last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_cache_expiry ON asset_cache(expires_at);
    )SQL";

    if (const auto r = ExecSimple(kSchemaV12Sql); std::holds_alternative<Error>(r))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(r);
    }

    if (const auto r = ExecSimple("PRAGMA user_version = 12;"); std::holds_alternative<Error>(r))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(r);
    }

    // ── Schema v13: durable friend presence events (Track B1) ──────
    // Superset of friend_log — captures location/status/avatar flips per
    // instance so the unified feed can replay a friend's session. All
    // CREATE IF NOT EXISTS, safe on every startup.
    static const char* kSchemaV13Sql = R"SQL(
CREATE TABLE IF NOT EXISTS friend_presence_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    display_name TEXT,
    event_type TEXT NOT NULL,
    world_id TEXT,
    instance_id TEXT,
    location TEXT,
    status TEXT,
    old_value TEXT,
    new_value TEXT,
    source TEXT,
    occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_friend_presence_user ON friend_presence_events(user_id);
CREATE INDEX IF NOT EXISTS idx_friend_presence_time ON friend_presence_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_friend_presence_type_time ON friend_presence_events(event_type, occurred_at);
    )SQL";

    if (const auto r = ExecSimple(kSchemaV13Sql); std::holds_alternative<Error>(r))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(r);
    }

    if (const auto r = ExecSimple("PRAGMA user_version = 13;"); std::holds_alternative<Error>(r))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(r);
    }

    // ── Schema v14: Track L log events (video/portal/moderation/sticker) ──
    // One generic table for all non-presence log atoms. `kind` discriminates;
    // `detail` carries the source-specific payload (video URL, join reason,
    // sticker inv_id) so the unified feed renders without a second lookup.
    // CREATE IF NOT EXISTS — safe on every startup.
    static const char* kSchemaV14Sql = R"SQL(
CREATE TABLE IF NOT EXISTS log_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    user_id TEXT,
    display_name TEXT,
    world_id TEXT,
    instance_id TEXT,
    detail TEXT,
    occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_events_time ON log_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_log_events_kind_time ON log_events(kind, occurred_at);
    )SQL";

    if (const auto r = ExecSimple(kSchemaV14Sql); std::holds_alternative<Error>(r))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(r);
    }

    if (const auto r = ExecSimple("PRAGMA user_version = 14;"); std::holds_alternative<Error>(r))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(r);
    }

    // ── Schema v15: notifications inbox + session segmentation ──
    // Two account-scoped tables shipped as one version bump. `notifications`
    // mirrors the VRChat inbox (idempotent on the unique notification id);
    // `sessions` tracks one row per VRChat run for mode/hmd + graceful-quit.
    // CREATE IF NOT EXISTS — safe on every startup.
    static const char* kSchemaV15Sql = R"SQL(
CREATE TABLE IF NOT EXISTS notifications (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_user_id TEXT    NOT NULL,
    notification_id TEXT    NOT NULL,
    type            TEXT    NOT NULL,
    sender_id       TEXT,
    sender_name     TEXT,
    detail          TEXT,
    seen            INTEGER NOT NULL DEFAULT 0,
    occurred_at     TEXT    NOT NULL,
    UNIQUE(account_user_id, notification_id)
);
CREATE INDEX IF NOT EXISTS idx_notifications_account_time
    ON notifications(account_user_id, occurred_at DESC);
CREATE TABLE IF NOT EXISTS sessions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    account_user_id  TEXT,
    started_at       TEXT NOT NULL,
    ended_at         TEXT,
    mode             TEXT,
    hmd_model        TEXT,
    closed_gracefully INTEGER NOT NULL DEFAULT 0,
    log_file         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
    )SQL";

    if (const auto r = ExecSimple(kSchemaV15Sql); std::holds_alternative<Error>(r))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(r);
    }

    if (const auto r = ExecSimple("PRAGMA user_version = 15;"); std::holds_alternative<Error>(r))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(r);
    }

    // ── Schema v16: account-scoped online entity caches ──
    // Thin REST-seed mirrors backing the model-management page (owned
    // avatars) and the VRC+ surfaces (prints/inventory/files). All keyed
    // by account_user_id; caches only, never feed sources — safe to drop
    // and rebuild. CREATE IF NOT EXISTS — safe on every startup.
    static const char* kSchemaV16Sql = R"SQL(
CREATE TABLE IF NOT EXISTS owned_avatars (
    account_user_id TEXT NOT NULL,
    avatar_id       TEXT NOT NULL,
    name            TEXT,
    description     TEXT,
    image_url       TEXT,
    release_status  TEXT,
    version         INTEGER,
    updated_at      TEXT,
    PRIMARY KEY(account_user_id, avatar_id)
);
CREATE TABLE IF NOT EXISTS online_prints (
    account_user_id TEXT NOT NULL,
    print_id        TEXT NOT NULL,
    note            TEXT,
    world_id        TEXT,
    world_name      TEXT,
    image_url       TEXT,
    timestamp       TEXT,
    created_at      TEXT,
    PRIMARY KEY(account_user_id, print_id)
);
CREATE TABLE IF NOT EXISTS online_inventory (
    account_user_id TEXT NOT NULL,
    item_id         TEXT NOT NULL,
    item_type       TEXT,
    name            TEXT,
    description     TEXT,
    image_url       TEXT,
    is_archived     INTEGER,
    created_at      TEXT,
    PRIMARY KEY(account_user_id, item_id)
);
CREATE TABLE IF NOT EXISTS online_files (
    account_user_id TEXT NOT NULL,
    file_id         TEXT NOT NULL,
    tag             TEXT,
    name            TEXT,
    url             TEXT,
    created_at      TEXT,
    PRIMARY KEY(account_user_id, file_id)
);
    )SQL";

    if (const auto r = ExecSimple(kSchemaV16Sql); std::holds_alternative<Error>(r))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(r);
    }

    if (const auto r = ExecSimple("PRAGMA user_version = 16;"); std::holds_alternative<Error>(r))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(r);
    }

    // ── Schema v17: persisted avatar benchmark snapshots ──
    // The Avatar Benchmark page reads parameter counts from the *live* VRChat
    // local-avatar cache (report.local_avatar_data.recent_items), which VRChat
    // evicts over time. This table snapshots every avatar we've measured so the
    // benchmark stays viewable after the source file is gone. Pure cache built
    // from scans — safe to drop and rebuild. Keyed by avatar_id; last write of
    // parameter_count/eye_height wins, first_seen_at is preserved.
    static const char* kSchemaV17Sql = R"SQL(
CREATE TABLE IF NOT EXISTS avatar_benchmark (
    avatar_id       TEXT PRIMARY KEY,
    user_id         TEXT,
    parameter_count INTEGER NOT NULL,
    eye_height      REAL,
    first_seen_at   TEXT,
    last_seen_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_avatar_benchmark_params
    ON avatar_benchmark(parameter_count DESC);
    )SQL";

    if (const auto r = ExecSimple(kSchemaV17Sql); std::holds_alternative<Error>(r))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(r);
    }

    if (const auto r = ExecSimple("PRAGMA user_version = 17;"); std::holds_alternative<Error>(r))
    {
        RollbackIfNeeded(m_db);
        return std::get<Error>(r);
    }

    // ── Schema v18: tag favorites with their origin ──
    // Official favorites sync now mirrors VRChat's native groups (avatars1..4,
    // worlds1..4) as separate lists named after each group's displayName. Group
    // displayNames can change between syncs, so we can't clear stale official
    // lists by name alone. The `source` column lets sync wipe everything it owns
    // ('official') without touching the user's own local lists ('local').
    // Existing rows predate grouping and all live in the single legacy
    // "VRChat Official Favorites" list or the local "Library" list; backfill
    // them so the first post-upgrade sync clears the legacy list cleanly.
    {
        bool hasSource = false;
        sqlite3_stmt* rawInfo = nullptr;
        if (sqlite3_prepare_v2(m_db, "PRAGMA table_info(local_favorites);", -1, &rawInfo, nullptr) == SQLITE_OK)
        {
            StatementGuard infoGuard(rawInfo);
            while (sqlite3_step(rawInfo) == SQLITE_ROW)
            {
                const auto* col = reinterpret_cast<const char*>(sqlite3_column_text(rawInfo, 1));
                if (col != nullptr && std::string_view(col) == "source")
                {
                    hasSource = true;
                    break;
                }
            }
        }

        if (!hasSource)
        {
            if (const auto r = ExecSimple(
                    "ALTER TABLE local_favorites ADD COLUMN source TEXT NOT NULL DEFAULT 'local';");
                std::holds_alternative<Error>(r))
            {
                RollbackIfNeeded(m_db);
                return std::get<Error>(r);
            }

            if (const auto r = ExecSimple(
                    "UPDATE local_favorites SET source = 'official' "
                    "WHERE list_name = 'VRChat Official Favorites';");
                std::holds_alternative<Error>(r))
            {
                RollbackIfNeeded(m_db);
                return std::get<Error>(r);
            }
        }
    }

    if (const auto r = ExecSimple("PRAGMA user_version = 18;"); std::holds_alternative<Error>(r))
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
