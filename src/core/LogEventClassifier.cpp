#include "LogEventClassifier.h"

#include <string>

#include "LogAtoms.h"
#include "LogParser.h"

namespace vrcsm::core
{

namespace
{

std::optional<std::string> isoTimeOrNull(const std::string& iso)
{
    if (iso.empty()) return std::nullopt;
    return iso;
}

PlayerEvent playerEventFromAtom(const LogAtom& atom, const LogTailLine& line)
{
    PlayerEvent event;
    event.kind = atom.getOr("kind");
    event.iso_time = isoTimeOrNull(line.iso_time);
    event.display_name = atom.getOr("display_name");
    event.user_id = atom.get("user_id");
    return event;
}

AvatarSwitchEvent avatarSwitchFromAtom(const LogAtom& atom, const LogTailLine& line)
{
    AvatarSwitchEvent event;
    event.iso_time = isoTimeOrNull(line.iso_time);
    event.actor = atom.getOr("actor");
    event.avatar_name = atom.getOr("avatar_name");
    return event;
}

ScreenshotEvent screenshotFromAtom(const LogAtom& atom, const LogTailLine& line)
{
    ScreenshotEvent event;
    event.iso_time = isoTimeOrNull(line.iso_time);
    event.path = atom.getOr("path");
    return event;
}

WorldSwitchEvent worldSwitchFromAtom(const LogAtom& atom, const LogTailLine& line)
{
    WorldSwitchEvent event;
    event.iso_time = isoTimeOrNull(line.iso_time);
    event.world_id = atom.getOr("world_id");
    event.instance_id = atom.getOr("instance_id");
    event.access_type = atom.getOr("access_type", "public");
    event.owner_id = atom.get("owner_id");
    event.region = atom.get("region");
    return event;
}

} // namespace

nlohmann::json ClassifyStreamLine(const LogTailLine& line)
{
    if (line.line.empty()) return nullptr;

    const auto atom = ParseVrchatLogAtom(line.line);
    if (!atom)
    {
        return nullptr;
    }

    switch (atom->kind)
    {
        case LogAtomKind::PlayerPresence:
            return nlohmann::json{
                {"kind", "player"},
                {"data", playerEventFromAtom(*atom, line)},
            };
        case LogAtomKind::AvatarSwitch:
            return nlohmann::json{
                {"kind", "avatarSwitch"},
                {"data", avatarSwitchFromAtom(*atom, line)},
            };
        case LogAtomKind::Screenshot:
            return nlohmann::json{
                {"kind", "screenshot"},
                {"data", screenshotFromAtom(*atom, line)},
            };
        case LogAtomKind::WorldInstance:
            return nlohmann::json{
                {"kind", "worldSwitch"},
                {"data", worldSwitchFromAtom(*atom, line)},
            };
        default:
            return nullptr;
    }
}

} // namespace vrcsm::core
