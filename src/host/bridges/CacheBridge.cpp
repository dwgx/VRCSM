#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/BundleSniff.h"
#include "../../core/CacheScanner.h"
#include "../../core/Common.h"
#include "../../core/Database.h"
#include "../../core/LogParser.h"
#include "../../core/PathProbe.h"
#include "../../core/SafeDelete.h"

#include <spdlog/spdlog.h>

nlohmann::json IpcBridge::HandleScan(const nlohmann::json&, const std::optional<std::string>&)
{
    const auto probe = vrcsm::core::PathProbe::Probe();

    // Side-effect: backfill avatar_history from the VRChat logs. LogTailer
    // only captures lines written *after* VRCSM started, so avatar switches
    // from earlier sessions (or from before VRCSM launched) never hit the
    // DB and Seen Avatars stays at 0. A scan is the user's way of saying
    // "re-sync everything" — replay the avatar_switches stream into
    // avatar_history here. RecordAvatarSeen has ON CONFLICT upsert so
    // replaying is idempotent.
    if (probe.baseDirExists && !probe.baseDir.empty())
    {
        try
        {
            auto report = vrcsm::core::LogParser::parse(probe.baseDir);
            int inserted = 0;
            for (const auto& ev : report.avatar_switches)
            {
                if (ev.avatar_name.empty()) continue;
                vrcsm::core::Database::AvatarSeenInsert a;
                a.avatar_id = "name:" + ev.avatar_name;
                a.avatar_name = ev.avatar_name;
                if (!ev.actor.empty()) a.first_seen_on = ev.actor;
                if (ev.actor_user_id.has_value()) a.first_seen_user_id = *ev.actor_user_id;
                // Never write empty timestamp — schema sorts by it and an empty
                // string poisons ordering. Fall back to nowIso() when log line
                // didn't carry a stamp (continuation/spam lines).
                a.first_seen_at = ev.iso_time.value_or(vrcsm::core::nowIso());
                (void)vrcsm::core::Database::Instance().RecordAvatarSeen(a);
                ++inserted;
            }
            spdlog::info("scan: backfilled {} avatar_history rows from logs", inserted);
        }
        catch (const std::exception& ex)
        {
            spdlog::warn("scan: avatar_history backfill failed: {}", ex.what());
        }
    }

    return ToJson(vrcsm::core::CacheScanner::buildReport(probe.baseDir));
}

nlohmann::json IpcBridge::HandleBundlePreview(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto entryPath = Utf8ToWide(params.at("entry").get<std::string>());
    const std::filesystem::path base(entryPath);
    const auto probe = vrcsm::core::PathProbe::Probe();
    const auto cwpDir = std::filesystem::path(probe.baseDir) / L"Cache-WindowsPlayer";
    if (probe.baseDir.empty() || !vrcsm::core::ensureWithinBase(cwpDir, base))
    {
        throw std::runtime_error("bundle.preview: entry escapes Cache-WindowsPlayer");
    }

    std::filesystem::path versionDir = base;
    if (!std::filesystem::exists(base / L"__info"))
    {
        std::error_code ec;
        for (const auto& child : std::filesystem::directory_iterator(base, ec))
        {
            if (ec) break;
            if (child.is_directory()
                && vrcsm::core::ensureWithinBase(cwpDir, child.path())
                && std::filesystem::exists(child.path() / L"__info"))
            {
                versionDir = child.path();
                break;
            }
        }
    }

    const std::filesystem::path infoPath = versionDir / L"__info";
    std::ifstream infoStream(infoPath, std::ios::binary);
    if (!infoStream)
    {
        throw std::runtime_error(
            "Could not locate __info under " + params.at("entry").get<std::string>());
    }

    std::string infoText((std::istreambuf_iterator<char>(infoStream)), std::istreambuf_iterator<char>());
    auto sniff = vrcsm::core::BundleSniff::sniff(versionDir);
    nlohmann::json result = ToJson(sniff);
    result["infoText"] = infoText;
    return result;
}

nlohmann::json IpcBridge::HandleDeleteDryRun(const nlohmann::json& params, const std::optional<std::string>&)
{
    return ToJson(vrcsm::core::SafeDelete::ResolveTargets(params));
}

nlohmann::json IpcBridge::HandleDeleteExecute(const nlohmann::json& params, const std::optional<std::string>&)
{
    // SafeDelete::Execute returns a dual-shape json: {"deleted": N} on success,
    // {"error": {code, message}} on failure. The bridge must convert the error
    // shape into an IpcException so the dispatch layer posts a proper error
    // response — otherwise the frontend receives it as a successful result and
    // silently believes the delete succeeded.
    auto result = vrcsm::core::SafeDelete::Execute(params);
    if (result.is_object() && result.contains("error") && result["error"].is_object())
    {
        const auto& err = result["error"];
        throw IpcException(vrcsm::core::Error{
            err.value("code", std::string("delete_failed")),
            err.value("message", std::string("unknown delete error")),
            0,
        });
    }
    return result;
}
