#include "LogParser.h"

#include "Common.h"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <regex>
#include <spdlog/spdlog.h>
#include <system_error>
#include <unordered_map>
#include <unordered_set>

namespace vrcsm::core
{

// ─────────────────────────────────────────────────────────────────────────
// LogParser — batch scanner over %LocalLow%\VRChat\VRChat\output_log_*.txt.
//
// This is one-shot, not a tail. Live follow (à la VRCX's LogWatcher.cs with
// its 1-second poll + FileShare.ReadWrite + per-file position tracking) is
// v0.1.3 territory — when it lands, it will replace this, not wrap it. For
// now we read the 5 newest files cold, scan end-to-end, return a LogReport.
// Costs ~40ms on a typical 3-session install.
//
// Do NOT switch to FileSystemWatcher when live-tail lands. VRChat writes
// the log buffered, so change notifications fire on flush rather than on
// append — you miss real events and get phantom ones on rotation. VRCX
// hit this and left a terse `// FileSystemWatcher() is unreliable` at the
// top of LogWatcher.cs. Poll every second, like they do.
// ─────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────
// JSON serialization
// ─────────────────────────────────────────────────────────────────────────

void to_json(nlohmann::json& j, const LogSettings& s)
{
    j = nlohmann::json{
        {"cache_directory", s.cache_directory ? nlohmann::json(*s.cache_directory) : nlohmann::json(nullptr)},
        {"cache_size_mb", s.cache_size_mb ? nlohmann::json(*s.cache_size_mb) : nlohmann::json(nullptr)},
        {"clear_cache_on_start", s.clear_cache_on_start ? nlohmann::json(*s.clear_cache_on_start) : nlohmann::json(nullptr)},
    };
}

void to_json(nlohmann::json& j, const LogEnvironment& e)
{
    auto opt = [](const std::optional<std::string>& o) -> nlohmann::json {
        return o ? nlohmann::json(*o) : nlohmann::json(nullptr);
    };
    j = nlohmann::json{
        {"vrchat_build", opt(e.vrchat_build)},
        {"store", opt(e.store)},
        {"platform", opt(e.platform)},
        {"device_model", opt(e.device_model)},
        {"processor", opt(e.processor)},
        {"system_memory", opt(e.system_memory)},
        {"operating_system", opt(e.operating_system)},
        {"gpu_name", opt(e.gpu_name)},
        {"gpu_api", opt(e.gpu_api)},
        {"gpu_memory", opt(e.gpu_memory)},
        {"xr_device", opt(e.xr_device)},
    };
}

void to_json(nlohmann::json& j, const LogSettingsSection& s)
{
    // TS consumer expects `Array<[string, string]>` (tuples). The prior
    // `{{"key", k}, {"value", v}}` init-list got parsed by nlohmann's
    // heuristic as an OBJECT (`{"key": k, "value": v}`) because both
    // inner lists had a string as their first element — so the frontend
    // ended up with `[{key, value}, ...]` and destructuring `([k,v])`
    // produced undefined, blanking the entire Settings Detected card.
    // Emitting tuples via `json::array({k, v})` matches the TS type and
    // the Logs page renders real rows again.
    nlohmann::json entries = nlohmann::json::array();
    for (const auto& [k, v] : s.entries)
    {
        entries.push_back(nlohmann::json::array({k, v}));
    }
    j = nlohmann::json{
        {"name", s.name},
        {"entries", entries},
    };
}

void to_json(nlohmann::json& j, const AvatarNameInfo& a)
{
    j = nlohmann::json{
        {"name", a.name},
        {"author", a.author ? nlohmann::json(*a.author) : nlohmann::json(nullptr)},
    };
}

void to_json(nlohmann::json& j, const PlayerEvent& e)
{
    j = nlohmann::json{
        {"kind", e.kind},
        {"iso_time", e.iso_time ? nlohmann::json(*e.iso_time) : nlohmann::json(nullptr)},
        {"display_name", e.display_name},
        {"user_id", e.user_id ? nlohmann::json(*e.user_id) : nlohmann::json(nullptr)},
        {"world_id", e.world_id ? nlohmann::json(*e.world_id) : nlohmann::json(nullptr)},
        {"instance_id", e.instance_id ? nlohmann::json(*e.instance_id) : nlohmann::json(nullptr)},
    };
}

void to_json(nlohmann::json& j, const AvatarSwitchEvent& e)
{
    j = nlohmann::json{
        {"iso_time", e.iso_time ? nlohmann::json(*e.iso_time) : nlohmann::json(nullptr)},
        {"actor", e.actor},
        {"actor_user_id", e.actor_user_id ? nlohmann::json(*e.actor_user_id) : nlohmann::json(nullptr)},
        {"avatar_name", e.avatar_name},
        {"author_name", e.author_name ? nlohmann::json(*e.author_name) : nlohmann::json(nullptr)},
        {"world_id", e.world_id ? nlohmann::json(*e.world_id) : nlohmann::json(nullptr)},
        {"instance_id", e.instance_id ? nlohmann::json(*e.instance_id) : nlohmann::json(nullptr)},
    };
}

void to_json(nlohmann::json& j, const ScreenshotEvent& e)
{
    j = nlohmann::json{
        {"iso_time", e.iso_time ? nlohmann::json(*e.iso_time) : nlohmann::json(nullptr)},
        {"path", e.path},
    };
}

void to_json(nlohmann::json& j, const WorldSwitchEvent& e)
{
    j = nlohmann::json{
        {"iso_time", e.iso_time ? nlohmann::json(*e.iso_time) : nlohmann::json(nullptr)},
        {"world_id", e.world_id},
        {"instance_id", e.instance_id},
        {"access_type", e.access_type},
        {"owner_id", e.owner_id ? nlohmann::json(*e.owner_id) : nlohmann::json(nullptr)},
        {"region", e.region ? nlohmann::json(*e.region) : nlohmann::json(nullptr)}
    };
}

void to_json(nlohmann::json& j, const LogReport& r)
{
    j = nlohmann::json{
        {"log_files", r.log_files},
        {"log_count", r.log_count},
        {"settings", r.settings},
        {"environment", r.environment},
        {"settings_sections", r.settings_sections},
        {"local_user_name", r.local_user_name ? nlohmann::json(*r.local_user_name) : nlohmann::json(nullptr)},
        {"local_user_id", r.local_user_id ? nlohmann::json(*r.local_user_id) : nlohmann::json(nullptr)},
        {"recent_world_ids", r.recent_world_ids},
        {"recent_avatar_ids", r.recent_avatar_ids},
        {"world_names", r.world_names},
        {"avatar_names", r.avatar_names},
        {"world_event_count", r.world_event_count},
        {"avatar_event_count", r.avatar_event_count},
        {"player_events", r.player_events},
        {"avatar_switches", r.avatar_switches},
        {"screenshots", r.screenshots},
        {"world_switches", r.world_switches},
    };
}

// ─────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────

namespace
{
constexpr std::size_t kMaxLogFiles = 5;
constexpr std::size_t kMaxRecentIds = 1000;
// Hard cap per event stream. A long party in GoGo Loco routinely generates
// 2000+ OnPlayerJoined lines and the frontend doesn't need them all — 500
// gives "recent activity" enough headroom while keeping the IPC payload
// under a few hundred kilobytes worst case.
constexpr std::size_t kMaxEventsPerKind = 500;

const std::regex kLogFileRe(R"(^output_log_.*\.txt$)");

// VRChat prefixes every log line with `YYYY.MM.DD HH:MM:SS Log        -  `
// (or `Error`/`Warning`). We don't care which severity — just grab the stamp
// so the UI can show "5 minutes ago" on events. Kept separate from the body
// regex because the body patterns run on the full line and \d is cheap.
const std::regex kTimestampRe(R"(^(\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}))");

// World destination / join events. Real VRChat lines:
//   [Behaviour] Destination set: wrld_xxx:port~private(...)~region(jp)
//   [AssetBundleDownloadManager] [100] Unpacking World (wrld_xxx)
//   [Behaviour] Entering Room: <name>
//   [Behaviour] Joining or Creating Room: <name>
const std::regex kDestSetRe(R"(\[Behaviour\] Destination set: (wrld_[0-9a-fA-F-]+))");
const std::regex kUnpackWorldRe(R"(Unpacking World \((wrld_[0-9a-fA-F-]+)\))");
const std::regex kEnteringRoomRe(R"(\[Behaviour\] Entering Room: (.+?)\s*$)");
const std::regex kJoiningRoomRe(R"(\[Behaviour\] Joining or Creating Room: (.+?)\s*$)");
const std::regex kJoiningInstanceRe(R"(\[Behaviour\] Joining (wrld_[0-9a-fA-F-]+):([0-9a-zA-Z~()_-]+)\s*$)");

// Avatar switch / unpack / load. Real VRChat lines:
//   [Behaviour] Switching <player> to avatar <name>
//   [AssetBundleDownloadManager] [101] Unpacking Avatar (<name> by <author>)
//   Loading Avatar Data:avtr_xxx                             (local player only)
//   - avatar: avtr_xxx                                       (profile header)
const std::regex kSwitchingAvatarRe(R"(\[Behaviour\] Switching (.+?) to avatar (.+?)\s*$)");
const std::regex kUnpackAvatarRe(R"(Unpacking Avatar \((.+?) by (.+?)\)\s*$)");
const std::regex kLoadAvatarDataRe(R"(Loading Avatar Data:(avtr_[0-9a-fA-F-]+))");
const std::regex kProfileAvatarRe(R"(^\s*-\s*avatar:\s*(avtr_[0-9a-fA-F-]+))");
const std::regex kUserAuthRe(R"(User Authenticated: (.+?) \((usr_[0-9a-fA-F-]+)\))");

// Player presence. VRChat has emitted both shapes over the years:
//   [Behaviour] OnPlayerJoined Alice
//   [Behaviour] OnPlayerJoined Alice (usr_xxx-xxx-xxx)       (2024+ builds)
// The `(usr_…)` group is optional so we capture both flavours. Same story
// for OnPlayerLeft. Display names can legitimately contain parentheses, so
// the lazy `(.+?)` stops at the first ` (usr_` or end-of-line.
const std::regex kPlayerJoinedRe(
    R"(\[Behaviour\] OnPlayerJoined (.+?)(?: \((usr_[0-9a-fA-F-]+)\))?\s*$)");
const std::regex kPlayerLeftRe(
    R"(\[Behaviour\] OnPlayerLeft (.+?)(?: \((usr_[0-9a-fA-F-]+)\))?\s*$)");

// Screenshot — VRC writes an absolute path; we keep it as-is. Not worth
// splitting filename from directory on the C++ side when the frontend needs
// both to build "reveal in Explorer".
const std::regex kScreenshotRe(R"(\[VRC Camera\] Took screenshot to: (.+?)\s*$)");

// Fallback avatar id scan — some lines (e.g., Initialize PlayerAvatarAPI) only
// mention the id. Used as a last resort so avatars that never trigger a
// Loading Avatar Data: line still appear in recent_avatar_ids.
const std::regex kAvatarIdRe(R"((avtr_[0-9a-fA-F-]+))");

// UserInfoLogger block starters.
const std::regex kEnvironmentStartRe(R"(\[UserInfoLogger\] Environment Info:)");
const std::regex kSettingsStartRe(R"(\[UserInfoLogger\] User Settings Info:)");

// Legacy AssetBundleDownloadManager settings.
const std::regex kCacheDirRe(R"(Using default cache directory\.?)");
const std::regex kCacheSizeRe(R"(Using default cache size:\s*(\d+))");
const std::regex kClearCacheRe(R"(Clear cache on start:\s*(\w+))");

std::vector<std::filesystem::path> findLogFiles(const std::filesystem::path& baseDir)
{
    std::vector<std::filesystem::path> files;
    std::error_code ec;
    if (!std::filesystem::exists(baseDir, ec) || ec) return files;

    for (const auto& entry : std::filesystem::directory_iterator(baseDir, ec))
    {
        if (ec) break;
        if (!entry.is_regular_file()) continue;
        const auto name = entry.path().filename().string();
        if (std::regex_match(name, kLogFileRe))
        {
            files.push_back(entry.path());
        }
    }

    std::sort(files.begin(), files.end(), [](const auto& a, const auto& b) {
        return a.filename().string() > b.filename().string();
    });
    if (files.size() > kMaxLogFiles)
    {
        files.resize(kMaxLogFiles);
    }
    
    // Reverse the vector so that we process them chronologically (oldest of the top 5 first, newest last)
    std::reverse(files.begin(), files.end());
    return files;
}

std::string stripTrailing(std::string s)
{
    while (!s.empty()
        && (s.back() == ' ' || s.back() == '\r' || s.back() == '\t' || s.back() == ','))
    {
        s.pop_back();
    }
    return s;
}

std::string stripLeading(const std::string& s)
{
    std::size_t i = 0;
    while (i < s.size() && (s[i] == ' ' || s[i] == '\t')) ++i;
    return s.substr(i);
}

// UserInfoLogger continuation lines start with 4+ spaces and have no
// timestamp prefix. An unindented / empty line ends the block.
bool isIndentedBody(const std::string& line)
{
    return line.size() >= 2 && (line[0] == ' ' || line[0] == '\t');
}

bool splitKeyValue(const std::string& trimmed, std::string& key, std::string& value)
{
    const auto colon = trimmed.find(':');
    if (colon == std::string::npos) return false;
    key = stripTrailing(trimmed.substr(0, colon));
    value = stripTrailing(stripLeading(trimmed.substr(colon + 1)));
    return !key.empty();
}

bool iequals(const std::string& a, const char* lit)
{
    std::size_t i = 0;
    while (lit[i] != '\0' && i < a.size())
    {
        if (std::tolower(static_cast<unsigned char>(a[i]))
            != std::tolower(static_cast<unsigned char>(lit[i])))
            return false;
        ++i;
    }
    return lit[i] == '\0' && i == a.size();
}

enum class BlockState
{
    Normal,
    Environment,
    Settings,
};

struct ParseState
{
    BlockState block = BlockState::Normal;

