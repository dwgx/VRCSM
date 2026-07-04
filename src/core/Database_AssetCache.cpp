#include "Database.h"

#include <sqlite3.h>

#include <fmt/format.h>

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
int AssetConfidenceRank(std::string_view confidence)
{
    if (confidence == "verified_api") return 50;
    if (confidence == "local_favorite") return 40;
    if (confidence == "log_exact") return 30;
    if (confidence == "reference") return 20;
    return 10;
}

bool IsAssetType(std::string_view type)
{
    return type == "world" || type == "avatar" || type == "user";
}

std::optional<std::string> NonEmpty(std::optional<std::string> value)
{
    if (!value.has_value() || value->empty())
    {
        return std::nullopt;
    }
    return value;
}

std::optional<std::string> JsonStringOrNull(const nlohmann::json& obj, const char* key)
{
    if (!obj.is_object() || !obj.contains(key) || obj[key].is_null())
    {
        return std::nullopt;
    }
    if (!obj[key].is_string())
    {
        return std::nullopt;
    }
    auto value = obj[key].get<std::string>();
    if (value.empty())
    {
        return std::nullopt;
    }
    return value;
}

std::optional<std::string> FirstJsonString(const nlohmann::json& obj, std::initializer_list<const char*> keys)
{
    for (const auto* key : keys)
    {
        if (auto value = JsonStringOrNull(obj, key); value.has_value())
        {
            return value;
        }
    }
    return std::nullopt;
}

nlohmann::json AssetRowToJson(sqlite3_stmt* stmt)
{
    nlohmann::json row = nlohmann::json::object();
    row["type"] = ColumnTextOrNull(stmt, 0);
    row["id"] = ColumnTextOrNull(stmt, 1);
    row["displayName"] = ColumnTextOrNull(stmt, 2);
    row["subtitle"] = ColumnTextOrNull(stmt, 3);
    row["thumbnailUrl"] = ColumnTextOrNull(stmt, 4);
    row["imageUrl"] = ColumnTextOrNull(stmt, 5);
    row["localThumbnailUrl"] = ColumnTextOrNull(stmt, 6);
    row["source"] = ColumnTextOrNull(stmt, 7);
    row["confidence"] = ColumnTextOrNull(stmt, 8);
    row["fetchedAt"] = ColumnTextOrNull(stmt, 9);
    row["lastUsedAt"] = ColumnTextOrNull(stmt, 10);
    row["expiresAt"] = ColumnTextOrNull(stmt, 11);
    row["negativeUntil"] = ColumnTextOrNull(stmt, 12);
    row["stale"] = sqlite3_column_int(stmt, 13) != 0;
    row["negative"] = sqlite3_column_int(stmt, 14) != 0;

    nlohmann::json payload = nlohmann::json::object();
    if (const auto payloadText = ColumnOptionalText(stmt, 15); payloadText.has_value() && !payloadText->empty())
    {
        payload = nlohmann::json::parse(*payloadText, nullptr, false);
        if (payload.is_discarded() || !payload.is_object())
        {
            payload = nlohmann::json::object();
        }
    }
    row["payload"] = std::move(payload);
    return row;
}

} // namespace


Result<std::monostate> Database::UpsertAssetCache(const AssetCacheUpsert& item)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return UpsertAssetCacheLocked(item);
}


