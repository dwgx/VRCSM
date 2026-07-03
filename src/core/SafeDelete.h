#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "Common.h"

namespace vrcsm::core
{

struct DeletePlan
{
    std::vector<std::string> targets;
};

void to_json(nlohmann::json& j, const DeletePlan& p);

class SafeDelete
{
public:
    static DeletePlan Plan(
        const std::filesystem::path& baseDir,
        std::string_view category,
        std::optional<std::string_view> entry);

    static Result<std::size_t> ExecutePlan(
        const std::filesystem::path& baseDir,
        const DeletePlan& plan);

    // IPC entry points: take JSON params, return JSON.
    static nlohmann::json ResolveTargets(const nlohmann::json& params);

    static nlohmann::json Execute(const nlohmann::json& params);

    // Root-scoped safe delete for VRCSM's own AppData caches (thumb cache,
    // preview cache, screenshot thumbs, updates, feed/index JSON). Unlike the
    // VRChat-category API above, this validates `target` only against `root`
    // (typically getAppDataRoot()); it does NOT require the target to be a
    // known VRChat cache category. It keeps the same hardening: the target
    // must resolve strictly inside `root`, may not be `root` itself, and the
    // recursive removal refuses to follow NTFS junctions / reparse points
    // (it removes the link entry rather than descending through it). Missing
    // targets return 0 deleted, not an error. Returns the number of files +
    // directories removed.
    static Result<std::size_t> DeleteWithinRoot(
        const std::filesystem::path& root,
        const std::filesystem::path& target);
};

} // namespace vrcsm::core
