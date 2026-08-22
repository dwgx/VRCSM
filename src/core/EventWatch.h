#pragma once

#include "GreyPrefs.h"
#include "GreyRateLimit.h"
#include "LocationParse.h"

#include <chrono>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

struct EventWatchMatch
{
    std::string watchId;
    std::string location;
    std::string worldId;
    std::string instanceId;
    std::string worldName;
    int nUsers{0};
    bool notify{true};
    bool autoJoin{false};
    std::string dedupKey;
};

Result<GreyWatch> ValidateWatch(GreyWatch watch);
std::string NewWatchId();
bool WatchAccessMatches(const std::string& access, InstanceAccess type);
bool InstanceMatchesWatch(const GreyWatch& watch, const nlohmann::json& instance);
std::optional<EventWatchMatch> MatchWatchInstance(const GreyWatch& watch, const nlohmann::json& instance);

struct EventJoinPending
{
    std::string watchId;
    std::string location;
    std::string worldName;
    std::chrono::steady_clock::time_point due;
};

class EventWatchEngine
{
public:
    EventWatchEngine();

    Result<std::vector<GreyWatch>> upsert(GreyWatch watch);
    Result<std::vector<GreyWatch>> remove(const std::string& id);
    std::vector<GreyWatch> watches() const;
    void replaceAll(std::vector<GreyWatch> watches);

    std::vector<EventWatchMatch> matchAll(const std::vector<nlohmann::json>& instances);

    bool shouldNotify(const std::string& dedupKey) const;
    void markNotified(const std::string& dedupKey);
    void retainPresent(const std::unordered_set<std::string>& presentKeys);

    bool armJoin(EventJoinPending pending);
    bool cancelJoin();
    std::optional<EventJoinPending> takeJoinDue(std::chrono::steady_clock::time_point now);
    std::optional<EventJoinPending> joinPending() const;

    bool joinCooldownReady(const std::string& watchId, std::chrono::steady_clock::time_point now) const;
    void markJoined(const std::string& watchId, std::chrono::steady_clock::time_point now);
    void setJoinCooldown(std::chrono::seconds sec);

    bool anyEnabled() const;

private:
    mutable std::mutex m_mutex;
    std::vector<GreyWatch> m_watches;
    std::unordered_set<std::string> m_notified;
    std::optional<EventJoinPending> m_join;
    GreyCooldownMap m_joinCooldown;
};

// Fire-time recheck after joinDelay: grey still on, auto-join still confirmed,
// the watch still exists/enabled/autoJoin, and the location is still launchable.
bool CanFirePendingWatchJoin(const GreyPrefs& prefs, const EventJoinPending& due, const EventWatchEngine& engine);

} // namespace vrcsm::core