Result<std::monostate> Database::UpsertAssetCacheLocked(const AssetCacheUpsert& item)
{
    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }
    if (!IsAssetType(item.type) || item.id.empty())
    {
        return MakeError("db_invalid_argument", "asset cache requires type and id");
    }

    const auto now = item.fetched_at.empty() ? nowIso() : item.fetched_at;
    const auto confidence = item.confidence.empty() ? std::string{"placeholder"} : item.confidence;
    const int newRank = AssetConfidenceRank(confidence);
    const auto payloadText = item.payload_json.is_object() ? item.payload_json.dump() : nlohmann::json::object().dump();

    const char* sql =
        "INSERT INTO asset_cache ("
        "type, id, display_name, subtitle, thumbnail_url, image_url, local_thumbnail_url, "
        "payload_json, source, confidence, fetched_at, last_used_at, expires_at, negative_until"
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(type, id) DO UPDATE SET "
        "display_name = CASE WHEN ? >= "
        "    CASE asset_cache.confidence "
        "        WHEN 'verified_api' THEN 50 WHEN 'local_favorite' THEN 40 "
        "        WHEN 'log_exact' THEN 30 WHEN 'reference' THEN 20 ELSE 10 END "
        "    THEN COALESCE(NULLIF(excluded.display_name, ''), asset_cache.display_name) "
        "    ELSE asset_cache.display_name END, "
        "subtitle = CASE WHEN ? >= "
        "    CASE asset_cache.confidence "
        "        WHEN 'verified_api' THEN 50 WHEN 'local_favorite' THEN 40 "
        "        WHEN 'log_exact' THEN 30 WHEN 'reference' THEN 20 ELSE 10 END "
        "    THEN COALESCE(NULLIF(excluded.subtitle, ''), asset_cache.subtitle) "
        "    ELSE asset_cache.subtitle END, "
        "thumbnail_url = CASE WHEN ? >= "
        "    CASE asset_cache.confidence "
        "        WHEN 'verified_api' THEN 50 WHEN 'local_favorite' THEN 40 "
        "        WHEN 'log_exact' THEN 30 WHEN 'reference' THEN 20 ELSE 10 END "
        "    THEN COALESCE(NULLIF(excluded.thumbnail_url, ''), asset_cache.thumbnail_url) "
        "    ELSE asset_cache.thumbnail_url END, "
        "image_url = CASE WHEN ? >= "
        "    CASE asset_cache.confidence "
        "        WHEN 'verified_api' THEN 50 WHEN 'local_favorite' THEN 40 "
        "        WHEN 'log_exact' THEN 30 WHEN 'reference' THEN 20 ELSE 10 END "
        "    THEN COALESCE(NULLIF(excluded.image_url, ''), asset_cache.image_url) "
        "    ELSE asset_cache.image_url END, "
        "local_thumbnail_url = COALESCE(NULLIF(excluded.local_thumbnail_url, ''), asset_cache.local_thumbnail_url), "
        "payload_json = CASE WHEN ? >= "
        "    CASE asset_cache.confidence "
        "        WHEN 'verified_api' THEN 50 WHEN 'local_favorite' THEN 40 "
        "        WHEN 'log_exact' THEN 30 WHEN 'reference' THEN 20 ELSE 10 END "
        "    THEN CASE WHEN excluded.payload_json = '{}' THEN asset_cache.payload_json ELSE excluded.payload_json END "
        "    ELSE asset_cache.payload_json END, "
        "source = CASE WHEN ? >= "
        "    CASE asset_cache.confidence "
        "        WHEN 'verified_api' THEN 50 WHEN 'local_favorite' THEN 40 "
        "        WHEN 'log_exact' THEN 30 WHEN 'reference' THEN 20 ELSE 10 END "
        "    THEN excluded.source ELSE asset_cache.source END, "
        "confidence = CASE WHEN ? >= "
        "    CASE asset_cache.confidence "
        "        WHEN 'verified_api' THEN 50 WHEN 'local_favorite' THEN 40 "
        "        WHEN 'log_exact' THEN 30 WHEN 'reference' THEN 20 ELSE 10 END "
        "    THEN excluded.confidence ELSE asset_cache.confidence END, "
        "fetched_at = CASE WHEN ? >= "
        "    CASE asset_cache.confidence "
        "        WHEN 'verified_api' THEN 50 WHEN 'local_favorite' THEN 40 "
        "        WHEN 'log_exact' THEN 30 WHEN 'reference' THEN 20 ELSE 10 END "
        "    THEN excluded.fetched_at ELSE asset_cache.fetched_at END, "
        "last_used_at = excluded.last_used_at, "
        "expires_at = CASE WHEN ? >= "
        "    CASE asset_cache.confidence "
        "        WHEN 'verified_api' THEN 50 WHEN 'local_favorite' THEN 40 "
        "        WHEN 'log_exact' THEN 30 WHEN 'reference' THEN 20 ELSE 10 END "
        "    THEN excluded.expires_at ELSE asset_cache.expires_at END, "
        "negative_until = CASE WHEN ? >= "
        "    CASE asset_cache.confidence "
        "        WHEN 'verified_api' THEN 50 WHEN 'local_favorite' THEN 40 "
        "        WHEN 'log_exact' THEN 30 WHEN 'reference' THEN 20 ELSE 10 END "
        "    THEN excluded.negative_until ELSE asset_cache.negative_until END;";

    return RunOnce(sql, [this, &item, &now, &confidence, &payloadText, newRank](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindText(stmt, 1, item.type) != SQLITE_OK ||
            BindText(stmt, 2, item.id) != SQLITE_OK ||
            BindOptionalText(stmt, 3, NonEmpty(item.display_name)) != SQLITE_OK ||
            BindOptionalText(stmt, 4, NonEmpty(item.subtitle)) != SQLITE_OK ||
            BindOptionalText(stmt, 5, NonEmpty(item.thumbnail_url)) != SQLITE_OK ||
            BindOptionalText(stmt, 6, NonEmpty(item.image_url)) != SQLITE_OK ||
            BindOptionalText(stmt, 7, NonEmpty(item.local_thumbnail_url)) != SQLITE_OK ||
            BindText(stmt, 8, payloadText) != SQLITE_OK ||
            BindText(stmt, 9, item.source.empty() ? std::string{"hint"} : item.source) != SQLITE_OK ||
            BindText(stmt, 10, confidence) != SQLITE_OK ||
            BindText(stmt, 11, now) != SQLITE_OK ||
            BindText(stmt, 12, now) != SQLITE_OK ||
            BindOptionalText(stmt, 13, NonEmpty(item.expires_at)) != SQLITE_OK ||
            BindOptionalText(stmt, 14, NonEmpty(item.negative_until)) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        for (int i = 15; i <= 24; ++i)
        {
            if (BindInt(stmt, i, newRank) != SQLITE_OK)
            {
                return MakeError("db_bind_failed");
            }
        }
        return std::monostate{};
    });
}


