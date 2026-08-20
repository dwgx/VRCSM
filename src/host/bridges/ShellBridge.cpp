#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/AuthStore.h"
#include "../../core/Common.h"
#include "../../core/Database.h"
#include "../../core/DiscordRpc.h"
#include "../../core/LogTailer.h"
#include "../../core/OscBridge.h"
#include "../../core/PathProbe.h"
#include "../../core/Pipeline.h"
#include "../../core/ProcessGuard.h"
#include "../../core/ScreenshotWatcher.h"
#include "../../core/VrcApi.h"
#include "../WebViewHost.h"

#include <fstream>
#include <KnownFolders.h>
#include <objidl.h>
#include <shellapi.h>
#include <shlguid.h>
#include <shlobj.h>
#include <shobjidl.h>

#include <wil/com.h>
#include <wil/resource.h>

namespace
{

std::optional<std::filesystem::path> SafeRelativeSubdir(const std::string& raw)
{
    namespace fs = std::filesystem;

    if (raw.empty())
    {
        return fs::path{};
    }

    fs::path input(Utf8ToWide(raw));
    if (input.is_absolute() || input.has_root_name() || input.has_root_directory())
    {
        return std::nullopt;
    }

    fs::path out;
    for (const auto& part : input)
    {
        const auto w = part.wstring();
        if (w.empty() || w == L"." || w == L"..")
        {
            return std::nullopt;
        }
        if (w.find_first_of(L"<>:\"|?*") != std::wstring::npos)
        {
            return std::nullopt;
        }
        out /= part;
    }

    return out.lexically_normal();
}

// Match JS encodeURIComponent so vrchat://launch?id= round-trips with the SPA.
std::string PercentEncodeUriComponent(std::string_view input)
{
    std::string out;
    out.reserve(input.size() + 16);
    static const char kHex[] = "0123456789ABCDEF";
    for (const unsigned char c : input)
    {
        const bool unescaped =
            (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
            || c == '-' || c == '_' || c == '.' || c == '!' || c == '~'
            || c == '*' || c == '\'' || c == '(' || c == ')';
        if (unescaped)
        {
            out.push_back(static_cast<char>(c));
        }
        else
        {
            out.push_back('%');
            out.push_back(kHex[(c >> 4) & 0xF]);
            out.push_back(kHex[c & 0xF]);
        }
    }
    return out;
}

std::string PercentDecodeUriComponent(std::string_view input)
{
    std::string out;
    out.reserve(input.size());
    auto hexVal = [](unsigned char h) -> int {
        if (h >= '0' && h <= '9') return h - '0';
        if (h >= 'A' && h <= 'F') return h - 'A' + 10;
        if (h >= 'a' && h <= 'f') return h - 'a' + 10;
        return -1;
    };
    for (size_t i = 0; i < input.size();)
    {
        const unsigned char c = static_cast<unsigned char>(input[i]);
        if (c == '%' && i + 2 < input.size())
        {
            const int hi = hexVal(static_cast<unsigned char>(input[i + 1]));
            const int lo = hexVal(static_cast<unsigned char>(input[i + 2]));
            if (hi >= 0 && lo >= 0)
            {
                out.push_back(static_cast<char>((hi << 4) | lo));
                i += 3;
                continue;
            }
        }
        out.push_back(static_cast<char>(c));
        ++i;
    }
    return out;
}

std::optional<std::string> LocationFromVrchatLaunchUrl(std::string_view url)
{
    auto idPos = url.find("?id=");
    if (idPos == std::string_view::npos)
    {
        idPos = url.find("&id=");
        if (idPos == std::string_view::npos)
        {
            return std::nullopt;
        }
    }
    auto rest = url.substr(idPos + 4);
    const auto amp = rest.find('&');
    if (amp != std::string_view::npos)
    {
        rest = rest.substr(0, amp);
    }
    return PercentDecodeUriComponent(rest);
}

bool IsValidVrchatLocation(std::string_view location)
{
    if (location.empty() || location.size() > 2048)
    {
        return false;
    }
    if (location.rfind("wrld_", 0) != 0)
    {
        return false;
    }
    for (const unsigned char c : location)
    {
        if (c < 0x20 || c == 0x7F)
        {
            return false;
        }
    }
    return true;
}

std::string BuildVrchatLocationLaunchUrl(std::string_view location)
{
    return "vrchat://launch?ref=vrchat.com&id=" + PercentEncodeUriComponent(location);
}

bool TryWriteVrchatLaunchPipe(const std::string& utf8Url)
{
    constexpr wchar_t kPipeName[] = L"\\\\.\\pipe\\VRChatURLLaunchPipe";
    constexpr DWORD kTimeoutMs = 1500;

    auto openPipe = [&]() -> HANDLE {
        return CreateFileW(
            kPipeName,
            GENERIC_WRITE,
            0,
            nullptr,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            nullptr);
    };

    HANDLE raw = openPipe();
    if (raw == INVALID_HANDLE_VALUE && GetLastError() == ERROR_PIPE_BUSY)
    {
        if (WaitNamedPipeW(kPipeName, kTimeoutMs))
        {
            raw = openPipe();
        }
    }
    if (raw == INVALID_HANDLE_VALUE)
    {
        return false;
    }

    DWORD written = 0;
    const BOOL ok = WriteFile(
        raw,
        utf8Url.data(),
        static_cast<DWORD>(utf8Url.size()),
        &written,
        nullptr);
    (void)FlushFileBuffers(raw);
    CloseHandle(raw);
    return ok == TRUE && written == utf8Url.size();
}

std::filesystem::path ResolveInstanceShortcutPath(const std::string& destRaw)
{
    namespace fs = std::filesystem;

    if (destRaw.empty())
    {
        const auto desk = vrcsm::core::tryGetKnownFolderPath(FOLDERID_Desktop);
        if (!desk)
        {
            throw IpcException(vrcsm::core::Error{
                "io_error", "shell.writeInstanceShortcut: cannot resolve Desktop folder", 0});
        }
        return *desk / L"VRCSM-last-instance.lnk";
    }

    fs::path dest(Utf8ToWide(destRaw));
    if (!dest.is_absolute())
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_params", "shell.writeInstanceShortcut: destPath must be absolute", 0});
    }

    std::error_code ec;
    dest = fs::weakly_canonical(dest, ec);
    if (ec)
    {
        dest = fs::path(Utf8ToWide(destRaw));
    }

    const auto ext = dest.extension().wstring();
    if (_wcsicmp(ext.c_str(), L".lnk") != 0)
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_params", "shell.writeInstanceShortcut: destPath must end with .lnk", 0});
    }

