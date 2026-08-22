#pragma once

#include "GreyRateLimit.h"

#include <chrono>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

struct InviteAssistContext
{
    bool greyEnabled{false};
    bool enabled{false};
    bool confirmed{false};
    bool inWorld{false};
    bool vrcRunning{false};
    bool isFriend{false};
    bool friendsStale{false};
    bool inAllowlist{false};
    std::chrono::seconds cooldownRemaining{0};
    int globalRemaining{3};
};

enum class AssistSkipReason
{
    None,
    WrongType,
    GreyDisabled,
    Disabled,
    Unconfirmed,
    NotInWorld,
    VrcNotRunning,
    NotFriend,
    FriendsStale,
    NotAllowlisted,
    Cooldown,
    GlobalLimit,
    Busy,
};

struct AssistDecision
{
    bool accept{false};
    AssistSkipReason skip{AssistSkipReason::GreyDisabled};
    const char* reason{""};
};

struct AssistPending
{
    std::string senderUserId;
    std::string displayName;
    std::string notificationId;
    std::string location;
    std::chrono::steady_clock::time_point due;
};

const char* AssistSkipName(AssistSkipReason reason);

std::string NotificationTypeOf(const std::string& pipelineType, const nlohmann::json& content);
std::string NotificationSenderId(const nlohmann::json& content);
std::string NotificationSenderName(const nlohmann::json& content);
std::string NotificationIdOf(const nlohmann::json& content);

AssistDecision EvaluateInviteAssist(
    const std::string& pipelineType,
    const nlohmann::json& content,
    const InviteAssistContext& ctx);

// Fire-time recheck after the cancel window. Location must still be a
// launchable in-world instance; empty / private / offline must not invite.
bool CanFirePendingAssist(const InviteAssistContext& ctx, std::string_view location);

class InviteAssistEngine
{
public:
    InviteAssistEngine();

    AssistDecision consider(
        const std::string& pipelineType,
        const nlohmann::json& content,
        const InviteAssistContext& ctx,
        std::chrono::steady_clock::time_point now);

    bool armPending(AssistPending pending, std::chrono::seconds cancelWindow);
    bool cancelPending();
    std::optional<AssistPending> takeDue(std::chrono::steady_clock::time_point now);
    std::optional<AssistPending> pending() const;

    void markAccepted(const std::string& senderUserId, std::chrono::steady_clock::time_point now);
    void setCooldown(std::chrono::seconds cooldown);
    std::chrono::seconds cooldownRemaining(const std::string& senderUserId,
                                           std::chrono::steady_clock::time_point now) const;
    int globalRemaining(std::chrono::steady_clock::time_point now) const;

    nlohmann::json pendingJson() const;

private:
    mutable std::mutex m_mutex;
    GreyCooldownMap m_perSender;
    GreyRateLimit m_global;
    std::optional<AssistPending> m_pending;
};

} // namespace vrcsm::core
