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
        std::cerr << "usage: dump_avatar_details <avtr_id> [--preview]\n"
                  << "       dump_avatar_details --search <avatar_name> [count]\n"
                  << "       dump_avatar_details --user <usr_id>\n";
        return 1;
    }

    (void)vrcsm::core::AuthStore::Instance().Load();

    const std::string mode = argv[1];
    if (mode == "--search")
    {
        if (argc < 3)
        {
            std::cerr << "usage: dump_avatar_details --search <avatar_name> [count]\n";
            return 1;
        }
        const int count = argc >= 4 ? std::stoi(argv[3]) : 10;
        const auto result = vrcsm::core::VrcApi::searchAvatars(argv[2], count, 0);
        if (!vrcsm::core::isOk(result))
        {
            const auto& err = vrcsm::core::error(result);
            std::cerr << "error: " << err.code << " :: " << err.message << " (http=" << err.httpStatus << ")\n";
            return 2;
        }
        std::cout << vrcsm::core::value(result).dump(2) << "\n";
        return 0;
    }

    if (mode == "--user")
    {
        if (argc < 3)
        {
            std::cerr << "usage: dump_avatar_details --user <usr_id>\n";
            return 1;
        }
        const auto result = vrcsm::core::VrcApi::fetchUser(argv[2]);
        if (!vrcsm::core::isOk(result))
        {
            const auto& err = vrcsm::core::error(result);
            std::cerr << "error: " << err.code << " :: " << err.message << " (http=" << err.httpStatus << ")\n";
            return 2;
        }
        std::cout << vrcsm::core::value(result).dump(2) << "\n";
        return 0;
    }

    const std::string avatarId = argv[1];
    const bool runPreview = argc >= 3 && std::string(argv[2]) == "--preview";
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
