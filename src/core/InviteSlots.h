#pragma once

#include "Common.h"

#include <chrono>
#include <cstddef>
#include <string>
#include <string_view>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

// Live VRChat saved-message type names already used by fetchSavedMessages.
// OpenAPI short aliases are wire-only after a 400; UI never sees them.
bool IsLiveInviteSlotType(std::string_view type);

std::string_view OpenApiInviteSlotAlias(std::string_view liveType);

std::size_t Utf8CodePointCount(std::string_view utf8);

std::string TrimAsciiWs(std::string_view utf8);

// Rejects empty / >64 code points / unknown type / slot outside 0..11
// before any network call. On success, `outTrimmed` is the body to PUT.
Result<std::monostate> ValidateSavedMessageUpdate(
    std::string_view type,
    int slot,
    std::string_view message,
    std::string* outTrimmed);

Result<std::monostate> ValidateSavedMessageSlot(std::string_view type, int slot);

// Normalize GET/PUT payloads into InviteSlot[]: slot, message,
// remainingCooldownMinutes, canBeUpdated, updatedAt?
nlohmann::json NormalizeInviteSlotMessages(const nlohmann::json& raw);

Error InviteSlotHttpError(int status);

// Host-side 8s gate between inviteUser / requestInvite from Slot mail.
void ResetInviteSlotSendGateForTests();
int InviteSlotSendCooldownRemainingSeconds();
Result<std::monostate> ConsumeInviteSlotSendGate(
    std::chrono::milliseconds minInterval = std::chrono::seconds{8});

} // namespace vrcsm::core
