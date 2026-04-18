#include "PathProbe.h"

#include "Common.h"
#include "ProcessGuard.h"
#include "SteamVrConfig.h"

#include <array>
#include <fstream>
#include <regex>
#include <set>
#include <system_error>
#include <vector>

#include <Windows.h>
#include <KnownFolders.h>
#include <ShlObj.h>

#include <wil/resource.h>

namespace vrcsm::core
{

namespace
{
std::optional<std::filesystem::path> getKnownFolder(REFKNOWNFOLDERID id)
{
    PWSTR raw = nullptr;
    if (FAILED(SHGetKnownFolderPath(id, 0, nullptr, &raw)) || raw == nullptr)
    {
        if (raw) CoTaskMemFree(raw);
        return std::nullopt;
    }
    std::filesystem::path p(raw);
    CoTaskMemFree(raw);
    return p;
}

std::optional<std::filesystem::path> firstExisting(std::initializer_list<std::filesystem::path> candidates)
{
    for (const auto& c : candidates)
    {
        std::error_code ec;
        if (std::filesystem::exists(c, ec) && !ec)
        {
            return c;
        }
    }
    return std::nullopt;
}

std::optional<std::filesystem::path> envPath(const wchar_t* key)
{
    const DWORD required = GetEnvironmentVariableW(key, nullptr, 0);
    if (required <= 1)
    {
        return std::nullopt;
    }

    std::wstring buffer(static_cast<std::size_t>(required), L'\0');
    const DWORD written = GetEnvironmentVariableW(key, buffer.data(), required);
    if (written == 0 || written >= required)
    {
        return std::nullopt;
    }

    buffer.resize(static_cast<std::size_t>(written));
    return std::filesystem::path(buffer);
}

bool pathExists(const std::filesystem::path& path)
{
    std::error_code ec;
    return !path.empty() && std::filesystem::exists(path, ec) && !ec;
}

std::optional<std::wstring> readRegistryString(HKEY root, const wchar_t* subKey, const wchar_t* valueName)
{
    DWORD type = 0;
    DWORD bytes = 0;
    if (RegGetValueW(root, subKey, valueName, RRF_RT_REG_SZ, &type, nullptr, &bytes) != ERROR_SUCCESS || bytes < sizeof(wchar_t))
    {
        return std::nullopt;
    }

    std::wstring buffer(bytes / sizeof(wchar_t), L'\0');
    if (RegGetValueW(root, subKey, valueName, RRF_RT_REG_SZ, &type, buffer.data(), &bytes) != ERROR_SUCCESS)
    {
        return std::nullopt;
    }

    const auto length = wcsnlen(buffer.c_str(), buffer.size());
    buffer.resize(length);
    if (buffer.empty())
    {
        return std::nullopt;
    }
    return buffer;
}

std::filesystem::path sanitizeExecutablePath(std::wstring value)
{
    if (value.empty())
    {
        return {};
    }

    if (value.front() == L'"')
    {
        const auto closingQuote = value.find(L'"', 1);
        if (closingQuote != std::wstring::npos)
        {
            value = value.substr(1, closingQuote - 1);
        }
    }
    else
    {
        const auto exePos = value.find(L".exe");
        if (exePos != std::wstring::npos)
        {
            value.resize(exePos + 4);
        }
    }

    return std::filesystem::path(value).lexically_normal();
}

std::optional<std::filesystem::path> runningVrchatExecutable()
{
    const auto status = ProcessGuard::IsVRChatRunning();
    if (!status.running || !status.pid.has_value())
    {
        return std::nullopt;
    }

    wil::unique_handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, *status.pid));
    if (!process)
    {
        return std::nullopt;
    }

    std::wstring buffer(static_cast<std::size_t>(MAX_PATH), L'\0');
    DWORD length = static_cast<DWORD>(buffer.size());
    while (!QueryFullProcessImageNameW(process.get(), 0, buffer.data(), &length))
    {
        if (GetLastError() != ERROR_INSUFFICIENT_BUFFER)
        {
            return std::nullopt;
        }
        buffer.resize(buffer.size() * 2);
        length = static_cast<DWORD>(buffer.size());
    }

    buffer.resize(length);
    if (buffer.empty())
    {
        return std::nullopt;
    }
    return std::filesystem::path(buffer).lexically_normal();
}

