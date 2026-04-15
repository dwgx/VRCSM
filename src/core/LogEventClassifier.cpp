#include "LogEventClassifier.h"

#include <regex>
#include <string>

#include "LogParser.h"

namespace vrcsm::core
{

namespace
{

// These mirror the regexes `LogParser.cpp` uses for the batch pass. Kept in
// their own file so the live-tail path doesn't pull in the entire batch
// parser's block-state machine and per-line stickiness bookkeeping. If the
// batch regexes drift, update both together — a mismatched live/batch pair
// would make the same event appear differently in the Console dock and the
// Logs page, which is exactly the confusion this helper exists to prevent.

const std::regex kPlayerJoinedRe(
    R"(\[Behaviour\] OnPlayerJoined (.+?)(?: \((usr_[0-9a-fA-F-]+)\))?\s*$)");
const std::regex kPlayerLeftRe(
    R"(\[Behaviour\] OnPlayerLeft (.+?)(?: \((usr_[0-9a-fA-F-]+)\))?\s*$)");
const std::regex kSwitchingAvatarRe(
    R"(\[Behaviour\] Switching (.+?) to avatar (.+?)\s*$)");
const std::regex kScreenshotRe(
    R"(\[VRC Camera\] Took screenshot to: (.+?)\s*$)");

std::optional<std::string> isoTimeOrNull(const std::string& iso)
{
    if (iso.empty()) return std::nullopt;
    return iso;
}

} // namespace

nlohmann::json ClassifyStreamLine(const LogTailLine& line)
{
    // Fast bail on the 95% of lines that are noise — each regex_search is
    // cheap individually but 5 of them per line × dozens of lines/sec adds
    // up, and the VRChat log is dominated by Udon spam / network ticks /
    // `UIManager` chatter that match none of the event shapes. Substring
    // pre-filtering keeps us from paying the regex cost on those.
    const auto& body = line.line;
    if (body.empty()) return nullptr;

    // Player presence.
    if (body.find("OnPlayerJoined") != std::string::npos)
    {
        std::smatch match;
        if (std::regex_search(body, match, kPlayerJoinedRe))
        {
            PlayerEvent event;
            event.kind = "joined";
            event.iso_time = isoTimeOrNull(line.iso_time);
            event.display_name = match[1].str();
            if (match[2].matched)
            {
                event.user_id = match[2].str();
            }
            return nlohmann::json{
                {"kind", "player"},
                {"data", event},
            };
        }
    }
    if (body.find("OnPlayerLeft") != std::string::npos)
    {
        std::smatch match;
        if (std::regex_search(body, match, kPlayerLeftRe))
        {
            PlayerEvent event;
            event.kind = "left";
            event.iso_time = isoTimeOrNull(line.iso_time);
            event.display_name = match[1].str();
            if (match[2].matched)
            {
                event.user_id = match[2].str();
            }
            return nlohmann::json{
                {"kind", "player"},
                {"data", event},
            };
        }
    }

    // Avatar switch. The `Switching ...` substring is unique to this line
    // shape so one check is enough.
    if (body.find("Switching ") != std::string::npos
        && body.find(" to avatar ") != std::string::npos)
    {
        std::smatch match;
        if (std::regex_search(body, match, kSwitchingAvatarRe))
        {
            AvatarSwitchEvent event;
            event.iso_time = isoTimeOrNull(line.iso_time);
            event.actor = match[1].str();
            event.avatar_name = match[2].str();
            return nlohmann::json{
                {"kind", "avatarSwitch"},
                {"data", event},
            };
        }
    }

    // Screenshot. `[VRC Camera]` is a unique tag.
    if (body.find("[VRC Camera] Took screenshot to: ") != std::string::npos)
    {
        std::smatch match;
        if (std::regex_search(body, match, kScreenshotRe))
        {
            ScreenshotEvent event;
            event.iso_time = isoTimeOrNull(line.iso_time);
            event.path = match[1].str();
            return nlohmann::json{
                {"kind", "screenshot"},
                {"data", event},
            };
        }
    }

    return nullptr;
}

} // namespace vrcsm::core
