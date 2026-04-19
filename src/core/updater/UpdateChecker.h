#pragma once

#include "../Common.h"

#include <cstdint>
#include <optional>
#include <string>

namespace vrcsm::core::updater
{

struct UpdateInfo
{
    bool available{false};
    std::string currentVersion;
    std::string latestVersion;
    std::optional<std::string> downloadUrl;
    std::optional<std::uint64_t> downloadSize;
    std::optional<std::string> sha256;
    std::string releaseNotesMarkdown;
    std::string releaseUrl;
};

class UpdateChecker
{
public:
    static Result<UpdateInfo> CheckLatest(bool forceRefresh);
};

} // namespace vrcsm::core::updater
