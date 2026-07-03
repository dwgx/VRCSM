#pragma once

#include <map>
#include <optional>
#include <string>
#include <string_view>

namespace vrcsm::core
{

struct ParsedLogLine
{
    std::string body;
    std::string level{"info"};
    std::optional<std::string> iso_time;
    bool has_prefix{false};
};

enum class LogAtomKind
{
    UserAuthenticated,
    ProfileAvatar,
    WorldDestination,
    WorldUnpack,
    RoomName,
    WorldInstance,
    AvatarSwitch,
    AvatarUnpack,
    AvatarLoad,
    PlayerPresence,
    Screenshot,
    VideoPlay,
    PortalSpawn,
    VoteKick,
    JoinBlocked,
    StickerSpawn,
    // Wave 2 Section A expansion (A1–A8). All follow the StickerSpawn recipe.
    Notification,          // A1: [API] Received Notification
    VideoError,            // A2: [Video Playback]/[AVProVideo] error
    AttributedVideoPlay,   // A3: SDK2/USharpVideo play carrying the requester
    VideoSync,             // A3: [USharpVideo] Syncing video to <url>
    AvatarPedestalChange,  // A4: RPC SwitchAvatar on AvatarPedestal
    AppQuit,               // A5: VRCApplication On/HandleApplicationQuit
    SessionMode,           // A6: VR vs Desktop session marker
    OscFail,               // A7: Could not Start OSC
    UdonException,         // A7: VRC.Udon.VM.UdonVMException
    InstanceReset,         // A7: [ModerationManager] instance age reset
    ShaderKeyword,         // A8: shader global keyword limit (stateful dedupe)
    AudioDevice,           // A8: uSpeak SetInputDevice (stateful change-only)
};

struct LogAtom
{
    LogAtomKind kind;
    std::map<std::string, std::string> params;

    std::optional<std::string> get(std::string_view key) const;
    std::string getOr(std::string_view key, std::string fallback = {}) const;
};

// Parse VRChat's optional `YYYY.MM.DD HH:MM:SS Severity - body` prefix.
// Continuation lines without a prefix return the whole line as `body`.
ParsedLogLine ParseVrchatLogLine(std::string_view raw);

// Strip unresolved-profile hash suffixes VRChat appends to display names when
// no usr_ id is present in a player line.
std::string NormalizeVrchatDisplayName(std::string name);

// Classify a prefix-stripped VRChat log body into one atomic event. This is
// intentionally stateless; batch parsers can add cross-line context later.
std::optional<LogAtom> ParseVrchatLogAtom(std::string_view body);

} // namespace vrcsm::core
