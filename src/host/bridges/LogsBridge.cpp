#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/LogAtoms.h"
#include "../../core/LogEventClassifier.h"
#include "../../core/LogParser.h"
#include "../../core/LogTailer.h"
#include "../../core/ProcessGuard.h"
#include "../../core/PathProbe.h"
#include "../../core/Database.h"

#include <regex>

namespace
{

const std::regex kOutputLogFileRe(R"(^output_log_.*\.txt$)");

std::string LogOnlyAvatarKey(const std::string& name, const std::optional<std::string>& author)
{
    if (author.has_value() && !author->empty())
    {
        return "name:" + name + "|author:" + *author;
    }
    return "name:" + name;
}

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

// How many trailing lines to seed a freshly-subscribed panel with, and how
// far back from EOF to scan to gather them. Mirrors LogTailer's backfill
// window so a NEW subscriber (e.g. a Game Log tab opened after the default
// dock already started the shared tailer) gets the same immediate history
// instead of a blank panel — the tailer only broadcasts its one-shot
// backfill to whoever was listening at first-attach time.
constexpr std::size_t kSnapshotLines = 400;
constexpr std::uint64_t kSnapshotScanBytes = 512u * 1024u;

// Read the last kSnapshotLines complete lines of `logFile`, parse each with
// the same prefix/severity logic the live tailer uses, and return them as a
// JSON array of {line, level, timestamp?, source} objects (oldest first).
// Returns an empty array on any error so the caller can always seed a buffer.
nlohmann::json BuildTailSnapshot(const std::filesystem::path& logFile)
{
    nlohmann::json out = nlohmann::json::array();
    if (logFile.empty())
    {
        return out;
    }

    // FILE_SHARE_WRITE is required — VRChat holds the log open for writing the
    // whole session; FILE_SHARE_DELETE mirrors the tailer so a concurrent
    // rotation can't fail the open.
    HANDLE handle = CreateFileW(
        logFile.c_str(),
        GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        nullptr);
    if (handle == INVALID_HANDLE_VALUE)
    {
        return out;
    }

    LARGE_INTEGER sizeLi{};
    if (!GetFileSizeEx(handle, &sizeLi) || sizeLi.QuadPart <= 0)
    {
        CloseHandle(handle);
        return out;
    }

    const std::uint64_t eof = static_cast<std::uint64_t>(sizeLi.QuadPart);
    const std::uint64_t start = eof > kSnapshotScanBytes ? eof - kSnapshotScanBytes : 0;
    const std::uint64_t span = eof - start;

    LARGE_INTEGER pos{};
    pos.QuadPart = static_cast<LONGLONG>(start);
    if (!SetFilePointerEx(handle, pos, nullptr, FILE_BEGIN))
    {
        CloseHandle(handle);
        return out;
    }

    std::string window;
    window.reserve(static_cast<std::size_t>(span));
    std::vector<char> buffer(65536);
    std::uint64_t remaining = span;
    while (remaining > 0)
    {
        const DWORD toRead = static_cast<DWORD>(
            std::min<std::uint64_t>(buffer.size(), remaining));
        DWORD bytesRead = 0;
        if (!ReadFile(handle, buffer.data(), toRead, &bytesRead, nullptr) || bytesRead == 0)
        {
            break;
        }
        window.append(buffer.data(), bytesRead);
        remaining -= bytesRead;
    }
    CloseHandle(handle);

    // Split into complete lines. If we started mid-file, drop the leading
    // partial line so we never emit a fragment.
    std::vector<std::string_view> lines;
    std::size_t lineStart = 0;
    if (start > 0)
    {
        const std::size_t firstNl = window.find('\n');
        if (firstNl == std::string::npos)
        {
            return out;
        }
        lineStart = firstNl + 1;
    }
    std::size_t nl = 0;
    while ((nl = window.find('\n', lineStart)) != std::string::npos)
    {
        std::string_view piece(window.data() + lineStart, nl - lineStart);
        if (!piece.empty() && piece.back() == '\r')
        {
            piece.remove_suffix(1);
        }
        if (!piece.empty())
        {
            lines.push_back(piece);
        }
        lineStart = nl + 1;
    }

    const std::string source = logFile.filename().string();
    const std::size_t begin = lines.size() > kSnapshotLines ? lines.size() - kSnapshotLines : 0;
    for (std::size_t i = begin; i < lines.size(); ++i)
    {
        const auto parsed = vrcsm::core::ParseVrchatLogLine(lines[i]);
        nlohmann::json entry{
            {"line", parsed.body},
            {"level", parsed.level},
            {"source", source},
        };
        if (parsed.iso_time)
        {
            entry["timestamp"] = *parsed.iso_time;
        }
        out.push_back(std::move(entry));
    }

    return out;
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
        const auto probe = vrcsm::core::PathProbe::Probe();
        const auto latestLog = probe.baseDirExists ? FindLatestLogFile(probe.baseDir)
                                                    : std::filesystem::path{};
        const bool logFound = !latestLog.empty();
        // The tailer broadcasts its one-shot backfill only to whoever was
        // listening at first-attach. A LATER subscriber (Game Log/Radar tab
        // opened after the default dock already started the tailer) would
        // otherwise get a blank panel. Seed it from a tail snapshot in the
        // reply so it can hydrate its own buffer without a second request.
        return nlohmann::json{
            {"running", true},
            {"subscribers", m_logTailerRefCount},
            {"baseDirExists", probe.baseDirExists},
            {"logFound", logFound},
            {"vrcRunning", vrcsm::core::ProcessGuard::IsVRChatRunning().running},
            {"snapshot", BuildTailSnapshot(latestLog)},
        };
    }

