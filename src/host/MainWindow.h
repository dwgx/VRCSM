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

    static LRESULT CALLBACK WndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam);

    LRESULT HandleMessage(UINT message, WPARAM wParam, LPARAM lParam);
    void RegisterWindowClass(HINSTANCE hInstance);
    RECT GetInitialWindowRect() const;
    void ApplyWindowChrome();

    HINSTANCE m_hInstance{};
    HWND m_hwnd{};
    std::unique_ptr<WebViewHost> m_webViewHost;
};
