#pragma once

#include <string>
#include <string_view>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

/// Discord-compatible incoming webhook. Default OFF. Unit tests cover URL
/// allowlisting and JSON body shape; they do not POST.
bool IsAllowedWebhookUrl(std::string_view url);
nlohmann::json BuildDiscordWebhookBody(std::string_view title, std::string_view body);
/// Best-effort POST. Returns false on SSRF reject or transport failure.
bool SendDiscordWebhook(const std::string& url, std::string_view title, std::string_view body);

} // namespace vrcsm::core