    const auto profile = vrcsm::core::tryGetEnvPath(L"USERPROFILE");
    if (!profile || !vrcsm::core::ensureWithinBase(*profile, dest))
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_params",
            "shell.writeInstanceShortcut: destPath must be under the user profile",
            0});
    }

    const auto parent = dest.parent_path();
    ec.clear();
    if (!fs::exists(parent, ec) || !fs::is_directory(parent, ec))
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_params",
            "shell.writeInstanceShortcut: destPath parent directory does not exist",
            0});
    }
    return dest;
}

} // namespace

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

    // When VRChat is already running, prefer its REST API over the
    // vrchat:// protocol handler so the running process receives the
    // join command through its existing server connection instead of
    // spawning a second VRChat.exe. Location is percent-decoded so
    // BuildVrchatLocationLaunchUrl's encodeURIComponent round-trips
    // (`wrld_…%3A…` → `wrld_…:…`) before inviteSelf.
    if (url.rfind("vrchat://launch", 0) == 0)
    {
        const auto vrc = vrcsm::core::ProcessGuard::IsVRChatRunning();
        if (vrc.running)
        {
            const auto location = LocationFromVrchatLaunchUrl(url);
            if (!location || !IsValidVrchatLocation(*location))
            {
                throw IpcException(vrcsm::core::Error{
                    "invalid_params",
                    "shell.openUrl: missing or invalid location id",
                    0});
            }
            const auto r = vrcsm::core::VrcApi::inviteSelf(*location);
            if (std::holds_alternative<vrcsm::core::Error>(r))
            {
                const auto& err = std::get<vrcsm::core::Error>(r);
                throw std::runtime_error("shell.openUrl: inviteSelf failed: " + err.message);
            }
            return nlohmann::json{{"ok", true}};
        }
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

nlohmann::json IpcBridge::HandleShellLaunchVrchatLocation(
    const nlohmann::json& params,
    const std::optional<std::string>& id)
{
    const std::string location = JsonStringField(params, "location").value_or("");
    if (!IsValidVrchatLocation(location))
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_params",
            "shell.launchVrchatLocation: missing or invalid 'location'",
            0});
    }

    bool preferPipe = true;
    if (params.is_object() && params.contains("preferPipe") && params["preferPipe"].is_boolean())
    {
        preferPipe = params["preferPipe"].get<bool>();
    }

    const std::string url = BuildVrchatLocationLaunchUrl(location);
    // Named pipe gets a raw location id. VRChat's launch pipe historically
    // wants wrld_…:instance, not percent-encoded ':' (%3A).
    const std::string pipeUrl = "vrchat://launch?ref=vrchat.com&id=" + location;

    if (preferPipe)
    {
        const auto vrc = vrcsm::core::ProcessGuard::IsVRChatRunning();
        if (vrc.running && TryWriteVrchatLaunchPipe(pipeUrl))
        {
            return nlohmann::json{{"ok", true}, {"via", "pipe"}};
        }
    }

    nlohmann::json result = HandleShellOpenUrl(nlohmann::json{{"url", url}}, id);
    if (!result.is_object())
    {
        result = nlohmann::json::object();
    }
    result["ok"] = true;
    result["via"] = "openUrl";
    return result;
}

