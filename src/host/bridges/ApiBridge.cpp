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

std::string SanitizeFilename(std::string value)
{
    for (char& ch : value)
    {
        switch (ch)
        {
        case '<':
        case '>':
        case ':':
        case '"':
        case '/':
        case '\\':
        case '|':
        case '?':
        case '*':
            ch = '_';
            break;
        default:
            break;
        }
    }

    while (!value.empty() && (value.back() == ' ' || value.back() == '.'))
    {
        value.pop_back();
    }

    if (value.empty())
    {
        return "avatar_bundle";
    }

    return value;
}

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
        {"currentAvatarId", JsonStringField(friendJson, "currentAvatar").value_or("")},
        {"currentAvatarName", JsonStringField(friendJson, "currentAvatarName").value_or("")},
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
        {"userIcon", JsonStringField(user, "userIcon").value_or("")},
        {"pronouns", JsonStringField(user, "pronouns").value_or("")},
        {"date_joined", JsonStringField(user, "date_joined").value_or("")},
        {"ageVerificationStatus", JsonStringField(user, "ageVerificationStatus").value_or("")},
        {"developerType", JsonStringField(user, "developerType").value_or("")},
        {"last_login", JsonStringField(user, "last_login").value_or("")},
        {"last_activity", JsonStringField(user, "last_activity").value_or("")},
        {"worldId", JsonStringField(user, "worldId").value_or("")},
        {"location", JsonStringField(user, "location").value_or("")},
        {"currentAvatarId", JsonStringField(user, "currentAvatar").value_or("")},
        {"currentAvatarName", JsonStringField(user, "currentAvatarName").value_or("")},
    };

    // Linked accounts — only present on the auth'd user object (user.me).
    // For other users these fields are absent from the API response, so
    // we guard with contains() and leave them out rather than defaulting to "".
    auto passStringIfPresent = [&](const char* key) {
        if (user.contains(key) && user[key].is_string())
            out[key] = user[key].get<std::string>();
    };
    auto passBoolIfPresent = [&](const char* key) {
        if (user.contains(key) && user[key].is_boolean())
            out[key] = user[key].get<bool>();
    };
    passStringIfPresent("googleId");
    passStringIfPresent("steamId");
    passStringIfPresent("oculusId");
    passStringIfPresent("picoId");
    passStringIfPresent("viveId");
    passBoolIfPresent("hasEmail");
    passBoolIfPresent("emailVerified");
    passBoolIfPresent("twoFactorAuthEnabled");
    passBoolIfPresent("allowAvatarCopying");
    passBoolIfPresent("hasLoggedInFromClient");

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

std::optional<int> JsonIntField(const nlohmann::json& json, const char* key)
{
    if (json.contains(key) && json[key].is_number_integer())
    {
        return json[key].get<int>();
    }
    return std::nullopt;
}

std::optional<bool> JsonBoolField(const nlohmann::json& json, const char* key)
{
    if (json.contains(key) && json[key].is_boolean())
    {
        return json[key].get<bool>();
    }
    return std::nullopt;
}

nlohmann::json FilterGroup(const nlohmann::json& groupJson)
{
    nlohmann::json out{
        {"id", JsonStringField(groupJson, "id").value_or("")},
        {"name", JsonStringField(groupJson, "name").value_or("")},
        {"shortCode", JsonStringField(groupJson, "shortCode").value_or("")},
        {"description", JsonStringField(groupJson, "description").value_or("")},
        {"iconUrl", JsonStringField(groupJson, "iconUrl").value_or("")},
        {"bannerUrl", JsonStringField(groupJson, "bannerUrl").value_or("")},
        {"discriminator", JsonStringField(groupJson, "discriminator").value_or("")},
        {"ownerId", JsonStringField(groupJson, "ownerId").value_or("")},
        {"memberCount", JsonIntField(groupJson, "memberCount").value_or(0)},
        {"onlineMemberCount", JsonIntField(groupJson, "onlineMemberCount").value_or(0)},
        {"privacy", JsonStringField(groupJson, "privacy").value_or("")},
        {"isVerified", JsonBoolField(groupJson, "isVerified").value_or(false)},
        {"isRepresenting", JsonBoolField(groupJson, "isRepresenting").value_or(false)},
        {"createdAt", JsonStringField(groupJson, "createdAt").value_or("")},
        {"lastPostCreatedAt", JsonStringField(groupJson, "lastPostCreatedAt").value_or("")},
    };

    if (groupJson.contains("roles") && groupJson["roles"].is_array())
    {
        nlohmann::json roles = nlohmann::json::array();
        for (const auto& role : groupJson["roles"])
        {
            if (!role.is_string()) continue;
            roles.push_back(role.get<std::string>());
        }
        out["roles"] = std::move(roles);
    }
    else
    {
        out["roles"] = nlohmann::json::array();
    }

    return out;
}

