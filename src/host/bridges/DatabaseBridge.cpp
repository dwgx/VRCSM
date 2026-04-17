#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/Database.h"

namespace
{

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
    auto res = vrcsm::core::Database::Instance().RecentPlayerEvents(limit, offset);
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
