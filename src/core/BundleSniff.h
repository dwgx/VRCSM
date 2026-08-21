#pragma once

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

struct BundleEntry
{
    std::string entry;
    std::string path;
    std::uint64_t bytes = 0;
    std::string bytes_human;
    std::uint64_t file_count = 0;
    std::optional<std::string> latest_mtime;
    std::optional<std::string> oldest_mtime;
    std::string bundle_format;
    /// First line of __info (typically the asset URL) — cheap to read during scan.
    std::string info_url;
};

void to_json(nlohmann::json& j, const BundleEntry& e);

struct BundleSniffResult
{
    std::string magic;
    std::string bundle_format;
    std::vector<std::string> fileTree;
};

void to_json(nlohmann::json& j, const BundleSniffResult& r);

class BundleSniff
{
public:
    static std::vector<BundleEntry> scanCacheWindowsPlayer(const std::filesystem::path& cwpDir);

    // One top-level Cache-WindowsPlayer hash directory → BundleEntry.
    // bundle_format stays "unknown"; call fillLargestBundleFormats after
    // sorting if the UnityFS badge is needed.
    static BundleEntry summarizeTopLevelDir(const std::filesystem::path& dir);

    // Classify `__data` magic for the first `limit` entries (already
    // sorted largest-first). Matches scanCacheWindowsPlayer's top-16 cap.
    static void fillLargestBundleFormats(std::vector<BundleEntry>& entries, std::size_t limit = 16);

    static BundleSniffResult sniff(const std::filesystem::path& dataPath);

    static std::string classifyMagic(const std::string& magic);
};

} // namespace vrcsm::core