Result<std::monostate> Database::TouchAssetCache(const std::string& type, const std::vector<std::string>& ids)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }
    if (!IsAssetType(type))
    {
        return MakeError("db_invalid_argument", "invalid asset type");
    }
    const auto touchedAt = nowIso();
    const char* sql = "UPDATE asset_cache SET last_used_at = ? WHERE type = ? AND id = ?;";
    for (const auto& id : ids)
    {
        if (id.empty()) continue;
        const auto r = RunOnce(sql, [this, &touchedAt, &type, &id](sqlite3_stmt* stmt) -> Result<std::monostate>
        {
            if (BindText(stmt, 1, touchedAt) != SQLITE_OK ||
                BindText(stmt, 2, type) != SQLITE_OK ||
                BindText(stmt, 3, id) != SQLITE_OK)
            {
                return MakeError("db_bind_failed");
            }
            return std::monostate{};
        });
        if (std::holds_alternative<Error>(r))
        {
            return std::get<Error>(r);
        }
    }
    return std::monostate{};
}


Result<std::monostate> Database::InvalidateAssetCache(std::optional<std::string> type, std::optional<std::string> id)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }
    if (type.has_value() && !IsAssetType(*type))
    {
        return MakeError("db_invalid_argument", "invalid asset type");
    }

    const char* sqlAll = "DELETE FROM asset_cache;";
    const char* sqlType = "DELETE FROM asset_cache WHERE type = ?;";
    const char* sqlOne = "DELETE FROM asset_cache WHERE type = ? AND id = ?;";

    if (!type.has_value())
    {
        return RunOnce(sqlAll, [](sqlite3_stmt*) -> Result<std::monostate> { return std::monostate{}; });
    }
    if (!id.has_value() || id->empty())
    {
        return RunOnce(sqlType, [this, &type](sqlite3_stmt* stmt) -> Result<std::monostate>
        {
            if (BindText(stmt, 1, *type) != SQLITE_OK)
            {
                return MakeError("db_bind_failed");
            }
            return std::monostate{};
        });
    }
    return RunOnce(sqlOne, [this, &type, &id](sqlite3_stmt* stmt) -> Result<std::monostate>
    {
        if (BindText(stmt, 1, *type) != SQLITE_OK ||
            BindText(stmt, 2, *id) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        return std::monostate{};
    });
}


