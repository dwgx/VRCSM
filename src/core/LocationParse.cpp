#include "LocationParse.h"

#include <string>
#include <utility>
#include <vector>

namespace vrcsm::core
{

namespace
{

std::vector<std::string> Split(std::string_view s, char delim)
{
    std::vector<std::string> out;
    std::string cur;
    for (char c : s)
    {
        if (c == delim)
        {
            out.push_back(std::move(cur));
            cur.clear();
        }
        else
        {
            cur.push_back(c);
        }
    }
    out.push_back(std::move(cur));
    return out;
}

} // namespace

ParsedLocation parseLocation(std::string_view location)
{
    ParsedLocation out;
    if (location.empty())
    {
        return out;
    }
    if (location == "offline")
    {
        out.kind = LocationKind::Offline;
        return out;
    }
    if (location == "private")
    {
        out.kind = LocationKind::Private;
        return out;
    }
    if (location == "traveling")
    {
        out.kind = LocationKind::Traveling;
        return out;
    }
    if (location.rfind("wrld_", 0) != 0)
    {
        return out;
    }

    const auto segments = Split(location, '~');
    const auto& head = segments.front();
    const auto colon = head.find(':');
    std::string worldId = colon == std::string::npos ? head : head.substr(0, colon);
    std::optional<std::string> instanceId;
    if (colon != std::string::npos)
    {
        instanceId = head.substr(colon + 1);
    }

    InstanceAccess instanceType = InstanceAccess::Public;
    std::optional<std::string> region;
    std::optional<std::string> ownerId;
    bool isGroup = false;
    std::string groupAccessType;
    bool canRequestInvite = false;

    for (std::size_t i = 1; i < segments.size(); ++i)
    {
        const auto& raw = segments[i];
        const auto parenStart = raw.find('(');
        const bool endsParen = !raw.empty() && raw.back() == ')';
        const auto parenEnd = endsParen ? raw.size() - 1 : raw.size();
        const std::string name = parenStart == std::string::npos ? raw : raw.substr(0, parenStart);
        const std::string payload =
            parenStart == std::string::npos ? std::string{} : raw.substr(parenStart + 1, parenEnd - (parenStart + 1));

        if (name == "region")
        {
            region = payload;
        }
        else if (name == "hidden")
        {
            instanceType = InstanceAccess::FriendsPlus;
            ownerId = payload;
        }
        else if (name == "friends")
        {
            instanceType = InstanceAccess::Friends;
            ownerId = payload;
        }
        else if (name == "private")
        {
            instanceType = InstanceAccess::Invite;
            ownerId = payload;
        }
        else if (name == "canRequestInvite")
        {
            canRequestInvite = true;
        }
        else if (name == "group")
        {
            isGroup = true;
            ownerId = payload;
        }
        else if (name == "groupAccessType")
        {
            groupAccessType = payload;
        }
    }

    if (instanceType == InstanceAccess::Invite && canRequestInvite)
    {
        instanceType = InstanceAccess::InvitePlus;
    }
    if (isGroup)
    {
        if (groupAccessType == "public")
        {
            instanceType = InstanceAccess::GroupPublic;
        }
        else if (groupAccessType == "plus")
        {
            instanceType = InstanceAccess::GroupPlus;
        }
        else
        {
            instanceType = InstanceAccess::Group;
        }
    }

    out.kind = LocationKind::World;
    out.worldId = std::move(worldId);
    out.instanceId = std::move(instanceId);
    out.instanceType = instanceType;
    out.region = std::move(region);
    out.ownerId = std::move(ownerId);
    return out;
}

bool isInWorld(const ParsedLocation& loc)
{
    return loc.kind == LocationKind::World
        && loc.worldId.has_value()
        && loc.worldId->rfind("wrld_", 0) == 0
        && loc.instanceId.has_value()
        && !loc.instanceId->empty();
}

bool isInWorld(std::string_view location)
{
    return isInWorld(parseLocation(location));
}

bool isLaunchableVrchatLocation(std::string_view location)
{
    if (location.empty() || location.size() > 2048)
    {
        return false;
    }
    if (location.rfind("wrld_", 0) != 0)
    {
        return false;
    }
    for (const unsigned char c : location)
    {
        if (c < 0x20 || c == 0x7F)
        {
            return false;
        }
    }
    return true;
}

const char* locationKindName(LocationKind kind)
{
    switch (kind)
    {
    case LocationKind::Offline: return "offline";
    case LocationKind::Private: return "private";
    case LocationKind::Traveling: return "traveling";
    case LocationKind::World: return "world";
    case LocationKind::Unknown: return "unknown";
    }
    return "unknown";
}

const char* instanceAccessName(InstanceAccess access)
{
    switch (access)
    {
    case InstanceAccess::Public: return "public";
    case InstanceAccess::FriendsPlus: return "friends+";
    case InstanceAccess::Friends: return "friends";
    case InstanceAccess::InvitePlus: return "invite+";
    case InstanceAccess::Invite: return "invite";
    case InstanceAccess::Group: return "group";
    case InstanceAccess::GroupPublic: return "group-public";
    case InstanceAccess::GroupPlus: return "group-plus";
    case InstanceAccess::Unknown: return "unknown";
    }
    return "unknown";
}

} // namespace vrcsm::core
