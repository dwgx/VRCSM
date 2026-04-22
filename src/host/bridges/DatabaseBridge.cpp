#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/Database.h"
#include "../../core/VrcApi.h"

namespace
{

constexpr std::string_view kOfficialFavoritesListName = "VRChat Official Favorites";

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

} // namespace

nlohmann::json IpcBridge::HandleDbWorldVisits(const nlohmann::json& params, const std::optional<std::string>&)
{
    const int limit = ParamInt(params, "limit", 100);
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

nlohmann::json IpcBridge::HandleDbAvatarHistory(const nlohmann::json& params, const std::optional<std::string>&)
{
    const int limit = ParamInt(params, "limit", 100);
    const int offset = ParamInt(params, "offset", 0);
    auto res = vrcsm::core::Database::Instance().RecentAvatarHistory(limit, offset);
    return nlohmann::json{{"items", unwrapResult(std::move(res))}};
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
    a.first_seen_at = JsonStringField(params, "first_seen_at").value_or(vrcsm::core::nowIso());
    auto res = vrcsm::core::Database::Instance().RecordAvatarSeen(a);
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

    auto& db = vrcsm::core::Database::Instance();
    auto clearRes = db.ClearFavoriteList(std::string(kOfficialFavoritesListName));
    if (!vrcsm::core::isOk(clearRes))
    {
        throw IpcException(vrcsm::core::error(clearRes));
    }

    const auto syncedAt = vrcsm::core::nowIso();
    int sortOrder = 0;
    int imported = 0;

    const auto importRows = [&](const std::vector<nlohmann::json>& rows, const char* type)
    {
        for (const auto& row : rows)
        {
            const auto id = FirstStringField(row, {"id"});
            if (!id.has_value() || id->empty())
            {
                continue;
            }

            vrcsm::core::Database::FavoriteInsert favorite;
            favorite.type = type;
            favorite.target_id = *id;
            favorite.list_name = std::string(kOfficialFavoritesListName);
            favorite.display_name = FirstStringField(row, {"name", "displayName"});
            favorite.thumbnail_url = FirstStringField(row, {"thumbnailImageUrl", "imageUrl"});
            favorite.added_at = syncedAt;
            favorite.sort_order = sortOrder++;

            auto addRes = db.AddFavorite(favorite);
            if (!vrcsm::core::isOk(addRes))
            {
                throw IpcException(vrcsm::core::error(addRes));
            }
            imported += 1;
        }
    };

    importRows(vrcsm::core::value(avatarsRes), "avatar");
    importRows(vrcsm::core::value(worldsRes), "world");

    return nlohmann::json{
        {"ok", true},
        {"list_name", std::string(kOfficialFavoritesListName)},
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