nlohmann::json IpcBridge::HandleShellWriteInstanceShortcut(
    const nlohmann::json& params,
    const std::optional<std::string>&)
{
    const std::string location = JsonStringField(params, "location").value_or("");
    if (!IsValidVrchatLocation(location))
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_params",
            "shell.writeInstanceShortcut: missing or invalid 'location'",
            0});
    }

    const std::string worldName = JsonStringField(params, "worldName").value_or("");
    const std::string destRaw = JsonStringField(params, "destPath").value_or("");
    const std::string url = BuildVrchatLocationLaunchUrl(location);
    const std::filesystem::path dest = ResolveInstanceShortcutPath(destRaw);

    wchar_t sysDir[MAX_PATH]{};
    if (GetSystemDirectoryW(sysDir, MAX_PATH) == 0)
    {
        throw IpcException(vrcsm::core::Error{
            "io_error", "shell.writeInstanceShortcut: GetSystemDirectory failed", 0});
    }
    const std::wstring rundll = std::wstring(sysDir) + L"\\rundll32.exe";
    const std::wstring urlWide = Utf8ToWide(url);
    const std::wstring args = L"url.dll,FileProtocolHandler " + urlWide;

    std::wstring desc = Utf8ToWide(worldName);
    if (desc.empty())
    {
        desc = L"VRCSM last instance";
    }
    if (desc.size() > 200)
    {
        desc.resize(200);
    }
    for (auto& ch : desc)
    {
        if (ch < 32)
        {
            ch = L' ';
        }
    }

    const HRESULT init = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    const bool needsUninit = (init == S_OK);
    auto uninit = wil::scope_exit([&]()
    {
        if (needsUninit)
        {
            CoUninitialize();
        }
    });
    if (FAILED(init) && init != RPC_E_CHANGED_MODE)
    {
        throw IpcException(vrcsm::core::Error{
            "com_error", "shell.writeInstanceShortcut: CoInitializeEx failed", 0});
    }

    Microsoft::WRL::ComPtr<IShellLinkW> link;
    HRESULT hr = CoCreateInstance(
        CLSID_ShellLink,
        nullptr,
        CLSCTX_INPROC_SERVER,
        IID_PPV_ARGS(&link));
    if (FAILED(hr) || !link)
    {
        throw IpcException(vrcsm::core::Error{
            "com_error", "shell.writeInstanceShortcut: CoCreateInstance(IShellLink) failed", 0});
    }

    hr = link->SetPath(rundll.c_str());
    if (FAILED(hr))
    {
        throw IpcException(vrcsm::core::Error{
            "com_error", "shell.writeInstanceShortcut: IShellLink::SetPath failed", 0});
    }
    (void)link->SetArguments(args.c_str());
    (void)link->SetDescription(desc.c_str());
    (void)link->SetShowCmd(SW_SHOWNORMAL);
    (void)link->SetWorkingDirectory(L"");

    Microsoft::WRL::ComPtr<IPersistFile> persist;
    hr = link.As(&persist);
    if (FAILED(hr) || !persist)
    {
        throw IpcException(vrcsm::core::Error{
            "com_error", "shell.writeInstanceShortcut: IPersistFile query failed", 0});
    }

    hr = persist->Save(dest.c_str(), TRUE);
    if (FAILED(hr))
    {
        throw IpcException(vrcsm::core::Error{
            "io_error",
            fmt::format(
                "shell.writeInstanceShortcut: Save failed (HRESULT 0x{:08X})",
                static_cast<unsigned long>(hr)),
            0});
    }

    return nlohmann::json{
        {"ok", true},
        {"path", WideToUtf8(dest.wstring())},
    };
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

