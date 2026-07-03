#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/Database.h"
#include "../../core/SafeDelete.h"
#include "../../core/VrcApi.h"

#include <array>
#include <filesystem>
#include <system_error>

namespace
{

constexpr std::string_view kOfficialFavoritesListName = "VRChat Official Favorites";

// ── data.usage / data.clear helpers ────────────────────────────────────

// True if the path is an NTFS junction / mount point / symlink. Tests the
// Win32 reparse attribute directly (is_symlink misses IO_REPARSE_TAG_MOUNT_POINT
// junctions), matching the explicit check the delete side uses.
bool isReparsePointPath(const std::filesystem::path& p)
{
    const DWORD attrs = ::GetFileAttributesW(p.wstring().c_str());
    if (attrs == INVALID_FILE_ATTRIBUTES) return false;
    return (attrs & FILE_ATTRIBUTE_REPARSE_POINT) != 0;
}

// Recursive byte total for a path, non-throwing. A missing path returns 0. A
// file returns its own size. A directory sums file sizes and does NOT follow
// reparse points: any junction/symlink dir has its recursion explicitly
// disabled, matching the delete side which refuses to descend through junctions
// (relying on the iterator's implicit symlink handling is MSVC-version
// dependent for mount-point junctions, so we guard explicitly).
std::uint64_t pathBytes(const std::filesystem::path& p)
{
    std::error_code ec;
    if (!std::filesystem::exists(p, ec) || ec) return 0;
    if (std::filesystem::is_regular_file(p, ec) && !ec)
    {
        const auto sz = std::filesystem::file_size(p, ec);
        return ec ? 0 : static_cast<std::uint64_t>(sz);
    }
    // Top-level guard: if p itself is a junction/symlink, the iterator would
    // open and enumerate its external target. disable_recursion_pending only
    // covers children, so guard the root explicitly — parity with the delete
    // side, which refuses a top-level reparse point outright.
    if (isReparsePointPath(p)) return 0;
    std::uint64_t total = 0;
    auto opts = std::filesystem::directory_options::skip_permission_denied;
    std::filesystem::recursive_directory_iterator it(p, opts, ec);
    if (ec) return 0;
    const std::filesystem::recursive_directory_iterator end{};
    for (; it != end; it.increment(ec))
    {
        if (ec) break;
        std::error_code fec;
        // Don't descend into a reparse-point directory: unlink-vs-follow parity
        // with removeTreeNoFollow, and never count bytes outside the target.
        if (it->is_directory(fec) && !fec && isReparsePointPath(it->path()))
        {
            it.disable_recursion_pending();
            continue;
        }
        if (it->is_regular_file(fec) && !fec)
        {
            const auto sz = it->file_size(fec);
            if (!fec) total += static_cast<std::uint64_t>(sz);
        }
    }
    return total;
}

// Disk target key → relative paths under getAppDataRoot(). Relative names are
// compile-time constants; caller input never contributes a path segment.
struct DiskTarget
{
    std::string_view key;
    std::array<std::string_view, 2> rel; // empty ("") entries are ignored
};

const std::array<DiskTarget, 6>& diskTargets()
{
    static const std::array<DiskTarget, 6> kTargets{{
        {"cache.thumbnails", {"thumb-cache-files", "thumb-cache.json"}},
        {"cache.previews", {"preview-cache", ""}},
        {"cache.screenshotThumbs", {"screenshot-thumbs", ""}},
        {"cache.updates", {"updates", ""}},
        {"cache.pluginFeed", {"plugin-feed-cache.json", ""}},
        {"cache.index", {"cache-index.json", ""}},
    }};
    return kTargets;
}

// Table target key → concrete table names cleared together.
const std::vector<std::pair<std::string, std::vector<std::string>>>& tableTargets()
{
    static const std::vector<std::pair<std::string, std::vector<std::string>>> kTargets{
        {"cache.assetCache", {"asset_cache"}},
        {"cache.benchmark", {"avatar_benchmark"}},
        {"cache.onlineMirror", {"owned_avatars", "online_prints", "online_inventory", "online_files"}},
        {"history.worldVisits", {"world_visits"}},
        {"history.playerEvents", {"player_events", "player_encounters"}},
        {"history.avatarHistory", {"avatar_history"}},
        {"history.friendLog", {"friend_log", "friend_presence_events"}},
        {"history.sessions", {"sessions"}},
        {"history.logEvents", {"log_events"}},
        {"experimental.embeddings", {"avatar_embeddings_meta", "avatar_embeddings_vec"}},
        {"assets.favorites", {"local_favorites", "local_favorite_notes", "local_favorite_tags"}},
    };
    return kTargets;
}

nlohmann::json RequireJsonField(const nlohmann::json& params, const char* key)
{
    if (!params.is_object() || !params.contains(key))
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_argument",
            fmt::format("Missing field '{}'", key),
            0,
        });
    }
    return params[key];
}

std::optional<std::string> FirstStringField(
    const nlohmann::json& obj,
    std::initializer_list<const char*> keys)
{
    for (const auto* key : keys)
    {
        if (!obj.is_object() || !obj.contains(key) || !obj[key].is_string())
        {
            continue;
        }
        return obj[key].get<std::string>();
    }
    return std::nullopt;
}

