#include "LogAtoms.h"

#include <algorithm>
#include <cctype>
#include <regex>

namespace vrcsm::core
{

namespace
{

const std::regex kLinePrefixRe(
    R"(^(\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}) +(Log|Warning|Error) +- +(.*)$)");

const std::regex kUserAuthRe(R"(User Authenticated: (.+?) \((usr_[0-9a-fA-F-]+)\))");
const std::regex kProfileAvatarRe(R"(^\s*-\s*avatar:\s*(avtr_[0-9a-fA-F-]+))");
const std::regex kDestinationRe(
    R"(\[Behaviour\] Destination (requested|set|fetching): (wrld_[0-9a-fA-F-]+(?::\S+)?)\s*$)");
const std::regex kUnpackWorldRe(R"(Unpacking World \((wrld_[0-9a-fA-F-]+)\))");
const std::regex kEnteringRoomRe(R"(\[Behaviour\] Entering Room: (.+?)\s*$)");
const std::regex kJoiningRoomRe(R"(\[Behaviour\] Joining or Creating Room: (.+?)\s*$)");
const std::regex kJoiningInstanceRe(R"(\[Behaviour\] Joining (wrld_[0-9a-fA-F-]+):(\S+)\s*$)");
const std::regex kSwitchingAvatarRe(R"(\[Behaviour\] Switching (.+?) to avatar (.+?)\s*$)");
const std::regex kUnpackAvatarRe(R"(Unpacking Avatar \((.+) by (.+?)\)\s*$)");
const std::regex kLoadAvatarDataRe(R"(Loading Avatar Data:(avtr_[0-9a-fA-F-]+))");
const std::regex kPlayerJoinedRe(
    R"(\[Behaviour\] OnPlayerJoined (.+?)(?: \((usr_[0-9a-fA-F-]+)\))?\s*$)");
const std::regex kPlayerLeftRe(
    R"(\[Behaviour\] OnPlayerLeft (.+?)(?: \((usr_[0-9a-fA-F-]+)\))?\s*$)");
const std::regex kScreenshotRe(R"(\[VRC Camera\] Took screenshot to: (.+?)\s*$)");
// VRChat resolves video player URLs through several code paths; the
// `[Video Playback]` resolve line is the most reliable and carries the raw URL.
// Matches both "Attempting to resolve URL '<url>'" and "Resolving URL '<url>'".
const std::regex kVideoResolveRe(
    R"(\[Video Playback\] (?:Attempting to resolve|Resolving) URL '([^']+)')");
// Portal drop. Modern VRChat (2023+) emits only the nameless form below — no
// dropper name or destination world is present on the line anymore.
const std::regex kPortalSpawnRe(
    R"(\[Behaviour\] Instantiated a \(Clone \[\d+\] Portals/PortalInternalDynamic\))");
// Vote-kick: three shapes. Self-kicked executive message, plus the instance-wide
// [ModerationManager] initiation / success pair (target display name captured).
const std::regex kVoteKickSelfRe(
    R"(\[Behaviour\] Received executive message: (.+?)\s*$)");
const std::regex kVoteKickInitiatedRe(
    R"(\[ModerationManager\] A vote kick has been initiated against (.+?), do you agree\?\s*$)");
const std::regex kVoteKickSucceededRe(
    R"(\[ModerationManager\] Vote to kick (.+?) succeeded\s*$)");
// Join problems. "Failed to join instance '<loc>' due to '<reason>'" carries the
// useful fields. Real logs often omit the closing quote on the reason (and the
// reason may be localized / multi-byte), so the trailing quote is optional.
const std::regex kFailedToJoinRe(
    R"(\[Behaviour\] Failed to join instance '([^']*)'(?: due to '([^']*)'?)?)");
const std::regex kJoinBlockedRe(
    R"(Master is not sending any events! Moving to a new instance\.)");
// Sticker spawn. NOTE the "flipped" order: usr_ id comes BEFORE the (display name).
const std::regex kStickerSpawnRe(
    R"(\[StickersManager\] User (usr_[0-9a-fA-F-]+) \((.+?)\) spawned sticker (inv_[0-9a-fA-F-]+))");

// ── Wave 2 Section A atoms ───────────────────────────────────────────────
// A1 Notification. VRCX ParseLogNotification (LogWatcher.cs:860): the body
// starts `[API] Received Notification: <Notification ...> received at`.
const std::regex kNotificationRe(
    R"(\[API\] Received Notification: <Notification from username:(.+?), sender user id:(usr_[0-9a-fA-F-]+) to of type: (\w+), id: (not_[0-9a-fA-F-]+).*?, type:(\w+).*?> received at)");
// A2 Video playback error. Both the legacy `[Video Playback] ERROR:` and the
// AVPro `[AVProVideo] Error:` shapes.
const std::regex kVideoErrorRe(
    R"(\[(?:Video Playback|AVProVideo)\] (?:ERROR|Error): (.+?)\s*$)");
// A3 Attributed video play. SDK2 (`User <name> added URL <url>`) and USharp
// (`[USharpVideo] Started video load for URL: <url>, requested by <name>`).
const std::regex kSdk2VideoRe(R"(User (.+?) added URL (\S+))");
const std::regex kUsharpVideoPlayRe(
    R"(\[USharpVideo\] Started video load for URL: (\S+), requested by (.+?)\s*$)");
const std::regex kUsharpVideoSyncRe(R"(\[USharpVideo\] Syncing video to (.+?)\s*$)");
// A4 Avatar pedestal change. VERIFIED 2026-06 against VRCX master
// LogWatcher.cs:609 — still active (fixed 68-char string.Compare on
// "[Network Processing] RPC invoked SwitchAvatar on AvatarPedestal for ",
// display name is the substring after it). Body matches byte-for-byte.
const std::regex kAvatarPedestalRe(
    R"(\[Network Processing\] RPC invoked SwitchAvatar on AvatarPedestal for (.+?)\s*$)");
// A5 Session-end marker. Client renamed OnApplicationQuit→HandleApplicationQuit
// on 2024.10.23 — match both.
const std::regex kAppQuitRe(
    R"(VRCApplication: (?:OnApplicationQuit|HandleApplicationQuit) at ([\d.]+))");
// A6 VR vs Desktop session marker.
const std::regex kSessionModeRe(
    R"(^(Initializing VRSDK\.|STEAMVR HMD Model: (.+?)|VR Disabled)\s*$)");
// A7 Diagnostics batch.
const std::regex kOscFailRe(R"(Could not Start OSC: (.+?)\s*$)");
const std::regex kUdonExceptionRe(R"(VRC\.Udon\.VM\.UdonVMException: (.+?)$)");
const std::regex kInstanceResetRe(
    R"(\[ModerationManager\] This instance will be reset in (\d+) minutes due to its age\.)");
// A8 Stateful diagnostics (the dedupe lives in the batch/live callers; the
// regexes themselves are stateless like every other atom).
const std::regex kShaderKeywordRe(
    R"(Maximum number \(384\) of shader global keywords exceeded)");
const std::regex kAudioDeviceRe(
    R"(\[Always\] uSpeak: SetInputDevice 0 \(\d+ total\) '(.+?)'\s*$)");

const std::regex kHashSuffixRe(R"(_[0-9a-f]{4,}$)");
const std::regex kTrailingHexRe(R"(\s+[0-9a-f]{7,}$|(?:_[0-9a-f]{4,})?[0-9a-f]{7,}$)");
const std::regex kOwnerTagRe(R"(~(private|friends|hidden)\((usr_[0-9a-fA-F-]+)\))");
const std::regex kGroupTagRe(R"(~group\((grp_[0-9a-fA-F-]+)\))");
const std::regex kRegionRe(R"(~region\(([a-zA-Z]+)\))");

std::string trimTrailing(std::string s)
{
    while (!s.empty()
        && (s.back() == ' ' || s.back() == '\r' || s.back() == '\t' || s.back() == ','))
    {
        s.pop_back();
    }
    return s;
}

std::string lowerAscii(std::string s)
{
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return s;
}

void put(LogAtom& atom, std::string key, std::string value)
{
    value = trimTrailing(std::move(value));
    if (!value.empty())
    {
        atom.params.emplace(std::move(key), std::move(value));
    }
}

void putWorldInstanceParams(LogAtom& atom, const std::string& worldId, const std::string& instanceSuffix)
{
    put(atom, "world_id", worldId);
    put(atom, "raw_instance", instanceSuffix);
    put(atom, "instance_id", worldId + ":" + instanceSuffix);

    const auto tilde = instanceSuffix.find('~');
    put(atom, "instance_number", tilde == std::string::npos
        ? instanceSuffix
        : instanceSuffix.substr(0, tilde));

    atom.params["access_type"] = "public";

    std::smatch tag;
    if (std::regex_search(instanceSuffix, tag, kGroupTagRe))
    {
        atom.params["access_type"] = "group";
        put(atom, "owner_id", tag[1].str());
    }
    else if (std::regex_search(instanceSuffix, tag, kOwnerTagRe))
    {
        const std::string tagName = tag[1].str();
        if (tagName == "private")
        {
            atom.params["access_type"] = "private";
        }
        else if (tagName == "friends")
        {
            atom.params["access_type"] = "friends";
        }
        else if (tagName == "hidden")
        {
            atom.params["access_type"] = "hidden";
        }
        put(atom, "owner_id", tag[2].str());
    }

    std::smatch region;
    if (std::regex_search(instanceSuffix, region, kRegionRe))
    {
        put(atom, "region", lowerAscii(region[1].str()));
    }

    if (instanceSuffix.find("~canRequestInvite") != std::string::npos)
    {
        atom.params["can_request_invite"] = "true";
    }
}

std::optional<LogAtom> parseWorldDestination(const std::smatch& match)
{
    LogAtom atom{LogAtomKind::WorldDestination, {}};
    put(atom, "phase", lowerAscii(match[1].str()));
    const std::string location = match[2].str();
    put(atom, "location", location);
    const auto colon = location.find(':');
    if (colon == std::string::npos)
    {
        put(atom, "world_id", location);
    }
    else
    {
        putWorldInstanceParams(atom, location.substr(0, colon), location.substr(colon + 1));
    }
    return atom;
}

} // namespace

std::optional<std::string> LogAtom::get(std::string_view key) const
{
    const auto it = params.find(std::string(key));
    if (it == params.end())
    {
        return std::nullopt;
    }
    return it->second;
}

std::string LogAtom::getOr(std::string_view key, std::string fallback) const
{
    const auto v = get(key);
    return v ? *v : fallback;
}

ParsedLogLine ParseVrchatLogLine(std::string_view raw)
{
    ParsedLogLine out;
    std::string text(raw);
    if (!text.empty() && text.back() == '\r')
    {
        text.pop_back();
    }

    std::smatch match;
    if (std::regex_match(text, match, kLinePrefixRe))
    {
        out.has_prefix = true;
        out.iso_time = match[1].str();
        const std::string severity = match[2].str();
        if (severity == "Warning")
        {
            out.level = "warn";
        }
        else if (severity == "Error")
        {
            out.level = "error";
        }
        else
        {
            out.level = "info";
        }
        out.body = match[3].str();
        return out;
    }

    out.body = std::move(text);
    return out;
}

std::string NormalizeVrchatDisplayName(std::string name)
{
    std::string prev;
    do {
        prev = name;
        name = std::regex_replace(name, kHashSuffixRe, "");
    } while (name != prev);

    do {
        prev = name;
        name = std::regex_replace(name, kTrailingHexRe, "");
    } while (name != prev);

    return trimTrailing(std::move(name));
}

std::optional<LogAtom> ParseVrchatLogAtom(std::string_view bodyView)
{
    const std::string body = ParseVrchatLogLine(bodyView).body;
    if (body.empty())
    {
        return std::nullopt;
    }

    std::smatch match;

    if (std::regex_search(body, match, kUserAuthRe))
    {
        LogAtom atom{LogAtomKind::UserAuthenticated, {}};
        put(atom, "display_name", match[1].str());
        put(atom, "user_id", match[2].str());
        return atom;
    }

    if (std::regex_search(body, match, kProfileAvatarRe))
    {
        LogAtom atom{LogAtomKind::ProfileAvatar, {}};
        put(atom, "avatar_id", match[1].str());
        return atom;
    }

    if (std::regex_search(body, match, kDestinationRe))
    {
        return parseWorldDestination(match);
    }

    if (std::regex_search(body, match, kUnpackWorldRe))
    {
        LogAtom atom{LogAtomKind::WorldUnpack, {}};
        put(atom, "world_id", match[1].str());
        return atom;
    }

    if (std::regex_search(body, match, kJoiningRoomRe))
    {
        LogAtom atom{LogAtomKind::RoomName, {}};
        put(atom, "phase", "joining");
        put(atom, "name", match[1].str());
        return atom;
    }

    if (std::regex_search(body, match, kEnteringRoomRe))
    {
        LogAtom atom{LogAtomKind::RoomName, {}};
        put(atom, "phase", "entering");
        put(atom, "name", match[1].str());
        return atom;
    }

    if (std::regex_search(body, match, kJoiningInstanceRe))
    {
        LogAtom atom{LogAtomKind::WorldInstance, {}};
        putWorldInstanceParams(atom, match[1].str(), match[2].str());
        return atom;
    }

    if (std::regex_search(body, match, kSwitchingAvatarRe))
    {
        LogAtom atom{LogAtomKind::AvatarSwitch, {}};
        put(atom, "actor", match[1].str());
        put(atom, "avatar_name", match[2].str());
        return atom;
    }

    if (std::regex_search(body, match, kUnpackAvatarRe))
    {
        LogAtom atom{LogAtomKind::AvatarUnpack, {}};
        put(atom, "avatar_name", match[1].str());
        put(atom, "author_name", match[2].str());
        return atom;
    }

    if (std::regex_search(body, match, kLoadAvatarDataRe))
    {
        LogAtom atom{LogAtomKind::AvatarLoad, {}};
        put(atom, "avatar_id", match[1].str());
        return atom;
    }

    if (std::regex_search(body, match, kPlayerJoinedRe))
    {
        LogAtom atom{LogAtomKind::PlayerPresence, {}};
        put(atom, "kind", "joined");
        const bool hasUserId = match.size() > 2 && match[2].matched;
        put(atom, "display_name", hasUserId
            ? match[1].str()
            : NormalizeVrchatDisplayName(match[1].str()));
        if (hasUserId)
        {
            put(atom, "user_id", match[2].str());
        }
        return atom;
    }

    if (std::regex_search(body, match, kPlayerLeftRe))
    {
        LogAtom atom{LogAtomKind::PlayerPresence, {}};
        put(atom, "kind", "left");
        const bool hasUserId = match.size() > 2 && match[2].matched;
        put(atom, "display_name", hasUserId
            ? match[1].str()
            : NormalizeVrchatDisplayName(match[1].str()));
        if (hasUserId)
        {
            put(atom, "user_id", match[2].str());
        }
        return atom;
    }

    if (std::regex_search(body, match, kScreenshotRe))
    {
        LogAtom atom{LogAtomKind::Screenshot, {}};
        put(atom, "path", match[1].str());
        return atom;
    }

    if (std::regex_search(body, match, kVideoResolveRe))
    {
        LogAtom atom{LogAtomKind::VideoPlay, {}};
        put(atom, "url", match[1].str());
        return atom;
    }

    if (std::regex_search(body, match, kPortalSpawnRe))
    {
        // Current VRChat logs carry no dropper/destination — record the event only.
        return LogAtom{LogAtomKind::PortalSpawn, {}};
    }

    if (std::regex_search(body, match, kVoteKickInitiatedRe))
    {
        LogAtom atom{LogAtomKind::VoteKick, {}};
        put(atom, "phase", "initiated");
        put(atom, "target", match[1].str());
        return atom;
    }

    if (std::regex_search(body, match, kVoteKickSucceededRe))
    {
        LogAtom atom{LogAtomKind::VoteKick, {}};
        put(atom, "phase", "succeeded");
        put(atom, "target", match[1].str());
        return atom;
    }

    if (std::regex_search(body, match, kVoteKickSelfRe))
    {
        LogAtom atom{LogAtomKind::VoteKick, {}};
        put(atom, "phase", "self");
        put(atom, "message", match[1].str());
        return atom;
    }

    if (std::regex_search(body, match, kFailedToJoinRe))
    {
        LogAtom atom{LogAtomKind::JoinBlocked, {}};
        put(atom, "reason_kind", "failed");
        put(atom, "location", match[1].str());
        if (match.size() > 2 && match[2].matched)
        {
            put(atom, "reason", match[2].str());
        }
        return atom;
    }

    if (std::regex_search(body, match, kJoinBlockedRe))
    {
        LogAtom atom{LogAtomKind::JoinBlocked, {}};
        put(atom, "reason_kind", "blocked");
        return atom;
    }

    if (std::regex_search(body, match, kStickerSpawnRe))
    {
        LogAtom atom{LogAtomKind::StickerSpawn, {}};
        put(atom, "user_id", match[1].str());
        put(atom, "display_name", match[2].str());
        put(atom, "inventory_id", match[3].str());
        return atom;
    }

    // A1 — Notification.
    if (std::regex_search(body, match, kNotificationRe))
    {
        LogAtom atom{LogAtomKind::Notification, {}};
        put(atom, "sender_name", match[1].str());
        put(atom, "sender_id", match[2].str());
        // group 5 is the trailing `type:` (the canonical one); group 3 is the
        // earlier `of type:` — both carry the same value in practice. Prefer 5.
        put(atom, "type", match[5].str());
        put(atom, "notification_id", match[4].str());
        return atom;
    }

    // A2 — Video playback error.
    if (std::regex_search(body, match, kVideoErrorRe))
    {
        LogAtom atom{LogAtomKind::VideoError, {}};
        put(atom, "error_message", match[1].str());
        return atom;
    }

    // A3 — Attributed video play (SDK2 / USharpVideo) + USharp sync.
    if (std::regex_search(body, match, kUsharpVideoPlayRe))
    {
        LogAtom atom{LogAtomKind::AttributedVideoPlay, {}};
        put(atom, "url", match[1].str());
        put(atom, "requester", match[2].str());
        return atom;
    }
    if (std::regex_search(body, match, kUsharpVideoSyncRe))
    {
        LogAtom atom{LogAtomKind::VideoSync, {}};
        put(atom, "url", match[1].str());
        return atom;
    }
    if (std::regex_search(body, match, kSdk2VideoRe))
    {
        LogAtom atom{LogAtomKind::AttributedVideoPlay, {}};
        put(atom, "requester", match[1].str());
        put(atom, "url", match[2].str());
        return atom;
    }

    // A4 — Avatar pedestal change (MEDIUM confidence).
    if (std::regex_search(body, match, kAvatarPedestalRe))
    {
        LogAtom atom{LogAtomKind::AvatarPedestalChange, {}};
        put(atom, "display_name", match[1].str());
        return atom;
    }

    // A5 — Application quit / session-end marker.
    if (std::regex_search(body, match, kAppQuitRe))
    {
        LogAtom atom{LogAtomKind::AppQuit, {}};
        put(atom, "uptime_seconds", match[1].str());
        return atom;
    }

    // A6 — VR vs Desktop session marker.
    if (std::regex_search(body, match, kSessionModeRe))
    {
        LogAtom atom{LogAtomKind::SessionMode, {}};
        if (match[2].matched && !match[2].str().empty())
        {
            atom.params["mode"] = "vr";
            put(atom, "hmd_model", match[2].str());
        }
        else if (match[1].str() == "VR Disabled")
        {
            atom.params["mode"] = "desktop";
        }
        else
        {
            // "Initializing VRSDK." — VR anchor without an HMD model yet.
            atom.params["mode"] = "vr";
        }
        return atom;
    }

    // A7 — Diagnostics batch: OSC fail, Udon exception, instance reset.
    if (std::regex_search(body, match, kOscFailRe))
    {
        LogAtom atom{LogAtomKind::OscFail, {}};
        put(atom, "reason", match[1].str());
        return atom;
    }
    if (std::regex_search(body, match, kUdonExceptionRe))
    {
        LogAtom atom{LogAtomKind::UdonException, {}};
        std::string msg = match[1].str();
        if (msg.size() > 200) msg.resize(200);
        put(atom, "message", msg);
        return atom;
    }
    if (std::regex_search(body, match, kInstanceResetRe))
    {
        LogAtom atom{LogAtomKind::InstanceReset, {}};
        put(atom, "minutes", match[1].str());
        return atom;
    }

    // A8 — Stateful diagnostics (callers do the dedupe; the atoms are stateless).
    if (std::regex_search(body, match, kShaderKeywordRe))
    {
        return LogAtom{LogAtomKind::ShaderKeyword, {}};
    }
    if (std::regex_search(body, match, kAudioDeviceRe))
    {
        LogAtom atom{LogAtomKind::AudioDevice, {}};
        put(atom, "device_name", match[1].str());
        return atom;
    }

    return std::nullopt;
}

} // namespace vrcsm::core
