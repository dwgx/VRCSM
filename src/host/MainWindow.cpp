#include "../pch.h"

#include "MainWindow.h"
#include "WebViewHost.h"

#include <dwmapi.h>
#include <shellapi.h>
#include <string>

MainWindow::MainWindow() = default;
MainWindow::~MainWindow() = default;

void MainWindow::Create(HINSTANCE hInstance, int nShowCmd)
{
    m_hInstance = hInstance;
    RegisterWindowClass(hInstance);

    const RECT rect = GetInitialWindowRect();
    m_hwnd = CreateWindowExW(
        0,
        kWindowClassName,
        L"VRC Settings Manager",
        WS_OVERLAPPEDWINDOW,
        rect.left,
        rect.top,
        rect.right - rect.left,
        rect.bottom - rect.top,
        nullptr,
        nullptr,
        hInstance,
        this);

    if (m_hwnd == nullptr)
    {
        THROW_LAST_ERROR();
    }

    ShowWindow(m_hwnd, nShowCmd);
    UpdateWindow(m_hwnd);
}

void MainWindow::RegisterWindowClass(HINSTANCE hInstance)
{
    // Must match IDI_APP_ICON in resources/app.rc.
    constexpr WORD kAppIconId = 101;
    HICON appIcon = LoadIconW(hInstance, MAKEINTRESOURCEW(kAppIconId));
    if (appIcon == nullptr)
    {
        appIcon = LoadIconW(nullptr, IDI_APPLICATION);
    }

    // Cached for the tray icon (NOTIFYICONDATA.hIcon). LoadIconW returns a
    // shared/system-managed handle, so it must not be DestroyIcon'd.
    m_appIcon = appIcon;

    WNDCLASSEXW wc{};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = &MainWindow::WndProc;
    wc.hInstance = hInstance;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.hIcon = appIcon;
    wc.hIconSm = appIcon;
    wc.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
    wc.lpszClassName = kWindowClassName;

    if (RegisterClassExW(&wc) == 0)
    {
        const DWORD error = GetLastError();
        if (error != ERROR_CLASS_ALREADY_EXISTS)
        {
            THROW_WIN32(error);
        }
    }
}

RECT MainWindow::GetInitialWindowRect() const
{
    const int width = 1280;
    const int height = 820;

    const int screenWidth = GetSystemMetrics(SM_CXSCREEN);
    const int screenHeight = GetSystemMetrics(SM_CYSCREEN);

    RECT rect{
        (screenWidth - width) / 2,
        (screenHeight - height) / 2,
        (screenWidth - width) / 2 + width,
        (screenHeight - height) / 2 + height,
    };

    AdjustWindowRectEx(&rect, WS_OVERLAPPEDWINDOW, FALSE, 0);
    return rect;
}

void MainWindow::ApplyWindowChrome()
{
    const BOOL darkMode = TRUE;
    (void)DwmSetWindowAttribute(
        m_hwnd,
        DWMWA_USE_IMMERSIVE_DARK_MODE,
        &darkMode,
        sizeof(darkMode));

    const int backdropType = DWMSBT_MAINWINDOW;
    (void)DwmSetWindowAttribute(
        m_hwnd,
        DWMWA_SYSTEMBACKDROP_TYPE,
        &backdropType,
        sizeof(backdropType));
}

void MainWindow::AddTrayIcon()
{
    if (m_trayIconAdded || m_hwnd == nullptr)
    {
        return;
    }

    NOTIFYICONDATAW nid{};
    nid.cbSize = sizeof(nid);
    nid.hWnd = m_hwnd;
    nid.uID = kTrayIconId;
    nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
    nid.uCallbackMessage = WM_APP_TRAY_CALLBACK;
    nid.hIcon = m_appIcon;
    // Tooltip. NOTIFYICONDATAW.szTip is a fixed wchar_t buffer.
    wcscpy_s(nid.szTip, L"VRCSM");

    if (Shell_NotifyIconW(NIM_ADD, &nid))
    {
        m_trayIconAdded = true;
    }
}

