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