bool IsAssetType(std::string_view type)
{
    return type == "world" || type == "avatar" || type == "user";
}

std::string AssetTypeFromId(std::string_view id)
{
    if (id.rfind("wrld_", 0) == 0) return "world";
    if (id.rfind("avtr_", 0) == 0) return "avatar";
    if (id.rfind("usr_", 0) == 0) return "user";
    return {};
}

std::string AssetTypeForThumbnailId(std::string_view id)
{
    if (id.rfind("wrld_", 0) == 0) return "world";
    if (id.rfind("avtr_", 0) == 0) return "avatar";
    return {};
}

std::string StringFieldOrEmpty(const nlohmann::json& obj, const char* key)
{
    return JsonStringField(obj, key).value_or("");
}

} // namespace

nlohmann::json IpcBridge::HandleAssetsResolve(const nlohmann::json& params, const std::optional<std::string>&)
{
    if (!params.is_object() || !params.contains("items") || !params["items"].is_array())
    {
        throw IpcException(vrcsm::core::Error{"invalid_argument", "assets.resolve requires items array", 0});
    }

    nlohmann::json normalizedParams = params;
    nlohmann::json normalizedItems = nlohmann::json::array();
    std::unordered_set<std::string> seen;
    const bool refresh = params.value("refresh", false);

    for (const auto& raw : params["items"])
    {
        if (!raw.is_object()) continue;
        auto id = JsonStringField(raw, "id").value_or("");
        if (id.empty()) continue;

        auto type = JsonStringField(raw, "type").value_or("");
        if (type.empty())
        {
            type = AssetTypeFromId(id);
        }
        if (!IsAssetType(type)) continue;

        const auto key = type + "|" + id;
        if (!seen.insert(key).second) continue;

        nlohmann::json item = raw;
        item["type"] = type;
        item["id"] = id;
        normalizedItems.push_back(item);

        if (normalizedItems.size() >= 256) break;
    }
    normalizedParams["items"] = normalizedItems;

    auto resolved = vrcsm::core::Database::Instance().ResolveAssetCache(normalizedParams);
    if (!vrcsm::core::isOk(resolved))
    {
        throw IpcException(vrcsm::core::error(resolved));
    }

    std::vector<std::string> missingThumbnailIds;
    const auto& firstPass = vrcsm::core::value(resolved);
    if (firstPass.contains("results") && firstPass["results"].is_array())
    {
        for (const auto& row : firstPass["results"])
        {
            const auto id = StringFieldOrEmpty(row, "id");
            if (id.empty() || AssetTypeForThumbnailId(id).empty()) continue;
            const auto localThumbnail = StringFieldOrEmpty(row, "localThumbnailUrl");
            const auto thumbnail = StringFieldOrEmpty(row, "thumbnailUrl");
            const bool stale = row.value("stale", false);
            if (refresh || localThumbnail.empty() || (thumbnail.empty() && stale))
            {
                missingThumbnailIds.push_back(id);
            }
            if (missingThumbnailIds.size() >= 64) break;
        }
    }

    if (!missingThumbnailIds.empty())
    {
        const auto thumbResults = vrcsm::core::VrcApi::fetchThumbnails(missingThumbnailIds, true);
        for (const auto& thumb : thumbResults)
        {
            auto type = AssetTypeForThumbnailId(thumb.id);
            if (type.empty()) continue;
            vrcsm::core::Database::AssetCacheUpsert item;
            item.type = std::move(type);
            item.id = thumb.id;
            item.thumbnail_url = thumb.url;
            item.local_thumbnail_url = thumb.localUrl;
            item.source = thumb.source.empty() ? "thumbnails.fetch" : thumb.source;
            item.confidence = "verified_api";
            item.fetched_at = vrcsm::core::nowIso();

            if (thumb.url.has_value() || thumb.localUrl.has_value())
            {
                auto upsert = vrcsm::core::Database::Instance().UpsertAssetCache(item);
                if (!vrcsm::core::isOk(upsert))
                {
                    throw IpcException(vrcsm::core::error(upsert));
                }
            }
        }

        resolved = vrcsm::core::Database::Instance().ResolveAssetCache(normalizedParams);
        if (!vrcsm::core::isOk(resolved))
        {
            throw IpcException(vrcsm::core::error(resolved));
        }
    }

    return vrcsm::core::value(resolved);
}

nlohmann::json IpcBridge::HandleAssetsPrefetch(const nlohmann::json& params, const std::optional<std::string>& id)
{
    auto out = HandleAssetsResolve(params, id);
    out["ok"] = true;
    return out;
}

