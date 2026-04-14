#pragma once

#include <cstdint>
#include <filesystem>
#include <functional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "Common.h"

namespace vrcsm::core
{

struct MigratePlan
{
    std::string source;
    std::string target;
    std::uint64_t sourceBytes = 0;
    std::uint64_t targetFreeBytes = 0;
    bool sourceIsJunction = false;
    bool vrcRunning = false;
    std::vector<std::string> blockers;
};

void to_json(nlohmann::json& j, const MigratePlan& p);

struct MigrateProgress
{
    std::string phase;
    std::uint64_t bytesDone = 0;
    std::uint64_t bytesTotal = 0;
    std::uint64_t filesDone = 0;
    std::uint64_t filesTotal = 0;
    std::string message;
};

void to_json(nlohmann::json& j, const MigrateProgress& p);

struct MigrateSummary
{
    bool ok = false;
    std::uint64_t bytesCopied = 0;
    std::uint64_t filesCopied = 0;
    std::string message;
};

void to_json(nlohmann::json& j, const MigrateSummary& s);

using MigrateProgressCallback = std::function<void(const MigrateProgress&)>;

class Migrator
{
public:
    static Result<MigratePlan> preflight(
        const std::filesystem::path& source,
        const std::filesystem::path& target);

    static Result<MigrateSummary> execute(
        const MigratePlan& plan,
        const MigrateProgressCallback& onProgress);

    // IPC facade
    static nlohmann::json Preflight(const nlohmann::json& params);

    static MigrateSummary Execute(
        const nlohmann::json& params,
        const MigrateProgressCallback& onProgress);
};

} // namespace vrcsm::core
