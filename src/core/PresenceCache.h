#pragma once

#include "LocationParse.h"

#include <chrono>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_set>
#include <vector>

namespace vrcsm::core
{

class PresenceCache
{
public:
    static PresenceCache& Instance();

    void setSelfUserId(std::string userId);
    std::optional<std::string> selfUserId() const;

    void setLocation(std::string location);
    std::optional<std::string> location() const;
    std::optional<std::chrono::system_clock::time_point> locationAt() const;
    bool isInWorld() const;
    ParsedLocation parsed() const;

    void setFriends(std::vector<std::string> userIds);
    bool isFriend(const std::string& userId) const;
    bool friendsStale(std::chrono::system_clock::time_point now,
                      std::chrono::minutes maxAge = std::chrono::minutes{15}) const;
    std::optional<std::chrono::system_clock::time_point> friendsAt() const;

    void clear();

private:
    PresenceCache() = default;

    mutable std::mutex m_mutex;
    std::optional<std::string> m_selfUserId;
    std::optional<std::string> m_location;
    std::optional<std::chrono::system_clock::time_point> m_locationAt;
    std::unordered_set<std::string> m_friends;
    std::optional<std::chrono::system_clock::time_point> m_friendsAt;
};

} // namespace vrcsm::core
