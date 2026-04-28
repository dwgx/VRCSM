#pragma once
// Shared utilities for IPC bridge handler implementations.
// Every bridges/*.cpp includes this instead of re-declaring helpers.

#include "../IpcBridge.h"
#include "../StringUtil.h"
#include "../WebViewHost.h"

#include "../../core/Common.h"

#include <spdlog/spdlog.h>
#include <fmt/format.h>

// ── Tiny helpers used across multiple bridge files ─────────────────────

inline std::optional<std::string> JsonStringField(const nlohmann::json& json, const char* key)
{
    if (json.contains(key) && json[key].is_string())
    {
        return json[key].get<std::string>();
    }
    return std::nullopt;
}

template <typename T>
inline nlohmann::json ToJson(const T& value)
{
    return nlohmann::json(value);
}

// Unwrap a Result<json> — returns the value on success, throws
// IpcException on failure.
inline nlohmann::json unwrapResult(vrcsm::core::Result<nlohmann::json>&& r)
{
    if (vrcsm::core::isOk(r))
    {
        return std::move(std::get<nlohmann::json>(r));
    }
    throw IpcException(std::move(std::get<vrcsm::core::Error>(r)));
}

// Pull an optional integer from a JSON params object with a default.
inline int ParamInt(const nlohmann::json& p, const char* key, int def)
{
    if (p.is_object() && p.contains(key) && p[key].is_number_integer())
    {
        return p[key].get<int>();
    }
    return def;
}