void MainWindow::RemoveTrayIcon()
{
    if (!m_trayIconAdded)
    {
        return;
    }

    NOTIFYICONDATAW nid{};
    nid.cbSize = sizeof(nid);
    nid.hWnd = m_hwnd;
    nid.uID = kTrayIconId;
    Shell_NotifyIconW(NIM_DELETE, &nid);
    m_trayIconAdded = false;
}

void MainWindow::RestoreFromTray()
{
    if (m_hwnd == nullptr)
    {
        return;
    }

    ShowWindow(m_hwnd, SW_SHOW);
    // If the window was minimized, SW_RESTORE brings it back to its prior
    // (non-minimized) size; harmless when already normal.
    ShowWindow(m_hwnd, SW_RESTORE);
    SetForegroundWindow(m_hwnd);
}

void MainWindow::HideToTray()
{
    if (m_hwnd == nullptr)
    {
        return;
    }

    // Ensure a tray icon exists to restore from before hiding, so the
    // window can never become unreachable.
    if (!m_trayIconAdded)
    {
        AddTrayIcon();
    }
    ShowWindow(m_hwnd, SW_HIDE);
}

void MainWindow::ShowTrayMenu()
{
    if (m_hwnd == nullptr)
    {
        return;
    }

    HMENU menu = CreatePopupMenu();
    if (menu == nullptr)
    {
        return;
    }

    AppendMenuW(menu, MF_STRING, kTrayCmdShow, L"Show VRCSM");
    AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
    AppendMenuW(menu, MF_STRING, kTrayCmdQuit, L"Quit");

    POINT cursor{};
    GetCursorPos(&cursor);

    // Per MSDN, the owner window must be foreground for the menu to
    // dismiss correctly when the user clicks elsewhere.
    SetForegroundWindow(m_hwnd);
    TrackPopupMenu(
        menu,
        TPM_RIGHTBUTTON | TPM_BOTTOMALIGN,
        cursor.x,
        cursor.y,
        0,
        m_hwnd,
        nullptr);
    // Posting a null message flushes the menu's message queue quirk.
    PostMessageW(m_hwnd, WM_NULL, 0, 0);

    DestroyMenu(menu);
}

void MainWindow::QuitFromTray()
{
    if (m_quitting)
    {
        return;
    }
    m_quitting = true;

    // Remove the tray icon first so no ghost lingers if teardown races.
    RemoveTrayIcon();

    if (m_hwnd != nullptr && IsWindow(m_hwnd))
    {
        DestroyWindow(m_hwnd);
    }
}

LRESULT CALLBACK MainWindow::WndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    MainWindow* instance = nullptr;
    if (message == WM_NCCREATE)
    {
        const auto* const createStruct = reinterpret_cast<CREATESTRUCTW*>(lParam);
        instance = static_cast<MainWindow*>(createStruct->lpCreateParams);
        instance->m_hwnd = hwnd;
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(instance));
    }
    else
    {
        instance = reinterpret_cast<MainWindow*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    }

    if (instance != nullptr)
    {
        return instance->HandleMessage(message, wParam, lParam);
    }

    return DefWindowProcW(hwnd, message, wParam, lParam);
}

