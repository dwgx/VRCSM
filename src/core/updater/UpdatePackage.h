#pragma once

#include "../Common.h"

#include <cstdint>
#include <filesystem>
#include <functional>
#include <optional>
#include <string>
#include <string_view>

namespace vrcsm::core::updater
{

struct PackageValidationOptions
{
    std::string version;
    std::string expectedFileName;
    std::uint64_t expectedSize{0};
    std::optional<std::string> expectedSha256;
    std::function<void(std::uint64_t, std::uint64_t)> onProgress;
};

std::filesystem::path UpdatesDirectory();
std::filesystem::path BuildUpdateTargetPath(std::string_view targetFileName);
std::filesystem::path TargetPathForVersion(const std::string& version);
bool IsMsiFileName(std::string_view value);
bool IsSafeMsiFileName(std::string_view value);
std::optional<std::uint64_t> UpdateFileSize(const std::filesystem::path& path);
Result<std::string> ComputeSha256(
    const std::filesystem::path& path,
    const std::function<void(std::uint64_t, std::uint64_t)>& onProgress = {});
Result<std::monostate> ValidateDownloadedPackage(
    const std::filesystem::path& path,
    const PackageValidationOptions& options);

} // namespace vrcsm::core::updater
