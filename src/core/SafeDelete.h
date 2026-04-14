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
};

} // namespace vrcsm::core
