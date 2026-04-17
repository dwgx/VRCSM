#include "PathProbe.h"

#include "Common.h"
#include "SteamVrConfig.h"

#include <array>
#include <system_error>

#include <Windows.h>
#include <KnownFolders.h>
#include <ShlObj.h>

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

    result.vrchatExe = firstExisting({
        L"D:\\WorkSpace\\VRChat\\VRChat.exe",
        L"C:\\Program Files (x86)\\Steam\\steamapps\\common\\VRChat\\VRChat.exe",
        L"D:\\Steam\\steamapps\\common\\VRChat\\VRChat.exe",
    });

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
