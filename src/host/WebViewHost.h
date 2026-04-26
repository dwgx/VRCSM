#pragma once

#include "../pch.h"

#include <unordered_map>

class IpcBridge;

// Custom Win32 message used to marshal PostWebMessageAsString calls
// from worker threads onto the UI thread. WParam is unused, LParam
// is a heap-allocated PostPayload* that the MainWindow handler owns
// after dispatch. Must be ≤ WM_APP + 0x3FFF.
inline constexpr UINT WM_APP_POST_WEB_MESSAGE = WM_APP + 1;

// Posted from a worker thread after the file-deletion phase of factory
// reset completes. The UI-thread handler runs ClearVrcCookies (a COM call
// that must execute on the WebView2 apartment) and then posts WM_QUIT so
// the next launch starts from a clean slate. WParam/LParam unused.
inline constexpr UINT WM_APP_FACTORY_RESET_QUIT = WM_APP + 2;

// Marshalled payload for WM_APP_POST_WEB_MESSAGE. `targetPluginId`
// is non-empty only when the message should go to a specific plugin
// iframe; otherwise DeliverWebMessage falls back to the top-level
// `ICoreWebView2::PostWebMessageAsString` (main SPA).
struct WebPostPayload
{
    std::string json;
    std::string targetPluginId; // "" → main frame
};

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
    //
    // `targetPluginId` routes the message to the plugin's iframe via
    // `ICoreWebView2Frame::PostWebMessageAsString` — essential because
    // the top-level PostWebMessageAsString only reaches the main frame
    // and plugin iframes would otherwise never see responses.
    void PostMessageToWeb(const std::string& json, const std::string& targetPluginId = {}) const;

    // UI-thread callback from MainWindow::WndProc when a WM_APP_POST_
    // WEB_MESSAGE arrives. Owns the incoming heap payload.
    void DeliverWebMessage(WebPostPayload* owned) const;

    HWND ParentHwnd() const noexcept { return m_parent; }

    // The main WebView2 environment — retained for future popups /
    // additional controllers that should share the same user-data
    // folder and cookie jar as the primary view.
    ICoreWebView2Environment* Environment() const noexcept { return m_environment.Get(); }

    // Erase every VRChat-related cookie from the shared WebView2
    // profile. Called on explicit sign-out so any cached cookie from
    // the v0.2.0 era popup login flow is wiped alongside the DPAPI
    // session.
    void ClearVrcCookies() const;

    // Install `SetVirtualHostNameToFolderMapping` for every enabled
    // panel plugin. Called on startup (initial mount) and after any
    // install/uninstall/enable/disable so the iframe host resolves
    // immediately without requiring a WebView2 restart. Idempotent —
    // re-applying an existing mapping simply overwrites it.
    void RefreshPluginMappings() const;

    // Shutdown path for an in-place MSI handoff. Destroys the host
    // window and posts WM_QUIT so the process exits once the updater
    // child has been spawned successfully.
    void QuitForUpdate() const;

private:
    HRESULT OnEnvironmentCreated(HRESULT result, ICoreWebView2Environment* environment);
    HRESULT OnControllerCreated(HRESULT result, ICoreWebView2Controller* controller);
    void ConfigureWebView();

    HWND m_parent{};
    Microsoft::WRL::ComPtr<ICoreWebView2Environment> m_environment;
    Microsoft::WRL::ComPtr<ICoreWebView2Controller> m_controller;
    Microsoft::WRL::ComPtr<ICoreWebView2> m_webview;
    std::unique_ptr<IpcBridge> m_ipcBridge;

    // Plugin iframe tracking — keyed by plugin id. Populated via
    // `ICoreWebView2_4::add_FrameCreated` for every frame whose first
    // navigation lands on a `plugin.<id>.vrcsm` virtual host; cleared
    // on `add_Destroyed`. All access must happen on the UI thread.
    std::unordered_map<std::string, Microsoft::WRL::ComPtr<ICoreWebView2Frame>> m_pluginFrames;
};
