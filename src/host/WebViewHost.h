#pragma once

#include "../pch.h"

class IpcBridge;

class WebViewHost
{
public:
    WebViewHost();
    ~WebViewHost();

    HRESULT Initialize(HWND parent);
    void Resize(RECT bounds) const;
    void PostMessageToWeb(const std::string& json) const;
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
