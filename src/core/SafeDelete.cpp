#include "SafeDelete.h"

#include "CacheScanner.h"
#include "Common.h"
#include "PathProbe.h"
#include "ProcessGuard.h"

#include <algorithm>
#include <array>
#include <optional>
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

bool samePathLexical(const std::filesystem::path& a, const std::filesystem::path& b)
{
    return ensureWithinBase(a, b) && ensureWithinBase(b, a);
}

std::filesystem::path normalizeLexical(const std::filesystem::path& path)
{
    std::error_code ec;
    auto abs = std::filesystem::absolute(path, ec);
    if (ec) abs = path;
    return abs.lexically_normal();
}

bool isChildOfCategoryRoot(
    const std::filesystem::path& categoryRoot,
    const std::filesystem::path& target)
{
    return ensureWithinBase(categoryRoot, target)
        && !samePathLexical(categoryRoot, target);
}

bool isPreservedCwpRootTarget(
    const std::filesystem::path& cwpRoot,
    const std::filesystem::path& target)
{
    const auto normalizedRoot = normalizeLexical(cwpRoot);
    const auto normalizedTarget = normalizeLexical(target);
    return samePathLexical(normalizedTarget.parent_path(), normalizedRoot)
        && isPreserved(normalizedTarget);
}

std::optional<Error> validateDeleteTarget(
    const std::filesystem::path& baseDir,
    const std::filesystem::path& target)
{
    if (!ensureWithinBase(baseDir, target))
    {
        return Error{"escape", "Target escapes baseDir"};
    }

    for (const auto& def : categoryDefs())
    {
        if (!def.safe_delete) continue;

        const auto categoryRoot = baseDir / std::filesystem::path(toWide(def.rel_path));
        if (!isChildOfCategoryRoot(categoryRoot, target))
        {
            continue;
        }

        if (def.key == std::string_view("cache_windows_player")
            && isPreservedCwpRootTarget(categoryRoot, target))
        {
            return Error{
                "preserved_target",
                "Cache-WindowsPlayer root __info and vrc-version are preserved"};
        }

        return std::nullopt;
    }

    return Error{"unsafe_target", "Target is not a child of a safe delete category"};
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
        if (ensureWithinBase(categoryRoot, entryPath)
            && !samePathLexical(categoryRoot, entryPath)
            && !(category == "cache_windows_player"
                && isPreservedCwpRootTarget(categoryRoot, entryPath)))
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
    const auto vrc = ProcessGuard::IsVRChatRunning();
    if (vrc.running)
    {
        return Error{"vrchat_running", "VRChat is currently running"};
    }

    std::size_t deleted = 0;
    for (const auto& targetUtf8 : plan.targets)
    {
        const auto target = utf8Path(targetUtf8);
        if (const auto validation = validateDeleteTarget(baseDir, target))
        {
            return *validation;
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