    // Most recent `YYYY.MM.DD HH:MM:SS` seen on any line. Stickiness matters
    // because VRChat continuation lines (exception stack traces, unpack
    // spam) inherit the timestamp of the preceding anchor line — that's how
    // you reconstruct when an event actually happened. We attach this stamp
    // to every PlayerEvent / AvatarSwitchEvent / ScreenshotEvent we emit.
    std::optional<std::string> lastTimestamp;

    // World pairing state: most recent in-flight world id.
    std::string pendingWorldId;
    std::string currentWorldId;
    std::string currentInstanceId;

    // Avatar pairing state: most recent local-player switch name + author.
    std::string pendingLocalAvatarName;
    std::string pendingLocalAvatarAuthor;
    std::unordered_map<std::string, std::string> remoteAvatarAuthorsByName;

    // Settings block state: last section header seen.
    bool hasCurrentSection = false;
    std::string currentSectionName;

    // Dedup helpers so recent_*_ids preserves first-seen order.
    std::unordered_set<std::string> worldSet;
    std::unordered_set<std::string> avatarSet;

    // playerName → usr_xxx map populated from OnPlayerJoined lines so we
    // can attach the actor's user_id to AvatarSwitchEvents (logs put the
    // id only on join, never on the avatar-switch line).
    std::unordered_map<std::string, std::string> playerNameToUserId;
};

void maybeApplyLegacyClearCache(const std::string& value, LogReport& report)
{
    if (report.settings.clear_cache_on_start) return;
    std::string v = value;
    std::transform(v.begin(), v.end(), v.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    if (v == "true" || v == "1" || v == "yes") report.settings.clear_cache_on_start = true;
    else if (v == "false" || v == "0" || v == "no") report.settings.clear_cache_on_start = false;
}

void handleNormalLine(const std::string& line, LogReport& report, ParseState& st)
{
    std::smatch m;

    // User auth — captures local player identity.
    if (!report.local_user_name && std::regex_search(line, m, kUserAuthRe))
    {
        report.local_user_name = stripTrailing(m[1]);
        report.local_user_id = stripTrailing(m[2]);
    }

    // Profile `- avatar: avtr_xxx` header (appears right after User Authenticated).
    if (std::regex_search(line, m, kProfileAvatarRe))
    {
        const std::string id = m[1];
        if (st.avatarSet.insert(id).second)
        {
            report.recent_avatar_ids.push_back(id);
        }
    }

    // World destination (earliest sighting of an id going into load).
    if (std::regex_search(line, m, kDestSetRe))
    {
        const std::string id = m[1];
        st.pendingWorldId = id;
        if (st.worldSet.insert(id).second)
        {
            report.recent_world_ids.push_back(id);
        }
    }
    else if (std::regex_search(line, m, kUnpackWorldRe))
    {
        const std::string id = m[1];
        st.pendingWorldId = id;
        if (st.worldSet.insert(id).second)
        {
            report.recent_world_ids.push_back(id);
        }
    }

    // Room name — prefer Joining (which is also the "we committed" event) and
    // fall back to Entering. Either one pairs with the pending world id.
    if (std::regex_search(line, m, kJoiningRoomRe))
    {
        report.world_event_count += 1;
        const std::string name = stripTrailing(m[1]);
        if (!st.pendingWorldId.empty() && !name.empty()
            && report.world_names.find(st.pendingWorldId) == report.world_names.end())
        {
            report.world_names[st.pendingWorldId] = name;
        }
    }
    else if (std::regex_search(line, m, kEnteringRoomRe))
    {
        const std::string name = stripTrailing(m[1]);
        if (!st.pendingWorldId.empty() && !name.empty()
            && report.world_names.find(st.pendingWorldId) == report.world_names.end())
        {
            report.world_names[st.pendingWorldId] = name;
        }
    }

    // World instance connection stream
    if (std::regex_search(line, m, kJoiningInstanceRe))
    {
        const std::string worldId = stripTrailing(m[1]);
        const std::string instanceIdStr = stripTrailing(m[2]);
        const std::string fullInstanceId = worldId + ":" + instanceIdStr;

        if (report.world_switches.size() < kMaxEventsPerKind)
        {
            WorldSwitchEvent ev;
            ev.iso_time = st.lastTimestamp;
            ev.world_id = worldId;
            ev.instance_id = fullInstanceId;
            
            // Parse tags. Patterns are static so std::regex doesn't recompile
            // on every world-switch line during a long log replay.
            static const std::regex kPrivateOwnerRe(R"(private\((usr_[0-9a-fA-F-]+)\))");
            static const std::regex kFriendsOwnerRe(R"(friends\((usr_[0-9a-fA-F-]+)\))");
            static const std::regex kHiddenOwnerRe(R"(hidden\((usr_[0-9a-fA-F-]+)\))");
            static const std::regex kGroupOwnerRe(R"(group\((grp_[0-9a-fA-F-]+)\))");
            static const std::regex kRegionRe(R"(~region\(([a-zA-Z]+)\))");

            ev.access_type = "public"; // default
            if (instanceIdStr.find("~private(") != std::string::npos) {
                ev.access_type = "private";
                std::smatch t;
                if (std::regex_search(instanceIdStr, t, kPrivateOwnerRe))
                    ev.owner_id = t[1].str();
            } else if (instanceIdStr.find("~friends(") != std::string::npos) {
                ev.access_type = "friends";
                std::smatch t;
                if (std::regex_search(instanceIdStr, t, kFriendsOwnerRe))
                    ev.owner_id = t[1].str();
            } else if (instanceIdStr.find("~hidden(") != std::string::npos) {
                ev.access_type = "hidden";
                std::smatch t;
                if (std::regex_search(instanceIdStr, t, kHiddenOwnerRe))
                    ev.owner_id = t[1].str();
            } else if (instanceIdStr.find("~group(") != std::string::npos) {
                ev.access_type = "group";
                std::smatch t;
                if (std::regex_search(instanceIdStr, t, kGroupOwnerRe))
                    ev.owner_id = t[1].str();
            }

            std::smatch r;
            if (std::regex_search(instanceIdStr, r, kRegionRe)) {
                ev.region = r[1].str();
            }
            
            report.world_switches.push_back(std::move(ev));
        }

        st.currentWorldId = worldId;
        st.currentInstanceId = fullInstanceId;
    }

    // Avatar switch — remember the name if it was OUR switch, and record it
    // in the avatar_switches stream regardless of who the actor was. The
    // stream is what the UI uses for the "who was wearing what" timeline;
    // `pendingLocalAvatarName` is only for the local name→id pairing chain.
    if (std::regex_search(line, m, kSwitchingAvatarRe))
    {
        const std::string player = stripTrailing(m[1]);
        const std::string name = stripTrailing(m[2]);
        report.avatar_event_count += 1;

        if (report.avatar_switches.size() < kMaxEventsPerKind)
        {
            AvatarSwitchEvent ev;
            ev.iso_time = st.lastTimestamp;
            ev.actor = player;
            // Attach user_id when we've seen this player join with one. Logs
            // never put the id on the Switching line itself, so this map
            // lookup is the only path to a clickable wearer card.
            if (auto it = st.playerNameToUserId.find(player); it != st.playerNameToUserId.end())
            {
                ev.actor_user_id = it->second;
            }
            else if (report.local_user_name && player == *report.local_user_name && report.local_user_id)
            {
                ev.actor_user_id = report.local_user_id;
            }
            ev.avatar_name = name;
            if (auto authorIt = st.remoteAvatarAuthorsByName.find(name); authorIt != st.remoteAvatarAuthorsByName.end())
            {
                ev.author_name = authorIt->second;
            }
            if (!st.currentWorldId.empty())
            {
                ev.world_id = st.currentWorldId;
            }
            if (!st.currentInstanceId.empty())
            {
                ev.instance_id = st.currentInstanceId;
            }
            report.avatar_switches.push_back(std::move(ev));
        }

        if (report.local_user_name && player == *report.local_user_name)
        {
            st.pendingLocalAvatarName = name;
            st.pendingLocalAvatarAuthor.clear();
        }
    }

    // Player presence — OnPlayerJoined / OnPlayerLeft.
    if (std::regex_search(line, m, kPlayerJoinedRe))
    {
        const std::string joinedName = stripTrailing(m[1]);
        if (m.size() > 2 && m[2].matched)
        {
            // Persist for the entire parse so any later avatar switch by the
            // same display name can be tagged with the matching usr_xxx.
            st.playerNameToUserId[joinedName] = stripTrailing(m[2]);
        }
        if (report.player_events.size() < kMaxEventsPerKind)
        {
            PlayerEvent ev;
            ev.kind = "joined";
            ev.iso_time = st.lastTimestamp;
            ev.display_name = joinedName;
            if (m.size() > 2 && m[2].matched)
            {
                ev.user_id = stripTrailing(m[2]);
            }
            if (!st.currentWorldId.empty())
            {
                ev.world_id = st.currentWorldId;
            }
            if (!st.currentInstanceId.empty())
            {
                ev.instance_id = st.currentInstanceId;
            }
            report.player_events.push_back(std::move(ev));
        }
    }
    else if (std::regex_search(line, m, kPlayerLeftRe))
    {
        if (report.player_events.size() < kMaxEventsPerKind)
        {
            PlayerEvent ev;
            ev.kind = "left";
            ev.iso_time = st.lastTimestamp;
            ev.display_name = stripTrailing(m[1]);
            if (m.size() > 2 && m[2].matched)
            {
                ev.user_id = stripTrailing(m[2]);
            }
            if (!st.currentWorldId.empty())
            {
                ev.world_id = st.currentWorldId;
            }
            if (!st.currentInstanceId.empty())
            {
                ev.instance_id = st.currentInstanceId;
            }
            report.player_events.push_back(std::move(ev));
        }
    }

    // Screenshots — VRChat dumps an absolute path on `[VRC Camera] Took
    // screenshot to:`. We don't touch the path (no normalisation, no drive
    // remap); the frontend is the one that needs to show it to the user.
    if (std::regex_search(line, m, kScreenshotRe))
    {
        if (report.screenshots.size() < kMaxEventsPerKind)
        {
            ScreenshotEvent ev;
            ev.iso_time = st.lastTimestamp;
            ev.path = stripTrailing(m[1]);
            report.screenshots.push_back(std::move(ev));
        }
    }

    // Avatar unpack — confirms author for the pending switch.
    if (std::regex_search(line, m, kUnpackAvatarRe))
    {
        const std::string name = stripTrailing(m[1]);
        const std::string author = stripTrailing(m[2]);
        if (!name.empty() && !author.empty())
        {
            st.remoteAvatarAuthorsByName[name] = author;
            for (auto it = report.avatar_switches.rbegin(); it != report.avatar_switches.rend(); ++it)
            {
                if (it->avatar_name == name && !it->author_name.has_value())
                {
                    it->author_name = author;
                    break;
                }
            }
        }
        if (!st.pendingLocalAvatarName.empty() && name == st.pendingLocalAvatarName)
        {
            st.pendingLocalAvatarAuthor = author;
        }
    }

    // Avatar load — the only line that binds the (name, author) pair to an id.
    if (std::regex_search(line, m, kLoadAvatarDataRe))
    {
        const std::string id = m[1];
        if (st.avatarSet.insert(id).second)
        {
            report.recent_avatar_ids.push_back(id);
        }
        if (!st.pendingLocalAvatarName.empty()
            && report.avatar_names.find(id) == report.avatar_names.end())
        {
            AvatarNameInfo info;
            info.name = st.pendingLocalAvatarName;
            if (!st.pendingLocalAvatarAuthor.empty())
            {
                info.author = st.pendingLocalAvatarAuthor;
            }
            report.avatar_names[id] = std::move(info);
        }
    }

    // Fallback: any remaining avtr_ reference adds to recent set even if we
    // never paired a name. Keeps list completeness.
    {
        auto begin = std::sregex_iterator(line.begin(), line.end(), kAvatarIdRe);
        auto end = std::sregex_iterator();
        for (auto it = begin; it != end; ++it)
        {
            const std::string id = (*it)[1];
            if (st.avatarSet.insert(id).second)
            {
                report.recent_avatar_ids.push_back(id);
            }
        }
    }

    // Legacy AssetBundleDownloadManager scraped settings.
    if (!report.settings.cache_directory && std::regex_search(line, m, kCacheDirRe))
    {
        report.settings.cache_directory = "default";
    }
    if (!report.settings.cache_size_mb && std::regex_search(line, m, kCacheSizeRe))
    {
        try { report.settings.cache_size_mb = std::stoi(m[1]); }
        catch (const std::exception& ex)
        {
            spdlog::debug("LogParser: failed to parse cache size '{}': {}", m[1].str(), ex.what());
        }
    }
    if (!report.settings.clear_cache_on_start && std::regex_search(line, m, kClearCacheRe))
    {
        maybeApplyLegacyClearCache(m[1], report);
    }

    // Block starters — transition last so the block body detection happens
    // on the NEXT line.
    if (std::regex_search(line, kEnvironmentStartRe))
    {
        st.block = BlockState::Environment;
    }
    else if (std::regex_search(line, kSettingsStartRe))
    {
        st.block = BlockState::Settings;
        st.hasCurrentSection = false;
        st.currentSectionName.clear();
    }
}

void handleEnvironmentBody(const std::string& line, LogReport& report, ParseState& st)
{
    // Unindented or empty line ends the block.
    if (!isIndentedBody(line))
    {
        st.block = BlockState::Normal;
        // Re-dispatch so we don't lose whatever the line actually was.
        handleNormalLine(line, report, st);
        return;
    }
    const std::string trimmed = stripLeading(line);
    if (trimmed.empty())
    {
        st.block = BlockState::Normal;
        return;
    }

    std::string key, value;
    if (!splitKeyValue(trimmed, key, value)) return;

    auto put = [&](std::optional<std::string>& dst) {
        if (!dst && !value.empty()) dst = value;
    };

    if (key == "VRChat Build") put(report.environment.vrchat_build);
    else if (key == "Store") put(report.environment.store);
    else if (key == "Platform") put(report.environment.platform);
    else if (key == "Device Model") put(report.environment.device_model);
    else if (key == "Processor Type") put(report.environment.processor);
    else if (key == "System Memory Size") put(report.environment.system_memory);
    else if (key == "Operating System") put(report.environment.operating_system);
    else if (key == "Graphics Device Name") put(report.environment.gpu_name);
    else if (key == "Graphics Device Version") put(report.environment.gpu_api);
    else if (key == "Graphics Memory Size") put(report.environment.gpu_memory);
    else if (key == "XR Device") put(report.environment.xr_device);
}

void handleSettingsBody(const std::string& line, LogReport& report, ParseState& st)
{
    if (line.empty())
    {
        st.block = BlockState::Normal;
        return;
    }

    // A non-indented line is either a section header ("Graphics Settings:")
    // or a line that ends the block entirely (e.g., a timestamped debug line
    // from VRChat itself).
    if (!isIndentedBody(line))
    {
        const std::string trimmed = stripLeading(line);
        const bool looksLikeHeader =
            !trimmed.empty()
            && trimmed.back() == ':'
            && trimmed.find('[') == std::string::npos
            && trimmed.find('=') == std::string::npos
            // Timestamp lines never start with a letter — they start with "2026."
            && !(trimmed.size() >= 4 && std::isdigit(static_cast<unsigned char>(trimmed[0])));

        if (looksLikeHeader)
        {
            std::string name = trimmed.substr(0, trimmed.size() - 1);
            name = stripTrailing(name);
            if (!name.empty())
            {
                st.currentSectionName = name;
                st.hasCurrentSection = true;
                LogSettingsSection sec;
                sec.name = name;
                report.settings_sections.push_back(std::move(sec));
                return;
            }
        }

        // Not a header — fall back to normal processing and leave the block.
        st.block = BlockState::Normal;
        handleNormalLine(line, report, st);
        return;
    }

    // Indented body line: "    Key: Value".
    const std::string trimmed = stripLeading(line);
    if (trimmed.empty()) return;

    std::string key, value;
    if (!splitKeyValue(trimmed, key, value)) return;

    if (!st.hasCurrentSection || report.settings_sections.empty())
    {
        LogSettingsSection sec;
        sec.name = "General";
        report.settings_sections.push_back(std::move(sec));
        st.currentSectionName = "General";
        st.hasCurrentSection = true;
    }
    report.settings_sections.back().entries.emplace_back(key, value);

    // Populate legacy LogSettings when the structured block contains known keys.
    if (iequals(key, "Clear cache on start"))
    {
        maybeApplyLegacyClearCache(value, report);
    }
}

void parseLine(const std::string& line, LogReport& report, ParseState& st)
{
    // Sniff the timestamp first — sticky across non-anchor lines so things
    // like unpack spam inherit the most recent `YYYY.MM.DD HH:MM:SS` seen.
    {
        std::smatch tm;
        if (std::regex_search(line, tm, kTimestampRe))
        {
            st.lastTimestamp = tm[1];
        }
    }

    switch (st.block)
    {
        case BlockState::Environment:
            handleEnvironmentBody(line, report, st);
            return;
        case BlockState::Settings:
            handleSettingsBody(line, report, st);
            return;
        default:
            handleNormalLine(line, report, st);
            return;
    }
}
} // namespace

// ─────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────

LogReport LogParser::parse(const std::filesystem::path& baseDir)
{
    LogReport report;
    auto files = findLogFiles(baseDir);
    report.log_count = files.size();
    report.log_files.reserve(files.size());
    for (const auto& f : files)
    {
        report.log_files.push_back(f.filename().string());
    }

    ParseState st;

    for (const auto& path : files)
    {
        std::ifstream stream(path);
        if (!stream) continue;
        std::string line;

        // Per-file transient state so a pending world/avatar from an older
        // log does not leak into the next file.
        st.block = BlockState::Normal;
        st.pendingWorldId.clear();
        st.pendingLocalAvatarName.clear();
        st.pendingLocalAvatarAuthor.clear();
        st.hasCurrentSection = false;
        st.currentSectionName.clear();
        st.lastTimestamp.reset();

        while (std::getline(stream, line))
        {
            parseLine(line, report, st);
        }
    }

    if (report.recent_world_ids.size() > kMaxRecentIds)
        report.recent_world_ids.resize(kMaxRecentIds);
    if (report.recent_avatar_ids.size() > kMaxRecentIds)
        report.recent_avatar_ids.resize(kMaxRecentIds);
    return report;
}

} // namespace vrcsm::core
