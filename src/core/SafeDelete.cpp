#include "SafeDelete.h"

#include "CacheScanner.h"
#include "Common.h"
#include "PathProbe.h"
#include "ProcessGuard.h"

#include <algorithm>
#include <array>
#include <optional>
#include <system_error>

#ifdef _WIN32
#include <windows.h>
#endif

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

// True if the path itself is a reparse point (NTFS junction / mount point /
// symlink). std::filesystem::remove_all follows directory junctions, so a
// junction planted inside a safe-delete category would pass the lexical
// within-base check yet recurse into and delete data *outside* baseDir. We
// refuse to delete through any reparse point. (std::filesystem::is_symlink
// does not catch junctions, which are IO_REPARSE_TAG_MOUNT_POINT, so we test
// the Win32 attribute directly.)
bool isReparsePoint(const std::filesystem::path& p)
{
#ifdef _WIN32
    const DWORD attrs = ::GetFileAttributesW(p.wstring().c_str());
    if (attrs == INVALID_FILE_ATTRIBUTES) return false;
    return (attrs & FILE_ATTRIBUTE_REPARSE_POINT) != 0;
#else
    std::error_code ec;
    return std::filesystem::is_symlink(p, ec);
#endif
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

// Recursively remove `dir` (a real directory, already confirmed inside root
// and not itself a reparse point) without ever descending through an NTFS
// junction / reparse point. std::filesystem::remove_all follows directory
// junctions and would delete data outside root, so we walk by hand: a child
// that is a reparse point is unlinked with remove() (drops the link entry
// only, never follows it); a real subdirectory is recursed into first. Counts
// every entry removed. On any error the out-param `ec` is set and the walk
// stops.
std::size_t removeTreeNoFollow(const std::filesystem::path& dir, std::error_code& ec)
{
    std::size_t removed = 0;
    std::filesystem::directory_iterator it(dir, ec);
    if (ec) return removed;
    const std::filesystem::directory_iterator end{};
    for (; it != end; it.increment(ec))
    {
        if (ec) return removed;
        const auto& child = it->path();
        if (isReparsePoint(child))
        {
            // Unlink the junction/symlink itself; do NOT recurse through it.
            if (std::filesystem::remove(child, ec)) ++removed;
            if (ec) return removed;
            continue;
        }
        std::error_code statEc;
        if (std::filesystem::is_directory(child, statEc) && !statEc)
        {
            removed += removeTreeNoFollow(child, ec);
            if (ec) return removed;
        }
        if (std::filesystem::remove(child, ec)) ++removed;
        if (ec) return removed;
    }
    return removed;
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
        // Refuse to delete through a junction/reparse point: remove_all would
        // follow it and recurse outside baseDir even though the lexical
        // within-base check above passed.
        if (isReparsePoint(target))
        {
            return Error{"reparse_target",
                         "Refusing to delete a junction/reparse point"};
        }
        // Walk by hand instead of std::filesystem::remove_all: remove_all
        // follows directory junctions nested *below* the top level, so a
        // junction planted at <category>/sub/evil would let it recurse and
        // delete data outside baseDir. removeTreeNoFollow unlinks any reparse
        // point it meets rather than descending through it (same hardening as
        // DeleteWithinRoot). Count semantics match remove_all: children + the
        // target directory itself.
        std::error_code ec;
        std::size_t count = 0;
        if (std::filesystem::is_directory(target, ec) && !ec)
        {
            count += removeTreeNoFollow(target, ec);
            if (ec) return Error{"remove_failed", ec.message()};
        }
        if (std::filesystem::remove(target, ec)) ++count;
        if (ec) return Error{"remove_failed", ec.message()};
        deleted += count;
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

Result<std::size_t> SafeDelete::DeleteWithinRoot(
    const std::filesystem::path& root,
    const std::filesystem::path& target)
{
    if (root.empty() || target.empty())
    {
        return Error{"invalid_argument", "empty root or target"};
    }

    // Containment check: the resolved target must live strictly inside root.
    // ensureWithinBase normalizes both lexically and compares components, so a
    // "../" escape can't slip through. Refuse deleting root itself.
    if (!ensureWithinBase(root, target))
    {
        return Error{"escape", "Target escapes AppData root"};
    }
    if (samePathLexical(normalizeLexical(root), normalizeLexical(target)))
    {
        return Error{"unsafe_target", "Refusing to delete the AppData root itself"};
    }

    std::error_code ec;
    if (!std::filesystem::exists(target, ec) || ec)
    {
        return std::size_t{0}; // nothing to delete
    }

    // Never follow a reparse point at the top level: if the target itself is a
    // junction/symlink, unlink the entry only.
    if (isReparsePoint(target))
    {
        return Error{"reparse_target", "Refusing to delete a junction/reparse point"};
    }

    std::size_t removed = 0;
    if (std::filesystem::is_directory(target, ec) && !ec)
    {
        removed += removeTreeNoFollow(target, ec);
        if (ec) return Error{"remove_failed", ec.message()};
    }
    if (std::filesystem::remove(target, ec)) ++removed;
    if (ec) return Error{"remove_failed", ec.message()};
    return removed;
}

} // namespace vrcsm::core