    const auto probe = vrcsm::core::PathProbe::Probe();
    if (!probe.baseDirExists)
    {
        // First-run: %LocalLow%\VRChat\VRChat doesn't exist yet. This is an
        // EXPECTED state, not an error — resolve with the same shape the
        // success path returns (baseDirExists:false) so the frontend's
        // "no log folder" empty-state is reachable instead of a rejected
        // promise the UI has to sniff for "not found" text.
        return nlohmann::json{
            {"running", false},
            {"subscribers", m_logTailerRefCount},
            {"baseDirExists", false},
            {"logFound", false},
            {"vrcRunning", vrcsm::core::ProcessGuard::IsVRChatRunning().running},
            {"snapshot", nlohmann::json::array()},
        };
    }

    // Surface whether a log file actually exists + whether VRChat is live so
    // the UI can render a specific empty-state ("no log / not running")
    // instead of a silent blank when there's nothing to tail yet.
    const auto latestLog = FindLatestLogFile(probe.baseDir);
    const bool logFound = !latestLog.empty();
    const bool vrcRunning = vrcsm::core::ProcessGuard::IsVRChatRunning().running;

    // Backfill historical log data into DB, then seed current-world
    // state from the latest switch. We always scan the newest log files
    // and INSERT OR IGNORE any visits/events not already recorded —
    // previously we only backfilled when tables were completely empty,
    // which caused sessions after the first day to never appear.
    try
    {
        const auto parsed = vrcsm::core::LogParser::parse(probe.baseDir);

        // Seed current world from latest switch (helps mid-session restarts).
        if (!parsed.world_switches.empty())
        {
            const auto& latestSwitch = parsed.world_switches.back();
            std::lock_guard<std::mutex> worldLock(m_currentWorldMutex);
            m_currentWorldId = latestSwitch.world_id;
            m_currentInstanceId = latestSwitch.instance_id;
        }

        // Always backfill world_visits — DB layer uses INSERT OR IGNORE.
        if (!parsed.world_switches.empty())
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

        // Always backfill player_events — DB layer uses INSERT OR IGNORE.
        if (!parsed.player_events.empty())
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
        [this, alive = m_alive](const vrcsm::core::LogTailLine& line)
        {
            // Defense-in-depth: if the bridge has begun tearing down, bail before
            // touching any member. Primary safety is ~IpcBridge stopping the
            // tailer before these members destruct; this guards the window
            // between *m_alive=false and the thread join. `alive` is a captured
            // shared_ptr copy so this read is valid even if `this` is gone.
            if (!alive || !alive->load())
            {
                return;
            }

            // 1) Raw line → logs.stream for the Console dock / GameLog. This
            // includes backfilled tail lines so a panel opened while VRChat is
            // already running shows immediate history, not a blank view.
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
                if (line.backfill)
                {
                    data["backfill"] = true;
                }
                m_host.PostMessageToWeb(nlohmann::json{
                    {"event", "logs.stream"},
                    {"data", std::move(data)}
                }.dump());
            }

            // Backfilled lines are historical replay for the raw dock only.
            // The batch LogParser above already seeded structured history into
            // the DB and live panels hydrate from `scan`, so classifying and
            // re-persisting these would double-count events and inject stale
            // joins/world-switches into the live radar. Stop after the raw emit.
            if (line.backfill)
            {
                return;
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
                    std::optional<std::string> authorName;
                    if (auto it = data.find("author_name"); it != data.end() && it->is_string())
                    {
                        authorName = it->get<std::string>();
                    }
                    if (!avatarName.empty())
                    {
                        vrcsm::core::Database::AvatarSeenInsert a;
                        a.avatar_id = LogOnlyAvatarKey(avatarName, authorName);
                        a.avatar_name = avatarName;
                        a.author_name = authorName;
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
                else if (kind == "videoPlay" || kind == "portalSpawn"
                         || kind == "voteKick" || kind == "joinBlocked"
                         || kind == "stickerSpawn"
                         || kind == "notification" || kind == "videoError"
                         || kind == "attributedVideoPlay" || kind == "videoSync"
                         || kind == "avatarPedestal" || kind == "vrcQuit"
                         || kind == "sessionMode" || kind == "oscFail"
                         || kind == "udonException" || kind == "instanceReset"
                         || kind == "shaderKeyword" || kind == "audioDevice")
                {
                    // Track L atoms → generic log_events table. `detail` packs
                    // the source-specific payload so the unified feed renders
                    // without a second lookup.
                    vrcsm::core::Database::LogEventInsert e;
                    e.kind = kind;
                    e.occurred_at = iso;
                    {
                        std::lock_guard<std::mutex> lk(m_currentWorldMutex);
                        if (!m_currentWorldId.empty()) e.world_id = m_currentWorldId;
                        if (!m_currentInstanceId.empty()) e.instance_id = m_currentInstanceId;
                    }

                    const auto str = [&data](const char* key) -> std::optional<std::string>
                    {
                        if (auto it = data.find(key); it != data.end() && it->is_string()
                            && !it->get<std::string>().empty())
                        {
                            return it->get<std::string>();
                        }
                        return std::nullopt;
                    };

                    if (kind == "videoPlay")
                    {
                        e.detail = str("url");
                    }
                    else if (kind == "voteKick")
                    {
                        std::string detail = data.value("phase", std::string{});
                        if (auto t = str("target")) detail += " target=" + *t;
                        if (auto m = str("message")) detail += " msg=" + *m;
                        if (!detail.empty()) e.detail = detail;
                    }
                    else if (kind == "joinBlocked")
                    {
                        std::string detail = data.value("reason_kind", std::string{});
                        if (auto r = str("reason")) detail += ": " + *r;
                        else if (auto loc = str("location")) detail += ": " + *loc;
                        if (!detail.empty()) e.detail = detail;
                    }
                    else if (kind == "stickerSpawn")
                    {
                        e.user_id = str("user_id");
                        e.display_name = str("display_name");
                        e.detail = str("inventory_id");
                    }
                    else if (kind == "notification")
                    {
                        // A1: pack sender + type for the feed row. (A dedicated
                        // `notifications` table is Slice D1, a separate schema
                        // change; here we keep the generic log_event path.)
                        e.user_id = str("sender_id");
                        e.display_name = str("sender_name");
                        e.detail = str("type");
                    }
                    else if (kind == "videoError")
                    {
                        e.detail = str("error_message");
                    }
                    else if (kind == "attributedVideoPlay")
                    {
                        e.display_name = str("requester");
                        e.detail = str("url");
                    }
                    else if (kind == "videoSync")
                    {
                        e.detail = str("url");
                    }
                    else if (kind == "avatarPedestal")
                    {
                        e.display_name = str("display_name");
                        e.user_id = str("user_id");
                    }
                    else if (kind == "vrcQuit")
                    {
                        e.detail = str("uptime_seconds");
                    }
                    else if (kind == "sessionMode")
                    {
                        std::string detail = data.value("mode", std::string{});
                        if (auto h = str("hmd_model")) detail += " " + *h;
                        if (!detail.empty()) e.detail = detail;
                    }
                    else if (kind == "oscFail")
                    {
                        e.detail = str("reason");
                    }
                    else if (kind == "udonException")
                    {
                        e.detail = str("message");
                    }
                    else if (kind == "instanceReset")
                    {
                        e.detail = str("minutes");
                    }
                    else if (kind == "audioDevice")
                    {
                        // A8: only persist when the input device changed since
                        // the last one this session saw (live dedupe mirrors
                        // the batch parser's lastAudioDevice guard).
                        const std::string device = data.value("device_name", std::string{});
                        bool changed = false;
                        {
                            std::lock_guard<std::mutex> lk(m_audioDeviceMutex);
                            if (!device.empty() && device != m_lastAudioDevice)
                            {
                                m_lastAudioDevice = device;
                                changed = true;
                            }
                        }
                        if (!changed)
                        {
                            // Skip the DB write for an unchanged device.
                            return;
                        }
                        e.detail = device;
                    }
                    // portalSpawn / shaderKeyword carry no extra payload — kind
                    // alone is the signal.

                    (void)vrcsm::core::Database::Instance().RecordLogEvent(e);
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
    // Seed the first subscriber too. The tailer will also replay backfill
    // lines on its first tick, but those are flagged backfill=true and the
    // frontend can dedupe/ignore them; returning the snapshot here means the
    // panel is populated the instant the reply lands rather than after the
    // first poll interval.
    return nlohmann::json{
        {"running", true},
        {"subscribers", refs},
        {"baseDirExists", true},
        {"logFound", logFound},
        {"vrcRunning", vrcRunning},
        {"snapshot", BuildTailSnapshot(latestLog)},
    };
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
