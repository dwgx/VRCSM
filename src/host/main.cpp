#include "../pch.h"

#include "App.h"
#include "StringUtil.h"
#include "UrlProtocol.h"

namespace
{
std::wstring GetErrorMessage(const std::exception& ex)
{
    try
    {
        return L"VRCSM failed to start.\n\n" + Utf8ToWide(ex.what());
    }
    catch (...)
    {
        return L"VRCSM failed to start due to an unexpected error.";
    }
}
}

int APIENTRY wWinMain(HINSTANCE hInstance, HINSTANCE, LPWSTR, int nShowCmd)
{
    HRESULT comHr = E_FAIL;

    try
    {
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

        comHr = OleInitialize(nullptr);
        if (FAILED(comHr))
        {
            THROW_IF_FAILED(comHr);
        }

        // Register vrcsm:// and vrcx:// URL protocol handlers under
        // HKCU\Software\Classes on every launch so the handler points at
        // the current VRCSM.exe (important if the user moves or reinstalls
        // the app). Registration is best-effort — failures only disable
        // clickable links, not the app itself.
        vrcsm::host::RegisterProtocolHandlers();

        App app;
        const int exitCode = app.Run(hInstance, nShowCmd);
        OleUninitialize();
        return exitCode;
    }
    catch (const std::exception& ex)
    {
        spdlog::critical("Unhandled exception in wWinMain: {}", ex.what());
        MessageBoxW(nullptr, GetErrorMessage(ex).c_str(), L"VRC Settings Manager", MB_ICONERROR | MB_OK);
    }
    catch (...)
    {
        spdlog::critical("Unhandled non-standard exception in wWinMain");
        MessageBoxW(
            nullptr,
            L"VRC Settings Manager failed to start due to an unexpected error.",
            L"VRC Settings Manager",
            MB_ICONERROR | MB_OK);
    }

    if (SUCCEEDED(comHr))
    {
        OleUninitialize();
    }

    return 1;
}