LRESULT MainWindow::HandleMessage(UINT message, WPARAM wParam, LPARAM lParam)
{
    switch (message)
    {
    case WM_CREATE:
    {
        ApplyWindowChrome();
        m_webViewHost = std::make_unique<WebViewHost>();
        THROW_IF_FAILED(m_webViewHost->Initialize(m_hwnd));
        AddTrayIcon();
        return 0;
    }
    case WM_SYSCOMMAND:
        // Minimize-to-tray: hide the window instead of minimizing to the
        // taskbar. Close (WM_CLOSE) is left alone so the app remains
        // quittable via its title bar; the tray menu also offers Quit.
        if ((wParam & 0xFFF0) == SC_MINIMIZE)
        {
            HideToTray();
            return 0;
        }
        return DefWindowProcW(m_hwnd, message, wParam, lParam);
    case WM_APP_TRAY_CALLBACK:
    {
        const UINT mouseEvent = LOWORD(lParam);
        switch (mouseEvent)
        {
        case WM_LBUTTONUP:
        case WM_LBUTTONDBLCLK:
            RestoreFromTray();
            break;
        case WM_RBUTTONUP:
        case WM_CONTEXTMENU:
            ShowTrayMenu();
            break;
        default:
            break;
        }
        return 0;
    }
    case WM_COMMAND:
        switch (LOWORD(wParam))
        {
        case kTrayCmdShow:
            RestoreFromTray();
            return 0;
        case kTrayCmdQuit:
            QuitFromTray();
            return 0;
        default:
            break;
        }
        return DefWindowProcW(m_hwnd, message, wParam, lParam);
    case WM_SIZE:
        if (m_webViewHost != nullptr)
        {
            RECT clientRect{};
            GetClientRect(m_hwnd, &clientRect);
            m_webViewHost->Resize(clientRect);
        }
        return 0;
    case WM_DESTROY:
        RemoveTrayIcon();
        PostQuitMessage(0);
        return 0;
    case WM_APP_POST_WEB_MESSAGE:
    {
        // Worker-thread PostMessageToWeb landed here. We own the
        // payload pointer; hand it to the WebView host which fires
        // the real WebView2 call on this (the UI) thread and then
        // deletes the payload.
        auto* payload = reinterpret_cast<WebPostPayload*>(lParam);
        if (m_webViewHost != nullptr)
        {
            m_webViewHost->DeliverWebMessage(payload);
        }
        else
        {
            delete payload;
        }
        return 0;
    }
    case WM_APP_FACTORY_RESET_QUIT:
    {
        // Factory reset finished file deletion on a worker thread.
        // Run the WebView2-bound cookie clear here (UI thread / COM
        // apartment), schedule a self-relaunch, then exit so the
        // user lands back in a freshly-initialized VRCSM without
        // having to manually click the desktop icon again.
        if (m_webViewHost != nullptr)
        {
            m_webViewHost->ClearVrcCookies();
        }

        // Spawn a detached cmd helper that waits a couple of seconds
        // for our process (and the WebView2 service process it owns)
        // to fully exit and release the file locks on the user-data
        // folder, then launches a fresh VRCSM.exe. The new process
        // will pick up the .factory-reset-pending marker in
        // App::Run::HandlePendingFactoryReset and wipe the WebView2
        // dir before initializing the new environment. Using
        // `ping -n 3 127.0.0.1` as the sleep keeps us off Win32-only
        // `timeout`, which behaves oddly under DETACHED_PROCESS.
        wchar_t exePath[MAX_PATH]{};
        if (GetModuleFileNameW(nullptr, exePath, MAX_PATH) > 0)
        {
            std::wstring cmdLine = L"cmd.exe /c ping -n 3 127.0.0.1 >nul && start \"\" \"";
            cmdLine += exePath;
            cmdLine += L"\"";

            STARTUPINFOW si{};
            si.cb = sizeof(si);
            PROCESS_INFORMATION pi{};
            if (CreateProcessW(
                    nullptr,
                    cmdLine.data(),
                    nullptr,
                    nullptr,
                    FALSE,
                    CREATE_NO_WINDOW | DETACHED_PROCESS,
                    nullptr,
                    nullptr,
                    &si,
                    &pi))
            {
                CloseHandle(pi.hThread);
                CloseHandle(pi.hProcess);
            }
        }

        if (m_hwnd != nullptr && IsWindow(m_hwnd))
        {
            DestroyWindow(m_hwnd);
        }
        PostQuitMessage(0);
        return 0;
    }
    case WM_APP_REFRESH_PLUGIN_MAPPINGS:
        if (m_webViewHost != nullptr)
        {
            m_webViewHost->RefreshPluginMappings();
        }
        return 0;
    default:
        return DefWindowProcW(m_hwnd, message, wParam, lParam);
    }
}
