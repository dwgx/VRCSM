#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/AuthStore.h"
#include "../../core/PathProbe.h"
#include "../../core/ProcessGuard.h"

#include <shellapi.h>
#include <shlobj.h>
#include <shobjidl.h>

#include <wil/com.h>
#include <wil/resource.h>

nlohmann::json IpcBridge::HandleAppVersion(const nlohmann::json&, const std::optional<std::string>&)
{
    return nlohmann::json{
        {"version", VRCSM_VERSION_STRING},
        {"build", std::string(__DATE__) + " " + std::string(__TIME__)}
    };
}

nlohmann::json IpcBridge::HandlePathProbe(const nlohmann::json&, const std::optional<std::string>&)
{
    return ToJson(vrcsm::core::PathProbe::Probe());
}

nlohmann::json IpcBridge::HandleProcessVrcRunning(const nlohmann::json&, const std::optional<std::string>&)
{
    return ToJson(vrcsm::core::ProcessGuard::IsVRChatRunning());
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

    Microsoft::WRL::ComPtr<IFileOpenDialog> dialog;
    HRESULT hr = CoCreateInstance(
        CLSID_FileOpenDialog,
        nullptr,
        CLSCTX_INPROC_SERVER,
        IID_PPV_ARGS(&dialog));
    if (FAILED(hr)) return nlohmann::json{{"cancelled", true}};

    FILEOPENDIALOGOPTIONS options = 0;
    dialog->GetOptions(&options);
    dialog->SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
    dialog->SetTitle(title.c_str());

    if (!initialDir.empty())
    {
        Microsoft::WRL::ComPtr<IShellItem> folder;
        if (SUCCEEDED(SHCreateItemFromParsingName(
                initialDir.c_str(),
                nullptr,
                IID_PPV_ARGS(&folder))))
        {
            (void)dialog->SetFolder(folder.Get());
        }
    }

    const HWND parent = m_host.ParentHwnd();
    const HRESULT showResult = dialog->Show(parent);
    if (showResult == HRESULT_FROM_WIN32(ERROR_CANCELLED) || FAILED(showResult))
    {
        return nlohmann::json{{"cancelled", true}};
    }

    Microsoft::WRL::ComPtr<IShellItem> result;
    if (FAILED(dialog->GetResult(&result))) return nlohmann::json{{"cancelled", true}};

    PWSTR path = nullptr;
    if (FAILED(result->GetDisplayName(SIGDN_FILESYSPATH, &path))) return nlohmann::json{{"cancelled", true}};

    nlohmann::json ret = {
        {"cancelled", false},
        {"path", WideToUtf8(path)}
    };
    CoTaskMemFree(path);
    return ret;
}

nlohmann::json IpcBridge::HandleShellOpenUrl(const nlohmann::json& params, const std::optional<std::string>&)
{
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

nlohmann::json IpcBridge::HandleAppFactoryReset(const nlohmann::json&, const std::optional<std::string>&)
{
    nlohmann::json removed = nlohmann::json::array();
    nlohmann::json skipped = nlohmann::json::array();

    vrcsm::core::AuthStore::Instance().Clear();
    removed.push_back("session.dat");

    m_host.ClearVrcCookies();

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
