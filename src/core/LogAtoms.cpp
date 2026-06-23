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

    return std::nullopt;
}

} // namespace vrcsm::core
