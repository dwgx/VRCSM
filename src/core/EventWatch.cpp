#include "EventWatch.h"

#include "LocationParse.h"

#include <algorithm>
#include <cctype>
#include <random>
#include <sstream>
#include <unordered_set>

namespace vrcsm::core
{

namespace
{

std::string Lower(std::string s)
{
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return s;
}

std::string JsonStr(const nlohmann::json& obj, const char* key)
{
    if (!obj.is_object() || !obj.contains(key))
    {
        return {};
    }
    if (obj[key].is_string())
    {
        return obj[key].get<std::string>();
    }
    return {};
}

int JsonInt(const nlohmann::json& obj, const char* key, int def = 0)
{
    if (!obj.is_object() || !obj.contains(key))
    {
        return def;
    }
    if (obj[key].is_number_integer())
    {
        return obj[key].get<int>();
    }
    if (obj[key].is_number())
    {
        return static_cast<int>(obj[key].get<double>());
    }
    return def;
}

std::string NestedName(const nlohmann::json& instance)
{
    auto name = JsonStr(instance, "displayName");
    if (name.empty())
    {
        name = JsonStr(instance, "name");
    }
    if (name.empty() && instance.contains("world") && instance["world"].is_object())
    {
        name = JsonStr(instance["world"], "name");
    }
    return name;
}

InstanceAccess AccessFromInstance(const nlohmann::json& instance, const ParsedLocation& loc)
{
    if (loc.kind == LocationKind::World && loc.instanceType != InstanceAccess::Unknown)
    {
        return loc.instanceType;
    }
    const auto type = Lower(JsonStr(instance, "type"));
    const auto gat = Lower(JsonStr(instance, "groupAccessType"));
    if (type == "public") return InstanceAccess::Public;
    if (type == "hidden") return InstanceAccess::FriendsPlus;
    if (type == "friends") return InstanceAccess::Friends;
    if (type == "private")
    {
        if (instance.value("canRequestInvite", false) || JsonStr(instance, "instanceId").find("canRequestInvite") != std::string::npos)
        {
            return InstanceAccess::InvitePlus;
        }
        return InstanceAccess::Invite;
    }
    if (type == "group")
    {
        if (gat == "public") return InstanceAccess::GroupPublic;
        if (gat == "plus") return InstanceAccess::GroupPlus;
        return InstanceAccess::Group;
    }
    return InstanceAccess::Unknown;
}

} // namespace

std::string NewWatchId()
{
    static thread_local std::mt19937_64 rng{std::random_device{}()};
    std::uniform_int_distribution<std::uint64_t> dist;
    std::ostringstream oss;
    oss << std::hex << dist(rng) << dist(rng);
    return oss.str();
}

Result<GreyWatch> ValidateWatch(GreyWatch watch)
{
    if (watch.worldId.empty() && watch.groupId.empty())
    {
        return Error{"invalid_params", "worldId or groupId is required", 0};
    }
    if (watch.autoJoin && !watch.notify)
    {
        return Error{"invalid_params", "autoJoin requires notify", 0};
    }
    static const std::unordered_set<std::string> kAccess = {
        "any", "public", "group", "group+", "friends", "invite"};
    if (watch.access.empty())
    {
        watch.access = "any";
    }
    if (kAccess.count(watch.access) == 0)
    {
        return Error{"invalid_params", "unknown access filter", 0};
    }
    if (watch.minUsers < 0 || watch.maxUsers < 0)
    {
        return Error{"invalid_params", "occupancy bounds must be >= 0", 0};
    }
    if (watch.id.empty())
    {
        watch.id = NewWatchId();
    }
    return watch;
}

bool WatchAccessMatches(const std::string& access, InstanceAccess type)
{
    if (access == "any" || access.empty())
    {
        return true;
    }
    if (access == "public")
    {
        return type == InstanceAccess::Public;
    }
    if (access == "group")
    {
        return type == InstanceAccess::Group || type == InstanceAccess::GroupPublic;
    }
    if (access == "group+")
    {
        return type == InstanceAccess::GroupPlus;
    }
    if (access == "friends")
    {
        return type == InstanceAccess::Friends || type == InstanceAccess::FriendsPlus;
    }
    if (access == "invite")
    {
        return type == InstanceAccess::Invite || type == InstanceAccess::InvitePlus;
    }
    return false;
}

bool InstanceMatchesWatch(const GreyWatch& watch, const nlohmann::json& instance)
{
    return MatchWatchInstance(watch, instance).has_value();
}

std::optional<EventWatchMatch> MatchWatchInstance(const GreyWatch& watch, const nlohmann::json& instance)
{
    if (!watch.enabled)
    {
        return std::nullopt;
    }

    std::string location = JsonStr(instance, "location");
    std::string worldId = JsonStr(instance, "worldId");
    if (worldId.empty() && instance.contains("world") && instance["world"].is_object())
    {
        worldId = JsonStr(instance["world"], "id");
    }
    std::string instanceId = JsonStr(instance, "instanceId");
    if (instanceId.empty())
    {
        instanceId = JsonStr(instance, "id");
    }
    if (location.empty() && !worldId.empty() && !instanceId.empty())
    {
        location = worldId + ":" + instanceId;
    }
    const auto loc = parseLocation(location);
    if (!worldId.empty() && loc.worldId)
    {
        worldId = *loc.worldId;
    }
    if (loc.instanceId && instanceId.empty())
    {
        instanceId = *loc.instanceId;
    }

    if (!watch.worldId.empty() && watch.worldId != worldId)
    {
        return std::nullopt;
    }

    if (!watch.groupId.empty())
    {
        std::string groupId = JsonStr(instance, "groupId");
        if (groupId.empty())
        {
            groupId = JsonStr(instance, "ownerId");
        }
        if (groupId.empty() && loc.ownerId)
        {
            groupId = *loc.ownerId;
        }
        if (groupId != watch.groupId)
        {
            return std::nullopt;
        }
    }

    if (!watch.region.empty())
    {
        std::string region = JsonStr(instance, "region");
        if (region.empty() && loc.region)
        {
            region = *loc.region;
        }
        if (Lower(region) != Lower(watch.region))
        {
            return std::nullopt;
        }
    }

    if (!WatchAccessMatches(watch.access, AccessFromInstance(instance, loc)))
    {
        return std::nullopt;
    }

    const int nUsers = JsonInt(instance, "n_users", JsonInt(instance, "userCount", 0));
    if (watch.minUsers > 0 && nUsers < watch.minUsers)
    {
        return std::nullopt;
    }
    if (watch.maxUsers > 0 && nUsers > watch.maxUsers)
    {
        return std::nullopt;
    }

    if (!watch.nameContains.empty())
    {
        const auto name = NestedName(instance);
        if (Lower(name).find(Lower(watch.nameContains)) == std::string::npos)
        {
            return std::nullopt;
        }
    }

    EventWatchMatch m;
    m.watchId = watch.id;
    m.location = location;
    m.worldId = worldId;
    m.instanceId = instanceId;
    m.worldName = NestedName(instance);
    m.nUsers = nUsers;
    m.notify = watch.notify;
    m.autoJoin = watch.autoJoin;
    m.dedupKey = worldId + ":" + instanceId;
    return m;
}

EventWatchEngine::EventWatchEngine()
    : m_joinCooldown(std::chrono::seconds{600})
{
}

Result<std::vector<GreyWatch>> EventWatchEngine::upsert(GreyWatch watch)
{
    auto validated = ValidateWatch(std::move(watch));
    if (!isOk(validated))
    {
        return error(validated);
    }
    watch = value(validated);

    std::lock_guard<std::mutex> lock(m_mutex);
    for (auto& existing : m_watches)
    {
        if (existing.id == watch.id)
        {
            existing = std::move(watch);
            return m_watches;
        }
    }
    if (m_watches.size() >= 8)
    {
        return Error{"limit_exceeded", "at most 8 event watches", 0};
    }
    m_watches.push_back(std::move(watch));
    return m_watches;
}

Result<std::vector<GreyWatch>> EventWatchEngine::remove(const std::string& id)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    m_watches.erase(
        std::remove_if(m_watches.begin(), m_watches.end(), [&](const GreyWatch& w) { return w.id == id; }),
        m_watches.end());
    return m_watches;
}

