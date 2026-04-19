#pragma once

#include "../Common.h"

#include <cstdint>
#include <filesystem>
#include <functional>
#include <optional>
#include <string>

namespace vrcsm::core::updater
{

struct DownloadOptions
{
    std::string url;
    std::uint64_t expectedSize{0};
    std::optional<std::string> expectedSha256;
    std::string targetFileName;
    std::function<void(std::uint64_t, std::uint64_t)> onProgress;
};

class UpdateDownloader
{
public:
    static Result<std::filesystem::path> Download(const DownloadOptions& options);
};

} // namespace vrcsm::core::updater
