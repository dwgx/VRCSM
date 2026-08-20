#pragma once

#include "Common.h"
#include "OtpMailParser.h"
#include "OtpMailStore.h"

#include <string>
#include <vector>

namespace vrcsm::core
{

bool IsBlockedImapHost(const std::string& hostRaw);
bool ImapHostResolvesToBlocked(const std::string& host);

Result<std::monostate> ValidateImapEndpoint(
    const std::string& host,
    int port,
    const std::string& tls);

struct ImapTestResult
{
    bool ok{false};
    bool inboxExists{false};
};

class ImapClient
{
public:
    static Result<ImapTestResult> TestInbox(const ImapOtpConfig& cfg);
    static Result<std::vector<OtpMailHeaders>> FetchUnseenToday(const ImapOtpConfig& cfg);
};

} // namespace vrcsm::core
