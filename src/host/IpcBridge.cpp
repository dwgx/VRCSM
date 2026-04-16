#include "../pch.h"

#include "IpcBridge.h"

#include "StringUtil.h"
#include "WebViewHost.h"

#include "../core/AvatarPreview.h"

#include "../core/AuthStore.h"
#include "../core/BundleSniff.h"
#include "../core/CacheScanner.h"
#include "../core/JunctionUtil.h"
#include "../core/LogEventClassifier.h"
#include "../core/Migrator.h"
#include "../core/PathProbe.h"
#include "../core/ProcessGuard.h"
#include "../core/SafeDelete.h"
#include "../core/VrcApi.h"
#include "../core/VrcSettings.h"

#include <KnownFolders.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shobjidl.h>

#include <thread>
#include <unordered_set>

namespace
{
// IPC methods that touch the filesystem, WinHTTP, or the VRChat API.
// These run on a detached worker so the WebView2 UI thread is never
// blocked by a multi-second scan/thumbnail-fetch/API call. The UI can
// keep rendering and fire other IPCs while the slow work runs in the
// background; the result is posted back via PostResult on the worker
// thread, which is safe because PostMessageToWeb marshals to the UI
// thread internally.
const std::unordered_set<std::string>& AsyncMethodSet()
{
    static const std::unordered_set<std::string> kMethods = {
        "scan",
        "bundle.preview",
        "delete.dryRun",
        "delete.execute",
        "settings.readAll",
        "settings.writeOne",
        "settings.exportReg",
        "migrate.preflight",
        "junction.repair",
        "thumbnails.fetch",
        "auth.status",
        "auth.user",
        "auth.logout",
        "auth.login",
        "auth.verify2FA",
        "friends.list",
        "avatar.details",
        "world.details",
        "avatar.preview",
        "avatar.select",
        "user.me",
        "user.getProfile",
        "user.updateProfile",
        "screenshots.list",
        "app.factoryReset",
    };
    return kMethods;
}

template <typename T>
nlohmann::json ToJson(const T& value)
{
    return nlohmann::json(value);
}

std::optional<std::string> ExtractId(const nlohmann::json& envelope)
{
    if (!envelope.contains("id") || envelope["id"].is_null())
    {
        return std::nullopt;
    }

    return envelope.at("id").get<std::string>();
}

std::optional<std::string> JsonStringField(const nlohmann::json& json, const char* key)
{
    if (json.contains(key) && json[key].is_string())
    {
        return json[key].get<std::string>();
    }
    return std::nullopt;
}

// Structured exception carrying a full Error — the dispatch layer catches
// this to produce `PostError(id, err.code, err.message)` with the correct
// error code instead of the generic "handler_error".
struct IpcException : std::exception
{
    vrcsm::core::Error err;
    explicit IpcException(vrcsm::core::Error e) : err(std::move(e)) {}
    const char* what() const noexcept override { return err.message.c_str(); }
};

// Unwrap a `Result<json>` — returns the value on success, throws
// `IpcException` on failure so the dispatch layer can surface the
// structured error code all the way to the frontend.
nlohmann::json unwrapResult(vrcsm::core::Result<nlohmann::json>&& r)
{
    if (vrcsm::core::isOk(r))
    {
        return std::move(std::get<nlohmann::json>(r));
    }
    throw IpcException(std::move(std::get<vrcsm::core::Error>(r)));
}

nlohmann::json MakeAuthSummary(const nlohmann::json& user)
{
    nlohmann::json out{
        {"authed", true},
        {"displayName", JsonStringField(user, "displayName").value_or("")},
    };

    if (const auto id = JsonStringField(user, "id"); id.has_value())
    {
        out["userId"] = *id;
    }
    else
    {
        out["userId"] = nullptr;
    }

    return out;
}

nlohmann::json FilterFriend(const nlohmann::json& friendJson)
{
    // VRCX-parity fields — we pull the same subset their UserDialog renders
    // (trust tags, bio, last-seen timestamps, developerType, profilePicOverride)
    // so our Friends page can match feature-by-feature. Every lookup is guarded
    // so missing fields degrade to empty string / null rather than crashing the
    // whole batch when one friend's record is partial.
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

    // Trust tags (`system_trust_*`) live inside the `tags` array — we only
    // echo the tags we'll actually need on the frontend so the IPC envelope
    // stays small. Everything else (`system_feedback_access`, language tags,
    // etc.) is discarded at this layer.
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

// Shape the raw VRChat user JSON into the `VrcUserProfile` contract the
// frontend `ProfileCard` component expects. Extra fields in the upstream
// payload are dropped here so the IPC envelope stays compact and the
// schema on the TypeScript side remains a closed set. Missing fields
// degrade to empty strings / nullopt rather than raising, because
// VRChat's `/auth/user` vs `/users/{id}` endpoints return subtly
// different shapes (e.g. `last_activity` lives on friends only).
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
    };

    // bioLinks — VRChat stores these as a `bioLinks` array of strings.
    // Pass through as-is when present; otherwise emit an empty array so
    // the frontend can unconditionally `.map()` over it.
    nlohmann::json bioLinks = nlohmann::json::array();
    if (user.contains("bioLinks") && user["bioLinks"].is_array())
    {
        for (const auto& link : user["bioLinks"])
        {
            if (link.is_string()) bioLinks.push_back(link.get<std::string>());
        }
    }
    out["bioLinks"] = std::move(bioLinks);