std::vector<GreyWatch> EventWatchEngine::watches() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_watches;
}

void EventWatchEngine::replaceAll(std::vector<GreyWatch> watches)
{
    std::vector<GreyWatch> kept;
    kept.reserve(std::min(watches.size(), std::size_t{8}));
    for (auto& watch : watches)
    {
        if (kept.size() >= 8)
        {
            break;
        }
        if (!watch.notify)
        {
            watch.autoJoin = false;
        }
        auto validated = ValidateWatch(std::move(watch));
        if (!isOk(validated))
        {
            continue;
        }
        kept.push_back(std::move(value(validated)));
    }
    std::lock_guard<std::mutex> lock(m_mutex);
    m_watches = std::move(kept);
}

std::vector<EventWatchMatch> EventWatchEngine::matchAll(const std::vector<nlohmann::json>& instances)
{
    std::vector<EventWatchMatch> out;
    auto rows = watches();
    for (const auto& watch : rows)
    {
        for (const auto& inst : instances)
        {
            if (auto m = MatchWatchInstance(watch, inst))
            {
                out.push_back(*m);
            }
        }
    }
    return out;
}

bool EventWatchEngine::shouldNotify(const std::string& dedupKey) const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_notified.count(dedupKey) == 0;
}

void EventWatchEngine::markNotified(const std::string& dedupKey)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    m_notified.insert(dedupKey);
}