nlohmann::json IpcBridge::HandleAssetsInvalidate(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto type = JsonStringField(params, "type");
    const auto id = JsonStringField(params, "id");
    auto res = vrcsm::core::Database::Instance().InvalidateAssetCache(type, id);
    if (!vrcsm::core::isOk(res))
    {
        throw IpcException(vrcsm::core::error(res));
    }
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleDbWorldVisits(const nlohmann::json& params, const std::optional<std::string>&)
{
    const int limit = std::clamp(ParamInt(params, "limit", 250), 0, 5000);
    const int offset = ParamInt(params, "offset", 0);
    auto res = vrcsm::core::Database::Instance().RecentWorldVisits(limit, offset);
    return nlohmann::json{{"items", unwrapResult(std::move(res))}};
}

nlohmann::json IpcBridge::HandleDbPlayerEvents(const nlohmann::json& params, const std::optional<std::string>&)
{
    const int limit = ParamInt(params, "limit", 100);
    const int offset = ParamInt(params, "offset", 0);
    const auto worldId = JsonStringField(params, "world_id");
    const auto instanceId = JsonStringField(params, "instance_id");
    const auto occurredAfter = JsonStringField(params, "occurred_after");
    const auto occurredBefore = JsonStringField(params, "occurred_before");
    auto res = vrcsm::core::Database::Instance().RecentPlayerEvents(
        limit,
        offset,
        worldId,
        instanceId,
        occurredAfter,
        occurredBefore);
    return nlohmann::json{{"items", unwrapResult(std::move(res))}};
}

nlohmann::json IpcBridge::HandleDbPlayerEncounters(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto userId = JsonStringField(params, "user_id").value_or("");
    if (userId.empty())
    {
        throw IpcException(vrcsm::core::Error{"invalid_argument", "Missing 'user_id'", 0});
    }
    auto res = vrcsm::core::Database::Instance().EncountersForUser(userId);
    return nlohmann::json{{"items", unwrapResult(std::move(res))}};
}

nlohmann::json IpcBridge::HandleDbCoPresenceGraph(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto centerUserId = JsonStringField(params, "center_user_id").value_or("");
    if (centerUserId.empty())
    {
        throw IpcException(vrcsm::core::Error{"invalid_argument", "Missing 'center_user_id'", 0});
    }
    const int sinceDays = ParamInt(params, "since_days", 90);
    const int minOverlapSec = ParamInt(params, "min_overlap_sec", 60);
    auto res = vrcsm::core::Database::Instance().CoPresenceEgoNetwork(centerUserId, sinceDays, minOverlapSec);
    return unwrapResult(std::move(res));
}

nlohmann::json IpcBridge::HandleDbAvatarHistory(const nlohmann::json& params, const std::optional<std::string>&)
{
    const int limit = ParamInt(params, "limit", 100);
    const int offset = ParamInt(params, "offset", 0);
    auto res = vrcsm::core::Database::Instance().RecentAvatarHistory(limit, offset);
    return nlohmann::json{{"items", unwrapResult(std::move(res))}};
}

nlohmann::json IpcBridge::HandleDbAvatarBenchmarks(const nlohmann::json& params, const std::optional<std::string>&)
{
    const int limit = ParamInt(params, "limit", 200);
    const int offset = ParamInt(params, "offset", 0);
    auto res = vrcsm::core::Database::Instance().AvatarBenchmarks(limit, offset);
    return nlohmann::json{{"items", unwrapResult(std::move(res))}};
}

nlohmann::json IpcBridge::HandleDbAvatarHistoryCount(const nlohmann::json&, const std::optional<std::string>&)
{
    auto res = vrcsm::core::Database::Instance().AvatarHistoryCount();
    if (!vrcsm::core::isOk(res))
        throw IpcException(vrcsm::core::error(res));
    return nlohmann::json{{"count", std::get<std::int64_t>(res)}};
}

nlohmann::json IpcBridge::HandleDbAvatarHistoryRecord(const nlohmann::json& params, const std::optional<std::string>&)
{
    vrcsm::core::Database::AvatarSeenInsert a;
    a.avatar_id = JsonStringField(params, "avatar_id").value_or("");
    if (a.avatar_id.empty())
        throw IpcException(vrcsm::core::Error{"invalid_argument", "Missing 'avatar_id'", 0});
    if (auto n = JsonStringField(params, "avatar_name"); n.has_value()) a.avatar_name = *n;
    if (auto n = JsonStringField(params, "author_name"); n.has_value()) a.author_name = *n;
    if (auto n = JsonStringField(params, "first_seen_on"); n.has_value()) a.first_seen_on = *n;
    if (auto n = JsonStringField(params, "first_seen_user_id"); n.has_value()) a.first_seen_user_id = *n;
    if (auto n = JsonStringField(params, "release_status"); n.has_value()) a.release_status = *n;
    a.first_seen_at = JsonStringField(params, "first_seen_at").value_or(vrcsm::core::nowIso());
    auto res = vrcsm::core::Database::Instance().RecordAvatarSeen(a);
    if (!vrcsm::core::isOk(res))
        throw IpcException(vrcsm::core::error(res));
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleDbAvatarHistoryResolve(const nlohmann::json& params, const std::optional<std::string>&)
{
    vrcsm::core::Database::AvatarResolveUpdate u;
    u.avatar_id = JsonStringField(params, "avatar_id").value_or("");
    if (u.avatar_id.empty())
        throw IpcException(vrcsm::core::Error{"invalid_argument", "Missing 'avatar_id'", 0});

    u.resolved_avatar_id = JsonStringField(params, "resolved_avatar_id");
    u.resolved_thumbnail_url = JsonStringField(params, "resolved_thumbnail_url");
    u.resolved_image_url = JsonStringField(params, "resolved_image_url");
    u.resolution_source = JsonStringField(params, "resolution_source");
    u.resolution_status = JsonStringField(params, "resolution_status").value_or("");
    if (u.resolution_status.empty())
        throw IpcException(vrcsm::core::Error{"invalid_argument", "Missing 'resolution_status'", 0});
    u.resolved_at = JsonStringField(params, "resolved_at").value_or(vrcsm::core::nowIso());

    auto res = vrcsm::core::Database::Instance().UpdateAvatarResolution(u);
    if (!vrcsm::core::isOk(res))
        throw IpcException(vrcsm::core::error(res));
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleDbStatsHeatmap(const nlohmann::json& params, const std::optional<std::string>&)
{
    const int days = ParamInt(params, "days", 30);
    auto res = vrcsm::core::Database::Instance().ActivityHeatmap(days);
    return unwrapResult(std::move(res));
}

nlohmann::json IpcBridge::HandleDbStatsOverview(const nlohmann::json&, const std::optional<std::string>&)
{
    auto res = vrcsm::core::Database::Instance().StatsOverview();
    return unwrapResult(std::move(res));
}

nlohmann::json IpcBridge::HandleDbHistoryClear(const nlohmann::json& params, const std::optional<std::string>&)
{
    const bool includeFriendNotes =
        params.is_object()
        && params.contains("include_friend_notes")
        && params["include_friend_notes"].is_boolean()
        && params["include_friend_notes"].get<bool>();

    auto res = vrcsm::core::Database::Instance().ClearHistory(includeFriendNotes);
    return unwrapResult(std::move(res));
}

nlohmann::json IpcBridge::HandleDataUsage(const nlohmann::json&, const std::optional<std::string>&)
{
    const auto root = vrcsm::core::getAppDataRoot();

    nlohmann::json disk = nlohmann::json::object();
    for (const auto& t : diskTargets())
    {
        std::uint64_t bytes = 0;
        for (const auto rel : t.rel)
        {
            if (rel.empty()) continue;
            bytes += pathBytes(root / vrcsm::core::toWide(rel));
        }
        disk[std::string(t.key)] = bytes;
    }

    nlohmann::json tables = nlohmann::json::object();
    {
        auto res = vrcsm::core::Database::Instance().TableCounts();
        if (vrcsm::core::isOk(res))
        {
            tables = std::move(std::get<nlohmann::json>(res));
        }
        else
        {
            throw IpcException(std::move(std::get<vrcsm::core::Error>(res)));
        }
    }

    std::uint64_t dbFileBytes = 0;
    {
        std::error_code ec;
        const auto dbPath = vrcsm::core::Database::DefaultDbPath();
        const auto sz = std::filesystem::file_size(dbPath, ec);
        if (!ec) dbFileBytes = static_cast<std::uint64_t>(sz);
    }

    return nlohmann::json{
        {"disk", std::move(disk)},
        {"tables", std::move(tables)},
        {"dbFileBytes", dbFileBytes},
    };
}

nlohmann::json IpcBridge::HandleDataClear(const nlohmann::json& params, const std::optional<std::string>&)
{
    if (!params.is_object() || !params.contains("targets") || !params["targets"].is_array())
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_argument", "data.clear requires a 'targets' array", 0});
    }

    std::vector<std::string> requested;
    for (const auto& t : params["targets"])
    {
        if (t.is_string()) requested.push_back(t.get<std::string>());
    }

    const auto root = vrcsm::core::getAppDataRoot();
    nlohmann::json results = nlohmann::json::object();

    for (const auto& key : requested)
    {
        // 1. Disk-cache targets → SafeDelete::DeleteWithinRoot (root-scoped,
        //    junction-hardened). Paths are built from getAppDataRoot() + a
        //    compile-time relative constant; the caller's key only selects a
        //    fixed entry, it never contributes a path segment.
        const DiskTarget* diskDef = nullptr;
        for (const auto& d : diskTargets())
        {
            if (d.key == key) { diskDef = &d; break; }
        }
        if (diskDef != nullptr)
        {
            std::uint64_t deleted = 0;
            bool ok = true;
            std::string errCode;
            std::string errMsg;
            for (const auto rel : diskDef->rel)
            {
                if (rel.empty()) continue;
                const auto target = root / vrcsm::core::toWide(rel);
                auto res = vrcsm::core::SafeDelete::DeleteWithinRoot(root, target);
                if (vrcsm::core::isOk(res))
                {
                    deleted += static_cast<std::uint64_t>(vrcsm::core::value(res));
                }
                else
                {
                    ok = false;
                    errCode = vrcsm::core::error(res).code;
                    errMsg = vrcsm::core::error(res).message;
                    break;
                }
            }
            nlohmann::json entry{{"ok", ok}, {"kind", "disk"}, {"removed", deleted}};
            if (!ok)
            {
                entry["error"] = nlohmann::json{{"code", errCode}, {"message", errMsg}};
            }
            results[key] = std::move(entry);
            continue;
        }

        // 2. Table targets → Database::ClearTables (allowlist-validated).
        const std::vector<std::string>* tableList = nullptr;
        for (const auto& p : tableTargets())
        {
            if (p.first == key) { tableList = &p.second; break; }
        }
        if (tableList != nullptr)
        {
            auto res = vrcsm::core::Database::Instance().ClearTables(*tableList);
            if (vrcsm::core::isOk(res))
            {
                results[key] = nlohmann::json{
                    {"ok", true},
                    {"kind", "table"},
                    {"cleared", std::get<nlohmann::json>(res)},
                };
            }
            else
            {
                const auto& err = std::get<vrcsm::core::Error>(res);
                results[key] = nlohmann::json{
                    {"ok", false},
                    {"kind", "table"},
                    {"error", {{"code", err.code}, {"message", err.message}}},
                };
            }
            continue;
        }

        // 3. Unknown key → skipped, flagged in results. No default deletion.
        results[key] = nlohmann::json{{"ok", false}, {"skipped", true}, {"reason", "unknown_target"}};
    }

    return nlohmann::json{{"results", std::move(results)}};
}

nlohmann::json IpcBridge::HandleFavoritesLists(const nlohmann::json&, const std::optional<std::string>&)
{
    auto res = vrcsm::core::Database::Instance().FavoriteLists();
    return nlohmann::json{{"lists", unwrapResult(std::move(res))}};
}

nlohmann::json IpcBridge::HandleFavoritesItems(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto listName = JsonStringField(params, "list_name").value_or("");
    if (listName.empty())
    {
        throw IpcException(vrcsm::core::Error{"invalid_argument", "Missing 'list_name'", 0});
    }
    auto res = vrcsm::core::Database::Instance().FavoriteItems(listName);
    return nlohmann::json{{"items", unwrapResult(std::move(res))}};
}

nlohmann::json IpcBridge::HandleFavoritesAdd(const nlohmann::json& params, const std::optional<std::string>&)
{
    vrcsm::core::Database::FavoriteInsert f;
    f.type = JsonStringField(params, "type").value_or("");
    f.target_id = JsonStringField(params, "target_id").value_or("");
    f.list_name = JsonStringField(params, "list_name").value_or("");
    if (f.type.empty() || f.target_id.empty() || f.list_name.empty())
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_argument",
            "favorites.add requires type, target_id, list_name",
            0,
        });
    }
    f.display_name = JsonStringField(params, "display_name");
    f.thumbnail_url = JsonStringField(params, "thumbnail_url");
    f.added_at = JsonStringField(params, "added_at").value_or(vrcsm::core::nowIso());
    f.sort_order = ParamInt(params, "sort_order", 0);

    auto res = vrcsm::core::Database::Instance().AddFavorite(f);
    if (!vrcsm::core::isOk(res))
    {
        throw IpcException(vrcsm::core::error(res));
    }
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleFavoritesRemove(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto type = JsonStringField(params, "type").value_or("");
    const auto targetId = JsonStringField(params, "target_id").value_or("");
    const auto listName = JsonStringField(params, "list_name").value_or("");
    if (type.empty() || targetId.empty() || listName.empty())
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_argument",
            "favorites.remove requires type, target_id, list_name",
            0,
        });
    }
    auto res = vrcsm::core::Database::Instance().RemoveFavorite(type, targetId, listName);
    if (!vrcsm::core::isOk(res))
    {
        throw IpcException(vrcsm::core::error(res));
    }
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleFavoritesNoteSet(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto type = JsonStringField(params, "type").value_or("");
    const auto targetId = JsonStringField(params, "target_id").value_or("");
    const auto listName = JsonStringField(params, "list_name").value_or("");
    const auto note = JsonStringField(params, "note").value_or("");
    if (type.empty() || targetId.empty() || listName.empty())
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_argument",
            "favorites.note.set requires type, target_id, list_name",
            0,
        });
    }

    const auto updatedAt = vrcsm::core::nowIso();
    auto res = vrcsm::core::Database::Instance().SetFavoriteNote(
        type,
        targetId,
        listName,
        note,
        updatedAt);
    if (!vrcsm::core::isOk(res))
    {
        throw IpcException(vrcsm::core::error(res));
    }
    return nlohmann::json{{"ok", true}, {"updated_at", updatedAt}};
}