    // Tag subset — same filter as FilterFriend so the UI renders the
    // trust badges (system_trust_*) consistently across Friends and
    // Profile cards.
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

// Percent-encode a path segment so it survives being embedded in a URL.
// VRChat screenshot filenames include spaces, `VRChat_<world>_<datetime>.png`
// and in some builds the world name can contain any printable character.
// Reserved unreserved set per RFC 3986 section 2.3.
std::string UrlEncodeSegment(std::string_view input)
{
    std::string out;
    out.reserve(input.size() + 16);
    for (const unsigned char c : input)
    {
        const bool unreserved =
            (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
            || c == '-' || c == '_' || c == '.' || c == '~';
        if (unreserved)
        {
            out.push_back(static_cast<char>(c));
        }
        else
        {
            static const char kHex[] = "0123456789ABCDEF";
            out.push_back('%');
            out.push_back(kHex[(c >> 4) & 0xF]);
            out.push_back(kHex[c & 0xF]);
        }
    }
    return out;
}

// Build the absolute path to the VRChat screenshots folder. The default
// location is `%USERPROFILE%\Pictures\VRChat` but VRChat writes into
// whatever SHGetKnownFolderPath(Pictures) resolves to, so we use the
// same API rather than hardcoding the English folder name (which
// breaks for users with localized %USERPROFILE%\Pictures\ names).
std::filesystem::path ScreenshotsRootDir()
{
    wil::unique_cotaskmem_string picturesPath;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_Pictures, 0, nullptr, picturesPath.put())))
    {
        return std::filesystem::path(picturesPath.get()) / L"VRChat";
    }
    // Fallback — build from environment.
    wchar_t buffer[MAX_PATH]{};
    const DWORD length = GetEnvironmentVariableW(L"USERPROFILE", buffer, MAX_PATH);
    if (length > 0 && length < MAX_PATH)
    {
        return std::filesystem::path(buffer) / L"Pictures" / L"VRChat";
    }
    return {};
}
}

IpcBridge::IpcBridge(WebViewHost& host)
    : m_host(host)
{
    (void)vrcsm::core::AuthStore::Instance().Load();
    RegisterHandlers();

    // Spin up the VRChat process watcher now. It pushes a
    // `process.vrcStatusChanged` event on every transition (first tick
    // also emits so the frontend has initial state without polling).
    // See ProcessGuard::StartWatcher for cadence details.
    vrcsm::core::ProcessGuard::StartWatcher([this](const vrcsm::core::ProcessStatus& status)
    {
        nlohmann::json envelope{
            {"event", "process.vrcStatusChanged"},
            {"data", ToJson(status)},
        };
        m_host.PostMessageToWeb(envelope.dump());
    });
}

IpcBridge::~IpcBridge()
{
    // StopWatcher blocks until the polling thread exits, which prevents
    // the captured `this` from being used after destruction.
    vrcsm::core::ProcessGuard::StopWatcher();
}

void IpcBridge::Dispatch(const std::string& jsonText)
{
    std::optional<std::string> id;

    try
    {
        const nlohmann::json envelope = nlohmann::json::parse(jsonText);
        id = ExtractId(envelope);

        const std::string method = envelope.at("method").get<std::string>();
        const nlohmann::json params = envelope.value("params", nlohmann::json::object());

        const auto it = m_handlers.find(method);
        if (it == m_handlers.end())
        {
            PostError(id, "method_not_found", fmt::format("Unknown IPC method: {}", method));
            return;
        }

        // Slow handlers run on a detached worker so the UI thread is
        // never blocked. Fast/UI-bound handlers (path.probe, shell.*,
        // logs.stream.start/stop, migrate.execute which already spawns
        // its own thread) stay inline to avoid a pointless thread hop.
        if (AsyncMethodSet().count(method) > 0)
        {
            auto handler = it->second;
            const auto capturedId = id;
            std::thread([this, handler = std::move(handler), params, capturedId, method]()
            {
                try
                {
                    PostResult(capturedId, handler(params, capturedId));
                }
                catch (const IpcException& ex)
                {
                    PostError(capturedId, ex.err);
                }
                catch (const std::exception& ex)
                {
                    PostError(capturedId, "handler_error", ex.what());
                }
                catch (...)
                {
                    PostError(capturedId, "handler_error", "Unknown handler failure");
                }
            }).detach();
            return;
        }

        try
        {
            PostResult(id, it->second(params, id));
        }
        catch (const IpcException& ex)
        {
            PostError(id, ex.err);
        }
        catch (const std::exception& ex)
        {
            PostError(id, "handler_error", ex.what());
        }
        catch (...)
        {
            PostError(id, "handler_error", "Unknown handler failure");
        }
    }
    catch (const std::exception& ex)
    {
        PostError(id, "invalid_request", ex.what());
    }
    catch (...)
    {
        PostError(id, "invalid_request", "Unknown dispatch failure");
    }
}

