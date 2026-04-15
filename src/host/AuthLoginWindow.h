#pragma once

#include "../pch.h"

#include <functional>
#include <string>

namespace vrcsm::host
{

/// Self-owning popup window hosting a second `ICoreWebView2` controller
/// that navigates to `https://vrchat.com/home/login` so the VRChat web
/// frontend handles every login permutation (password + 2FA, Steam
/// OAuth, reCAPTCHA, email verification) for us. Once the user lands
/// back on `/home` we harvest the `auth` + `twoFactorAuth` cookies out
/// of the WebView2 cookie jar, hand them to `AuthStore`, and close.
///
/// The window is self-managed: `Launch` allocates a new instance,
/// stashes it in GWLP_USERDATA, and the window's own `WM_NCDESTROY`
/// handler deletes it. Callers only keep a handle to the `Launch`
/// callback — they don't have to track lifetime.
class AuthLoginWindow
{
public:
    /// Invoked exactly once: `ok == true` with an empty error on
    /// success, `ok == false` with a short failure reason string
    /// otherwise ("cancelled", "webview2_env_unavailable", ...).
    /// Fires on the WebView2 UI thread (same as `IpcBridge::Dispatch`).
    using CompletionCallback = std::function<void(bool ok, const std::string& error)>;

    /// Creates the popup + its own WebView2 controller that shares the
    /// main window's environment (so we inherit the same cookie jar at
    /// `%LOCALAPPDATA%\VRCSM\WebView2`). Returns `true` when the window
    /// took ownership of `callback`; returns `false` (and invokes the
    /// callback synchronously with an error) when setup failed.
    static bool Launch(HWND ownerHwnd, ICoreWebView2Environment* env, CompletionCallback callback);

private:
    AuthLoginWindow(HWND hwnd, HWND owner, ICoreWebView2Environment* env, CompletionCallback callback);
    ~AuthLoginWindow();

    AuthLoginWindow(const AuthLoginWindow&) = delete;
    AuthLoginWindow& operator=(const AuthLoginWindow&) = delete;

    static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp);
    static HWND CreatePopup(HWND owner);
    static void EnsureClassRegistered();

    HRESULT OnControllerCreated(HRESULT result, ICoreWebView2Controller* controller);
    HRESULT OnNavigationCompleted(ICoreWebView2* sender, ICoreWebView2NavigationCompletedEventArgs* args);
    HRESULT OnSourceChanged(ICoreWebView2* sender, ICoreWebView2SourceChangedEventArgs* args);
    void ProbeUrlAndHarvest();
    void OnHarvestTimer();
    void HarvestCookies();
    HRESULT OnCookiesResolved(HRESULT result, ICoreWebView2CookieList* list);
    void ResizeController() const;
    void Finish(bool ok, const std::string& error);

    HWND m_hwnd{};
    HWND m_owner{};
    wil::com_ptr<ICoreWebView2Environment> m_env;
    wil::com_ptr<ICoreWebView2Controller> m_controller;
    wil::com_ptr<ICoreWebView2> m_webview;
    EventRegistrationToken m_navToken{};
    EventRegistrationToken m_sourceToken{};
    bool m_timerActive{false};
    CompletionCallback m_callback;
    bool m_finished{false};
};

} // namespace vrcsm::host