nlohmann::json FilterModeration(const nlohmann::json& moderationJson)
{
    return nlohmann::json{
        {"id", JsonStringField(moderationJson, "id").value_or("")},
        {"type", JsonStringField(moderationJson, "type").value_or("")},
        {"targetUserId", JsonStringField(moderationJson, "targetUserId").value_or("")},
        {"targetDisplayName", JsonStringField(moderationJson, "targetDisplayName").value_or("")},
        {"sourceUserId", JsonStringField(moderationJson, "sourceUserId").value_or("")},
        {"created", JsonStringField(moderationJson, "created").value_or("")},
    };
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
        const auto& err = vrcsm::core::error(currentUser);
        if (err.code == "auth_expired")
        {
            vrcsm::core::AuthStore::Instance().Clear();
        }
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

nlohmann::json IpcBridge::HandleGroupsList(const nlohmann::json&, const std::optional<std::string>&)
{
    const auto result = vrcsm::core::VrcApi::fetchGroups();
    if (!vrcsm::core::isOk(result))
    {
        const auto& err = vrcsm::core::error(result);
        if (err.code == "auth_expired")
        {
            vrcsm::core::AuthStore::Instance().Clear();
            return nlohmann::json{{"groups", nlohmann::json::array()}};
        }
        throw IpcException{err};
    }

    nlohmann::json out = nlohmann::json::array();
    for (const auto& item : vrcsm::core::value(result))
    {
        out.push_back(FilterGroup(item));
    }
    return nlohmann::json{{"groups", std::move(out)}};
}

nlohmann::json IpcBridge::HandleCalendarList(const nlohmann::json&, const std::optional<std::string>&)
{
    // Fire-and-best-effort: calendar is public-ish but we send the
    // cookie so the response is region-appropriate. If we're signed
    // out, return empty rather than erroring — the Dashboard tile
    // gracefully hides.
    const auto result = vrcsm::core::VrcApi::fetchCalendar();
    if (!vrcsm::core::isOk(result))
    {
        const auto& err = vrcsm::core::error(result);
        if (err.code == "auth_expired")
        {
            vrcsm::core::AuthStore::Instance().Clear();
        }
        return nlohmann::json{{"events", nlohmann::json::array()}};
    }
    return nlohmann::json{{"events", vrcsm::core::value(result)}};
}

nlohmann::json IpcBridge::HandleModerationsList(const nlohmann::json&, const std::optional<std::string>&)
{
    auto currentUser = vrcsm::core::VrcApi::fetchCurrentUser();
    if (!vrcsm::core::isOk(currentUser))
    {
        const auto& err = vrcsm::core::error(currentUser);
        if (err.code == "auth_expired")
        {
            vrcsm::core::AuthStore::Instance().Clear();
        }
        return nlohmann::json{{"items", nlohmann::json::array()}};
    }

    const auto result = vrcsm::core::VrcApi::fetchPlayerModerations();
    if (!vrcsm::core::isOk(result))
    {
        throw IpcException{vrcsm::core::error(result)};
    }

    nlohmann::json out = nlohmann::json::array();
    for (const auto& item : vrcsm::core::value(result))
    {
        out.push_back(FilterModeration(item));
    }
    return nlohmann::json{{"items", std::move(out)}};
}

nlohmann::json IpcBridge::HandleAvatarBundleDownload(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto avatarId = JsonStringField(params, "avatarId").value_or("");
    const auto assetUrl = JsonStringField(params, "assetUrl").value_or("");
    const auto outDir = JsonStringField(params, "outDir").value_or("");
    const auto displayName = JsonStringField(params, "displayName").value_or(avatarId);

    if (avatarId.empty() || assetUrl.empty() || outDir.empty())
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_argument",
            "avatar.bundle.download requires avatarId, assetUrl, outDir",
            0,
        });
    }

    const std::filesystem::path targetDir = Utf8ToWide(outDir);
    std::error_code ec;
    std::filesystem::create_directories(targetDir, ec);
    if (ec)
    {
        throw IpcException(vrcsm::core::Error{
            "io_error",
            fmt::format("Failed to create download directory: {}", ec.message()),
            0,
        });
    }

    const auto safeStem = SanitizeFilename(displayName);
    std::filesystem::path targetPath = targetDir / Utf8ToWide(fmt::format("{}-{}.vrca", safeStem, avatarId));

    if (!vrcsm::core::VrcApi::downloadFile(assetUrl, targetPath))
    {
        throw IpcException(vrcsm::core::Error{
            "download_failed",
            "Failed to download avatar bundle",
            0,
        });
    }

    return nlohmann::json{
        {"ok", true},
        {"path", WideToUtf8(targetPath.wstring())},
    };
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

