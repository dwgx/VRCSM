#include "../pch.h"

#include "UrlProtocol.h"
#include "StringUtil.h"

#include <shellapi.h>
#include <spdlog/spdlog.h>

namespace vrcsm::host
{

namespace
{

// Write a single registry value (REG_SZ) under HKCU\Software\Classes.
// Returns true on success, false on any step failing — we deliberately
// swallow failure with a warning log because protocol registration is
// best-effort: if registry access is denied, the app still runs, just
// without clickable-link support.
bool SetRegValue(const wchar_t* subKey, const wchar_t* valueName, const wchar_t* valueData)
{
    HKEY hKey = nullptr;
    std::wstring fullPath = L"Software\\Classes\\";
    fullPath += subKey;

    LONG rc = RegCreateKeyExW(
        HKEY_CURRENT_USER,
        fullPath.c_str(),
        0,
        nullptr,
        0,
        KEY_WRITE,
        nullptr,
        &hKey,
        nullptr);
    if (rc != ERROR_SUCCESS || hKey == nullptr)
    {
        spdlog::warn("[url-protocol] RegCreateKeyEx failed for {}: {}",
                     WideToUtf8(fullPath), rc);
        return false;
    }

    const DWORD cbData = static_cast<DWORD>((wcslen(valueData) + 1) * sizeof(wchar_t));
    rc = RegSetValueExW(
        hKey,
        valueName,
        0,
        REG_SZ,
        reinterpret_cast<const BYTE*>(valueData),
        cbData);
    RegCloseKey(hKey);
    if (rc != ERROR_SUCCESS)
    {
        spdlog::warn("[url-protocol] RegSetValueEx failed for {}\\{}: {}",
                     WideToUtf8(fullPath),
                     WideToUtf8(valueName ? valueName : L""),
                     rc);
        return false;
    }
    return true;
}

// Build the shell-open-command value: "<exe> --uri \"%1\"". The %1
// placeholder is what Windows replaces with the actual URI at launch.
std::wstring BuildOpenCommand()
{
    wchar_t exePath[MAX_PATH]{};
    const DWORD got = GetModuleFileNameW(nullptr, exePath, MAX_PATH);
    if (got == 0 || got >= MAX_PATH)
    {
        return L"";
    }
    std::wstring cmd;
    cmd.reserve(MAX_PATH + 20);
    cmd += L"\"";
    cmd += exePath;
    cmd += L"\" --uri \"%1\"";
    return cmd;
}

void RegisterScheme(const wchar_t* scheme, const std::wstring& openCommand)
{
    if (!SetRegValue(scheme, nullptr, L"URL:VRCSM Protocol")) return;
    if (!SetRegValue(scheme, L"URL Protocol", L"")) return;

    std::wstring shellCmdKey = scheme;
    shellCmdKey += L"\\shell\\open\\command";
    SetRegValue(shellCmdKey.c_str(), nullptr, openCommand.c_str());
}

// Turn a URI like "vrcsm://user/usr_abc" into a React-router path
// "/user/usr_abc". Scheme is validated but the body is passed through
// as-is (aside from stripping any trailing slash). Returns empty on a
// malformed URI so the caller can treat it as "no URI".
std::string UriToRoute(const std::wstring& uri)
{
    const auto schemePos = uri.find(L"://");
    if (schemePos == std::wstring::npos) return "";

    const std::wstring scheme = uri.substr(0, schemePos);
    if (scheme != L"vrcsm" && scheme != L"vrcx") return "";

    std::wstring rest = uri.substr(schemePos + 3);
    // Strip any trailing slash for router tidiness; preserve internal ones.
    while (!rest.empty() && rest.back() == L'/')
    {
        rest.pop_back();
    }
    if (rest.empty()) return "/";

    // React Router paths are leading-slash. Map vrcsm://user/usr_abc →
    // /user/usr_abc, vrcsm://world/wrld_abc → /world/wrld_abc, etc. The
    // frontend route table decides what each path renders.
    std::wstring path;
    path.reserve(rest.size() + 1);
    path += L"/";
    path += rest;
    return WideToUtf8(path);
}

} // namespace

void RegisterProtocolHandlers()
{
    const std::wstring openCmd = BuildOpenCommand();
    if (openCmd.empty())
    {
        spdlog::warn("[url-protocol] GetModuleFileName failed — skipping registration");
        return;
    }
    RegisterScheme(L"vrcsm", openCmd);
    RegisterScheme(L"vrcx",  openCmd);
}

std::string GetInitialRouteFromArgs()
{
    int argc = 0;
    wchar_t** argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    if (argv == nullptr) return "";

    std::string route;
    // Look for either `--uri <value>` or a bare positional that looks
    // like a URI. The positional form is what the shell hands us when
    // the user clicks a registered link; the `--uri` form is for manual
    // invocation from scripts / tests.
    for (int i = 1; i < argc; ++i)
    {
        const std::wstring arg = argv[i];
        if (arg == L"--uri" && i + 1 < argc)
        {
            route = UriToRoute(argv[i + 1]);
            break;
        }
        if (arg.rfind(L"vrcsm://", 0) == 0 || arg.rfind(L"vrcx://", 0) == 0)
        {
            route = UriToRoute(arg);
            break;
        }
    }
    LocalFree(argv);
    return route;
}

} // namespace vrcsm::host
