#include "Migrator.h"

#include "Common.h"
#include "JunctionUtil.h"
#include "PathProbe.h"
#include "ProcessGuard.h"

#include <algorithm>
#include <fstream>
#include <system_error>

#include <Windows.h>

namespace vrcsm::core
{

void to_json(nlohmann::json& j, const MigratePlan& p)
{
    j = nlohmann::json{
        {"source", p.source},
        {"target", p.target},
        {"sourceBytes", p.sourceBytes},
        {"targetFreeBytes", p.targetFreeBytes},
        {"sourceIsJunction", p.sourceIsJunction},
        {"vrcRunning", p.vrcRunning},
        {"blockers", p.blockers},
    };
}

void to_json(nlohmann::json& j, const MigrateProgress& p)
{
    j = nlohmann::json{
        {"phase", p.phase},
        {"bytesDone", p.bytesDone},
        {"bytesTotal", p.bytesTotal},
        {"filesDone", p.filesDone},
        {"filesTotal", p.filesTotal},
        {"message", p.message},
    };
}

void to_json(nlohmann::json& j, const MigrateSummary& s)
{
    j = nlohmann::json{
        {"ok", s.ok},
        {"bytesCopied", s.bytesCopied},
        {"filesCopied", s.filesCopied},
        {"message", s.message},
    };
}

namespace
{
struct DirectoryStats
{
    std::uint64_t bytes = 0;
    std::uint64_t files = 0;
};

DirectoryStats sizeOf(const std::filesystem::path& dir)
{
    DirectoryStats stats;
    std::error_code ec;
    if (!std::filesystem::exists(dir, ec) || ec) return stats;
    for (const auto& f : std::filesystem::recursive_directory_iterator(
             dir, std::filesystem::directory_options::skip_permission_denied, ec))
    {
        if (ec) break;
        if (f.is_regular_file())
        {
            stats.bytes += f.file_size(ec);
            if (ec) ec.clear();
            stats.files += 1;
        }
    }
    return stats;
}

std::uint64_t freeBytesOnVolume(const std::filesystem::path& target)
{
    auto root = target.root_path();
    if (root.empty()) return 0;
    ULARGE_INTEGER freeAvail{};
    ULARGE_INTEGER totalBytes{};
    ULARGE_INTEGER totalFree{};
    if (GetDiskFreeSpaceExW(root.c_str(), &freeAvail, &totalBytes, &totalFree))
    {
        return static_cast<std::uint64_t>(freeAvail.QuadPart);
    }
    return 0;
}
} // namespace

Result<MigratePlan> Migrator::preflight(
    const std::filesystem::path& source,
    const std::filesystem::path& target)
{
    MigratePlan plan;
    plan.source = toUtf8(source.wstring());
    plan.target = toUtf8(target.wstring());

    std::error_code ec;
    if (!std::filesystem::exists(source, ec) || ec)
    {
        plan.blockers.push_back("source does not exist");
    }
    else
    {
        const auto stats = sizeOf(source);
        plan.sourceBytes = stats.bytes;
    }

    const auto probe = PathProbe::Probe();
    if (probe.baseDir.empty() || !ensureWithinBase(probe.baseDir, source))
    {
        if (!std::filesystem::exists(source, ec))
            plan.blockers.push_back("source path does not exist and is outside the detected VRChat data directory");
    }

    auto normalizedSource = std::filesystem::absolute(source, ec);
    if (ec) normalizedSource = source;
    ec.clear();
    auto normalizedTarget = std::filesystem::absolute(target, ec);
    if (ec) normalizedTarget = target;
    ec.clear();

    if (_wcsicmp(normalizedSource.wstring().c_str(), normalizedTarget.wstring().c_str()) == 0)
    {
        plan.blockers.push_back("source and target must be different paths");
    }
    else if (ensureWithinBase(normalizedSource, normalizedTarget))
    {
        plan.blockers.push_back("target cannot be inside the source directory");
    }

    plan.sourceIsJunction = JunctionUtil::isReparsePoint(source);
    plan.targetFreeBytes = freeBytesOnVolume(target);

    if (std::filesystem::exists(target, ec))
    {
        if (std::filesystem::is_directory(target, ec))
        {
            const auto it = std::filesystem::directory_iterator(target, ec);
            if (!ec && it != std::filesystem::directory_iterator{})
            {
                plan.blockers.push_back("target directory is not empty");
            }
        }
        else
        {
            plan.blockers.push_back("target path exists and is not a directory");
        }
    }

    if (plan.targetFreeBytes < plan.sourceBytes)
    {
        plan.blockers.push_back("not enough free space on target volume");
    }

    const auto vrc = ProcessGuard::IsVRChatRunning();
    plan.vrcRunning = vrc.running;
    if (vrc.running)
    {
        plan.blockers.push_back("VRChat is currently running");
    }

    return plan;
}

Result<MigrateSummary> Migrator::execute(
    const MigratePlan& plan,
    const MigrateProgressCallback& onProgress)
{
    MigrateSummary summary;
    if (!plan.blockers.empty())
    {
        return Error{"preflight_blocked", "Cannot execute: blockers present"};
    }

    const auto sourcePath = utf8Path(plan.source);
    const auto targetPath = utf8Path(plan.target);

    // Sidecar backup path. We rename the source here once the copy is
    // verified, instead of deleting outright — if the junction step fails
    // we can atomically restore. Suffix chosen to be obviously ours and
    // unlikely to collide with any VRChat filename.
    const std::filesystem::path backupPath = sourcePath.wstring() + L".vrcsm-bak";

    // Re-verify VRChat isn't running. preflight() was called earlier,
    // possibly before a user-confirmation dialog — the user may have
    // launched VRChat while the confirmation sat on screen. Once we start
    // touching the cache directory, a live VRChat can lock files and leave
    // the source in a half-copied state.
    {
        const auto vrc = ProcessGuard::IsVRChatRunning();
        if (vrc.running)
        {
            return Error{"vrchat_running",
                "VRChat was launched between preflight and execute — aborting"};
        }
    }

    // Refuse if a leftover backup exists from a prior failed run. Better
    // to surface the stale state to the user than to silently overwrite
    // or silently inherit corrupt data.
    std::error_code ec;
    if (std::filesystem::exists(backupPath, ec))
    {
        return Error{"backup_exists",
            "A leftover backup from a previous migration exists at " +
            toUtf8(backupPath.wstring()) + " — please remove it manually before retrying"};
    }
    ec.clear();

    std::filesystem::create_directories(targetPath, ec);
    if (ec)
    {
        return Error{"target_create_failed", ec.message()};
    }

    auto emit = [&](const std::string& phase,
                    std::uint64_t bytesDone,
                    std::uint64_t bytesTotal,
                    std::uint64_t filesDone,
                    std::uint64_t filesTotal,
                    const std::string& message) {
        if (!onProgress) return;
        MigrateProgress p;
        p.phase = phase;
        p.bytesDone = bytesDone;
        p.bytesTotal = bytesTotal;
        p.filesDone = filesDone;
        p.filesTotal = filesTotal;
        p.message = message;
        onProgress(p);
    };

    const auto totalStats = sizeOf(sourcePath);
    emit("copy", 0, totalStats.bytes, 0, totalStats.files, "starting copy");

    std::uint64_t bytesDone = 0;
    std::uint64_t filesDone = 0;
    for (const auto& f : std::filesystem::recursive_directory_iterator(
             sourcePath, std::filesystem::directory_options::skip_permission_denied, ec))
    {
        if (ec) return Error{"iter_failed", ec.message()};
        const auto rel = std::filesystem::relative(f.path(), sourcePath, ec);
        if (ec) return Error{"rel_failed", ec.message()};
        const auto dst = targetPath / rel;
        if (f.is_directory())
        {
            std::filesystem::create_directories(dst, ec);
            if (ec) return Error{"mkdir_failed", ec.message()};
            continue;
        }
        if (f.is_regular_file())
        {
            std::filesystem::copy_file(
                f.path(),
                dst,
                std::filesystem::copy_options::overwrite_existing,
                ec);
            if (ec) return Error{"copy_failed", ec.message()};
            bytesDone += f.file_size(ec);
            filesDone += 1;
            if (filesDone % 32 == 0)
            {
                emit("copy", bytesDone, totalStats.bytes, filesDone, totalStats.files, "copying");
            }
        }
    }
    emit("copy", bytesDone, totalStats.bytes, filesDone, totalStats.files, "copy complete");

    emit("verify", bytesDone, totalStats.bytes, filesDone, totalStats.files, "verifying");
    const auto verifyStats = sizeOf(targetPath);
    if (verifyStats.bytes != bytesDone)
    {
        return Error{"verify_failed", "byte count mismatch after copy"};
    }

    // ── Atomic swap: rename source → backup, then create junction. ──
    // If the rename fails, nothing has been destroyed yet. If the junction
    // step fails after the rename, we rename the backup back over the
    // original path.
    emit("swap", bytesDone, totalStats.bytes, filesDone, totalStats.files,
         "swapping source to backup");
    std::filesystem::rename(sourcePath, backupPath, ec);
    if (ec)
    {
        return Error{"source_rename_failed", ec.message()};
    }

    emit("junction", bytesDone, totalStats.bytes, filesDone, totalStats.files,
         "creating junction");
    auto jr = JunctionUtil::createJunction(sourcePath, targetPath);
    if (!isOk(jr))
    {
        // Restore the backup — rename is atomic, so on success the user's
        // cache is exactly where it started.
        std::error_code restoreEc;
        std::filesystem::rename(backupPath, sourcePath, restoreEc);
        if (restoreEc)
        {
            return Error{"junction_failed_restore_failed",
                "junction: " + error(jr).message +
                "; restore from " + toUtf8(backupPath.wstring()) +
                " failed: " + restoreEc.message()};
        }
        return Error{"junction_failed", error(jr).message};
    }

    // Junction claims success. Verify it actually resolves — a broken
    // reparse point is indistinguishable from a real one via CreateFile
    // until you try to read. If it's broken, tear it down and restore.
    emit("junction_verify", bytesDone, totalStats.bytes, filesDone, totalStats.files,
         "verifying junction");
    std::error_code probeEc;
    const bool junctionLivesAtSource =
        std::filesystem::is_directory(sourcePath, probeEc) && !probeEc;
    if (!junctionLivesAtSource)
    {
        std::error_code cleanupEc;
        std::filesystem::remove(sourcePath, cleanupEc);  // remove the junction
        std::error_code restoreEc;
        std::filesystem::rename(backupPath, sourcePath, restoreEc);
        if (restoreEc)
        {
            return Error{"junction_verify_failed_restore_failed",
                "junction created but not readable; restore from " +
                toUtf8(backupPath.wstring()) + " failed: " + restoreEc.message()};
        }
        return Error{"junction_verify_failed",
            "junction created but source path is not a readable directory"};
    }

    // All green — drop the backup. If removal fails, the migration itself
    // still succeeded (the user now has a working junction); just surface
    // it in the summary message so the user can delete manually.
    emit("cleanup", bytesDone, totalStats.bytes, filesDone, totalStats.files,
         "removing backup");
    std::error_code backupRmEc;
    std::filesystem::remove_all(backupPath, backupRmEc);

    summary.ok = true;
    summary.bytesCopied = bytesDone;
    summary.filesCopied = filesDone;
    if (backupRmEc)
    {
        summary.message = "migration complete (backup left at " +
                          toUtf8(backupPath.wstring()) +
                          " — safe to delete manually)";
    }
    else
    {
        summary.message = "migration complete";
    }
    emit("done", bytesDone, totalStats.bytes, filesDone, totalStats.files, summary.message);
    return summary;
}

nlohmann::json Migrator::Preflight(const nlohmann::json& params)
{
    const auto source = utf8Path(params.at("source").get<std::string>());
    const auto target = utf8Path(params.at("target").get<std::string>());
    auto result = preflight(source, target);
    if (isOk(result))
    {
        return nlohmann::json(value(result));
    }
    return nlohmann::json{{"error", {{"code", error(result).code}, {"message", error(result).message}}}};
}

MigrateSummary Migrator::Execute(
    const nlohmann::json& params,
    const MigrateProgressCallback& onProgress)
{
    const auto source = utf8Path(params.at("source").get<std::string>());
    const auto target = utf8Path(params.at("target").get<std::string>());

    auto plan = preflight(source, target);
    if (!isOk(plan))
    {
        MigrateSummary s;
        s.ok = false;
        s.message = error(plan).message;
        return s;
    }
    auto result = execute(value(plan), onProgress);
    if (isOk(result)) return value(result);
    MigrateSummary s;
    s.ok = false;
    s.message = error(result).message;
    return s;
}

} // namespace vrcsm::core
