#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/LogEventClassifier.h"
#include "../../core/PathProbe.h"
#include "../../core/Database.h"

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
                        (void)vrcsm::core::Database::Instance().InsertWorldVisit(v);
                        std::lock_guard<std::mutex> lk(m_currentWorldMutex);
                        m_currentWorldId = v.world_id;
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