void EventWatchEngine::retainPresent(const std::unordered_set<std::string>& presentKeys)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    for (auto it = m_notified.begin(); it != m_notified.end();)
    {
        if (presentKeys.count(*it) == 0)
        {
            it = m_notified.erase(it);
        }
        else
        {
            ++it;
        }
    }
}

bool EventWatchEngine::armJoin(EventJoinPending pending)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_join)
    {
        return false;
    }
    m_join = std::move(pending);
    return true;
}

bool EventWatchEngine::cancelJoin()
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_join)
    {
        return false;
    }
    m_join.reset();
    return true;
}

std::optional<EventJoinPending> EventWatchEngine::takeJoinDue(std::chrono::steady_clock::time_point now)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_join || now < m_join->due)
    {
        return std::nullopt;
    }
    auto out = *m_join;
    m_join.reset();
    return out;
}

std::optional<EventJoinPending> EventWatchEngine::joinPending() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_join;
}

bool EventWatchEngine::joinCooldownReady(const std::string& watchId, std::chrono::steady_clock::time_point now) const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_joinCooldown.ready(watchId, now);
}

void EventWatchEngine::markJoined(const std::string& watchId, std::chrono::steady_clock::time_point now)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    m_joinCooldown.mark(watchId, now);
}

void EventWatchEngine::setJoinCooldown(std::chrono::seconds sec)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    m_joinCooldown.setCooldown(sec);
}

bool EventWatchEngine::anyEnabled() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return std::any_of(m_watches.begin(), m_watches.end(), [](const GreyWatch& w) { return w.enabled; });
}

bool CanFirePendingWatchJoin(const GreyPrefs& prefs, const EventJoinPending& due, const EventWatchEngine& engine)
{
    if (!prefs.greyEnabled || !prefs.eventWatch.autoJoinConfirmed)
    {
        return false;
    }
    if (due.watchId.empty() || !isLaunchableVrchatLocation(due.location))
    {
        return false;
    }
    for (const auto& w : engine.watches())
    {
        if (w.id == due.watchId)
        {
            return w.enabled && w.autoJoin;
        }
    }
    return false;
}

} // namespace vrcsm::core
