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
