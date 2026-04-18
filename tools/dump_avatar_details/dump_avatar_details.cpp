#include <iostream>
#include <string>

#include <nlohmann/json.hpp>

#include "core/AuthStore.h"
#include "core/AvatarPreview.h"
#include "core/PathProbe.h"
#include "core/VrcApi.h"

int main(int argc, char** argv)
{
    if (argc < 2)
    {
        std::cerr << "usage: dump_avatar_details <avtr_id> [--preview]\n";
        return 1;
    }

    const std::string avatarId = argv[1];
    const bool runPreview = argc >= 3 && std::string(argv[2]) == "--preview";
    (void)vrcsm::core::AuthStore::Instance().Load();
    const auto result = vrcsm::core::VrcApi::fetchAvatarDetails(avatarId);
    if (!vrcsm::core::isOk(result))
    {
        const auto& err = vrcsm::core::error(result);
        std::cerr << "error: " << err.code << " :: " << err.message << " (http=" << err.httpStatus << ")\n";
        return 2;
    }

    const auto& doc = vrcsm::core::value(result);
    std::cout << doc.dump(2) << "\n";

    if (!runPreview)
    {
        return 0;
    }

    std::string assetUrl;
    if (doc.contains("unityPackages") && doc["unityPackages"].is_array())
    {
        for (const auto& pkg : doc["unityPackages"])
        {
            if (!pkg.is_object()) continue;
            if (pkg.value("platform", std::string{}) != "standalonewindows") continue;
            if (!pkg.contains("assetUrl") || !pkg["assetUrl"].is_string()) continue;
            const auto candidate = pkg["assetUrl"].get<std::string>();
            if (candidate.empty()) continue;
            assetUrl = candidate;
            if (pkg.value("variant", std::string{}) == "standard")
            {
                break;
            }
        }
    }

    if (assetUrl.empty())
    {
        std::cerr << "preview: no standalonewindows assetUrl\n";
        return 3;
    }

    const auto probe = vrcsm::core::PathProbe::Probe();
    const auto preview = vrcsm::core::AvatarPreview::Request(
        avatarId,
        probe.baseDir,
        assetUrl,
        {});
    if (!preview.ok)
    {
        std::cerr << "preview error: " << preview.code << " :: " << preview.message << "\n";
        return 4;
    }

    std::cout << "preview glb: " << preview.glbPath << "\n";
    std::cout << "preview url: " << preview.glbUrl << "\n";
    return 0;
}