nlohmann::json IpcBridge::HandleFavoritesTagsSet(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto type = JsonStringField(params, "type").value_or("");
    const auto targetId = JsonStringField(params, "target_id").value_or("");
    const auto listName = JsonStringField(params, "list_name").value_or("");
    if (type.empty() || targetId.empty() || listName.empty())
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_argument",
            "favorites.tags.set requires type, target_id, list_name",
            0,
        });
    }

    std::vector<std::string> tags;
    if (params.contains("tags"))
    {
        if (!params["tags"].is_array())
        {
            throw IpcException(vrcsm::core::Error{
                "invalid_argument",
                "favorites.tags.set requires tags to be an array",
                0,
            });
        }
        for (const auto& tag : params["tags"])
        {
            if (!tag.is_string())
            {
                throw IpcException(vrcsm::core::Error{
                    "invalid_argument",
                    "favorites.tags.set requires every tag to be a string",
                    0,
                });
            }
            tags.push_back(tag.get<std::string>());
        }
    }

    const auto updatedAt = vrcsm::core::nowIso();
    auto res = vrcsm::core::Database::Instance().SetFavoriteTags(
        type,
        targetId,
        listName,
        tags,
        updatedAt);
    if (!vrcsm::core::isOk(res))
    {
        throw IpcException(vrcsm::core::error(res));
    }
    return nlohmann::json{{"ok", true}, {"updated_at", updatedAt}};
}

