#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/LogEventClassifier.h"
#include "../../core/LogParser.h"
#include "../../core/ProcessGuard.h"
#include "../../core/PathProbe.h"
#include "../../core/Database.h"

#include <regex>

namespace
{

const std::regex kOutputLogFileRe(R"(^output_log_.*\.txt$)");

std::filesystem::path FindLatestLogFile(const std::filesystem::path& logDir)
{
    std::error_code ec;
    if (!std::filesystem::exists(logDir, ec) || ec)
    {
        return {};
    }

    std::filesystem::path best;
    std::filesystem::file_time_type bestTime{};
    bool haveBest = false;
    for (const auto& entry : std::filesystem::directory_iterator(logDir, ec))
    {
        if (ec)
        {
            break;
        }

        std::error_code innerEc;
        if (!entry.is_regular_file(innerEc) || innerEc)
        {
            continue;
        }

        const auto filename = entry.path().filename().string();
        if (!std::regex_match(filename, kOutputLogFileRe))
        {
            continue;
        }

        const auto lastWriteTime = entry.last_write_time(innerEc);
        if (innerEc)
        {
            continue;
        }

        if (!haveBest || lastWriteTime > bestTime)
        {
            best = entry.path();
            bestTime = lastWriteTime;
            haveBest = true;
        }
    }

    return best;
}

} // namespace

nlohmann::json IpcBridge::HandleLogsStreamStart(const nlohmann::json&, const std::optional<std::string>&)
{
    // Idempotent — React StrictMode double-effects and two docks mounting
    // in quick succession must not spawn two tailers.
    if (m_logTailer)
    {
        return nlohmann::json{{"running", true}};
    }

    const auto probe = vrcsm::core::PathProbe::Probe();
    if (!probe.baseDirExists)
    {
        throw std::runtime_error("logs.stream.start: VRChat log directory not found");
    }

    if (vrcsm::core::ProcessGuard::IsVRChatRunning().running)
    {
        try
        {
            const auto parsed = vrcsm::core::LogParser::parse(probe.baseDir);
            if (!parsed.world_switches.empty())
            {
                const auto& latestSwitch = parsed.world_switches.back();
                std::lock_guard<std::mutex> lk(m_currentWorldMutex);
                m_currentWorldId = latestSwitch.world_id;
                m_currentInstanceId = latestSwitch.instance_id;
            }
        }
        catch (...)
        {
            // Non-fatal: live tailing can still proceed without a seeded
            // current world, but seeding helps mid-session host restarts
            // keep player join/leave events attached to the right instance.
        }
    }

    m_logTailer = std::make_unique<vrcsm::core::LogTailer>(
        probe.baseDir,
        [this](const vrcsm::core::LogTailLine& line)
        {
            // 1) Raw line → logs.stream for the Console dock.
            {
                nlohmann::json data{
                    {"line", line.line},
                    {"level", line.level},
                    {"source", line.source},
                };
                if (!line.iso_time.empty())
                {
                    data["timestamp"] = line.iso_time;
                }
                m_host.PostMessageToWeb(nlohmann::json{
                    {"event", "logs.stream"},
                    {"data", std::move(data)}
                }.dump());
            }

            // 2) Classified event → logs.stream.event for live panels.
            nlohmann::json classified = vrcsm::core::ClassifyStreamLine(line);
            if (classified.is_null())
            {
                return;
            }

            try
            {
                const std::string kind = classified.value("kind", std::string{});
                auto& data = classified["data"];
                if ((kind == "player" || kind == "avatarSwitch") && data.is_object())
                {
                    std::lock_guard<std::mutex> lk(m_currentWorldMutex);
                    if (!m_currentWorldId.empty() && !data.contains("world_id"))
                    {
                        data["world_id"] = m_currentWorldId;
                    }
                    if (!m_currentInstanceId.empty() && !data.contains("instance_id"))
                    {
                        data["instance_id"] = m_currentInstanceId;
                    }
                }
            }
            catch (...)
            {
                // Non-fatal: event streaming should continue even if the
                // context enrichment path sees malformed JSON.
            }

            m_host.PostMessageToWeb(nlohmann::json{
                {"event", "logs.stream.event"},
                {"data", classified}
            }.dump());

            // 3) Persist into SQLite so pages see history across restarts.
            try
            {
                const std::string kind = classified.value("kind", std::string{});
                const auto& data = classified.value("data", nlohmann::json::object());
                const std::string iso = data.value("iso_time", vrcsm::core::nowIso());

                if (kind == "worldSwitch")
                {
                    vrcsm::core::Database::WorldVisitInsert v;
                    v.world_id = data.value("world_id", std::string{});
                    v.instance_id = data.value("instance_id", std::string{});
                    if (data.contains("access_type") && data["access_type"].is_string())
                        v.access_type = data["access_type"].get<std::string>();
                    if (data.contains("owner_id") && data["owner_id"].is_string())
                        v.owner_id = data["owner_id"].get<std::string>();
                    if (data.contains("region") && data["region"].is_string())
                        v.region = data["region"].get<std::string>();
                    v.joined_at = iso;

                    if (!v.world_id.empty() && !v.instance_id.empty())
                    {
                        bool hadTrackedWorld = false;
                        {
                            std::lock_guard<std::mutex> lk(m_currentWorldMutex);
                            hadTrackedWorld = !m_currentWorldId.empty() && !m_currentInstanceId.empty();
                            if (hadTrackedWorld &&
                                (m_currentWorldId != v.world_id || m_currentInstanceId != v.instance_id))
                            {
                                (void)vrcsm::core::Database::Instance().MarkVisitLeft(
                                    m_currentWorldId,
                                    m_currentInstanceId,
                                    iso);
                            }
                        }
                        if (!hadTrackedWorld)
                        {
                            // Recover from interrupted host sessions: if we
                            // see a fresh world switch but have no in-memory
                            // tracked world, close any stale open visits
                            // before inserting the new one.
                            (void)vrcsm::core::Database::Instance().CloseOpenWorldVisits(iso);
                        }
                        (void)vrcsm::core::Database::Instance().InsertWorldVisit(v);
                        std::lock_guard<std::mutex> lk(m_currentWorldMutex);
                        m_currentWorldId = v.world_id;
                        m_currentInstanceId = v.instance_id;
                    }
                }
                else if (kind == "player")
                {
                    vrcsm::core::Database::PlayerEventInsert e;
                    e.kind = data.value("kind", std::string{});
                    e.display_name = data.value("display_name", std::string{});
                    if (data.contains("user_id") && data["user_id"].is_string())
                        e.user_id = data["user_id"].get<std::string>();
                    {
                        std::lock_guard<std::mutex> lk(m_currentWorldMutex);
                        if (!m_currentWorldId.empty()) e.world_id = m_currentWorldId;
                        if (!m_currentInstanceId.empty()) e.instance_id = m_currentInstanceId;
                    }
                    e.occurred_at = iso;
                    if (!e.display_name.empty())
                    {
                        (void)vrcsm::core::Database::Instance().RecordPlayerEvent(e);
                    }
                }
            }
            catch (...)
            {
                // Swallow DB/JSON hiccups; the live event was already
                // broadcast to the UI.
            }
        });
    m_logTailer->Start();

    return nlohmann::json{{"running", true}};
}