nlohmann::json IpcBridge::HandleAvatarSearch(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto query = JsonStringField(params, "query");
    if (!query.has_value() || query->empty())
    {
        return nlohmann::json{{"avatars", nlohmann::json::array()}};
    }
    int count = 20;
    int offset = 0;
    if (params.contains("count") && params["count"].is_number_integer())
        count = params["count"].get<int>();
    if (params.contains("offset") && params["offset"].is_number_integer())
        offset = params["offset"].get<int>();
    return unwrapResult(vrcsm::core::VrcApi::searchAvatars(*query, count, offset));
}

nlohmann::json IpcBridge::HandleUserInvite(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto location = JsonStringField(params, "location");
    if (!location.has_value() || location->empty())
    {
        throw std::runtime_error("user.invite: missing 'location'");
    }
    return unwrapResult(vrcsm::core::VrcApi::inviteSelf(*location));
}

nlohmann::json IpcBridge::HandleUserMute(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto userId = JsonStringField(params, "userId");
    if (!userId.has_value() || userId->empty())
    {
        throw std::runtime_error("user.mute: missing 'userId'");
    }
    return unwrapResult(vrcsm::core::VrcApi::addPlayerModeration("mute", *userId));
}

nlohmann::json IpcBridge::HandleUserUnmute(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto id = JsonStringField(params, "moderationId");
    if (!id.has_value() || id->empty())
    {
        throw std::runtime_error("user.unmute: missing 'moderationId'");
    }
    return unwrapResult(vrcsm::core::VrcApi::removePlayerModeration(*id));
}

nlohmann::json IpcBridge::HandleUserBlock(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto userId = JsonStringField(params, "userId");
    if (!userId.has_value() || userId->empty())
    {
        throw std::runtime_error("user.block: missing 'userId'");
    }
    return unwrapResult(vrcsm::core::VrcApi::addPlayerModeration("block", *userId));
}

