#include "AvatarIdHarvest.h"

#include <fstream>
#include <regex>
#include <system_error>
#include <unordered_set>

#include "Common.h"

namespace vrcsm::core
{

namespace
{
// Avatar id token. The analytics cache embeds ids inside JSON strings; a bare
// token scan is sufficient and avoids coupling to Amplitude's exact schema
// (which is treated as opaque DATA).
const std::regex kAvatarIdRe(R"((avtr_[0-9a-fA-F-]+))");
} // namespace

std::filesystem::path AvatarIdHarvest::DefaultCachePath()
{
    return getWritableTempDirectory() / L"VRChat" / L"VRChat" / L"amplitude.cache";
}

std::vector<std::string> AvatarIdHarvest::HarvestFromFile(const std::filesystem::path& cachePath)
{
    std::vector<std::string> ids;

    std::error_code ec;
    if (!std::filesystem::exists(cachePath, ec) || ec)
    {
        return ids;
    }

    std::ifstream in(cachePath, std::ios::binary);
    if (!in)
    {
        return ids;
    }

    std::unordered_set<std::string> seen;
    std::string line;
    // JSON-lines: scan line-by-line so a huge cache never balloons memory.
    while (std::getline(in, line))
    {
        auto begin = std::sregex_iterator(line.begin(), line.end(), kAvatarIdRe);
        auto end = std::sregex_iterator();
        for (auto it = begin; it != end; ++it)
        {
            std::string id = (*it)[1].str();
            if (seen.insert(id).second)
            {
                ids.push_back(std::move(id));
            }
        }
    }

    return ids;
}

std::vector<std::string> AvatarIdHarvest::Harvest()
{
    return HarvestFromFile(DefaultCachePath());
}

} // namespace vrcsm::core
