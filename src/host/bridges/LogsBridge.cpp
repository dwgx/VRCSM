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
    // Refcounted — multiple frontend pages can subscribe (Logs page,
    // RadarEngine). The first start spawns the tailer; subsequent starts
    // bump the count. Stops decrement; only the last stop tears down.
    // The lock is held across init (probe/parse/Start) so two concurrent
    // worker-thread calls can't both observe a null m_logTailer and race
    // to build two tailers. logs.stream.start lives on AsyncMethodSet so
    // this handler runs off the UI thread; the lock blocks the second
    // caller for the duration of LogParser::parse, which only the first
    // call pays for.
    std::unique_lock<std::mutex> lk(m_logTailerMutex);
    if (m_logTailer)
    {
        m_logTailerRefCount += 1;
        return nlohmann::json{{"running", true}, {"subscribers", m_logTailerRefCount}};
    }

    const auto probe = vrcsm::core::PathProbe::Probe();
    if (!probe.baseDirExists)
    {
        throw std::runtime_error("logs.stream.start: VRChat log directory not found");
    }

    // Backfill historical log data into DB if tables are empty,
    // then seed current-world state from the latest switch.
    try
    {
        const auto parsed = vrcsm::core::LogParser::parse(probe.baseDir);

        // Seed current world from latest switch (helps mid-session restarts).
        if (!parsed.world_switches.empty())
        {
            const auto& latestSwitch = parsed.world_switches.back();
            std::lock_guard<std::mutex> lk(m_currentWorldMutex);
            m_currentWorldId = latestSwitch.world_id;
            m_currentInstanceId = latestSwitch.instance_id;
        }

        // Backfill world_visits if empty.
        auto existingVisits = vrcsm::core::Database::Instance().RecentWorldVisits(1, 0);
        bool visitsEmpty = vrcsm::core::isOk(existingVisits) &&
                           std::get<nlohmann::json>(existingVisits).empty();
        if (visitsEmpty && !parsed.world_switches.empty())
        {
            std::string prevWorldId, prevInstanceId;
            for (size_t i = 0; i < parsed.world_switches.size(); ++i)
            {
                const auto& ws = parsed.world_switches[i];
                const auto iso = ws.iso_time.value_or(vrcsm::core::nowIso());

                if (!prevWorldId.empty())
                {
                    (void)vrcsm::core::Database::Instance().MarkVisitLeft(
                        prevWorldId, prevInstanceId, iso);
                }

                vrcsm::core::Database::WorldVisitInsert v;
                v.world_id = ws.world_id;
                v.instance_id = ws.instance_id;
                if (!ws.access_type.empty()) v.access_type = ws.access_type;
                v.owner_id = ws.owner_id;
                v.region = ws.region;
                v.joined_at = iso;
                (void)vrcsm::core::Database::Instance().InsertWorldVisit(v);

                prevWorldId = ws.world_id;
                prevInstanceId = ws.instance_id;
            }
        }

        // Backfill player_events if empty.
        auto existingEvents = vrcsm::core::Database::Instance().RecentPlayerEvents(1, 0);
        bool eventsEmpty = vrcsm::core::isOk(existingEvents) &&
                           std::get<nlohmann::json>(existingEvents).empty();
        if (eventsEmpty && !parsed.player_events.empty())
        {
            for (const auto& pe : parsed.player_events)
            {
                vrcsm::core::Database::PlayerEventInsert e;
                e.kind = pe.kind;
                e.display_name = pe.display_name;
                e.user_id = pe.user_id;
                e.world_id = pe.world_id;
                e.instance_id = pe.instance_id;
                e.occurred_at = pe.iso_time.value_or(vrcsm::core::nowIso());
                if (!e.display_name.empty())
                {
                    (void)vrcsm::core::Database::Instance().RecordPlayerEvent(e);
                }
            }
        }
    }
    catch (...)
    {
        // Non-fatal: live tailing can still proceed.
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
                else if (kind == "avatarSwitch")
                {
                    const auto actorName = data.value("actor", std::string{});
                    const auto avatarName = data.value("avatar_name", std::string{});
                    if (!avatarName.empty())
                    {
                        vrcsm::core::Database::AvatarSeenInsert a;
                        a.avatar_id = "name:" + avatarName;
                        a.avatar_name = avatarName;
                        a.first_seen_on = actorName;
                        a.first_seen_at = iso.empty() ? vrcsm::core::nowIso() : iso;
                        if (!actorName.empty())
                        {
                            std::lock_guard<std::mutex> lk(m_playerIdMutex);
                            if (auto it = m_playerNameToUserId.find(actorName); it != m_playerNameToUserId.end())
                            {
                                a.first_seen_user_id = it->second;
                            }
                        }
                        (void)vrcsm::core::Database::Instance().RecordAvatarSeen(a);
                    }
                }
                else if (kind == "player")
                {
                    vrcsm::core::Database::PlayerEventInsert e;
                    e.kind = data.value("kind", std::string{});
                    e.display_name = data.value("display_name", std::string{});
                    if (data.contains("user_id") && data["user_id"].is_string())
                        e.user_id = data["user_id"].get<std::string>();
                    if (e.kind == "joined" && e.user_id.has_value() && !e.display_name.empty())
                    {
                        std::lock_guard<std::mutex> lk(m_playerIdMutex);
                        m_playerNameToUserId[e.display_name] = *e.user_id;
                    }
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

    // lk still held — refcount bump under the same critical section as
    // tailer assignment so the (m_logTailer != nullptr) and refcount
    // states stay coherent for any other caller that acquires the lock.
    m_logTailerRefCount += 1;
    int refs = m_logTailerRefCount;
    return nlohmann::json{{"running", true}, {"subscribers", refs}};
}

nlohmann::json IpcBridge::HandleLogsStreamStop(const nlohmann::json&, const std::optional<std::string>&)
{
    bool teardown = false;
    int refs = 0;
    {
        std::lock_guard<std::mutex> lk(m_logTailerMutex);
        if (m_logTailerRefCount > 0) m_logTailerRefCount -= 1;
        refs = m_logTailerRefCount;
        teardown = (m_logTailerRefCount == 0 && m_logTailer != nullptr);
    }
    if (teardown)
    {
        m_logTailer->Stop();
        m_logTailer.reset();
    }
    return nlohmann::json{{"running", refs > 0}, {"subscribers", refs}};
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
