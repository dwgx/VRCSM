#pragma once

#include "../pch.h"

class WebViewHost;

class MainWindow
{
public:
    MainWindow();
    ~MainWindow();

    void Create(HINSTANCE hInstance, int nShowCmd);

private:
    static constexpr wchar_t kWindowClassName[] = L"VRCSM_MainWindow";

    // Unique identifier for our single tray icon (per-window scope).
    static constexpr UINT kTrayIconId = 1;

    // Tray context-menu command identifiers (WM_COMMAND wParam).
    static constexpr UINT kTrayCmdShow = 0xA001;
    static constexpr UINT kTrayCmdQuit = 0xA002;

    static LRESULT CALLBACK WndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam);

    LRESULT HandleMessage(UINT message, WPARAM wParam, LPARAM lParam);
    void RegisterWindowClass(HINSTANCE hInstance);
    RECT GetInitialWindowRect() const;
    void ApplyWindowChrome();

    void AddTrayIcon();
    void RemoveTrayIcon();
    void RestoreFromTray();
    void HideToTray();
    void ShowTrayMenu();
    void QuitFromTray();

    HINSTANCE m_hInstance{};
    HWND m_hwnd{};
    HICON m_appIcon{};
    bool m_trayIconAdded{false};
    bool m_quitting{false};
    std::unique_ptr<WebViewHost> m_webViewHost;
};