nlohmann::json IpcBridge::HandleFsAppDataDir(const nlohmann::json& params, const std::optional<std::string>&)
{
    namespace fs = std::filesystem;

    const std::string subdir = (params.is_object() && params.contains("subdir") && params["subdir"].is_string())
        ? params["subdir"].get<std::string>()
        : std::string{};
    const bool create = !params.is_object()
        || !params.contains("create")
        || !params["create"].is_boolean()
        || params["create"].get<bool>();

    const auto rel = SafeRelativeSubdir(subdir);
    if (!rel.has_value())
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_params",
            "fs.appDataDir: subdir must be a safe relative path",
            0});
    }

    const fs::path root = vrcsm::core::getAppDataRoot();
    const fs::path target = (root / *rel).lexically_normal();
    if (!vrcsm::core::ensureWithinBase(root, target))
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_params",
            "fs.appDataDir: subdir escapes app data root",
            0});
    }

    std::error_code ec;
    bool created = false;
    if (create)
    {
        created = fs::create_directories(target, ec);
        if (ec)
        {
            throw IpcException(vrcsm::core::Error{
                "fs.appDataDir.io",
                fmt::format("failed to create directory: {}", ec.message()),
                0});
        }
    }

    return nlohmann::json{
        {"ok", true},
        {"root", WideToUtf8(root.wstring())},
        {"path", WideToUtf8(target.wstring())},
        {"created", created},
    };
}

