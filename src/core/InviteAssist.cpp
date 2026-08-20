#include "InviteAssist.h"

namespace vrcsm::core
{

namespace
{

std::string JsonString(const nlohmann::json& obj, const char* key)
{
    if (!obj.is_object() || !obj.contains(key) || !obj[key].is_string())
    {
        return {};
    }
    return obj[key].get<std::string>();
}

} // namespace

const char* AssistSkipName(AssistSkipReason reason)
{
    switch (reason)
    {
    case AssistSkipReason::None: return "ok";
    case AssistSkipReason::WrongType: return "wrong_type";
    case AssistSkipReason::GreyDisabled: return "grey_disabled";
    case AssistSkipReason::Disabled: return "disabled";
    case AssistSkipReason::Unconfirmed: return "confirm_required";
    case AssistSkipReason::NotInWorld: return "not_in_world";
    case AssistSkipReason::VrcNotRunning: return "vrc_not_running";
    case AssistSkipReason::NotFriend: return "not_friend";
    case AssistSkipReason::FriendsStale: return "friends_stale";
    case AssistSkipReason::NotAllowlisted: return "not_allowlisted";
    case AssistSkipReason::Cooldown: return "cooldown";
    case AssistSkipReason::GlobalLimit: return "rate_limited";
    case AssistSkipReason::Busy: return "busy";
    }
    return "skip";
}

std::string NotificationTypeOf(const std::string& pipelineType, const nlohmann::json& content)
{
    if (pipelineType == "notification" || pipelineType == "notification-v2")
    {
        auto inner = JsonString(content, "type");
        if (inner.empty() && content.contains("data") && content["data"].is_object())
        {
            inner = JsonString(content["data"], "type");
        }
        return inner;
    }
    return pipelineType;
}

std::string NotificationSenderId(const nlohmann::json& content)
{
    auto id = JsonString(content, "senderUserId");
    if (id.empty())
    {
        id = JsonString(content, "senderId");
    }
    if (id.empty() && content.contains("data") && content["data"].is_object())
    {
        id = JsonString(content["data"], "senderUserId");
    }
    return id;
}

std::string NotificationSenderName(const nlohmann::json& content)
{
    auto name = JsonString(content, "senderUsername");
    if (name.empty())
    {
        name = JsonString(content, "senderDisplayName");
    }
    if (name.empty() && content.contains("sender") && content["sender"].is_object())
    {
        name = JsonString(content["sender"], "displayName");
    }
    return name;
}

std::string NotificationIdOf(const nlohmann::json& content)
{
    auto id = JsonString(content, "id");
    if (id.empty())
    {
        id = JsonString(content, "notificationId");
    }
    return id;
}

AssistDecision EvaluateInviteAssist(
    const std::string& pipelineType,
    const nlohmann::json& content,
    const InviteAssistContext& ctx)
{
    const auto type = NotificationTypeOf(pipelineType, content);
    if (type != "requestInvite")
    {
        return {false, AssistSkipReason::WrongType, AssistSkipName(AssistSkipReason::WrongType)};
    }
    if (!ctx.greyEnabled)
    {
        return {false, AssistSkipReason::GreyDisabled, AssistSkipName(AssistSkipReason::GreyDisabled)};
    }
    if (!ctx.enabled)
    {
        return {false, AssistSkipReason::Disabled, AssistSkipName(AssistSkipReason::Disabled)};
    }
    if (!ctx.confirmed)
    {
        return {false, AssistSkipReason::Unconfirmed, AssistSkipName(AssistSkipReason::Unconfirmed)};
    }
    if (!ctx.inWorld)
    {
        return {false, AssistSkipReason::NotInWorld, AssistSkipName(AssistSkipReason::NotInWorld)};
    }
    if (!ctx.vrcRunning)
    {
        return {false, AssistSkipReason::VrcNotRunning, AssistSkipName(AssistSkipReason::VrcNotRunning)};
    }
    if (ctx.friendsStale)
    {
        return {false, AssistSkipReason::FriendsStale, AssistSkipName(AssistSkipReason::FriendsStale)};
    }
    if (!ctx.isFriend)
    {
        return {false, AssistSkipReason::NotFriend, AssistSkipName(AssistSkipReason::NotFriend)};
    }
    if (!ctx.inAllowlist)
    {
        return {false, AssistSkipReason::NotAllowlisted, AssistSkipName(AssistSkipReason::NotAllowlisted)};
    }
    if (ctx.cooldownRemaining.count() > 0)
    {
        return {false, AssistSkipReason::Cooldown, AssistSkipName(AssistSkipReason::Cooldown)};
    }
    if (ctx.globalRemaining <= 0)
    {
        return {false, AssistSkipReason::GlobalLimit, AssistSkipName(AssistSkipReason::GlobalLimit)};
    }
    return {true, AssistSkipReason::None, "ok"};
}

InviteAssistEngine::InviteAssistEngine()
    : m_perSender(std::chrono::seconds{600})
    , m_global(3, std::chrono::seconds{600})
{
}

AssistDecision InviteAssistEngine::consider(
    const std::string& pipelineType,
    const nlohmann::json& content,
    const InviteAssistContext& ctx,
    std::chrono::steady_clock::time_point now)
{
    InviteAssistContext live = ctx;
    const auto sender = NotificationSenderId(content);
    live.cooldownRemaining = m_perSender.remaining(sender, now);
    live.globalRemaining = m_global.remaining(now);

    auto decision = EvaluateInviteAssist(pipelineType, content, live);
    if (!decision.accept)
    {
        return decision;
    }

    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_pending)
    {
        return {false, AssistSkipReason::Busy, AssistSkipName(AssistSkipReason::Busy)};
    }
    return decision;
}

bool InviteAssistEngine::armPending(AssistPending pending, std::chrono::seconds cancelWindow)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_pending)
    {
        return false;
    }
    pending.due = pending.due;
    if (pending.due.time_since_epoch().count() == 0)
    {
        pending.due = std::chrono::steady_clock::now() + cancelWindow;
    }
    m_pending = std::move(pending);
    return true;
}

bool InviteAssistEngine::cancelPending()
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_pending)
    {
        return false;
    }
    m_pending.reset();
    return true;
}

std::optional<AssistPending> InviteAssistEngine::takeDue(std::chrono::steady_clock::time_point now)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_pending || now < m_pending->due)
    {
        return std::nullopt;
    }
    auto out = *m_pending;
    m_pending.reset();
    return out;
}

std::optional<AssistPending> InviteAssistEngine::pending() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_pending;
}

void InviteAssistEngine::markAccepted(const std::string& senderUserId, std::chrono::steady_clock::time_point now)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    m_perSender.mark(senderUserId, now);
    m_global.tryConsume(now);
}

void InviteAssistEngine::setCooldown(std::chrono::seconds cooldown)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    m_perSender.setCooldown(cooldown);
}

std::chrono::seconds InviteAssistEngine::cooldownRemaining(
    const std::string& senderUserId,
    std::chrono::steady_clock::time_point now) const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_perSender.remaining(senderUserId, now);
}

int InviteAssistEngine::globalRemaining(std::chrono::steady_clock::time_point now) const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_global.remaining(now);
}

nlohmann::json InviteAssistEngine::pendingJson() const
{
    auto p = pending();
    if (!p)
    {
        return nullptr;
    }
    return nlohmann::json{
        {"senderUserId", p->senderUserId},
        {"displayName", p->displayName},
        {"notificationId", p->notificationId},
        {"location", p->location},
    };
}

} // namespace vrcsm::core
