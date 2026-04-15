#pragma once

#include "../pch.h"

class IpcBridge;

// Custom Win32 message used to marshal PostWebMessageAsString calls
// from worker threads onto the UI thread. WParam is unused, LParam
// is a heap-allocated std::string* that the MainWindow handler owns
// after dispatch. Must be ≤ WM_APP + 0x3FFF.
inline constexpr UINT WM_APP_POST_WEB_MESSAGE = WM_APP + 1;

class WebViewHost
{
public:
    WebViewHost();
    ~WebViewHost();

    HRESULT Initialize(HWND parent);
    void Resize(RECT bounds) const;

    // Post a JSON string to the WebView2 renderer. Safe to call from
    // any thread — if the caller is not on the UI thread, the payload
    // is queued via PostMessage onto the main window's message loop
    // and DeliverWebMessage fires it for real. This matters because
    // PostWebMessageAsString is only valid on the WebView2 UI thread;
    // calling it from a detached worker silently no-ops (or worse, on
    // some Windows builds, blocks forever), which is why the IPC
    // async-dispatch path used to look like a "hung" scan.
    void PostMessageToWeb(const std::string& json) const;

    // UI-thread callback from MainWindow::WndProc when a WM_APP_POST_
    // WEB_MESSAGE arrives. Owns the incoming heap string.
    void DeliverWebMessage(std::string* owned) const;

    HWND ParentHwnd() const noexcept { return m_parent; }

    // The main WebView2 environment — shared with AuthLoginWindow so the
    // login popup inherits the same user-data folder / cookie jar and any
    // credentials the user enters persist back to the main WebView.
    ICoreWebView2Environment* Environment() const noexcept { return m_environment.get(); }

    // Erase every VRChat-related cookie from the shared profile. Called
    // on explicit sign-out so a subsequent login popup starts from a
    // clean state instead of silently reusing a stale session.
    void ClearVrcCookies() const;

private:
    std::filesystem::path GetLocalAppDataPath() const;
    std::filesystem::path GetExecutableDirectory() const;
    HRESULT OnEnvironmentCreated(HRESULT result, ICoreWebView2Environment* environment);
    HRESULT OnControllerCreated(HRESULT result, ICoreWebView2Controller* controller);
    void ConfigureWebView();

    HWND m_parent{};
    wil::com_ptr<ICoreWebView2Environment> m_environment;
    wil::com_ptr<ICoreWebView2Controller> m_controller;
    wil::com_ptr<ICoreWebView2> m_webview;
    std::unique_ptr<IpcBridge> m_ipcBridge;
};