nlohmann::json IpcBridge::HandleAppFactoryReset(const nlohmann::json&, const std::optional<std::string>&)
{
    nlohmann::json removed = nlohmann::json::array();
    nlohmann::json skipped = nlohmann::json::array();

    // 1. Wipe in-memory auth state. Cookie eviction in WebView2 is a COM
    //    call and must run on the UI thread — defer that to the
    //    WM_APP_FACTORY_RESET_QUIT handler at the end.
    vrcsm::core::AuthStore::Instance().Clear("FactoryReset");
    removed.push_back("session.dat");

    // 2. Stop every background worker that holds a file handle inside
    //    appDataRoot. Without this the SQLite db, log tailer poll, and
    //    pipeline socket would keep file/handle references alive and
    //    leave the app in a half-reset state on next launch.
    if (m_pipeline)
    {
        m_pipeline->Stop();
    }
    if (m_logTailer)
    {
        std::lock_guard<std::mutex> lk(m_logTailerMutex);
        m_logTailer->Stop();
        m_logTailer.reset();
        m_logTailerRefCount = 0;
    }
    if (m_screenshotWatcher)
    {
        m_screenshotWatcher->Stop();
    }
    if (m_discordRpc)
    {
        m_discordRpc->Stop();
    }
    if (m_osc)
    {
        m_osc->StopListen();
    }

    // 3. Close the SQLite handle so vrcsm.db, its journal, and shm/wal
    //    sidecar files are unlocked for std::filesystem::remove on
    //    Windows. Sqlite3 holds an exclusive lock by default; without
    //    this, the .db survives the reset and breaks the next start.
    vrcsm::core::Database::Instance().Close();

    const std::filesystem::path dataRoot = vrcsm::core::getAppDataRoot();
    std::error_code ec;
    if (std::filesystem::exists(dataRoot, ec))
    {
        // The MSI is a per-user install: VRCSM.exe, the bundled DLLs,
        // and the `web/` UI bundle all sit inside %LocalAppData%\VRCSM
        // alongside the app's own data files. A naive "delete every
        // child of dataRoot" wipes the renderer assets too — next
        // launch boots into a permanent white screen because
        // app.vrcsm/index.html is gone. Treat anything that looks like
        // an install artifact (running EXE, loaded DLLs, web/ bundle,
        // WebView2 user-data) as off-limits and only purge known data
        // files. Snapshot the entries first so we don't mutate the
        // directory under an active iterator.
        auto isInstallArtifact = [](const std::wstring& name) -> bool
        {
            if (name == L"WebView2") return true;
            if (name == L"web") return true;
            const auto endsWithCi = [&](std::wstring_view suffix) -> bool
            {
                if (name.size() < suffix.size()) return false;
                return _wcsicmp(name.c_str() + name.size() - suffix.size(),
                                suffix.data()) == 0;
            };
            return endsWithCi(L".exe") || endsWithCi(L".dll");
        };

        std::vector<std::filesystem::path> entries;
        for (const auto& child : std::filesystem::directory_iterator(dataRoot, ec))
        {
            if (ec) break;
            entries.push_back(child.path());
        }

        for (const auto& path : entries)
        {
            const auto name = path.filename().wstring();
            if (isInstallArtifact(name))
            {
                skipped.push_back(WideToUtf8(name));
                continue;
            }

            std::error_code delEc;
            if (std::filesystem::is_directory(path, delEc))
            {
                std::filesystem::remove_all(path, delEc);
            }
            else
            {
                std::filesystem::remove(path, delEc);
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
    }

    // 4. Drop a marker so App::Run's HandlePendingFactoryReset wipes the
    //    WebView2 user-data folder on next launch. We can't delete it now
    //    because the live WebView2 environment is still using it to
    //    deliver this very response — but cookies, IndexedDB, and
    //    localStorage inside WebView2 must be gone before the React app
    //    boots against the fresh appDataRoot, otherwise the renderer
    //    crashes silently to a white screen.
    if (std::filesystem::exists(dataRoot, ec))
    {
        std::error_code markerEc;
        std::ofstream marker(dataRoot / L".factory-reset-pending", std::ios::trunc);
        if (marker)
        {
            marker << "1";
        }
        (void)markerEc;
    }

    // 5. Schedule cookie clear + clean app exit on the UI thread. Once
    //    this returns the response goes back to the frontend; the user's
    //    next launch hits a clean appDataRoot AND a clean WebView2
    //    profile (the marker triggers the wipe).
    HWND parentHwnd = m_host.ParentHwnd();
    if (parentHwnd != nullptr)
    {
        PostMessageW(parentHwnd, WM_APP_FACTORY_RESET_QUIT, 0, 0);
    }

    return nlohmann::json{
        {"ok", true},
        {"removed", std::move(removed)},
        {"skipped", std::move(skipped)},
        {"willExit", true},
    };
}

// ── Autostart (HKCU Run key) ──────────────────────────────────────

static const wchar_t* kRunKey = L"Software\\Microsoft\\Windows\\CurrentVersion\\Run";
static const wchar_t* kRunValue = L"VRCSM";

nlohmann::json IpcBridge::HandleAutoStartGet(const nlohmann::json&, const std::optional<std::string>&)
{
    HKEY hk = nullptr;
    bool enabled = false;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, kRunKey, 0, KEY_READ, &hk) == ERROR_SUCCESS)
    {
        DWORD type = 0;
        enabled = (RegQueryValueExW(hk, kRunValue, nullptr, &type, nullptr, nullptr) == ERROR_SUCCESS);
        RegCloseKey(hk);
    }
    return nlohmann::json{{"enabled", enabled}};
}

nlohmann::json IpcBridge::HandleAutoStartSet(const nlohmann::json& params, const std::optional<std::string>&)
{
    const bool enable = params.contains("enabled") && params["enabled"].is_boolean()
        ? params["enabled"].get<bool>() : false;

    HKEY hk = nullptr;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, kRunKey, 0, KEY_SET_VALUE, &hk) != ERROR_SUCCESS)
        throw IpcException({"registry_error", "Cannot open Run key", 500});

    LONG result;
    if (enable)
    {
        wchar_t exePath[MAX_PATH]{};
        GetModuleFileNameW(nullptr, exePath, MAX_PATH);
        const DWORD cbData = static_cast<DWORD>((wcslen(exePath) + 1) * sizeof(wchar_t));
        result = RegSetValueExW(hk, kRunValue, 0, REG_SZ,
            reinterpret_cast<const BYTE*>(exePath), cbData);
    }
    else
    {
        result = RegDeleteValueW(hk, kRunValue);
        if (result == ERROR_FILE_NOT_FOUND) result = ERROR_SUCCESS;
    }
    RegCloseKey(hk);

    if (result != ERROR_SUCCESS)
        throw IpcException({"registry_error", "Failed to update Run key", 500});

    return nlohmann::json{{"enabled", enable}};
}
