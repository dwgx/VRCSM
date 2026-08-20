#include "PresenceCache.h"

namespace vrcsm::core
{

PresenceCache& PresenceCache::Instance()
{
    static PresenceCache cache;
    return cache;
}

void PresenceCache::setSelfUserId(std::string userId)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (userId.empty())
    {
        m_selfUserId.reset();
    }
    else
    {
        m_selfUserId = std::move(userId);
    }
}

std::optional<std::string> PresenceCache::selfUserId() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_selfUserId;
}

void PresenceCache::setLocation(std::string location)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    m_location = std::move(location);
    m_locationAt = std::chrono::system_clock::now();
}

std::optional<std::string> PresenceCache::location() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_location;
}

std::optional<std::chrono::system_clock::time_point> PresenceCache::locationAt() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_locationAt;
}

bool PresenceCache::isInWorld() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_location)
    {
        return false;
    }
    return vrcsm::core::isInWorld(*m_location);
}

ParsedLocation PresenceCache::parsed() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_location)
    {
        return {};
    }
    return parseLocation(*m_location);
}

void PresenceCache::setFriends(std::vector<std::string> userIds)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    m_friends.clear();
    m_friends.reserve(userIds.size());
    for (auto& id : userIds)
    {
        if (!id.empty())
        {
            m_friends.insert(std::move(id));
        }
    }
    m_friendsAt = std::chrono::system_clock::now();
}

bool PresenceCache::isFriend(const std::string& userId) const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_friends.count(userId) > 0;
}

bool PresenceCache::friendsStale(
    std::chrono::system_clock::time_point now,
    std::chrono::minutes maxAge) const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_friendsAt)
    {
        return true;
    }
    return now - *m_friendsAt > maxAge;
}

std::optional<std::chrono::system_clock::time_point> PresenceCache::friendsAt() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_friendsAt;
}

void PresenceCache::clear()
{
    std::lock_guard<std::mutex> lock(m_mutex);
    m_selfUserId.reset();
    m_location.reset();
    m_locationAt.reset();
    m_friends.clear();
    m_friendsAt.reset();
}

} // namespace vrcsm::core
