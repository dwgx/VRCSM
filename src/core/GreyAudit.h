#pragma once

#include "Common.h"

#include <string>
#include <string_view>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

// Append-only audit for grey features. Never store IMAP passwords, OTP
// digits, or session cookies in `detail`.
Result<std::monostate> AppendGreyAudit(
    std::string_view feature,
    std::string_view action,
    const nlohmann::json& detail);

} // namespace vrcsm::core
