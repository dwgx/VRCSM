#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/AuthStore.h"
#include "../../core/VrcApi.h"

namespace
{

nlohmann::json MakeAuthSummary(const nlohmann::json& user)
{
    nlohmann::json out{
        {"authed", true},
        {"displayName", JsonStringField(user, "displayName").value_or("")},
    };

    if (const auto id = JsonStringField(user, "id"); id.has_value())
    {
        out["userId"] = *id;
    }
    else
    {
        out["userId"] = nullptr;
    }

    return out;
}

} // namespace

nlohmann::json IpcBridge::HandleAuthStatus(const nlohmann::json&, const std::optional<std::string>&)
{
    auto result = vrcsm::core::VrcApi::fetchCurrentUser();
    if (!vrcsm::core::isOk(result))
    {
        vrcsm::core::AuthStore::Instance().Clear();
        return nlohmann::json{
            {"authed", false},
            {"displayName", nullptr},
            {"userId", nullptr},
        };
    }

    return MakeAuthSummary(vrcsm::core::value(result));
}

nlohmann::json IpcBridge::HandleAuthLogin(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto username = JsonStringField(params, "username").value_or("");
    const auto password = JsonStringField(params, "password").value_or("");

    if (username.empty() || password.empty())
    {
        return nlohmann::json{
            {"status", "error"},
            {"error", "username and password are required"},
        };
    }

    const auto result = vrcsm::core::VrcApi::loginWithPassword(username, password);

    nlohmann::json out;
    switch (result.status)
    {
    case vrcsm::core::LoginResult::Status::Success:
    {
        out["status"] = "success";
        if (result.user.has_value())
        {
            out["user"] = MakeAuthSummary(*result.user);
        }

        nlohmann::json event{
            {"event", "auth.loginCompleted"},
            {"data", {
                {"ok", true},
                {"user", out.value("user", nlohmann::json::object())},
            }},
        };
        m_host.PostMessageToWeb(event.dump());
        return out;
    }
    case vrcsm::core::LoginResult::Status::Requires2FA:
    {
        out["status"] = "requires2FA";
        nlohmann::json methods = nlohmann::json::array();
        for (const auto& m : result.twoFactorMethods)
        {
            methods.push_back(m);
        }
        out["twoFactorMethods"] = std::move(methods);
        return out;
    }
    case vrcsm::core::LoginResult::Status::Error:
    default:
    {
        out["status"] = "error";
        out["error"] = result.error.value_or("Login failed");
        if (result.httpStatus > 0)
        {
            out["httpStatus"] = result.httpStatus;
        }
        return out;
    }
    }
}

nlohmann::json IpcBridge::HandleAuthVerify2FA(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto method = JsonStringField(params, "method").value_or("totp");
    const auto code = JsonStringField(params, "code").value_or("");

    if (code.empty())
    {
        return nlohmann::json{{"ok", false}, {"error", "code is required"}};
    }

    const auto result = vrcsm::core::VrcApi::verifyTwoFactor(method, code);
    if (!result.ok)
    {
        return nlohmann::json{
            {"ok", false},
            {"error", result.error.value_or("2FA verification failed")},
            {"httpStatus", result.httpStatus},
        };
    }

    auto user = vrcsm::core::VrcApi::fetchCurrentUser();
    nlohmann::json userSummary = nlohmann::json::object();
    if (vrcsm::core::isOk(user))
    {
        userSummary = MakeAuthSummary(vrcsm::core::value(user));
    }

    nlohmann::json event{
        {"event", "auth.loginCompleted"},
        {"data", {
            {"ok", true},
            {"user", userSummary},
        }},
    };
    m_host.PostMessageToWeb(event.dump());

    return nlohmann::json{
        {"ok", true},
        {"user", std::move(userSummary)},
    };
}

nlohmann::json IpcBridge::HandleAuthLogout(const nlohmann::json&, const std::optional<std::string>&)
{
    vrcsm::core::AuthStore::Instance().Clear();
    m_host.ClearVrcCookies();
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleAuthUser(const nlohmann::json&, const std::optional<std::string>&)
{
    auto result = vrcsm::core::VrcApi::fetchCurrentUser();
    if (!vrcsm::core::isOk(result))
    {
        vrcsm::core::AuthStore::Instance().Clear();
        return nlohmann::json{
            {"authed", false},
            {"user", nullptr},
        };
    }

    return nlohmann::json{
        {"authed", true},
        {"user", vrcsm::core::value(result)},
    };
}
