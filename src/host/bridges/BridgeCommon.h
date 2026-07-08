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

// Some core layers report failure by RETURNING a {"error":{code,message}}
// envelope as a normal JSON result (rather than a Result<T> Error). When such
// a value is handed straight back to the frontend it resolves as a SUCCESS,
// so the UI cannot branch on it — leading to white-screens (a truthy report
// with no .entries) or "written successfully" toasts on a failed write. Call
// this on such a value to convert the envelope into a proper IpcException the
// frontend receives as an error; on any non-error value it returns unchanged.
inline nlohmann::json rethrowIfErrorEnvelope(nlohmann::json value)
{
    if (value.is_object() && value.contains("error") && value["error"].is_object())
    {
        const auto& err = value["error"];
        const std::string code = err.value("code", "handler_error");
        const std::string message = err.value("message", "operation failed");
        throw IpcException(vrcsm::core::Error{code, message, 0});
    }
    return value;
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