nlohmann::json IpcBridge::HandleLogsStreamStop(const nlohmann::json&, const std::optional<std::string>&)
{
    if (m_logTailer)
    {
        m_logTailer->Stop();
        m_logTailer.reset();
    }
    return nlohmann::json{{"running", false}};
}

nlohmann::json IpcBridge::HandleLogsFilesClear(const nlohmann::json&, const std::optional<std::string>&)
{
    const auto probe = vrcsm::core::PathProbe::Probe();
    if (!probe.baseDirExists)
    {
        throw std::runtime_error("logs.files.clear: VRChat log directory not found");
    }

    const bool vrcRunning = vrcsm::core::ProcessGuard::IsVRChatRunning().running;
    const auto latestLog = vrcRunning ? FindLatestLogFile(probe.baseDir) : std::filesystem::path{};

    int deleted = 0;
    std::vector<std::string> failed;
    std::vector<std::string> skipped;

    std::error_code ec;
    for (const auto& entry : std::filesystem::directory_iterator(probe.baseDir, ec))
    {
        if (ec)
        {
            break;
        }

        std::error_code innerEc;
        if (!entry.is_regular_file(innerEc) || innerEc)
        {
            continue;
        }

        const auto filename = entry.path().filename().string();
        if (!std::regex_match(filename, kOutputLogFileRe))
        {
            continue;
        }

        if (!latestLog.empty() && entry.path().filename() == latestLog.filename())
        {
            skipped.push_back(filename);
            continue;
        }

        if (std::filesystem::remove(entry.path(), innerEc))
        {
            ++deleted;
        }
        else
        {
            failed.push_back(filename);
        }
    }

    return nlohmann::json{
        {"ok", failed.empty()},
        {"deleted", deleted},
        {"failed", failed},
        {"skipped", skipped},
        {"vrc_running", vrcRunning},
    };
}