void IpcBridge::RegisterHandlers()
{
    // IPC roster is now 24 methods: the original shell/cache/settings
    // calls, plus live logs, plus the v0.2.0 auth + friends endpoints.
    m_handlers.emplace("app.version", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleAppVersion(params, id);
    });
    m_handlers.emplace("path.probe", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandlePathProbe(params, id);
    });
    m_handlers.emplace("scan", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleScan(params, id);
    });
    m_handlers.emplace("bundle.preview", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleBundlePreview(params, id);
    });
    m_handlers.emplace("delete.dryRun", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleDeleteDryRun(params, id);
    });
    m_handlers.emplace("delete.execute", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleDeleteExecute(params, id);
    });
    m_handlers.emplace("process.vrcRunning", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleProcessVrcRunning(params, id);
    });
    m_handlers.emplace("settings.readAll", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleSettingsReadAll(params, id);
    });
    m_handlers.emplace("settings.writeOne", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleSettingsWriteOne(params, id);
    });
    m_handlers.emplace("settings.exportReg", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleSettingsExportReg(params, id);
    });
    m_handlers.emplace("migrate.preflight", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleMigratePreflight(params, id);
    });
    m_handlers.emplace("migrate.execute", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleMigrateExecute(params, id);
    });
    m_handlers.emplace("junction.repair", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleJunctionRepair(params, id);
    });
    m_handlers.emplace("shell.pickFolder", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleShellPickFolder(params, id);
    });
    m_handlers.emplace("shell.openUrl", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleShellOpenUrl(params, id);
    });
    m_handlers.emplace("thumbnails.fetch", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleThumbnailsFetch(params, id);
    });
    m_handlers.emplace("auth.status", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleAuthStatus(params, id);
    });
    m_handlers.emplace("auth.login", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleAuthLogin(params, id);
    });
    m_handlers.emplace("auth.verify2FA", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleAuthVerify2FA(params, id);
    });
    m_handlers.emplace("auth.logout", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleAuthLogout(params, id);
    });
    m_handlers.emplace("auth.user", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleAuthUser(params, id);
    });
    m_handlers.emplace("avatar.preview", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleAvatarPreviewRequest(params, id);
    });
    m_handlers.emplace("friends.list", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleFriendsList(params, id);
    });
    m_handlers.emplace("avatar.details", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleAvatarDetails(params, id);
    });
    m_handlers.emplace("world.details", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleWorldDetails(params, id);
    });
    m_handlers.emplace("avatar.select", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleAvatarSelect(params, id);
    });
    m_handlers.emplace("user.me", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleUserMe(params, id);
    });
    m_handlers.emplace("user.getProfile", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleUserGetProfile(params, id);
    });
    m_handlers.emplace("user.updateProfile", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleUserUpdateProfile(params, id);
    });
    m_handlers.emplace("screenshots.list", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleScreenshotsList(params, id);
    });
    m_handlers.emplace("screenshots.open", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleScreenshotsOpen(params, id);
    });
    m_handlers.emplace("screenshots.folder", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleScreenshotsFolder(params, id);
    });
    m_handlers.emplace("logs.stream.start", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleLogsStreamStart(params, id);
    });
    m_handlers.emplace("logs.stream.stop", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleLogsStreamStop(params, id);
    });
    m_handlers.emplace("app.factoryReset", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleAppFactoryReset(params, id);
    });
}

nlohmann::json IpcBridge::HandleAppVersion(const nlohmann::json&, const std::optional<std::string>&)
{
    // Bump in lockstep with installer/vrcsm.wxs ProductVersion and
    // web/package.json — the About dialog reads this, so leaving it stale
    // lies to the user.
    return nlohmann::json{
        {"version", "0.5.0"},
        {"build", std::string(__DATE__) + " " + std::string(__TIME__)}
    };
}

nlohmann::json IpcBridge::HandlePathProbe(const nlohmann::json&, const std::optional<std::string>&)
{
    return ToJson(vrcsm::core::PathProbe::Probe());
}

nlohmann::json IpcBridge::HandleScan(const nlohmann::json&, const std::optional<std::string>&)
{
    const auto probe = vrcsm::core::PathProbe::Probe();
    return ToJson(vrcsm::core::CacheScanner::buildReport(probe.baseDir));
}

nlohmann::json IpcBridge::HandleBundlePreview(const nlohmann::json& params, const std::optional<std::string>&)
{
    // VRChat's Cache-WindowsPlayer layout is:
    //   <top>/            ← `entry.path` from CacheScanner
    //     <versionHash>/  ← exactly one subdir per entry
    //       __info
    //       __data
    // The frontend passes the TOP-level dir, so we have to descend one
    // level to reach the actual files. Legacy behaviour (files directly
    // under `<top>`) is still supported as a fallback so older formats
    // and mock data keep working.
    const auto entryPath = Utf8ToWide(params.at("entry").get<std::string>());
    const std::filesystem::path base(entryPath);

    std::filesystem::path versionDir = base;
    if (!std::filesystem::exists(base / L"__info"))
    {
        std::error_code ec;
        for (const auto& child : std::filesystem::directory_iterator(base, ec))
        {
            if (ec) break;
            if (child.is_directory() && std::filesystem::exists(child.path() / L"__info"))
            {
                versionDir = child.path();
                break;
            }
        }
    }

    const std::filesystem::path infoPath = versionDir / L"__info";
    std::ifstream infoStream(infoPath, std::ios::binary);
    if (!infoStream)
    {
        throw std::runtime_error(
            "Could not locate __info under " + params.at("entry").get<std::string>());
    }

    std::string infoText((std::istreambuf_iterator<char>(infoStream)), std::istreambuf_iterator<char>());
    // Sniff the version directory so fileTree lists every file (__data,
    // __info, vrc-version, …) rather than just __data's filename.
    auto sniff = vrcsm::core::BundleSniff::sniff(versionDir);
    nlohmann::json result = ToJson(sniff);
    result["infoText"] = infoText;
    return result;
}

nlohmann::json IpcBridge::HandleDeleteDryRun(const nlohmann::json& params, const std::optional<std::string>&)
{
    return ToJson(vrcsm::core::SafeDelete::ResolveTargets(params));
}

nlohmann::json IpcBridge::HandleDeleteExecute(const nlohmann::json& params, const std::optional<std::string>&)
{
    return ToJson(vrcsm::core::SafeDelete::Execute(params));
}

