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

    // Adds or re-asserts the tray icon. Idempotent and self-healing: it
    // NIM_MODIFYs first (which verifies the icon is actually present) and
    // falls back to NIM_ADD when the shell has dropped it (e.g. after an
    // Explorer/taskbar restart). Returns true when the icon is present
    // afterwards. Callers that gate window-hiding on the tray must check
    // this so a failed add never orphans the window.
    bool AddTrayIcon();
    void RemoveTrayIcon();
    void RestoreFromTray();
    // Returns true when the window was hidden to the tray. Returns false
    // when no tray icon could be established, so the caller can fall back
    // to an ordinary minimize instead of hiding into nowhere.
    bool HideToTray();
    void ShowTrayMenu();
    void QuitFromTray();

    HINSTANCE m_hInstance{};
    HWND m_hwnd{};
    HICON m_appIcon{};
    bool m_trayIconAdded{false};
    bool m_quitting{false};
    // Tracks whether the window was maximized when it was hidden to the
    // tray, so RestoreFromTray can bring it back maximized instead of
    // collapsing it to a normal-sized window.
    bool m_wasMaximized{false};
    // "TaskbarCreated" broadcast message id (RegisterWindowMessage). The
    // shell broadcasts this when Explorer/the taskbar restarts, at which
    // point every app must re-add its notification icon. 0 until registered.
    UINT m_taskbarCreatedMsg{0};
    std::unique_ptr<WebViewHost> m_webViewHost;
};