nlohmann::json IpcBridge::HandleFavoritesSyncOfficial(const nlohmann::json&, const std::optional<std::string>&)
{
    // VRChat groups favorites into named buckets (avatars1..4, worlds1..4),
    // each with a user-customisable displayName. Three endpoints have to be
    // joined to reconstruct that:
    //   1. /favorite/groups   → internal group name → displayName + type
    //   2. /favorites?type=…  → target id → which group it belongs to
    //   3. /avatars|worlds/favorites → name + thumbnail for each target
    // We mirror each group as its own local list named after the displayName.
    // If group membership can't be resolved (API shape drift, empty groups),
    // we fall back to the legacy single "VRChat Official Favorites" list so a
    // sync never silently drops the user's favorites.

    auto avatarsRes = vrcsm::core::VrcApi::fetchFavoritedAvatars();
    if (!vrcsm::core::isOk(avatarsRes))
    {
        throw IpcException(vrcsm::core::error(avatarsRes));
    }

    auto worldsRes = vrcsm::core::VrcApi::fetchFavoritedWorlds();
    if (!vrcsm::core::isOk(worldsRes))
    {
        throw IpcException(vrcsm::core::error(worldsRes));
    }

    // Group metadata: internal name (e.g. "avatars1") → display label. Failure
    // here is non-fatal — we degrade to internal names, then to the legacy list.
    std::unordered_map<std::string, std::string> groupLabel;
    if (auto groupsRes = vrcsm::core::VrcApi::fetchFavoriteGroups(); vrcsm::core::isOk(groupsRes))
    {
        for (const auto& g : vrcsm::core::value(groupsRes))
        {
            const auto name = FirstStringField(g, {"name"});
            if (!name.has_value() || name->empty())
            {
                continue;
            }
            const auto display = FirstStringField(g, {"displayName"});
            groupLabel[*name] = (display.has_value() && !display->empty()) ? *display : *name;
        }
    }

    // Membership: target id (avtr_/wrld_) → internal group name. The group is
    // carried in the favorite record's `tags`; VRChat puts exactly one group
    // tag per favorite, so we take the first tag that names a known group, or
    // the first tag as a last resort.
    const auto buildMembership = [&groupLabel](const std::vector<nlohmann::json>& records)
    {
        std::unordered_map<std::string, std::string> membership;
        for (const auto& rec : records)
        {
            const auto targetId = FirstStringField(rec, {"favoriteId"});
            if (!targetId.has_value() || targetId->empty())
            {
                continue;
            }
            if (!rec.contains("tags") || !rec["tags"].is_array())
            {
                continue;
            }
            std::optional<std::string> chosen;
            std::optional<std::string> firstTag;
            for (const auto& tag : rec["tags"])
            {
                if (!tag.is_string())
                {
                    continue;
                }
                const auto value = tag.get<std::string>();
                if (value.empty())
                {
                    continue;
                }
                if (!firstTag.has_value())
                {
                    firstTag = value;
                }
                if (groupLabel.count(value) != 0)
                {
                    chosen = value;
                    break;
                }
            }
            if (!chosen.has_value())
            {
                chosen = firstTag;
            }
            if (chosen.has_value())
            {
                membership[*targetId] = *chosen;
            }
        }
        return membership;
    };

    std::unordered_map<std::string, std::string> membership;
    bool membershipResolved = false;
    if (auto avatarRecsRes = vrcsm::core::VrcApi::fetchFavoriteRecords("avatar");
        vrcsm::core::isOk(avatarRecsRes))
    {
        const auto m = buildMembership(vrcsm::core::value(avatarRecsRes));
        membership.insert(m.begin(), m.end());
        membershipResolved = membershipResolved || !m.empty();
    }
    if (auto worldRecsRes = vrcsm::core::VrcApi::fetchFavoriteRecords("world");
        vrcsm::core::isOk(worldRecsRes))
    {
        const auto m = buildMembership(vrcsm::core::value(worldRecsRes));
        membership.insert(m.begin(), m.end());
        membershipResolved = membershipResolved || !m.empty();
    }

    auto& db = vrcsm::core::Database::Instance();

    // Replace the previous official snapshot wholesale. Clearing by source wipes
    // every synced group regardless of how its displayName has changed since the
    // last sync, leaving the user's own local lists untouched.
    auto clearRes = db.ClearFavoritesBySource("official");
    if (!vrcsm::core::isOk(clearRes))
    {
        throw IpcException(vrcsm::core::error(clearRes));
    }

    const auto syncedAt = vrcsm::core::nowIso();
    int sortOrder = 0;
    int imported = 0;
    std::set<std::string> listNames;

    const auto importRows = [&](const std::vector<nlohmann::json>& rows, const char* type)
    {
        for (const auto& row : rows)
        {
            const auto id = FirstStringField(row, {"id"});
            if (!id.has_value() || id->empty())
            {
                continue;
            }

            // Resolve this favorite's list: group displayName when membership is
            // known, else the legacy single bucket.
            std::string listName{kOfficialFavoritesListName};
            if (membershipResolved)
            {
                if (const auto it = membership.find(*id); it != membership.end())
                {
                    const auto labelIt = groupLabel.find(it->second);
                    listName = (labelIt != groupLabel.end()) ? labelIt->second : it->second;
                }
            }

            vrcsm::core::Database::FavoriteInsert favorite;
            favorite.type = type;
            favorite.target_id = *id;
            favorite.list_name = listName;
            favorite.display_name = FirstStringField(row, {"name", "displayName"});
            favorite.thumbnail_url = FirstStringField(row, {"thumbnailImageUrl", "imageUrl"});
            favorite.added_at = syncedAt;
            favorite.sort_order = sortOrder++;
            favorite.source = "official";

            auto addRes = db.AddFavorite(favorite);
            if (!vrcsm::core::isOk(addRes))
            {
                throw IpcException(vrcsm::core::error(addRes));
            }
            listNames.insert(listName);
            imported += 1;
        }
    };

    importRows(vrcsm::core::value(avatarsRes), "avatar");
    importRows(vrcsm::core::value(worldsRes), "world");

    return nlohmann::json{
        {"ok", true},
        {"lists", nlohmann::json(std::vector<std::string>(listNames.begin(), listNames.end()))},
        {"list_count", static_cast<int>(listNames.size())},
        {"grouped", membershipResolved},
        {"imported", imported},
        {"avatars", static_cast<int>(vrcsm::core::value(avatarsRes).size())},
        {"worlds", static_cast<int>(vrcsm::core::value(worldsRes).size())},
        {"synced_at", syncedAt},
    };
}

