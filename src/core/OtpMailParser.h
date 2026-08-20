#pragma once

#include <chrono>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace vrcsm::core
{

struct OtpMailHeaders
{
    std::string from;
    std::string subject;
    std::string date;
    std::string body;
};

struct OtpParseResult
{
    std::string code;
    std::string fromHost;
    std::chrono::system_clock::time_point date;
    int remainingTtlSec{0};
};

std::string StripHtmlTags(std::string_view html);
std::optional<std::string> ExtractEmailHost(std::string_view from);
bool IsVrchatMailHost(std::string_view host);
std::optional<std::chrono::system_clock::time_point> ParseMailDate(std::string_view date);
OtpMailHeaders ParseRfc822(std::string_view raw);

// `now` is injectable so fixture dates can be tested without sleeping.
std::optional<OtpParseResult> ParseOtpMail(
    const OtpMailHeaders& mail,
    std::chrono::system_clock::time_point now,
    const std::vector<std::string>& fromAllow = {});

} // namespace vrcsm::core
