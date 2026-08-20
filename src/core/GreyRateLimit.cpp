#include "GreyRateLimit.h"

#include <algorithm>

namespace vrcsm::core
{

GreyRateLimit::GreyRateLimit(int maxEvents, std::chrono::seconds window)
    : m_maxEvents(std::max(1, maxEvents))
    , m_window(window.count() < 1 ? std::chrono::seconds{1} : window)
{
}

void GreyRateLimit::prune(std::chrono::steady_clock::time_point now) const
{
    const auto cutoff = now - m_window;
    while (!m_stamps.empty() && m_stamps.front() < cutoff)
    {
        m_stamps.pop_front();
    }
}

bool GreyRateLimit::tryConsume(std::chrono::steady_clock::time_point now)
{
    prune(now);
    if (static_cast<int>(m_stamps.size()) >= m_maxEvents)
    {
        return false;
    }
    m_stamps.push_back(now);
    return true;
}

int GreyRateLimit::remaining(std::chrono::steady_clock::time_point now) const
{
    prune(now);
    return std::max(0, m_maxEvents - static_cast<int>(m_stamps.size()));
}

void GreyRateLimit::reset()
{
    m_stamps.clear();
}

GreyCooldownMap::GreyCooldownMap(std::chrono::seconds cooldown)
    : m_cooldown(cooldown.count() < 1 ? std::chrono::seconds{1} : cooldown)
{
}

bool GreyCooldownMap::ready(const std::string& key, std::chrono::steady_clock::time_point now) const
{
    return remaining(key, now).count() <= 0;
}

std::chrono::seconds GreyCooldownMap::remaining(
    const std::string& key,
    std::chrono::steady_clock::time_point now) const
{
    const auto it = m_last.find(key);
    if (it == m_last.end())
    {
        return std::chrono::seconds{0};
    }
    const auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(now - it->second);
    if (elapsed >= m_cooldown)
    {
        return std::chrono::seconds{0};
    }
    return m_cooldown - elapsed;
}

void GreyCooldownMap::mark(const std::string& key, std::chrono::steady_clock::time_point now)
{
    m_last[key] = now;
}

void GreyCooldownMap::clear()
{
    m_last.clear();
}

void GreyCooldownMap::setCooldown(std::chrono::seconds cooldown)
{
    m_cooldown = cooldown.count() < 1 ? std::chrono::seconds{1} : cooldown;
}

} // namespace vrcsm::core
