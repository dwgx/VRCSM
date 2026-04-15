#include "../pch.h"

#include "IpcBridge.h"

#include "StringUtil.h"
#include "WebViewHost.h"

#include "../core/BundleSniff.h"
#include "../core/CacheScanner.h"
#include "../core/JunctionUtil.h"
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
}

IpcBridge::IpcBridge(WebViewHost& host)
    : m_host(host)
{
    RegisterHandlers();
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
}

nlohmann::json IpcBridge::HandleAppVersion(const nlohmann::json&, const std::optional<std::string>&)
{
    // Bump in lockstep with installer/vrcsm.wxs ProductVersion and
    // web/package.json — the About dialog reads this, so leaving it stale
    // lies to the user.
    return nlohmann::json{
        {"version", "0.1.2"},
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