Result<nlohmann::json> Database::ResolveAssetCache(const nlohmann::json& request)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_db == nullptr)
    {
        return MakeError("db_not_open");
    }
    if (!request.is_object() || !request.contains("items") || !request["items"].is_array())
    {
        return MakeError("db_invalid_argument", "assets.resolve requires items array");
    }

    struct RequestedAsset
    {
        std::string type;
        std::string id;
        std::optional<std::string> hintName;
        std::optional<std::string> hintImageUrl;
    };

    std::vector<RequestedAsset> items;
    std::unordered_set<std::string> seen;
    for (const auto& raw : request["items"])
    {
        if (!raw.is_object()) continue;
        auto type = JsonStringOrNull(raw, "type").value_or("");
        auto id = JsonStringOrNull(raw, "id").value_or("");
        if (!IsAssetType(type) || id.empty()) continue;
        const auto key = type + "|" + id;
        if (!seen.insert(key).second) continue;
        RequestedAsset item;
        item.type = std::move(type);
        item.id = std::move(id);
        item.hintName = FirstJsonString(raw, {"hintName", "displayName", "name"});
        item.hintImageUrl = FirstJsonString(raw, {"hintImageUrl", "thumbnailUrl", "imageUrl"});
        items.push_back(std::move(item));
        if (items.size() >= 256) break;
    }

    const auto now = nowIso();
    nlohmann::json results = nlohmann::json::array();
    const char* selectSql =
        "SELECT type, id, display_name, subtitle, thumbnail_url, image_url, local_thumbnail_url, "
        "source, confidence, fetched_at, last_used_at, expires_at, negative_until, "
        "CASE WHEN expires_at IS NOT NULL AND expires_at <> '' AND expires_at < ? THEN 1 ELSE 0 END AS stale, "
        "CASE WHEN negative_until IS NOT NULL AND negative_until <> '' AND negative_until > ? THEN 1 ELSE 0 END AS negative, "
        "payload_json "
        "FROM asset_cache WHERE type = ? AND id = ?;";

    const char* touchSql = "UPDATE asset_cache SET last_used_at = ? WHERE type = ? AND id = ?;";

    auto runSeed = [&](const RequestedAsset& item) -> Result<std::monostate>
    {
        AssetCacheUpsert seed;
        seed.type = item.type;
        seed.id = item.id;
        seed.fetched_at = now;
        seed.source = "hint";
        seed.confidence = "placeholder";
        seed.display_name = item.hintName;
        seed.thumbnail_url = item.hintImageUrl;
        if (seed.display_name.has_value() || seed.thumbnail_url.has_value())
        {
            seed.confidence = item.type == "user" ? "log_exact" : "reference";
            return UpsertAssetCacheLocked(seed);
        }
        return std::monostate{};
    };

    auto selectOne = [&](const RequestedAsset& item) -> Result<std::optional<nlohmann::json>>
    {
        sqlite3_stmt* rawStmt = nullptr;
        if (sqlite3_prepare_v2(m_db, selectSql, -1, &rawStmt, nullptr) != SQLITE_OK)
        {
            return MakeError("db_prepare_failed");
        }
        StatementGuard stmt(rawStmt);
        if (BindText(rawStmt, 1, now) != SQLITE_OK ||
            BindText(rawStmt, 2, now) != SQLITE_OK ||
            BindText(rawStmt, 3, item.type) != SQLITE_OK ||
            BindText(rawStmt, 4, item.id) != SQLITE_OK)
        {
            return MakeError("db_bind_failed");
        }
        const int rc = sqlite3_step(rawStmt);
        if (rc == SQLITE_ROW)
        {
            return std::optional<nlohmann::json>{AssetRowToJson(rawStmt)};
        }
        if (rc != SQLITE_DONE)
        {
            return MakeError("db_step_failed");
        }
        return std::optional<nlohmann::json>{};
    };

    for (const auto& item : items)
    {
        auto existing = selectOne(item);
        if (std::holds_alternative<Error>(existing))
        {
            return std::get<Error>(existing);
        }

        if (!std::get<std::optional<nlohmann::json>>(existing).has_value())
        {
            // Seed from local tables without any network call.
            if (const auto seed = runSeed(item); std::holds_alternative<Error>(seed))
            {
                return std::get<Error>(seed);
            }

            if (item.type == "world")
            {
                const char* sql =
                    "SELECT display_name, thumbnail_url FROM local_favorites "
                    "WHERE type = 'world' AND target_id = ? "
                    "ORDER BY added_at DESC LIMIT 1;";
                sqlite3_stmt* rawStmt = nullptr;
                if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK) return MakeError("db_prepare_failed");
                StatementGuard stmt(rawStmt);
                if (BindText(rawStmt, 1, item.id) != SQLITE_OK) return MakeError("db_bind_failed");
                if (sqlite3_step(rawStmt) == SQLITE_ROW)
                {
                    AssetCacheUpsert seed;
                    seed.type = item.type;
                    seed.id = item.id;
                    seed.display_name = ColumnOptionalText(rawStmt, 0);
                    seed.thumbnail_url = ColumnOptionalText(rawStmt, 1);
                    seed.source = "local_favorites";
                    seed.confidence = "local_favorite";
                    seed.fetched_at = now;
                    if (const auto r = UpsertAssetCacheLocked(seed); std::holds_alternative<Error>(r)) return std::get<Error>(r);
                }
            }
            else if (item.type == "avatar")
            {
                const char* sql =
                    "SELECT avatar_name, author_name, resolved_thumbnail_url, resolved_image_url, resolution_source, resolution_status "
                    "FROM avatar_history WHERE avatar_id = ? LIMIT 1;";
                sqlite3_stmt* rawStmt = nullptr;
                if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK) return MakeError("db_prepare_failed");
                StatementGuard stmt(rawStmt);
                if (BindText(rawStmt, 1, item.id) != SQLITE_OK) return MakeError("db_bind_failed");
                if (sqlite3_step(rawStmt) == SQLITE_ROW)
                {
                    AssetCacheUpsert seed;
                    seed.type = item.type;
                    seed.id = item.id;
                    seed.display_name = ColumnOptionalText(rawStmt, 0);
                    seed.subtitle = ColumnOptionalText(rawStmt, 1);
                    seed.thumbnail_url = ColumnOptionalText(rawStmt, 2);
                    seed.image_url = ColumnOptionalText(rawStmt, 3);
                    seed.source = ColumnOptionalText(rawStmt, 4).value_or("avatar_history");
                    const auto status = ColumnOptionalText(rawStmt, 5).value_or("");
                    seed.confidence = status == "resolved" && seed.thumbnail_url.has_value() ? "verified_api" : "log_exact";
                    seed.fetched_at = now;
                    if (const auto r = UpsertAssetCacheLocked(seed); std::holds_alternative<Error>(r)) return std::get<Error>(r);
                }
            }
            else if (item.type == "user")
            {
                const char* sql =
                    "SELECT display_name, MAX(last_seen) FROM player_encounters "
                    "WHERE user_id = ? GROUP BY user_id, display_name "
                    "ORDER BY MAX(last_seen) DESC LIMIT 1;";
                sqlite3_stmt* rawStmt = nullptr;
                if (sqlite3_prepare_v2(m_db, sql, -1, &rawStmt, nullptr) != SQLITE_OK) return MakeError("db_prepare_failed");
                StatementGuard stmt(rawStmt);
                if (BindText(rawStmt, 1, item.id) != SQLITE_OK) return MakeError("db_bind_failed");
                if (sqlite3_step(rawStmt) == SQLITE_ROW)
                {
                    AssetCacheUpsert seed;
                    seed.type = item.type;
                    seed.id = item.id;
                    seed.display_name = ColumnOptionalText(rawStmt, 0);
                    seed.subtitle = ColumnOptionalText(rawStmt, 1);
                    seed.source = "player_encounters";
                    seed.confidence = "log_exact";
                    seed.fetched_at = now;
                    if (const auto r = UpsertAssetCacheLocked(seed); std::holds_alternative<Error>(r)) return std::get<Error>(r);
                }
            }
            existing = selectOne(item);
            if (std::holds_alternative<Error>(existing))
            {
                return std::get<Error>(existing);
            }
        }

        if (auto row = std::get<std::optional<nlohmann::json>>(existing); row.has_value())
        {
            results.push_back(std::move(*row));
            const auto touch = RunOnce(touchSql, [this, &now, &item](sqlite3_stmt* stmt) -> Result<std::monostate>
            {
                if (BindText(stmt, 1, now) != SQLITE_OK ||
                    BindText(stmt, 2, item.type) != SQLITE_OK ||
                    BindText(stmt, 3, item.id) != SQLITE_OK)
                {
                    return MakeError("db_bind_failed");
                }
                return std::monostate{};
            });
            if (std::holds_alternative<Error>(touch))
            {
                return std::get<Error>(touch);
            }
        }
        else
        {
            results.push_back(nlohmann::json{
                {"type", item.type},
                {"id", item.id},
                {"displayName", item.hintName.has_value() ? nlohmann::json(*item.hintName) : nlohmann::json(nullptr)},
                {"subtitle", nullptr},
                {"thumbnailUrl", item.hintImageUrl.has_value() ? nlohmann::json(*item.hintImageUrl) : nlohmann::json(nullptr)},
                {"imageUrl", nullptr},
                {"localThumbnailUrl", nullptr},
                {"source", "placeholder"},
                {"confidence", "placeholder"},
                {"fetchedAt", nullptr},
                {"lastUsedAt", nullptr},
                {"expiresAt", nullptr},
                {"negativeUntil", nullptr},
                {"stale", true},
                {"negative", false},
                {"payload", nlohmann::json::object()},
            });
        }
    }

    return nlohmann::json{{"results", std::move(results)}, {"resolvedAt", now}};
}

} // namespace vrcsm::core