nlohmann::json IpcBridge::HandleProcessVrcRunning(const nlohmann::json&, const std::optional<std::string>&)
{
    return ToJson(vrcsm::core::ProcessGuard::IsVRChatRunning());
}

nlohmann::json IpcBridge::HandleSettingsReadAll(const nlohmann::json& params, const std::optional<std::string>&)
{
    return vrcsm::core::VrcSettings::ReadAllJson(params);
}

nlohmann::json IpcBridge::HandleSettingsWriteOne(const nlohmann::json& params, const std::optional<std::string>&)
{
    return vrcsm::core::VrcSettings::WriteOneJson(params);
}

nlohmann::json IpcBridge::HandleSettingsExportReg(const nlohmann::json& params, const std::optional<std::string>&)
{
    return vrcsm::core::VrcSettings::ExportRegJson(params);
}

nlohmann::json IpcBridge::HandleMigratePreflight(const nlohmann::json& params, const std::optional<std::string>&)
{
    return ToJson(vrcsm::core::Migrator::Preflight(params));
}

nlohmann::json IpcBridge::HandleMigrateExecute(const nlohmann::json& params, const std::optional<std::string>& id)
{
    const auto request = params;
    const auto requestId = id;

    std::thread([this, request, requestId]()
    {
        try
        {
            auto progress = [this](const auto& update)
            {
                m_host.PostMessageToWeb(nlohmann::json{
                    {"event", "migrate.progress"},
                    {"data", ToJson(update)}
                }.dump());
            };

            const auto result = vrcsm::core::Migrator::Execute(request, progress);
            m_host.PostMessageToWeb(nlohmann::json{
                {"event", "migrate.done"},
                {"data", ToJson(result)}
            }.dump());
            PostResult(requestId, ToJson(result));
        }
        catch (const std::exception& ex)
        {
            PostError(requestId, "migrate_failed", ex.what());
        }
        catch (...)
        {
            PostError(requestId, "migrate_failed", "Unknown migration failure");
        }
    }).detach();

    return nlohmann::json{{"started", true}};
}

nlohmann::json IpcBridge::HandleJunctionRepair(const nlohmann::json& params, const std::optional<std::string>&)
{
    return ToJson(vrcsm::core::JunctionUtil::Repair(params));
}

nlohmann::json IpcBridge::HandleShellPickFolder(const nlohmann::json& params, const std::optional<std::string>&)
{
    const std::wstring title = params.contains("title") && params["title"].is_string()
        ? Utf8ToWide(params["title"].get<std::string>())
        : L"Select a folder";

    const std::wstring initialDir = params.contains("initialDir") && params["initialDir"].is_string()
        ? Utf8ToWide(params["initialDir"].get<std::string>())
        : L"";

    const HRESULT init = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    const bool needsUninit = SUCCEEDED(init);

    auto uninit = wil::scope_exit([&]()
    {
        if (needsUninit)
        {
            CoUninitialize();
        }
    });

    wil::com_ptr<IFileOpenDialog> dialog;
    THROW_IF_FAILED(CoCreateInstance(
        CLSID_FileOpenDialog,
        nullptr,
        CLSCTX_INPROC_SERVER,
        IID_PPV_ARGS(dialog.put())));

    FILEOPENDIALOGOPTIONS options = 0;
    THROW_IF_FAILED(dialog->GetOptions(&options));
    THROW_IF_FAILED(dialog->SetOptions(
        options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST));
    THROW_IF_FAILED(dialog->SetTitle(title.c_str()));

    if (!initialDir.empty())
    {
        wil::com_ptr<IShellItem> folder;
        if (SUCCEEDED(SHCreateItemFromParsingName(
                initialDir.c_str(),
                nullptr,
                IID_PPV_ARGS(folder.put()))))
        {
            (void)dialog->SetFolder(folder.get());
        }
    }

    const HWND parent = m_host.ParentHwnd();
    const HRESULT showResult = dialog->Show(parent);
    if (showResult == HRESULT_FROM_WIN32(ERROR_CANCELLED))
    {
        return nlohmann::json{{"cancelled", true}};
    }
    THROW_IF_FAILED(showResult);

    wil::com_ptr<IShellItem> result;
    THROW_IF_FAILED(dialog->GetResult(result.put()));

    wil::unique_cotaskmem_string path;
    THROW_IF_FAILED(result->GetDisplayName(SIGDN_FILESYSPATH, &path));

    return nlohmann::json{
        {"cancelled", false},
        {"path", WideToUtf8(path.get())}
    };
}

