#pragma once

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

    static BundleSniffResult sniff(const std::filesystem::path& dataPath);

    static std::string classifyMagic(const std::string& magic);
};

} // namespace vrcsm::core