nlohmann::json IpcBridge::HandleUserUnblock(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto id = JsonStringField(params, "moderationId");
    if (!id.has_value() || id->empty())
    {
        throw std::runtime_error("user.unblock: missing 'moderationId'");
    }
    return unwrapResult(vrcsm::core::VrcApi::removePlayerModeration(*id));
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
    if (const auto pronouns = JsonStringField(params, "pronouns"); pronouns.has_value())
    {
        patch["pronouns"] = *pronouns;
    }
    if (const auto userIcon = JsonStringField(params, "userIcon"); userIcon.has_value())
    {
        patch["userIcon"] = *userIcon;
    }
    if (const auto profilePicOverride = JsonStringField(params, "profilePicOverride"); profilePicOverride.has_value())
    {
        patch["profilePicOverride"] = *profilePicOverride;
    }

    // bioLinks — VRChat accepts up to 4 URL strings. We trim empties and cap
    // the length here so a UI bug can't send garbage; the server also
    // validates but we want a cleaner 400 at the edge.
    if (params.contains("bioLinks") && params["bioLinks"].is_array())
    {
        nlohmann::json cleaned = nlohmann::json::array();
        for (const auto& item : params["bioLinks"])
        {
            if (!item.is_string()) continue;
            auto s = item.get<std::string>();
            // Trim whitespace.
            auto notWs = [](int c) { return !std::isspace(c); };
            s.erase(s.begin(), std::find_if(s.begin(), s.end(), notWs));
            s.erase(std::find_if(s.rbegin(), s.rend(), notWs).base(), s.end());
            if (s.empty()) continue;
            cleaned.push_back(std::move(s));
            if (cleaned.size() >= 4) break;
        }
        patch["bioLinks"] = std::move(cleaned);
    }

    // Tags passthrough (used for language_* tags, e.g. ["language_eng", "language_jpn"]).
    // The caller is expected to send the full tag set they want — VRChat's
    // PUT /users/{id} replaces the `tags` array wholesale.
    if (params.contains("tags") && params["tags"].is_array())
    {
        nlohmann::json cleaned = nlohmann::json::array();
        for (const auto& item : params["tags"])
        {
            if (item.is_string()) cleaned.push_back(item.get<std::string>());
        }
        patch["tags"] = std::move(cleaned);
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
    const auto bundlePath = JsonStringField(params, "bundlePath").value_or("");
    if (avatarId.empty())
    {
        return nlohmann::json{
            {"ok", false},
            {"code", "missing_avatar_id"},
            {"message", "avatarId is required"},
        };
    }

    const auto probe = vrcsm::core::PathProbe::Probe();
    const auto emitProgress = [this, avatarId](std::string_view phase, std::string_view message, std::size_t queuePosition = 0)
    {
        nlohmann::json event{
            {"event", "avatar.preview.progress"},
            {"data", {
                {"avatarId", avatarId},
                {"phase", phase},
                {"message", message},
                {"queuePosition", queuePosition},
            }},
        };
        m_host.PostMessageToWeb(event.dump());
    };

    std::shared_ptr<std::promise<std::string>> ownerPromise;
    std::shared_future<std::string> sharedFuture;
    bool owner = false;
    {
        std::lock_guard<std::mutex> lock(m_previewSharedMutex);
        if (const auto it = m_previewShared.find(avatarId); it != m_previewShared.end())
        {
            sharedFuture = it->second;
        }
        else
        {
            ownerPromise = std::make_shared<std::promise<std::string>>();
            sharedFuture = ownerPromise->get_future().share();
            m_previewShared[avatarId] = sharedFuture;
            owner = true;
        }
    }

    if (!owner)
    {
        emitProgress("extracting", "Running the avatar extractor");
        const auto joinedResult = sharedFuture.get();
        try { return nlohmann::json::parse(joinedResult); }
        catch (...)
        {
            return nlohmann::json{
                {"avatarId", avatarId},
                {"ok", false},
                {"code", "preview_failed"},
                {"message", "Joined preview request returned invalid JSON"},
            };
        }
    }

    vrcsm::core::Task task;
    task.key = avatarId;
    task.work = [avatarId, assetUrl, bundlePath, baseDir = probe.baseDir, this, emitProgress](const vrcsm::core::TaskToken& token) -> vrcsm::core::TaskResult
    {
        emitProgress("starting", "Preparing avatar preview");
        const auto result = vrcsm::core::AvatarPreview::Request(
            avatarId,
            baseDir,
            assetUrl,
            bundlePath,
            m_previewQueue,
            token,
            [emitProgress](std::string_view phase, std::string_view message)
            {
                emitProgress(phase, message);
            });
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

    task.onDone = [this, avatarId, ownerPromise, emitProgress](const vrcsm::core::TaskResult& taskResult)
    {
        std::string serialized;
        if (taskResult.error == "cancelled")
        {
            serialized = nlohmann::json{
                {"avatarId", avatarId},
                {"ok", false},
                {"code", "cancelled"},
                {"message", "Request superseded by a newer avatar.preview call"},
            }.dump();
            emitProgress("cancelled", "Preview request cancelled");
        }
        else if (taskResult.ok && !taskResult.value.empty())
        {
            serialized = taskResult.value;
            emitProgress("done", "Avatar preview ready");
        }
        else
        {
            serialized = nlohmann::json{
                {"avatarId", avatarId},
                {"ok", false},
                {"code", "preview_failed"},
                {"message", taskResult.error.empty() ? std::string("Avatar preview failed") : taskResult.error},
            }.dump();
            emitProgress("failed", taskResult.error.empty() ? "Avatar preview failed" : taskResult.error);
        }

        {
            std::lock_guard<std::mutex> lock(m_previewSharedMutex);
            m_previewShared.erase(avatarId);
        }
        ownerPromise->set_value(std::move(serialized));
    };

    const auto queuePosition = m_previewQueue.PendingCount() + 1;
    emitProgress(
        queuePosition > 1 ? "queued" : "starting",
        queuePosition > 1 ? "Waiting for the preview queue" : "Preparing avatar preview",
        queuePosition);
    m_previewQueue.Submit(std::move(task));
    const auto finalResult = sharedFuture.get();
    try { return nlohmann::json::parse(finalResult); }
    catch (...)
    {
        return nlohmann::json{
            {"avatarId", avatarId},
            {"ok", false},
            {"code", "preview_failed"},
            {"message", "Preview request returned invalid JSON"},
        };
    }
}

nlohmann::json IpcBridge::HandleCalendarDiscover(const nlohmann::json&, const std::optional<std::string>&)
{
    auto res = vrcsm::core::VrcApi::fetchCalendarDiscover();
    if (std::holds_alternative<vrcsm::core::Error>(res))
        throw IpcException(std::get<vrcsm::core::Error>(res));
    return nlohmann::json{{"events", std::get<std::vector<nlohmann::json>>(res)}};
}

nlohmann::json IpcBridge::HandleCalendarFeatured(const nlohmann::json&, const std::optional<std::string>&)
{
    auto res = vrcsm::core::VrcApi::fetchCalendarFeatured();
    if (std::holds_alternative<vrcsm::core::Error>(res))
        throw IpcException(std::get<vrcsm::core::Error>(res));
    return nlohmann::json{{"events", std::get<std::vector<nlohmann::json>>(res)}};
}

nlohmann::json IpcBridge::HandleJamsList(const nlohmann::json&, const std::optional<std::string>&)
{
    return unwrapResult(vrcsm::core::VrcApi::fetchJams());
}

nlohmann::json IpcBridge::HandleJamDetail(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto jamId = JsonStringField(params, "jamId");
    if (!jamId.has_value() || jamId->empty())
        throw IpcException({"missing_field", "jams.detail: missing 'jamId'", 400});
    return unwrapResult(vrcsm::core::VrcApi::fetchJamDetail(*jamId));
}

nlohmann::json IpcBridge::HandleWorldsSearch(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto query = JsonStringField(params, "query");
    if (!query.has_value() || query->empty())
        throw IpcException({"missing_field", "worlds.search: missing 'query'", 400});

    const std::string sort = params.contains("sort") && params["sort"].is_string()
        ? params["sort"].get<std::string>() : "relevance";
    const int n = ParamInt(params, "n", 20);
    const int offset = ParamInt(params, "offset", 0);

    return unwrapResult(vrcsm::core::VrcApi::searchWorlds(*query, sort, n, offset));
}

nlohmann::json IpcBridge::HandleFriendsUnfriend(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto userId = JsonStringField(params, "userId");
    if (!userId.has_value() || userId->empty())
        throw IpcException({"missing_field", "friends.unfriend: missing 'userId'", 400});

    return unwrapResult(vrcsm::core::VrcApi::unfriend(*userId));
}

nlohmann::json IpcBridge::HandleFriendsRequest(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto userId = JsonStringField(params, "userId");
    if (!userId.has_value() || userId->empty())
        throw IpcException({"missing_field", "friends.request: missing 'userId'", 400});

    return unwrapResult(vrcsm::core::VrcApi::sendFriendRequest(*userId));
}
