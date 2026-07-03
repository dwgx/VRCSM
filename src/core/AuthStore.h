#pragma once

#include <filesystem>
#include <mutex>
#include <string>

namespace vrcsm::core
{

// VRChat only gives us avatar + social data once we present the real
// browser session cookies. Keeping them behind one tiny store avoids
// sprinkling DPAPI and file IO concerns through VrcApi + IPC handlers.
class AuthStore
{
public:
    static AuthStore& Instance();

    bool Load();
    bool Save() const;
    void SetCookies(std::string auth, std::string twoFactor);
    // `reason` is a diagnostic tag identifying the call site — logged so we
    // can tell an intentional logout from a spurious session wipe.
    void Clear(std::string_view reason = "unspecified");
    bool HasSession() const;
    std::string BuildCookieHeader() const;

    // Raw `auth` cookie value — Pipeline WebSocket passes it as the
    // `?authToken=` query param (not the full Cookie header).
    std::string AuthCookie() const;

private:
    AuthStore() = default;
    ~AuthStore();

    std::filesystem::path ResolveSessionPath() const;

    mutable std::mutex m_mutex;
    std::string m_authCookie;
    std::string m_twoFactorCookie;
};

} // namespace vrcsm::core
