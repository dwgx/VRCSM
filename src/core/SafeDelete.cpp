#include "SafeDelete.h"

#include "CacheScanner.h"
#include "Common.h"
#include "PathProbe.h"

#include <algorithm>
#include <array>
#include <system_error>

namespace vrcsm::core
{

void to_json(nlohmann::json& j, const DeletePlan& p)
{
    j = nlohmann::json{{"targets", p.targets}};
}

namespace
{
constexpr std::array<std::string_view, 2> kPreserveAtCwpRoot{"__info", "vrc-version"};

bool isPreserved(const std::filesystem::path& p)
{
    const auto name = p.filename().string();
    for (const auto& r : kPreserveAtCwpRoot)
    {
        if (name == r) return true;
    }
    return false;
}

const CategoryDef* findCategory(std::string_view key)
{
    for (const auto& def : categoryDefs())
    {
        if (def.key == key) return &def;
    }
    return nullptr;
}
} // namespace

DeletePlan SafeDelete::Plan(
    const std::filesystem::path& baseDir,
    std::string_view category,
    std::optional<std::string_view> entry)
{
    DeletePlan plan;
    const auto* def = findCategory(category);
    if (def == nullptr) return plan;
    if (!def->safe_delete) return plan;

    const auto categoryRoot = baseDir / std::filesystem::path(toWide(def->rel_path));

    if (entry.has_value())
    {
        const auto entryPath = categoryRoot / std::filesystem::path(toWide(*entry));
        if (ensureWithinBase(categoryRoot, entryPath))
        {
            plan.targets.push_back(toUtf8(entryPath.wstring()));
        }
        return plan;
    }

    std::error_code ec;
    if (!std::filesystem::exists(categoryRoot, ec) || ec) return plan;

    for (const auto& child : std::filesystem::directory_iterator(categoryRoot, ec))
    {
        if (ec) break;
        if (category == "cache_windows_player" && isPreserved(child.path())) continue;
        if (!ensureWithinBase(categoryRoot, child.path())) continue;
        plan.targets.push_back(toUtf8(child.path().wstring()));
    }
    return plan;
}

Result<std::size_t> SafeDelete::ExecutePlan(
    const std::filesystem::path& baseDir,
    const DeletePlan& plan)
{
    std::size_t deleted = 0;
    for (const auto& targetUtf8 : plan.targets)
    {
        const auto target = utf8Path(targetUtf8);
        if (!ensureWithinBase(baseDir, target))
        {
            return Error{"escape", "Target escapes baseDir"};
        }
        std::error_code ec;
        const auto count = std::filesystem::remove_all(target, ec);
        if (ec) return Error{"remove_failed", ec.message()};
        deleted += static_cast<std::size_t>(count);
    }
    return deleted;
}

nlohmann::json SafeDelete::ResolveTargets(const nlohmann::json& params)
{
    const auto category = params.at("category").get<std::string>();
    std::optional<std::string> entry;
    if (params.contains("entry") && params["entry"].is_string())
    {
        entry = params["entry"].get<std::string>();
    }

    const auto baseDir = PathProbe::Probe().baseDir;
    const auto plan = Plan(
        baseDir,
        category,
        entry ? std::optional<std::string_view>(*entry) : std::nullopt);
    return nlohmann::json{{"targets", plan.targets}};
}

nlohmann::json SafeDelete::Execute(const nlohmann::json& params)
{
    const auto baseDir = PathProbe::Probe().baseDir;

    DeletePlan plan;
    if (params.contains("targets") && params["targets"].is_array())
    {
        for (const auto& t : params["targets"])
        {
            plan.targets.push_back(t.get<std::string>());
        }
    }
    else
    {
        const auto category = params.at("category").get<std::string>();
        std::optional<std::string> entry;
        if (params.contains("entry") && params["entry"].is_string())
        {
            entry = params["entry"].get<std::string>();
        }
        plan = Plan(
            baseDir,
            category,
            entry ? std::optional<std::string_view>(*entry) : std::nullopt);
    }

    const auto result = ExecutePlan(baseDir, plan);
    if (isOk(result))
    {
        return nlohmann::json{{"deleted", value(result)}};
    }
    const auto& err = error(result);
    return nlohmann::json{{"error", {{"code", err.code}, {"message", err.message}}}};
}

} // namespace vrcsm::core