nlohmann::json IpcBridge::HandleFavoritesExport(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto listName = JsonStringField(params, "list_name").value_or("");
    if (listName.empty())
    {
        throw IpcException(vrcsm::core::Error{"invalid_argument", "Missing 'list_name'", 0});
    }
    auto res = vrcsm::core::Database::Instance().ExportFavoriteList(listName);
    return unwrapResult(std::move(res));
}

nlohmann::json IpcBridge::HandleFavoritesImport(const nlohmann::json& params, const std::optional<std::string>&)
{
    auto payload = RequireJsonField(params, "payload");
    auto res = vrcsm::core::Database::Instance().ImportFavoriteList(payload);
    if (!vrcsm::core::isOk(res))
    {
        throw IpcException(vrcsm::core::error(res));
    }
    return nlohmann::json{{"imported", vrcsm::core::value(res)}};
}

nlohmann::json IpcBridge::HandleFriendLogInsert(const nlohmann::json& params, const std::optional<std::string>&)
{
    vrcsm::core::Database::FriendLogInsert e;
    e.user_id = JsonStringField(params, "user_id").value_or("");
    e.event_type = JsonStringField(params, "event_type").value_or("");
    if (e.user_id.empty() || e.event_type.empty())
    {
        throw IpcException(vrcsm::core::Error{"invalid_argument", "user_id and event_type are required", 0});
    }
    if (auto old_value = JsonStringField(params, "old_value"); old_value.has_value())
    {
        e.old_value = *old_value;
    }
    if (auto new_value = JsonStringField(params, "new_value"); new_value.has_value())
    {
        e.new_value = *new_value;
    }
    if (auto dn = JsonStringField(params, "display_name"); dn.has_value())
    {
        e.display_name = *dn;
    }
    e.occurred_at = JsonStringField(params, "occurred_at").value_or("");
    if (e.occurred_at.empty())
    {
        e.occurred_at = vrcsm::core::nowIso();
    }

    auto res = vrcsm::core::Database::Instance().InsertFriendLog(e);
    if (!vrcsm::core::isOk(res))
    {
        throw IpcException(vrcsm::core::error(res));
    }
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleFriendLogRecent(const nlohmann::json& params, const std::optional<std::string>&)
{
    const int limit = ParamInt(params, "limit", 100);
    const int offset = ParamInt(params, "offset", 0);
    auto res = vrcsm::core::Database::Instance().RecentFriendLog(limit, offset);
    return nlohmann::json{{"items", unwrapResult(std::move(res))}};
}

nlohmann::json IpcBridge::HandleFriendLogForUser(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto userId = JsonStringField(params, "user_id").value_or("");
    if (userId.empty())
    {
        throw IpcException(vrcsm::core::Error{"invalid_argument", "Missing 'user_id'", 0});
    }
    const int limit = ParamInt(params, "limit", 100);
    const int offset = ParamInt(params, "offset", 0);
    auto res = vrcsm::core::Database::Instance().FriendLogForUser(userId, limit, offset);
    return nlohmann::json{{"items", unwrapResult(std::move(res))}};
}

nlohmann::json IpcBridge::HandleFriendNoteGet(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto userId = JsonStringField(params, "user_id").value_or("");
    if (userId.empty())
    {
        throw IpcException(vrcsm::core::Error{"invalid_argument", "Missing 'user_id'", 0});
    }
    auto res = vrcsm::core::Database::Instance().GetFriendNote(userId);
    if (!vrcsm::core::isOk(res))
    {
        throw IpcException(vrcsm::core::error(res));
    }
    const auto& note = vrcsm::core::value(res);
    if (note.has_value())
    {
        return nlohmann::json{{"note", *note}};
    }
    return nlohmann::json{{"note", nullptr}};
}

nlohmann::json IpcBridge::HandleFriendNoteAll(const nlohmann::json&, const std::optional<std::string>&)
{
    auto res = vrcsm::core::Database::Instance().AllFriendNotes();
    if (!vrcsm::core::isOk(res))
    {
        throw IpcException(vrcsm::core::error(res));
    }
    return nlohmann::json{{"items", vrcsm::core::value(res)}};
}

nlohmann::json IpcBridge::HandleFriendNoteSet(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto userId = JsonStringField(params, "user_id").value_or("");
    const auto note = JsonStringField(params, "note").value_or("");
    if (userId.empty())
    {
        throw IpcException(vrcsm::core::Error{"invalid_argument", "Missing 'user_id'", 0});
    }
    const auto updatedAt = vrcsm::core::nowIso();
    auto res = vrcsm::core::Database::Instance().SetFriendNote(userId, note, updatedAt);
    if (!vrcsm::core::isOk(res))
    {
        throw IpcException(vrcsm::core::error(res));
    }
    return nlohmann::json{{"ok", true}, {"updated_at", updatedAt}};
}

nlohmann::json IpcBridge::HandleFriendPresenceRecord(const nlohmann::json& params, const std::optional<std::string>&)
{
    vrcsm::core::Database::FriendPresenceEventInsert e;
    e.user_id = JsonStringField(params, "user_id").value_or("");
    e.event_type = JsonStringField(params, "event_type").value_or("");
    if (e.user_id.empty() || e.event_type.empty())
    {
        throw IpcException(vrcsm::core::Error{"invalid_argument", "user_id and event_type are required", 0});
    }
    if (auto v = JsonStringField(params, "display_name"); v.has_value()) e.display_name = *v;
    if (auto v = JsonStringField(params, "world_id"); v.has_value()) e.world_id = *v;
    if (auto v = JsonStringField(params, "instance_id"); v.has_value()) e.instance_id = *v;
    if (auto v = JsonStringField(params, "location"); v.has_value()) e.location = *v;
    if (auto v = JsonStringField(params, "status"); v.has_value()) e.status = *v;
    if (auto v = JsonStringField(params, "old_value"); v.has_value()) e.old_value = *v;
    if (auto v = JsonStringField(params, "new_value"); v.has_value()) e.new_value = *v;
    if (auto v = JsonStringField(params, "source"); v.has_value()) e.source = *v;
    e.occurred_at = JsonStringField(params, "occurred_at").value_or("");
    if (e.occurred_at.empty())
    {
        e.occurred_at = vrcsm::core::nowIso();
    }

    auto res = vrcsm::core::Database::Instance().RecordFriendPresenceEvent(e);
    if (!vrcsm::core::isOk(res))
    {
        throw IpcException(vrcsm::core::error(res));
    }
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleFriendPresenceRecent(const nlohmann::json& params, const std::optional<std::string>&)
{
    const int limit = ParamInt(params, "limit", 100);
    const int offset = ParamInt(params, "offset", 0);
    const auto userId = JsonStringField(params, "user_id");
    const auto eventType = JsonStringField(params, "event_type");
    const auto occurredAfter = JsonStringField(params, "occurred_after");
    const auto occurredBefore = JsonStringField(params, "occurred_before");
    auto res = vrcsm::core::Database::Instance().RecentFriendPresenceEvents(
        limit, offset, userId, eventType, occurredAfter, occurredBefore);
    return nlohmann::json{{"items", unwrapResult(std::move(res))}};
}

nlohmann::json IpcBridge::HandleFriendPresencePredict(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto userId = JsonStringField(params, "user_id").value_or("");
    const int topN = ParamInt(params, "top_n", 3);
    const int halfLifeWeeks = ParamInt(params, "half_life_weeks", 4);
    auto res = vrcsm::core::Database::Instance().PredictFriendOnlineWindows(
        userId, topN, halfLifeWeeks);
    return unwrapResult(std::move(res));
}

nlohmann::json IpcBridge::HandleFeedUnified(const nlohmann::json& params, const std::optional<std::string>&)
{
    const int limit = ParamInt(params, "limit", 100);
    const int offset = ParamInt(params, "offset", 0);
    const auto userId = JsonStringField(params, "user_id");
    const auto sourceKind = JsonStringField(params, "source_kind");
    const auto occurredAfter = JsonStringField(params, "occurred_after");
    const auto occurredBefore = JsonStringField(params, "occurred_before");
    auto res = vrcsm::core::Database::Instance().UnifiedFeed(
        limit, offset, userId, sourceKind, occurredAfter, occurredBefore);
    return nlohmann::json{{"items", unwrapResult(std::move(res))}};
}