std::vector<std::filesystem::path> detectSteamRoots()
{
    std::vector<std::filesystem::path> roots;
    std::set<std::wstring> seen;

    const auto addRoot = [&](const std::filesystem::path& root)
    {
        if (root.empty())
        {
            return;
        }
        const auto normalized = root.lexically_normal();
        const auto key = normalized.wstring();
        if (seen.insert(key).second)
        {
            roots.push_back(normalized);
        }
    };

    if (const auto steamExe = readRegistryString(HKEY_CURRENT_USER, L"Software\\Valve\\Steam", L"SteamExe"))
    {
        addRoot(std::filesystem::path(*steamExe).parent_path());
    }
    if (const auto steamPath = readRegistryString(HKEY_CURRENT_USER, L"Software\\Valve\\Steam", L"SteamPath"))
    {
        addRoot(std::filesystem::path(*steamPath));
    }
    if (const auto steamInstall = readRegistryString(HKEY_LOCAL_MACHINE, L"SOFTWARE\\WOW6432Node\\Valve\\Steam", L"InstallPath"))
    {
        addRoot(std::filesystem::path(*steamInstall));
    }
    if (const auto steamInstall = readRegistryString(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Valve\\Steam", L"InstallPath"))
    {
        addRoot(std::filesystem::path(*steamInstall));
    }

    if (auto programFilesX86 = envPath(L"ProgramFiles(x86)"))
    {
        addRoot(*programFilesX86 / L"Steam");
    }
    if (auto programFiles = envPath(L"ProgramFiles"))
    {
        addRoot(*programFiles / L"Steam");
    }

    return roots;
}

void appendSteamLibraryExes(
    std::vector<std::filesystem::path>& out,
    std::set<std::wstring>& seen,
    const std::filesystem::path& steamRoot)
{
    const auto addExe = [&](const std::filesystem::path& exePath)
    {
        if (!pathExists(exePath))
        {
            return;
        }
        const auto normalized = exePath.lexically_normal();
        const auto key = normalized.wstring();
        if (seen.insert(key).second)
        {
            out.push_back(normalized);
        }
    };

    addExe(steamRoot / L"steamapps" / L"common" / L"VRChat" / L"VRChat.exe");

    const auto libraryFile = steamRoot / L"steamapps" / L"libraryfolders.vdf";
    if (!pathExists(libraryFile))
    {
        return;
    }

    std::ifstream in(libraryFile);
    if (!in)
    {
        return;
    }

    static const std::regex kPathLineRe(R"vdf("path"\s*"([^"]+)")vdf");
    std::string line;
    while (std::getline(in, line))
    {
        std::smatch match;
        if (!std::regex_search(line, match, kPathLineRe))
        {
            continue;
        }

        std::string rawPath = match[1].str();
        std::string unescaped;
        unescaped.reserve(rawPath.size());
        for (std::size_t i = 0; i < rawPath.size(); ++i)
        {
            if (rawPath[i] == '\\' && i + 1 < rawPath.size() && rawPath[i + 1] == '\\')
            {
                unescaped.push_back('\\');
                ++i;
            }
            else
            {
                unescaped.push_back(rawPath[i]);
            }
        }

        addExe(std::filesystem::path(toWide(unescaped)) / L"steamapps" / L"common" / L"VRChat" / L"VRChat.exe");
    }
}

std::vector<std::filesystem::path> candidateVrchatExecutables()
{
    std::vector<std::filesystem::path> candidates;
    std::set<std::wstring> seen;

    const auto addCandidate = [&](const std::filesystem::path& path)
    {
        if (!pathExists(path))
        {
            return;
        }
        const auto normalized = path.lexically_normal();
        const auto key = normalized.wstring();
        if (seen.insert(key).second)
        {
            candidates.push_back(normalized);
        }
    };

    if (const auto runningExe = runningVrchatExecutable())
    {
        addCandidate(*runningExe);
    }

    for (const auto root : {HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE})
    {
        if (const auto value = readRegistryString(root, L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\VRChat.exe", nullptr))
        {
            addCandidate(sanitizeExecutablePath(*value));
        }
    }

    for (const auto* subKey : {
             L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App 438100",
             L"SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App 438100"})
    {
        if (const auto installLocation = readRegistryString(HKEY_LOCAL_MACHINE, subKey, L"InstallLocation"))
        {
            addCandidate(std::filesystem::path(*installLocation) / L"VRChat.exe");
        }
        if (const auto displayIcon = readRegistryString(HKEY_LOCAL_MACHINE, subKey, L"DisplayIcon"))
        {
            addCandidate(sanitizeExecutablePath(*displayIcon));
        }
    }

    for (const auto& steamRoot : detectSteamRoots())
    {
        appendSteamLibraryExes(candidates, seen, steamRoot);
    }

    return candidates;
}
} // namespace

void to_json(nlohmann::json& j, const PathProbeResult& r)
{
    auto pathOrNull = [](const std::optional<std::filesystem::path>& p) -> nlohmann::json {
        if (!p.has_value()) return nullptr;
        return toUtf8(p->wstring());
    };

    j = nlohmann::json{
        {"baseDir", toUtf8(r.baseDir.wstring())},
        {"baseDirExists", r.baseDirExists},
        {"vrchatExe", pathOrNull(r.vrchatExe)},
        {"configJson", pathOrNull(r.configJson)},
        {"melonLoaderCfg", pathOrNull(r.melonLoaderCfg)},
        {"steamVrSettings", pathOrNull(r.steamVrSettings)},
    };
}

PathProbeResult PathProbe::Probe()
{
    PathProbeResult result;

    if (auto localLow = getKnownFolder(FOLDERID_LocalAppDataLow))
    {
        result.baseDir = *localLow / L"VRChat" / L"VRChat";
        std::error_code ec;
        result.baseDirExists = std::filesystem::exists(result.baseDir, ec) && !ec;
    }
    else if (auto userProfile = envPath(L"USERPROFILE"))
    {
        result.baseDir = *userProfile / L"AppData" / L"LocalLow" / L"VRChat" / L"VRChat";
        std::error_code ec;
        result.baseDirExists = std::filesystem::exists(result.baseDir, ec) && !ec;
    }

    const auto exeCandidates = candidateVrchatExecutables();
    if (!exeCandidates.empty())
    {
        result.vrchatExe = exeCandidates.front();
    }

    if (!result.baseDir.empty())
    {
        std::filesystem::path cfgCandidate = result.baseDir / L"config.json";
        std::error_code ec;
        if (std::filesystem::exists(cfgCandidate, ec) && !ec)
        {
            result.configJson = cfgCandidate;
        }
    }

    if (result.vrchatExe)
    {
        std::filesystem::path mlCfg = result.vrchatExe->parent_path() / L"UserData" / L"Loader.cfg";
        std::error_code ec;
        if (std::filesystem::exists(mlCfg, ec) && !ec)
        {
            result.melonLoaderCfg = mlCfg;
        }
    }

    result.steamVrSettings = SteamVrConfig::DetectVrSettingsPath();

    return result;
}

} // namespace vrcsm::core
