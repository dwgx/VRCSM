#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/AuthStore.h"
#include "../../core/Common.h"
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

nlohmann::json IpcBridge::HandleFsListDir(const nlohmann::json& params, const std::optional<std::string>&)
{
    namespace fs = std::filesystem;

    const std::string reqPath = (params.is_object() && params.contains("path") && params["path"].is_string())
        ? params["path"].get<std::string>()
        : std::string{};
    const bool includeHidden = params.is_object() && params.contains("includeHidden")
        && params["includeHidden"].is_boolean()
        && params["includeHidden"].get<bool>();

    nlohmann::json roots = nlohmann::json::array();
    const DWORD mask = GetLogicalDrives();
    for (int i = 0; i < 26; ++i)
    {
        if (!(mask & (1u << i))) continue;
        wchar_t wpath[4] = {static_cast<wchar_t>(L'A' + i), L':', L'\\', 0};
        const UINT type = GetDriveTypeW(wpath);
        std::string rootPath(1, static_cast<char>('A' + i));
        rootPath += ":\\";

        wchar_t volumeName[MAX_PATH + 1] = {0};
        (void)GetVolumeInformationW(wpath, volumeName,
            static_cast<DWORD>(sizeof(volumeName) / sizeof(volumeName[0])),
            nullptr, nullptr, nullptr, nullptr, 0);

        roots.push_back({
            {"path", rootPath},
            {"label", WideToUtf8(volumeName)},
            {"type", static_cast<int>(type)},
        });
    }

    nlohmann::json ret = {
        {"path", std::string{}},
        {"parent", nullptr},
        {"entries", nlohmann::json::array()},
        {"roots", std::move(roots)},
        {"truncated", false},
    };

    if (reqPath.empty())
    {
        return ret;
    }

    std::error_code ec;
    fs::path target(Utf8ToWide(reqPath));
    target = fs::weakly_canonical(target, ec);
    if (ec)
    {
        target = fs::path(Utf8ToWide(reqPath));
    }

    ec.clear();
    if (!fs::exists(target, ec) || !fs::is_directory(target, ec))
    {
        throw IpcException(vrcsm::core::Error{
            "fs.listDir.notdir",
            fmt::format("not a directory: {}", WideToUtf8(target.wstring())),
            0,
        });
    }

    ret["path"] = WideToUtf8(target.wstring());
    const auto parent = target.parent_path();
    if (!parent.empty() && parent != target)
    {
        ret["parent"] = WideToUtf8(parent.wstring());
    }

    constexpr size_t kCap = 2000;
    size_t count = 0;
    bool truncated = false;

    ec.clear();
    fs::directory_iterator it(target, fs::directory_options::skip_permission_denied, ec);
    const fs::directory_iterator end;
    for (; !ec && it != end; it.increment(ec))
    {
        if (count >= kCap)
        {
            truncated = true;
            break;
        }

        const fs::path& p = it->path();
        const DWORD attr = GetFileAttributesW(p.c_str());
        const bool hidden = (attr != INVALID_FILE_ATTRIBUTES) && (attr & FILE_ATTRIBUTE_HIDDEN);
        const bool system = (attr != INVALID_FILE_ATTRIBUTES) && (attr & FILE_ATTRIBUTE_SYSTEM);
        if (!includeHidden && (hidden || system)) continue;

        std::error_code dirEc;
        const bool isDir = it->is_directory(dirEc);

        ret["entries"].push_back({
            {"name", WideToUtf8(p.filename().wstring())},
            {"isDir", isDir},
            {"hidden", hidden},
            {"system", system},
        });
        ++count;
    }

    ret["truncated"] = truncated;
    return ret;
}

// Writes a single JSON plan file `.vrcsm-upload-plan.json` into the
// directory chosen by the caller. Kept intentionally narrow: only a
// fixed filename, JSON-validated content, <1MB, inside an *existing*
// directory. This is what the AutoUploader panel uses to hand its
// rename map across to the Python runner without opening a general
// fs.write surface to plugins.
nlohmann::json IpcBridge::HandleFsWritePlan(const nlohmann::json& params, const std::optional<std::string>&)
{
    namespace fs = std::filesystem;

    if (!params.is_object() || !params.contains("rootPath") || !params["rootPath"].is_string())
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_params", "fs.writePlan: missing 'rootPath'", 0});
    }
    if (!params.contains("content") || !params["content"].is_string())
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_params", "fs.writePlan: missing 'content'", 0});
    }

    const std::string rootPath = params["rootPath"].get<std::string>();
    const std::string content = params["content"].get<std::string>();

    constexpr size_t kMaxSize = 1 * 1024 * 1024;
    if (content.size() > kMaxSize)
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_params", "fs.writePlan: content > 1MB", 0});
    }

    try
    {
        (void)nlohmann::json::parse(content);
    }
    catch (const std::exception&)
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_params", "fs.writePlan: content is not valid JSON", 0});
    }

    std::error_code ec;
    fs::path root(Utf8ToWide(rootPath));
    root = fs::weakly_canonical(root, ec);
    if (ec)
    {
        root = fs::path(Utf8ToWide(rootPath));
    }
    ec.clear();
    if (!fs::exists(root, ec) || !fs::is_directory(root, ec))
    {
        throw IpcException(vrcsm::core::Error{
            "fs.writePlan.notdir",
            fmt::format("not a directory: {}", WideToUtf8(root.wstring())),
            0});
    }

    const fs::path planPath = root / L".vrcsm-upload-plan.json";
    std::ofstream out(planPath, std::ios::binary | std::ios::trunc);
    if (!out)
    {
        throw IpcException(vrcsm::core::Error{
            "fs.writePlan.io",
            fmt::format("failed to open for write: {}", WideToUtf8(planPath.wstring())),
            0});
    }
    out.write(content.data(), static_cast<std::streamsize>(content.size()));
    out.close();

    return nlohmann::json{
        {"ok", true},
        {"path", WideToUtf8(planPath.wstring())},
        {"bytes", content.size()},
    };
}

nlohmann::json IpcBridge::HandleAppFactoryReset(const nlohmann::json&, const std::optional<std::string>&)
{
    nlohmann::json removed = nlohmann::json::array();
    nlohmann::json skipped = nlohmann::json::array();

    vrcsm::core::AuthStore::Instance().Clear();
    removed.push_back("session.dat");

    m_host.ClearVrcCookies();

    const std::filesystem::path dataRoot = vrcsm::core::getAppDataRoot();
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
