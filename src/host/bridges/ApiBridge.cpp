#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/AuthStore.h"
#include "../../core/AvatarPreview.h"
#include "../../core/PathProbe.h"
#include "../../core/TaskQueue.h"
#include "../../core/VrcApi.h"

#include <future>

namespace
{

nlohmann::json FilterFriend(const nlohmann::json& friendJson)
{
    nlohmann::json out{
        {"id", JsonStringField(friendJson, "id").value_or("")},
        {"displayName", JsonStringField(friendJson, "displayName").value_or("")},
        {"userId", JsonStringField(friendJson, "id").value_or("")},
        {"statusDescription", JsonStringField(friendJson, "statusDescription").value_or("")},
        {"location", JsonStringField(friendJson, "location").value_or("")},
        {"currentAvatarImageUrl", JsonStringField(friendJson, "currentAvatarImageUrl").value_or("")},
        {"currentAvatarThumbnailImageUrl", JsonStringField(friendJson, "currentAvatarThumbnailImageUrl").value_or("")},
        {"status", JsonStringField(friendJson, "status").value_or("")},
        {"last_platform", JsonStringField(friendJson, "last_platform").value_or("")},
        {"bio", JsonStringField(friendJson, "bio").value_or("")},
        {"developerType", JsonStringField(friendJson, "developerType").value_or("")},
        {"last_login", JsonStringField(friendJson, "last_login").value_or("")},
        {"last_activity", JsonStringField(friendJson, "last_activity").value_or("")},
        {"profilePicOverride", JsonStringField(friendJson, "profilePicOverride").value_or("")},
        {"userIcon", JsonStringField(friendJson, "userIcon").value_or("")},
    };

    nlohmann::json tags = nlohmann::json::array();
    if (friendJson.contains("tags") && friendJson["tags"].is_array())
    {
        for (const auto& tag : friendJson["tags"])
        {
            if (!tag.is_string()) continue;
            const auto tagStr = tag.get<std::string>();
            if (tagStr.rfind("system_trust_", 0) == 0
                || tagStr == "admin_moderator"
                || tagStr == "admin_scripting_access"
                || tagStr == "admin_avatar_access")
            {
                tags.push_back(tagStr);
            }
        }
    }
    out["tags"] = std::move(tags);

    return out;
}

nlohmann::json FilterUserProfile(const nlohmann::json& user)
{
    nlohmann::json out{
        {"id", JsonStringField(user, "id").value_or("")},
        {"displayName", JsonStringField(user, "displayName").value_or("")},
        {"bio", JsonStringField(user, "bio").value_or("")},
        {"status", JsonStringField(user, "status").value_or("offline")},
        {"statusDescription", JsonStringField(user, "statusDescription").value_or("")},
        {"currentAvatarImageUrl", JsonStringField(user, "currentAvatarImageUrl").value_or("")},
        {"currentAvatarThumbnailImageUrl", JsonStringField(user, "currentAvatarThumbnailImageUrl").value_or("")},
        {"profilePicOverride", JsonStringField(user, "profilePicOverride").value_or("")},
        {"developerType", JsonStringField(user, "developerType").value_or("")},
        {"last_login", JsonStringField(user, "last_login").value_or("")},
        {"last_activity", JsonStringField(user, "last_activity").value_or("")},
        {"worldId", JsonStringField(user, "worldId").value_or("")},
        {"location", JsonStringField(user, "location").value_or("")},
        {"currentAvatarId", JsonStringField(user, "currentAvatar").value_or("")},
        {"currentAvatarName", JsonStringField(user, "currentAvatarName").value_or("")},
    };

    nlohmann::json bioLinks = nlohmann::json::array();
    if (user.contains("bioLinks") && user["bioLinks"].is_array())
    {
        for (const auto& link : user["bioLinks"])
        {
            if (link.is_string()) bioLinks.push_back(link.get<std::string>());
        }
    }
    out["bioLinks"] = std::move(bioLinks);

    nlohmann::json tags = nlohmann::json::array();
    if (user.contains("tags") && user["tags"].is_array())
    {
        for (const auto& tag : user["tags"])
        {
            if (tag.is_string()) tags.push_back(tag.get<std::string>());
        }
    }
    out["tags"] = std::move(tags);

    return out;
}

} // namespace

nlohmann::json IpcBridge::HandleThumbnailsFetch(const nlohmann::json& params, const std::optional<std::string>&)
{
    std::vector<std::string> ids;
    if (params.contains("ids") && params["ids"].is_array())
    {
        for (const auto& v : params["ids"])
        {
            if (v.is_string()) ids.push_back(v.get<std::string>());
        }
    }
    else if (params.contains("id") && params["id"].is_string())
    {
        ids.push_back(params["id"].get<std::string>());
    }

    const auto results = vrcsm::core::VrcApi::fetchThumbnails(ids);
    nlohmann::json out = nlohmann::json::array();
    for (const auto& r : results)
    {
        out.push_back(ToJson(r));
    }
    return nlohmann::json{{"results", std::move(out)}};
}

nlohmann::json IpcBridge::HandleFriendsList(const nlohmann::json& params, const std::optional<std::string>&)
{
    const bool offline = params.contains("offline") && params["offline"].is_boolean()
        ? params["offline"].get<bool>()
        : false;

    auto currentUser = vrcsm::core::VrcApi::fetchCurrentUser();
    if (!vrcsm::core::isOk(currentUser))
    {
        vrcsm::core::AuthStore::Instance().Clear();
        return nlohmann::json{{"friends", nlohmann::json::array()}};
    }

    const auto result = vrcsm::core::VrcApi::fetchFriends(offline);
    if (!vrcsm::core::isOk(result))
    {
        throw IpcException{vrcsm::core::error(result)};
    }
    const auto& friends = vrcsm::core::value(result);

    nlohmann::json out = nlohmann::json::array();
    for (const auto& item : friends)
    {
        out.push_back(FilterFriend(item));
    }

    return nlohmann::json{{"friends", std::move(out)}};
}

