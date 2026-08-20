#pragma once

#include <optional>
#include <string>
#include <string_view>

namespace vrcsm::core
{

enum class LocationKind
{
    Offline,
    Private,
    Traveling,
    World,
    Unknown,
};

enum class InstanceAccess
{
    Public,
    FriendsPlus,
    Friends,
    InvitePlus,
    Invite,
    Group,
    GroupPublic,
    GroupPlus,
    Unknown,
};

struct ParsedLocation
{
    LocationKind kind{LocationKind::Unknown};
    std::optional<std::string> worldId;
    std::optional<std::string> instanceId;
    InstanceAccess instanceType{InstanceAccess::Unknown};
    std::optional<std::string> region;
    std::optional<std::string> ownerId;
};

// Behavior matches web/src/lib/vrcFriends.ts parseLocation.
ParsedLocation parseLocation(std::string_view location);

bool isInWorld(const ParsedLocation& loc);
bool isInWorld(std::string_view location);

// wrld_ prefix, length 1..2048, no C0/DEL. Used before inviteSelf / vrchat://launch.
bool isLaunchableVrchatLocation(std::string_view location);

const char* locationKindName(LocationKind kind);
const char* instanceAccessName(InstanceAccess access);

} // namespace vrcsm::core
