#include "../pch.h"

#include "IpcBridge.h"

#include "AuthLoginWindow.h"
#include "StringUtil.h"
#include "WebViewHost.h"

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

#include <shellapi.h>
#include <shlobj.h>
#include <shobjidl.h>

namespace
{
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

        try
        {
            PostResult(id, it->second(params, id));
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
    m_handlers.emplace("auth.openLoginWindow", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleAuthOpenLoginWindow(params, id);
    });
    m_handlers.emplace("auth.logout", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleAuthLogout(params, id);
    });
    m_handlers.emplace("auth.user", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleAuthUser(params, id);
    });
    m_handlers.emplace("friends.list", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleFriendsList(params, id);
    });
    m_handlers.emplace("avatar.details", [this](const nlohmann::json& params, const std::optional<std::string>& id)
    {
        return HandleAvatarDetails(params, id);
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
        {"version", "0.3.0"},
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
    const auto user = vrcsm::core::VrcApi::fetchCurrentUser();
    if (!user.has_value())
    {
        vrcsm::core::AuthStore::Instance().Clear();
        return nlohmann::json{
            {"authed", false},
            {"displayName", nullptr},
            {"userId", nullptr},
        };
    }

    return MakeAuthSummary(*user);
}

nlohmann::json IpcBridge::HandleAuthOpenLoginWindow(const nlohmann::json&, const std::optional<std::string>& id)
{
    // Pop the VRChat login page in its own WebView2 window, let the user
    // do the whole username+password / Steam / 2FA / captcha dance, then
    // harvest cookies and persist via AuthStore. The login popup is
    // self-managed — ownership is transferred to the window itself.
    // When the window finishes (success or cancellation) it fires the
    // completion callback which broadcasts an `auth.loginCompleted`
    // event over the same PostMessageToWeb channel used by logs.stream.
    auto* env = m_host.Environment();
    if (env == nullptr)
    {
        PostError(id, "auth_env_unavailable", "WebView2 environment is not initialised yet");
        return nlohmann::json{{"ok", false}};
    }

    const bool launched = vrcsm::host::AuthLoginWindow::Launch(
        m_host.ParentHwnd(),
        env,
        [this](bool ok, const std::string& error)
        {
            nlohmann::json data{{"ok", ok}};
            if (!ok)
            {
                data["error"] = error;
            }
            else
            {
                const auto user = vrcsm::core::VrcApi::fetchCurrentUser();
                if (user.has_value())
                {
                    data["user"] = MakeAuthSummary(*user);
                }
            }

            nlohmann::json envelope{
                {"event", "auth.loginCompleted"},
                {"data", std::move(data)},
            };
            m_host.PostMessageToWeb(envelope.dump());
        });

    if (!launched)
    {
        PostError(id, "auth_window_failed", "Failed to open login window");
        return nlohmann::json{{"ok", false}};
    }

    // The request itself just acknowledges the popup was spawned — the
    // actual success/failure arrives asynchronously as the event above.
    return nlohmann::json{{"ok", true}};
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
    const auto user = vrcsm::core::VrcApi::fetchCurrentUser();
    if (!user.has_value())
    {
        vrcsm::core::AuthStore::Instance().Clear();
        return nlohmann::json{
            {"authed", false},
            {"user", nullptr},
        };
    }

    return nlohmann::json{
        {"authed", true},
        {"user", *user},
    };
}

nlohmann::json IpcBridge::HandleFriendsList(const nlohmann::json& params, const std::optional<std::string>&)
{
    const bool offline = params.contains("offline") && params["offline"].is_boolean()
        ? params["offline"].get<bool>()
        : false;

    const auto currentUser = vrcsm::core::VrcApi::fetchCurrentUser();
    if (!currentUser.has_value())
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

    const auto details = vrcsm::core::VrcApi::fetchAvatarDetails(*idField);
    if (!details.has_value())
    {
        return nlohmann::json{{"details", nullptr}};
    }

    // Pass the whole payload through — the frontend decides which fields
    // to render. This keeps the host out of the business of guessing
    // which keys matter for future UI iterations.
    return nlohmann::json{{"details", *details}};
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
