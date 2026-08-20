#pragma once

#include <chrono>
#include <deque>
#include <mutex>
#include <string>
#include <unordered_map>

namespace vrcsm::core
{

// Sliding-window limiter used by G5 (3 auto-invites / 10 min) and G6
// (join cooldown is a separate map; this is the shared helper).
class GreyRateLimit
{
public:
    GreyRateLimit(int maxEvents, std::chrono::seconds window);

    bool tryConsume(std::chrono::steady_clock::time_point now);
    int remaining(std::chrono::steady_clock::time_point now) const;
    void reset();

    int maxEvents() const { return m_maxEvents; }
    std::chrono::seconds window() const { return m_window; }

private:
    void prune(std::chrono::steady_clock::time_point now) const;

    int m_maxEvents;
    std::chrono::seconds m_window;
    mutable std::deque<std::chrono::steady_clock::time_point> m_stamps;
};

// Per-key cooldown (G5 per-sender, G6 per-watch join).
class GreyCooldownMap
{
public:
    explicit GreyCooldownMap(std::chrono::seconds cooldown);

    bool ready(const std::string& key, std::chrono::steady_clock::time_point now) const;
    std::chrono::seconds remaining(const std::string& key, std::chrono::steady_clock::time_point now) const;
    void mark(const std::string& key, std::chrono::steady_clock::time_point now);
    void clear();
    void setCooldown(std::chrono::seconds cooldown);

private:
    std::chrono::seconds m_cooldown;
    std::unordered_map<std::string, std::chrono::steady_clock::time_point> m_last;
};

} // namespace vrcsm::core