nlohmann::json IpcBridge::HandleAvatarDetails(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto idField = JsonStringField(params, "id");
    if (!idField.has_value() || idField->empty())
    {
        return nlohmann::json{{"details", nullptr}};
    }
    return nlohmann::json{{"details", unwrapResult(vrcsm::core::VrcApi::fetchAvatarDetails(*idField))}};
}

nlohmann::json IpcBridge::HandleWorldDetails(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto idField = JsonStringField(params, "id");
    if (!idField.has_value() || idField->empty())
    {
        return nlohmann::json{{"details", nullptr}};
    }
    return nlohmann::json{{"details", unwrapResult(vrcsm::core::VrcApi::fetchWorldDetails(*idField))}};
}

nlohmann::json IpcBridge::HandleAvatarSelect(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto avatarId = JsonStringField(params, "avatarId");
    if (!avatarId.has_value() || avatarId->empty())
    {
        throw std::runtime_error("avatar.select: missing 'avatarId'");
    }
    return unwrapResult(vrcsm::core::VrcApi::selectAvatar(*avatarId));
}

nlohmann::json IpcBridge::HandleUserMe(const nlohmann::json&, const std::optional<std::string>&)
{
    auto user = unwrapResult(vrcsm::core::VrcApi::fetchCurrentUser());
    return nlohmann::json{{"profile", FilterUserProfile(user)}};
}

nlohmann::json IpcBridge::HandleUserGetProfile(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto userId = JsonStringField(params, "userId");
    if (!userId.has_value() || userId->empty())
    {
        return nlohmann::json{{"profile", nullptr}};
    }
    auto user = unwrapResult(vrcsm::core::VrcApi::fetchUser(*userId));
    return nlohmann::json{{"profile", FilterUserProfile(user)}};
}

nlohmann::json IpcBridge::HandleUserUpdateProfile(const nlohmann::json& params, const std::optional<std::string>&)
{
    nlohmann::json patch = nlohmann::json::object();
    if (const auto bio = JsonStringField(params, "bio"); bio.has_value())
    {
        patch["bio"] = *bio;
    }
    if (const auto statusDesc = JsonStringField(params, "statusDescription"); statusDesc.has_value())
    {
        patch["statusDescription"] = *statusDesc;
    }
    if (const auto status = JsonStringField(params, "status"); status.has_value())
    {
        patch["status"] = *status;
    }

    if (patch.empty())
    {
        return nlohmann::json{{"profile", nullptr}, {"error", "no fields to update"}};
    }

    auto updated = unwrapResult(vrcsm::core::VrcApi::updateAuthUser(patch));
    return nlohmann::json{{"profile", FilterUserProfile(updated)}};
}

nlohmann::json IpcBridge::HandleAvatarPreviewRequest(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto avatarId = JsonStringField(params, "avatarId").value_or("");
    const auto assetUrl = JsonStringField(params, "assetUrl").value_or("");
    if (avatarId.empty())
    {
        return nlohmann::json{
            {"ok", false},
            {"code", "missing_avatar_id"},
            {"message", "avatarId is required"},
        };
    }

    std::promise<vrcsm::core::AvatarPreviewResult> promise;
    auto future = promise.get_future();

    const auto probe = vrcsm::core::PathProbe::Probe();

    vrcsm::core::Task task;
    task.key = avatarId;
    task.work = [avatarId, assetUrl, baseDir = probe.baseDir, this](const vrcsm::core::TaskToken& token) -> vrcsm::core::TaskResult
    {
        const auto result = vrcsm::core::AvatarPreview::Request(avatarId, baseDir, assetUrl, m_previewQueue, token);
        nlohmann::json out;
        out["avatarId"] = avatarId;
        out["ok"] = result.ok;
        if (result.ok)
        {
            out["glbUrl"] = result.glbUrl;
            if (!result.glbPath.empty()) out["glbPath"] = result.glbPath;
            out["cached"] = result.cached;
        }
        else
        {
            out["code"] = result.code.empty() ? std::string("preview_failed") : result.code;
            out["message"] = result.message;
        }
        return vrcsm::core::TaskResult{result.ok, out.dump(), result.message};
    };

    task.onDone = [&promise](const vrcsm::core::TaskResult& taskResult)
    {
        vrcsm::core::AvatarPreviewResult result;
        if (taskResult.error == "cancelled")
        {
            result.code = "cancelled";
            result.message = "Request superseded by a newer avatar.preview call";
        }
        else if (taskResult.ok)
        {
            result.ok = true;
            result.glbPath = taskResult.value;
        }
        else
        {
            result.code = "preview_failed";
            result.message = taskResult.error;
        }
        promise.set_value(std::move(result));
    };

    m_previewQueue.Submit(std::move(task));
    auto queueResult = future.get();

    if (!queueResult.glbPath.empty() && queueResult.glbPath.front() == '{')
    {
        try { return nlohmann::json::parse(queueResult.glbPath); }
        catch (...) {}
    }

    nlohmann::json out;
    out["avatarId"] = avatarId;
    out["ok"] = queueResult.ok;
    out["code"] = queueResult.code.empty() ? std::string("preview_failed") : queueResult.code;
    out["message"] = queueResult.message;
    return out;
}
