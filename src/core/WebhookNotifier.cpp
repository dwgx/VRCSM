#include "WebhookNotifier.h"

#include "HttpClient.h"

#include <algorithm>
#include <cctype>

namespace vrcsm::core
{

namespace
{

std::string ToLowerAscii(std::string value)
{
    for (char& ch : value)
    {
        ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    }
    return value;
}

} // namespace

bool IsAllowedWebhookUrl(std::string_view url)
{
    const auto cracked = http::crackUrl(std::string(url));
    if (!cracked || !cracked->https)
    {
        return false;
    }
    std::string host;
    host.reserve(cracked->host.size());
    for (wchar_t ch : cracked->host)
    {
        host.push_back(static_cast<char>(ch < 128 ? ch : '?'));
    }
    host = ToLowerAscii(std::move(host));
    return host == "discord.com" || host == "discordapp.com"
        || host.ends_with(".discord.com") || host.ends_with(".discordapp.com");
}

nlohmann::json BuildDiscordWebhookBody(std::string_view title, std::string_view body)
{
    std::string content;
    content.reserve(title.size() + body.size() + 8);
    if (!title.empty())
    {
        content.append("**");
        content.append(title);
        content.append("**");
    }
    if (!body.empty())
    {
        if (!content.empty()) content.push_back('\n');
        content.append(body);
    }
    if (content.size() > 1900) content.resize(1900);
    return nlohmann::json{{"content", content}};
}

bool SendDiscordWebhook(const std::string& url, std::string_view title, std::string_view body)
{
    if (!IsAllowedWebhookUrl(url))
    {
        return false;
    }
    const auto cracked = http::crackUrl(url);
    if (!cracked)
    {
        return false;
    }
    const auto payload = BuildDiscordWebhookBody(title, body).dump();
    const auto res = http::request(
        L"POST",
        cracked->host,
        cracked->pathAndQuery,
        {{L"Content-Type", L"application/json"}},
        payload);
    return res.error == std::nullopt && res.status >= 200 && res.status < 300;
}

} // namespace vrcsm::core
