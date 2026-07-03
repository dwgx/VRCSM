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

VideoPlayEvent videoPlayFromAtom(const LogAtom& atom, const LogTailLine& line)
{
    VideoPlayEvent event;
    event.iso_time = isoTimeOrNull(line.iso_time);
    event.url = atom.getOr("url");
    return event;
}

PortalSpawnEvent portalSpawnFromAtom(const LogAtom&, const LogTailLine& line)
{
    PortalSpawnEvent event;
    event.iso_time = isoTimeOrNull(line.iso_time);
    return event;
}

VoteKickEvent voteKickFromAtom(const LogAtom& atom, const LogTailLine& line)
{
    VoteKickEvent event;
    event.iso_time = isoTimeOrNull(line.iso_time);
    event.phase = atom.getOr("phase");
    event.target = atom.get("target");
    event.message = atom.get("message");
    return event;
}

JoinBlockedEvent joinBlockedFromAtom(const LogAtom& atom, const LogTailLine& line)
{
    JoinBlockedEvent event;
    event.iso_time = isoTimeOrNull(line.iso_time);
    event.reason_kind = atom.getOr("reason_kind");
    event.location = atom.get("location");
    event.reason = atom.get("reason");
    return event;
}

StickerSpawnEvent stickerSpawnFromAtom(const LogAtom& atom, const LogTailLine& line)
{
    StickerSpawnEvent event;
    event.iso_time = isoTimeOrNull(line.iso_time);
    event.user_id = atom.getOr("user_id");
    event.display_name = atom.getOr("display_name");
    event.inventory_id = atom.getOr("inventory_id");
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

NotificationEvent notificationFromAtom(const LogAtom& atom, const LogTailLine& line)
{
    NotificationEvent event;
    event.iso_time = isoTimeOrNull(line.iso_time);
    event.sender_id = atom.getOr("sender_id");
    event.sender_name = atom.getOr("sender_name");
    event.type = atom.getOr("type");
    event.notification_id = atom.getOr("notification_id");
    return event;
}

VideoErrorEvent videoErrorFromAtom(const LogAtom& atom, const LogTailLine& line)
{
    VideoErrorEvent event;
    event.iso_time = isoTimeOrNull(line.iso_time);
    event.error_message = atom.getOr("error_message");
    return event;
}

AttributedVideoEvent attributedVideoFromAtom(const LogAtom& atom, const LogTailLine& line)
{
    AttributedVideoEvent event;
    event.iso_time = isoTimeOrNull(line.iso_time);
    event.url = atom.getOr("url");
    event.requester = atom.get("requester");
    return event;
}

VideoSyncEvent videoSyncFromAtom(const LogAtom& atom, const LogTailLine& line)
{
    VideoSyncEvent event;
    event.iso_time = isoTimeOrNull(line.iso_time);
    event.url = atom.getOr("url");
    return event;
}

AvatarPedestalEvent avatarPedestalFromAtom(const LogAtom& atom, const LogTailLine& line)
{
    AvatarPedestalEvent event;
    event.iso_time = isoTimeOrNull(line.iso_time);
    event.display_name = atom.getOr("display_name");
    return event;
}

AppQuitEvent appQuitFromAtom(const LogAtom& atom, const LogTailLine& line)
{
    AppQuitEvent event;
    event.iso_time = isoTimeOrNull(line.iso_time);
    event.uptime_seconds = atom.get("uptime_seconds");
    return event;
}

SessionModeEvent sessionModeFromAtom(const LogAtom& atom, const LogTailLine& line)
{
    SessionModeEvent event;
    event.iso_time = isoTimeOrNull(line.iso_time);
    event.mode = atom.getOr("mode");
    event.hmd_model = atom.get("hmd_model");
    return event;
}

OscFailEvent oscFailFromAtom(const LogAtom& atom, const LogTailLine& line)
{
    OscFailEvent event;
    event.iso_time = isoTimeOrNull(line.iso_time);
    event.reason = atom.getOr("reason");
    return event;
}

UdonExceptionEvent udonExceptionFromAtom(const LogAtom& atom, const LogTailLine& line)
{
    UdonExceptionEvent event;
    event.iso_time = isoTimeOrNull(line.iso_time);
    event.message = atom.getOr("message");
    return event;
}

InstanceResetEvent instanceResetFromAtom(const LogAtom& atom, const LogTailLine& line)
{
    InstanceResetEvent event;
    event.iso_time = isoTimeOrNull(line.iso_time);
    event.minutes = atom.getOr("minutes");
    return event;
}

ShaderKeywordEvent shaderKeywordFromAtom(const LogAtom&, const LogTailLine& line)
{
    ShaderKeywordEvent event;
    event.iso_time = isoTimeOrNull(line.iso_time);
    return event;
}

AudioDeviceEvent audioDeviceFromAtom(const LogAtom& atom, const LogTailLine& line)
{
    AudioDeviceEvent event;
    event.iso_time = isoTimeOrNull(line.iso_time);
    event.device_name = atom.getOr("device_name");
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
        case LogAtomKind::VideoPlay:
            return nlohmann::json{
                {"kind", "videoPlay"},
                {"data", videoPlayFromAtom(*atom, line)},
            };
        case LogAtomKind::PortalSpawn:
            return nlohmann::json{
                {"kind", "portalSpawn"},
                {"data", portalSpawnFromAtom(*atom, line)},
            };
        case LogAtomKind::VoteKick:
            return nlohmann::json{
                {"kind", "voteKick"},
                {"data", voteKickFromAtom(*atom, line)},
            };
        case LogAtomKind::JoinBlocked:
            return nlohmann::json{
                {"kind", "joinBlocked"},
                {"data", joinBlockedFromAtom(*atom, line)},
            };
        case LogAtomKind::StickerSpawn:
            return nlohmann::json{
                {"kind", "stickerSpawn"},
                {"data", stickerSpawnFromAtom(*atom, line)},
            };
        case LogAtomKind::WorldInstance:
            return nlohmann::json{
                {"kind", "worldSwitch"},
                {"data", worldSwitchFromAtom(*atom, line)},
            };
        case LogAtomKind::Notification:
            return nlohmann::json{
                {"kind", "notification"},
                {"data", notificationFromAtom(*atom, line)},
            };
        case LogAtomKind::VideoError:
            return nlohmann::json{
                {"kind", "videoError"},
                {"data", videoErrorFromAtom(*atom, line)},
            };
        case LogAtomKind::AttributedVideoPlay:
            return nlohmann::json{
                {"kind", "attributedVideoPlay"},
                {"data", attributedVideoFromAtom(*atom, line)},
            };
        case LogAtomKind::VideoSync:
            return nlohmann::json{
                {"kind", "videoSync"},
                {"data", videoSyncFromAtom(*atom, line)},
            };
        case LogAtomKind::AvatarPedestalChange:
            return nlohmann::json{
                {"kind", "avatarPedestal"},
                {"data", avatarPedestalFromAtom(*atom, line)},
            };
        case LogAtomKind::AppQuit:
            return nlohmann::json{
                {"kind", "vrcQuit"},
                {"data", appQuitFromAtom(*atom, line)},
            };
        case LogAtomKind::SessionMode:
            return nlohmann::json{
                {"kind", "sessionMode"},
                {"data", sessionModeFromAtom(*atom, line)},
            };
        case LogAtomKind::OscFail:
            return nlohmann::json{
                {"kind", "oscFail"},
                {"data", oscFailFromAtom(*atom, line)},
            };
        case LogAtomKind::UdonException:
            return nlohmann::json{
                {"kind", "udonException"},
                {"data", udonExceptionFromAtom(*atom, line)},
            };
        case LogAtomKind::InstanceReset:
            return nlohmann::json{
                {"kind", "instanceReset"},
                {"data", instanceResetFromAtom(*atom, line)},
            };
        case LogAtomKind::ShaderKeyword:
            return nlohmann::json{
                {"kind", "shaderKeyword"},
                {"data", shaderKeywordFromAtom(*atom, line)},
            };
        case LogAtomKind::AudioDevice:
            return nlohmann::json{
                {"kind", "audioDevice"},
                {"data", audioDeviceFromAtom(*atom, line)},
            };
        default:
            return nullptr;
    }
}

} // namespace vrcsm::core