nlohmann::json IpcBridge::HandleShellOpenUrl(const nlohmann::json& params, const std::optional<std::string>&)
{
    // Hand a URL (https://... or vrchat://...) over to the OS shell so it
    // opens in the user's default browser / protocol handler. Used by the
    // Worlds inspector "View on vrchat.com" and "Launch in VRChat" buttons.
    // Reject anything that isn't an http(s) or vrchat scheme so a caller
    // can't accidentally launch arbitrary local executables through this
    // path — even though it still flows through ShellExecuteW.
    if (!params.contains("url") || !params["url"].is_string())
    {
        throw std::runtime_error("shell.openUrl: missing 'url'");
    }

    const std::string url = params["url"].get<std::string>();
    const bool okScheme =
        url.rfind("https://", 0) == 0
        || url.rfind("http://", 0) == 0
        || url.rfind("vrchat://", 0) == 0;
    if (!okScheme)
    {
        throw std::runtime_error("shell.openUrl: unsupported URL scheme");
    }

    const std::wstring wide = Utf8ToWide(url);
    const HINSTANCE result = ShellExecuteW(
        nullptr,
        L"open",
        wide.c_str(),
        nullptr,
        nullptr,
        SW_SHOWNORMAL);
    const auto code = reinterpret_cast<INT_PTR>(result);
    if (code <= 32)
    {
        throw std::runtime_error(
            "ShellExecute failed with code " + std::to_string(code));
    }

    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleLogsStreamStart(const nlohmann::json&, const std::optional<std::string>&)
{
    // Idempotent — React StrictMode double-effects and two docks mounting
    // in quick succession must not spawn two tailers (which would
    // double-fire every line).
    if (m_logTailer)
    {
        return nlohmann::json{{"running", true}};
    }

    const auto probe = vrcsm::core::PathProbe::Probe();
    if (!probe.baseDirExists)
    {
        throw std::runtime_error("logs.stream.start: VRChat log directory not found");
    }

    m_logTailer = std::make_unique<vrcsm::core::LogTailer>(
        probe.baseDir,
        [this](const vrcsm::core::LogTailLine& line)
        {
            // 1) Raw line → `logs.stream` for the Console dock. The
            // frontend's `LogStreamChunk` type accepts any of `line` /
            // `message` / `text`; we pick `line` to match the VRCX-style
            // semantics (one tail line = one event).
            {
                nlohmann::json data{
                    {"line", line.line},
                    {"level", line.level},
                    {"source", line.source},
                };
                if (!line.iso_time.empty())
                {
                    data["timestamp"] = line.iso_time;
                }
                m_host.PostMessageToWeb(nlohmann::json{
                    {"event", "logs.stream"},
                    {"data", std::move(data)}
                }.dump());
            }

            // 2) Classified event (if any) → `logs.stream.event` for the
            // Logs page live panels. Most lines classify to null (plain
            // noise, Udon chatter, etc.) and produce zero extra traffic.
            nlohmann::json classified = vrcsm::core::ClassifyStreamLine(line);
            if (!classified.is_null())
            {
                m_host.PostMessageToWeb(nlohmann::json{
                    {"event", "logs.stream.event"},
                    {"data", std::move(classified)}
                }.dump());
            }
        });
    m_logTailer->Start();

    return nlohmann::json{{"running", true}};
}

nlohmann::json IpcBridge::HandleLogsStreamStop(const nlohmann::json&, const std::optional<std::string>&)
{
    if (m_logTailer)
    {
        // LogTailer::Stop() joins the worker thread, so by the time reset()
        // destroys the object no callback is in flight — it's safe to
        // discard the std::function that captured `this`.
        m_logTailer->Stop();
        m_logTailer.reset();
    }
    return nlohmann::json{{"running", false}};
}

nlohmann::json IpcBridge::HandleThumbnailsFetch(const nlohmann::json& params, const std::optional<std::string>&)
{
    // Accept either { ids: [...] } or { id: "..." } for convenience — the
    // frontend hook uses the batch form, mock and tests sometimes use the
    // single form.
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

nlohmann::json IpcBridge::HandleAuthStatus(const nlohmann::json&, const std::optional<std::string>&)
{
    auto result = vrcsm::core::VrcApi::fetchCurrentUser();
    if (!vrcsm::core::isOk(result))
    {
        vrcsm::core::AuthStore::Instance().Clear();
        return nlohmann::json{
            {"authed", false},
            {"displayName", nullptr},
            {"userId", nullptr},
        };
    }

    return MakeAuthSummary(vrcsm::core::value(result));
}

nlohmann::json IpcBridge::HandleAuthLogin(const nlohmann::json& params, const std::optional<std::string>&)
{
    // Native VRChat login — v0.5.0 replaces the WebView2 popup with a
    // direct WinHTTP request against /api/1/auth/user using HTTP Basic
    // credentials. The frontend owns the form; this handler just runs
    // the request + translates the three-state result (success /
    // needs-2FA / error) into JSON the UI can switch on.
    const auto username = JsonStringField(params, "username").value_or("");
    const auto password = JsonStringField(params, "password").value_or("");

    if (username.empty() || password.empty())
    {
        return nlohmann::json{
            {"status", "error"},
            {"error", "username and password are required"},
        };
    }

    const auto result = vrcsm::core::VrcApi::loginWithPassword(username, password);

    nlohmann::json out;
    switch (result.status)
    {
    case vrcsm::core::LoginResult::Status::Success:
    {
        out["status"] = "success";
        if (result.user.has_value())
        {
            out["user"] = MakeAuthSummary(*result.user);
        }

        // Broadcast an auth.loginCompleted event so components that
        // were subscribed under the old popup flow (AuthProvider's
        // refresh hook) still light up without changes. The event
        // carries the same `ok`/`user` shape the popup used to fire.
        nlohmann::json event{
            {"event", "auth.loginCompleted"},
            {"data", {
                {"ok", true},
                {"user", out.value("user", nlohmann::json::object())},
            }},
        };
        m_host.PostMessageToWeb(event.dump());
        return out;
    }
    case vrcsm::core::LoginResult::Status::Requires2FA:
    {
        out["status"] = "requires2FA";
        nlohmann::json methods = nlohmann::json::array();
        for (const auto& m : result.twoFactorMethods)
        {
            methods.push_back(m);
        }
        out["twoFactorMethods"] = std::move(methods);
        return out;
    }
    case vrcsm::core::LoginResult::Status::Error:
    default:
    {
        out["status"] = "error";
        out["error"] = result.error.value_or("Login failed");
        if (result.httpStatus > 0)
        {
            out["httpStatus"] = result.httpStatus;
        }
        return out;
    }
    }
}

nlohmann::json IpcBridge::HandleAuthVerify2FA(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto method = JsonStringField(params, "method").value_or("totp");
    const auto code = JsonStringField(params, "code").value_or("");

    if (code.empty())
    {
        return nlohmann::json{{"ok", false}, {"error", "code is required"}};
    }

    const auto result = vrcsm::core::VrcApi::verifyTwoFactor(method, code);
    if (!result.ok)
    {
        return nlohmann::json{
            {"ok", false},
            {"error", result.error.value_or("2FA verification failed")},
            {"httpStatus", result.httpStatus},
        };
    }

    // 2FA passed → re-probe /auth/user for the real user payload so we
    // can hand it to the UI and broadcast the same login-completed
    // event the success path above fires.
    auto user = vrcsm::core::VrcApi::fetchCurrentUser();
    nlohmann::json userSummary = nlohmann::json::object();
    if (vrcsm::core::isOk(user))
    {
        userSummary = MakeAuthSummary(vrcsm::core::value(user));
    }

    nlohmann::json event{
        {"event", "auth.loginCompleted"},
        {"data", {
            {"ok", true},
            {"user", userSummary},
        }},
    };
    m_host.PostMessageToWeb(event.dump());

    return nlohmann::json{
        {"ok", true},
        {"user", std::move(userSummary)},
    };
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

    // Delegate the heavy lifting — bundle location, extractor spawn,
    // fbx→glb conversion, cache hit-path — to AvatarPreview::Request
    // so the IPC handler stays a thin adapter. The request runs on the
    // async worker thread already (avatar.preview is in
    // AsyncMethodSet), so we can block here without freezing the UI.
    const auto probe = vrcsm::core::PathProbe::Probe();
    const auto result = vrcsm::core::AvatarPreview::Request(avatarId, probe.baseDir, assetUrl);

    nlohmann::json out;
    out["avatarId"] = avatarId;
    out["ok"] = result.ok;
    if (result.ok)
    {
        out["glbUrl"] = result.glbUrl;
        if (!result.glbPath.empty())
        {
            out["glbPath"] = result.glbPath;
        }
        out["cached"] = result.cached;
        return out;
    }

    // All failure modes come through here — the frontend switches on
    // `code` so each mode gets its own empty-state message. Keep the
    // taxonomy flat and stable; adding a new code is fine, renaming
    // one silently breaks the fallback.
    out["code"] = result.code.empty() ? std::string("preview_failed") : result.code;
    out["message"] = result.message;
    return out;
}

nlohmann::json IpcBridge::HandleAuthLogout(const nlohmann::json&, const std::optional<std::string>&)
{
    vrcsm::core::AuthStore::Instance().Clear();
    // Also wipe the WebView2 cookie jar so the next login popup doesn't
    // silently rehydrate the session from stale browser state.
    m_host.ClearVrcCookies();
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleAuthUser(const nlohmann::json&, const std::optional<std::string>&)
{
    auto result = vrcsm::core::VrcApi::fetchCurrentUser();
    if (!vrcsm::core::isOk(result))
    {
        vrcsm::core::AuthStore::Instance().Clear();
        return nlohmann::json{
            {"authed", false},
            {"user", nullptr},
        };
    }

    return nlohmann::json{
        {"authed", true},
        {"user", vrcsm::core::value(result)},
    };
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

    const auto friends = vrcsm::core::VrcApi::fetchFriends(offline);
    nlohmann::json out = nlohmann::json::array();
    for (const auto& item : friends)
    {
        out.push_back(FilterFriend(item));
    }

    return nlohmann::json{{"friends", std::move(out)}};
}

nlohmann::json IpcBridge::HandleAppFactoryReset(const nlohmann::json&, const std::optional<std::string>&)
{
    // Factory reset — wipe everything VRCSM owns under %LocalAppData%\VRCSM,
    // EXCEPT the `WebView2/` user data folder which is held open by the
    // current WebView2 process and would fail mid-delete. That folder is
    // the browser's disk store (cache/service workers) — we flush the
    // cookie jar in-process instead so the session state matches the
    // "sign out + wipe cache" user expectation.
    //
    // What gets wiped:
    //   session.dat       → AuthStore::Clear() removes + wipes in-memory
    //   thumb-cache.json  → VrcApi's on-disk thumbnail cache
    //   logs/*            → spdlog rolling files
    //   (anything else)   → future-proof — anything new we ever drop
    //                        under the VRCSM data dir gets reset too
    //
    // What does NOT get wiped:
    //   WebView2/         → kept, held open by the running process
    //   VRChat's own data → scope is VRCSM's own state, never touch VRC
    //
    // The response lists the paths we removed + the ones we skipped so
    // the frontend toast can tell the user what actually happened.
    nlohmann::json removed = nlohmann::json::array();
    nlohmann::json skipped = nlohmann::json::array();

    // Step 1 — in-memory + session.dat.
    vrcsm::core::AuthStore::Instance().Clear();
    removed.push_back("session.dat");

    // Step 2 — the persistent cookie jar of the in-process WebView2.
    // This is the same call the Logout handler uses; running it twice
    // is safe (idempotent) so we always include it in a factory reset.
    m_host.ClearVrcCookies();

    // Step 3 — walk %LocalAppData%\VRCSM and remove everything that
    // isn't WebView2/. Single-level iteration is enough: AuthStore and
    // VrcApi both write directly into the root, and logs/ is a single
    // subdirectory.
    wchar_t buffer[MAX_PATH]{};
    DWORD length = GetEnvironmentVariableW(L"LOCALAPPDATA", buffer, MAX_PATH);
    if (length == 0 || length >= MAX_PATH)
    {
        return nlohmann::json{
            {"ok", false},
            {"error", "LOCALAPPDATA is not set"},
            {"removed", std::move(removed)},
            {"skipped", std::move(skipped)},
        };
    }

    const std::filesystem::path dataRoot = std::filesystem::path(buffer) / L"VRCSM";
    std::error_code ec;
    if (!std::filesystem::exists(dataRoot, ec))
    {
        // Nothing to reset — still report success, caller expects an
        // idempotent operation.
        return nlohmann::json{
            {"ok", true},
            {"removed", std::move(removed)},
            {"skipped", std::move(skipped)},
        };
    }

    for (const auto& child : std::filesystem::directory_iterator(dataRoot, ec))
    {
        if (ec) break;
        const auto name = child.path().filename().wstring();
        if (name == L"WebView2")
        {
            skipped.push_back(WideToUtf8(name));
            continue;
        }

        std::error_code delEc;
        if (child.is_directory(delEc))
        {
            std::filesystem::remove_all(child.path(), delEc);
        }
        else
        {
            std::filesystem::remove(child.path(), delEc);
        }
        if (delEc)
        {
            // Best-effort — flag what we couldn't delete but keep going.
            skipped.push_back(fmt::format("{} ({})", WideToUtf8(name), delEc.message()));
        }
        else
        {
            removed.push_back(WideToUtf8(name));
        }
    }

    return nlohmann::json{
        {"ok", true},
        {"removed", std::move(removed)},
        {"skipped", std::move(skipped)},
    };
}

nlohmann::json IpcBridge::HandleAvatarDetails(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto idField = JsonStringField(params, "id");
    if (!idField.has_value() || idField->empty())
    {
        return nlohmann::json{{"details", nullptr}};
    }

    // Pass the whole payload through — the frontend decides which fields
    // to render. Auth/network/404 errors surface as IpcException so the
    // dispatch layer can post structured error codes to the frontend.
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

    // Result<json> — auth/network/permission errors surface as IpcException;
    // on success VRChat returns the selected avatar JSON.
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
    // Accept bio/statusDescription/status as optional fields. Anything
    // present gets forwarded to VRChat's PUT /users/{id} endpoint; anything
    // absent is left untouched (VRChat's API treats missing keys as
    // "no change"). Build the patch JSON inline so we never send keys the
    // caller didn't explicitly set.
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

nlohmann::json IpcBridge::HandleScreenshotsList(const nlohmann::json&, const std::optional<std::string>&)
{
    const auto folder = ScreenshotsRootDir();
    nlohmann::json screenshots = nlohmann::json::array();

    std::error_code ec;
    if (folder.empty() || !std::filesystem::exists(folder, ec))
    {
        return nlohmann::json{
            {"screenshots", std::move(screenshots)},
            {"folder", folder.empty() ? "" : WideToUtf8(folder.wstring())},
        };
    }

    // Walk recursively — VRChat buckets screenshots into daily subfolders
    // like `2024-06\VRChat_<...>.png`, so a single-level iterate would
    // miss everything. Cap at 2000 entries to keep the IPC envelope
    // manageable; if a user has more than that we surface the most
    // recently modified ones first via sort_by.
    struct Entry
    {
        std::filesystem::path path;
        std::filesystem::file_time_type mtime;
        std::uintmax_t size;
    };
    std::vector<Entry> entries;
    entries.reserve(256);

    for (auto it = std::filesystem::recursive_directory_iterator(folder, ec);
         it != std::filesystem::recursive_directory_iterator();
         it.increment(ec))
    {
        if (ec) break;
        if (!it->is_regular_file(ec)) continue;
        const auto& p = it->path();
        const auto ext = p.extension().wstring();
        // VRChat writes PNG by default; also accept JPG just in case
        // someone's using a mod. Everything else is ignored — we don't
        // want to list random files users might have dropped in here.
        if (ext != L".png" && ext != L".PNG" && ext != L".jpg" && ext != L".jpeg"
            && ext != L".JPG" && ext != L".JPEG")
        {
            continue;
        }
        std::error_code sizeEc;
        const auto size = std::filesystem::file_size(p, sizeEc);
        std::error_code timeEc;
        const auto mtime = std::filesystem::last_write_time(p, timeEc);
        entries.push_back({p, mtime, sizeEc ? 0 : size});
    }

    // Newest first — VRChat users want to find the screenshot they just
    // took, not the one from 2019.
    std::sort(entries.begin(), entries.end(), [](const Entry& a, const Entry& b)
    {
        return a.mtime > b.mtime;
    });
    if (entries.size() > 2000)
    {
        entries.resize(2000);
    }

    // Convert filesystem time to an ISO-8601 string. `file_time_type` is
    // the file_clock epoch on Windows, which is FILETIME-based. Roundtrip
    // through system_clock so std::gmtime works on a known epoch.
    for (const auto& entry : entries)
    {
        const auto sysTime = std::chrono::clock_cast<std::chrono::system_clock>(entry.mtime);
        const auto timeT = std::chrono::system_clock::to_time_t(sysTime);
        std::tm tmUtc{};
        gmtime_s(&tmUtc, &timeT);
        char isoBuf[32]{};
        std::strftime(isoBuf, sizeof(isoBuf), "%Y-%m-%dT%H:%M:%SZ", &tmUtc);

        // Relative path under the screenshots root so nested daily
        // folders are preserved in the virtual-host URL. Each segment
        // is percent-encoded independently so slashes survive.
        std::error_code relEc;
        const auto rel = std::filesystem::relative(entry.path, folder, relEc);
        std::string urlPath;
        if (!relEc)
        {
            for (const auto& seg : rel)
            {
                if (!urlPath.empty()) urlPath.push_back('/');
                urlPath.append(UrlEncodeSegment(WideToUtf8(seg.wstring())));
            }
        }
        else
        {
            urlPath = UrlEncodeSegment(WideToUtf8(entry.path.filename().wstring()));
        }

        screenshots.push_back({
            {"path", WideToUtf8(entry.path.wstring())},
            {"filename", WideToUtf8(entry.path.filename().wstring())},
            {"created_at", isoBuf},
            {"size_bytes", static_cast<std::uint64_t>(entry.size)},
            {"url", fmt::format("https://screenshots.local/{}", urlPath)},
        });
    }

    return nlohmann::json{
        {"screenshots", std::move(screenshots)},
        {"folder", WideToUtf8(folder.wstring())},
    };
}

nlohmann::json IpcBridge::HandleScreenshotsOpen(const nlohmann::json& params, const std::optional<std::string>&)
{
    // Hand the path to the OS shell so it opens in the user's default
    // image viewer. We defend against being tricked into launching an
    // executable by requiring the path to live under the known
    // screenshots root AND by checking the extension whitelist.
    const auto pathStr = JsonStringField(params, "path");
    if (!pathStr.has_value() || pathStr->empty())
    {
        throw std::runtime_error("screenshots.open: missing 'path'");
    }
    const std::filesystem::path target = Utf8ToWide(*pathStr);
    const auto root = ScreenshotsRootDir();
    if (root.empty())
    {
        throw std::runtime_error("screenshots.open: screenshots folder unavailable");
    }

    std::error_code ec;
    const auto absTarget = std::filesystem::weakly_canonical(target, ec);
    const auto absRoot = std::filesystem::weakly_canonical(root, ec);
    const auto targetStr = absTarget.wstring();
    const auto rootStr = absRoot.wstring();
    if (targetStr.rfind(rootStr, 0) != 0)
    {
        throw std::runtime_error("screenshots.open: path escapes screenshots root");
    }
    const auto ext = target.extension().wstring();
    if (ext != L".png" && ext != L".PNG" && ext != L".jpg" && ext != L".jpeg"
        && ext != L".JPG" && ext != L".JPEG")
    {
        throw std::runtime_error("screenshots.open: unsupported file type");
    }

    const HINSTANCE h = ShellExecuteW(nullptr, L"open", targetStr.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    if (reinterpret_cast<INT_PTR>(h) <= 32)
    {
        throw std::runtime_error("screenshots.open: ShellExecute failed");
    }
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleScreenshotsFolder(const nlohmann::json& params, const std::optional<std::string>&)
{
    // Optional `path` parameter — if absent, open the VRChat screenshots
    // root. If present, reveal that specific file inside Explorer (same
    // behaviour as right-click → "Open file location" on Windows).
    const auto pathStr = JsonStringField(params, "path");
    const auto root = ScreenshotsRootDir();
    if (root.empty())
    {
        throw std::runtime_error("screenshots.folder: screenshots folder unavailable");
    }

    if (!pathStr.has_value() || pathStr->empty())
    {
        const HINSTANCE h = ShellExecuteW(nullptr, L"open", root.wstring().c_str(),
            nullptr, nullptr, SW_SHOWNORMAL);
        if (reinterpret_cast<INT_PTR>(h) <= 32)
        {
            throw std::runtime_error("screenshots.folder: ShellExecute failed");
        }
        return nlohmann::json{{"ok", true}};
    }

    // Path provided — reveal the file inside its parent folder.
    const std::filesystem::path target = Utf8ToWide(*pathStr);
    std::error_code ec;
    const auto absTarget = std::filesystem::weakly_canonical(target, ec);
    const auto absRoot = std::filesystem::weakly_canonical(root, ec);
    if (absTarget.wstring().rfind(absRoot.wstring(), 0) != 0)
    {
        throw std::runtime_error("screenshots.folder: path escapes screenshots root");
    }

    // Use `explorer.exe /select,<path>` so the target file is highlighted
    // when Explorer opens. ShellExecute with a verb of "open" on a folder
    // doesn't support the /select flag; we have to invoke explorer.exe
    // directly via the lpParameters argument.
    const std::wstring args = L"/select,\"" + absTarget.wstring() + L"\"";
    const HINSTANCE h = ShellExecuteW(nullptr, L"open", L"explorer.exe",
        args.c_str(), nullptr, SW_SHOWNORMAL);
    if (reinterpret_cast<INT_PTR>(h) <= 32)
    {
        throw std::runtime_error("screenshots.folder: ShellExecute failed");
    }
    return nlohmann::json{{"ok", true}};
}

void IpcBridge::PostResult(const std::optional<std::string>& id, const nlohmann::json& result) const
{
    nlohmann::json response{
        {"result", result}
    };
    if (id.has_value())
    {
        response["id"] = *id;
    }

    m_host.PostMessageToWeb(response.dump());
}

void IpcBridge::PostError(const std::optional<std::string>& id, std::string_view code, std::string_view message) const
{
    nlohmann::json response{
        {"error", {
            {"code", code},
            {"message", message}
        }}
    };
    if (id.has_value())
    {
        response["id"] = *id;
    }

    m_host.PostMessageToWeb(response.dump());
}

void IpcBridge::PostError(const std::optional<std::string>& id, const vrcsm::core::Error& err) const
{
    nlohmann::json errJson;
    to_json(errJson, err);
    nlohmann::json response{{"error", errJson}};
    if (id.has_value())
    {
        response["id"] = *id;
    }
    m_host.PostMessageToWeb(response.dump());
}
