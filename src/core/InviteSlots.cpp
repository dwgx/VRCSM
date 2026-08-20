#include "InviteSlots.h"

#include <fmt/format.h>

#include <cctype>
#include <mutex>
#include <unordered_map>
#include <unordered_set>

namespace vrcsm::core
{
namespace
{

const std::unordered_set<std::string>& LiveTypes()
{
    static const std::unordered_set<std::string> k = {
        "invite",
        "inviteResponse",
        "requestInvite",
        "requestInviteResponse",
    };
    return k;
}

const std::unordered_map<std::string, std::string>& OpenApiAliases()
{
    static const std::unordered_map<std::string, std::string> k = {
        {"invite", "message"},
        {"inviteResponse", "response"},
        {"requestInvite", "request"},
        {"requestInviteResponse", "requestResponse"},
    };
    return k;
}

std::mutex g_sendMutex;
std::chrono::steady_clock::time_point g_lastSend{};
bool g_hasLastSend{false};

} // namespace

bool IsLiveInviteSlotType(std::string_view type)
{
    return LiveTypes().contains(std::string(type));
}

std::string_view OpenApiInviteSlotAlias(std::string_view liveType)
{
    const auto it = OpenApiAliases().find(std::string(liveType));
    if (it == OpenApiAliases().end()) return liveType;
    return it->second;
}

std::size_t Utf8CodePointCount(std::string_view utf8)
{
    std::size_t n = 0;
    for (unsigned char c : utf8)
    {
        if ((c & 0xC0) != 0x80)
        {
            ++n;
        }
    }
    return n;
}

std::string TrimAsciiWs(std::string_view utf8)
{
    std::size_t begin = 0;
    std::size_t end = utf8.size();
    while (begin < end && std::isspace(static_cast<unsigned char>(utf8[begin])))
    {
        ++begin;
    }
    while (end > begin && std::isspace(static_cast<unsigned char>(utf8[end - 1])))
    {
        --end;
    }
    return std::string(utf8.substr(begin, end - begin));
}

Result<std::monostate> ValidateSavedMessageSlot(std::string_view type, int slot)
{
    if (!IsLiveInviteSlotType(type))
    {
        return Error{
            "invalid_params",
            "messageType must be one of: invite, inviteResponse, requestInvite, requestInviteResponse",
            400};
    }
    if (slot < 0 || slot > 11)
    {
        return Error{"invalid_params", "slot must be an integer in 0..11", 400};
    }
    return std::monostate{};
}

Result<std::monostate> ValidateSavedMessageUpdate(
    std::string_view type,
    int slot,
    std::string_view message,
    std::string* outTrimmed)
{
    if (const auto r = ValidateSavedMessageSlot(type, slot); !isOk(r))
    {
        return error(r);
    }
    auto trimmed = TrimAsciiWs(message);
    if (trimmed.empty())
    {
        return Error{"invalid_params", "message must be non-empty", 400};
    }
    if (Utf8CodePointCount(trimmed) > 64)
    {
        return Error{"invalid_params", "message must be at most 64 UTF-8 code points", 400};
    }
    if (outTrimmed != nullptr)
    {
        *outTrimmed = std::move(trimmed);
    }
    return std::monostate{};
}

nlohmann::json NormalizeInviteSlotMessages(const nlohmann::json& raw)
{
    const nlohmann::json* src = &raw;
    if (raw.is_object() && raw.contains("messages") && raw["messages"].is_array())
    {
        src = &raw["messages"];
    }

    nlohmann::json out = nlohmann::json::array();
    if (!src->is_array())
    {
        return out;
    }

    for (const auto& item : *src)
    {
        if (!item.is_object()) continue;
        int slot = -1;
        if (item.contains("slot") && item["slot"].is_number_integer())
        {
            slot = item["slot"].get<int>();
        }
        if (slot < 0 || slot > 11) continue;

        int cooldown = 0;
        if (item.contains("remainingCooldownMinutes") && item["remainingCooldownMinutes"].is_number())
        {
            cooldown = item["remainingCooldownMinutes"].get<int>();
        }
        if (cooldown < 0) cooldown = 0;

        bool canUpdate = cooldown == 0;
        if (item.contains("canBeUpdated") && item["canBeUpdated"].is_boolean())
        {
            canUpdate = item["canBeUpdated"].get<bool>();
        }

        nlohmann::json row{
            {"slot", slot},
            {"message", item.value("message", "")},
            {"remainingCooldownMinutes", cooldown},
            {"canBeUpdated", canUpdate},
        };
        if (item.contains("updatedAt") && item["updatedAt"].is_string())
        {
            row["updatedAt"] = item["updatedAt"].get<std::string>();
        }
        else if (item.contains("updated_at") && item["updated_at"].is_string())
        {
            row["updatedAt"] = item["updated_at"].get<std::string>();
        }
        out.push_back(std::move(row));
        if (out.size() >= 12) break;
    }
    return out;
}

Error InviteSlotHttpError(int status)
{
    if (status == 429)
    {
        return Error{"rate_limited", "Too many requests", 429};
    }
    if (status == 401)
    {
        return Error{"auth_expired", "Session expired", 401};
    }
    return Error{"api_error", fmt::format("invite slot request returned HTTP {}", status), status};
}

void ResetInviteSlotSendGateForTests()
{
    std::lock_guard<std::mutex> lock(g_sendMutex);
    g_hasLastSend = false;
    g_lastSend = {};
}

int InviteSlotSendCooldownRemainingSeconds()
{
    std::lock_guard<std::mutex> lock(g_sendMutex);
    if (!g_hasLastSend) return 0;
    const auto elapsed = std::chrono::steady_clock::now() - g_lastSend;
    const auto minInterval = std::chrono::seconds{8};
    if (elapsed >= minInterval) return 0;
    const auto remain = std::chrono::duration_cast<std::chrono::seconds>(minInterval - elapsed).count();
    return static_cast<int>(remain < 1 ? 1 : remain);
}

Result<std::monostate> ConsumeInviteSlotSendGate(std::chrono::milliseconds minInterval)
{
    std::lock_guard<std::mutex> lock(g_sendMutex);
    const auto now = std::chrono::steady_clock::now();
    if (g_hasLastSend && now - g_lastSend < minInterval)
    {
        const auto remain = std::chrono::duration_cast<std::chrono::seconds>(minInterval - (now - g_lastSend)).count();
        return Error{
            "rate_limited",
            fmt::format("wait {}s between Slot mail sends", remain < 1 ? 1 : remain),
            429};
    }
    g_lastSend = now;
    g_hasLastSend = true;
    return std::monostate{};
}

} // namespace vrcsm::core
