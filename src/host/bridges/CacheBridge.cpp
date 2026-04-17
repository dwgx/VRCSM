#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/BundleSniff.h"
#include "../../core/CacheScanner.h"
#include "../../core/PathProbe.h"
#include "../../core/SafeDelete.h"

nlohmann::json IpcBridge::HandleScan(const nlohmann::json&, const std::optional<std::string>&)
{
    const auto probe = vrcsm::core::PathProbe::Probe();
    return ToJson(vrcsm::core::CacheScanner::buildReport(probe.baseDir));
}

nlohmann::json IpcBridge::HandleBundlePreview(const nlohmann::json& params, const std::optional<std::string>&)
{
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
