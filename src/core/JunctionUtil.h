#pragma once

#include <filesystem>
#include <optional>
#include <string>

#include <nlohmann/json.hpp>

#include "Common.h"

namespace vrcsm::core
{

class JunctionUtil
{
public:
    static bool isReparsePoint(const std::filesystem::path& p);

    static std::optional<std::filesystem::path> readJunctionTarget(const std::filesystem::path& p);

    static Result<std::monostate> createJunction(
        const std::filesystem::path& source,
        const std::filesystem::path& target);

    static Result<std::monostate> removeJunction(const std::filesystem::path& p);

    static nlohmann::json Repair(const nlohmann::json& params);
};

} // namespace vrcsm::core
