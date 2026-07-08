#include "../../pch.h"

#include "UpdateApplier.h"

namespace vrcsm::core::updater
{

namespace
{

bool HasMsiExtension(const std::filesystem::path& path)
{
    return _wcsicmp(path.extension().c_str(), L".msi") == 0;
}

std::wstring GetMsiexecPath()
{
    std::wstring buffer(static_cast<std::size_t>(MAX_PATH), L'\0');
    UINT length = GetSystemDirectoryW(buffer.data(), static_cast<UINT>(buffer.size()));
    while (length >= buffer.size())
    {
        buffer.resize(buffer.size() * 2);
        length = GetSystemDirectoryW(buffer.data(), static_cast<UINT>(buffer.size()));
    }

    if (length == 0)
    {
        return L"msiexec.exe";
    }

    buffer.resize(length);
    return (std::filesystem::path(buffer) / L"msiexec.exe").wstring();
}

std::wstring GetCurrentExePath()
{
    std::wstring buffer(static_cast<std::size_t>(MAX_PATH), L'\0');
    DWORD length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
    while (length == buffer.size())
    {
        // Buffer was too small and the result is truncated (Win7 behavior:
        // GetLastError == ERROR_INSUFFICIENT_BUFFER). Grow and retry.
        buffer.resize(buffer.size() * 2);
        length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
    }
    if (length == 0)
    {
        return {};
    }
    buffer.resize(length);
    return buffer;
}

} // namespace

std::wstring BuildInstallCommandLine(
    const std::wstring& msiexecPath,
    const std::wstring& msiPath,
    const std::wstring& relaunchExePath)
{
    // Structure mirrors the proven factory-reset relauncher in MainWindow.cpp:
    // a detached `cmd /c` chain that first waits for THIS process to exit (so
    // it releases the lock on VRCSM.exe and its loaded DLLs), then applies the
    // MSI, then relaunches. `ping -n 4 127.0.0.1` is the sleep primitive —
    // ~3s — chosen over Win32-only `timeout`, which misbehaves under
    // DETACHED_PROCESS. The chain must NOT start with a quote, or cmd's /c
    // quote-stripping would mangle it; leading with `ping` keeps us safe even
    // though later tokens (msiexec, exe path) are quoted.
    std::wstring cmd = L"cmd.exe /c ping -n 4 127.0.0.1 >nul && \"";
    cmd += msiexecPath;
    cmd += L"\" /i \"";
    cmd += msiPath;
    cmd += L"\" /passive /norestart";

    if (!relaunchExePath.empty())
    {
        // `start "" "<exe>"` — the empty "" is the mandatory window-title arg
        // so `start` does not treat the quoted exe path as the title.
        cmd += L" && start \"\" \"";
        cmd += relaunchExePath;
        cmd += L"\"";
    }

    return cmd;
}

Result<std::monostate> UpdateApplier::Apply(const std::filesystem::path& msiPath)
{
    std::error_code ec;
    if (!std::filesystem::is_regular_file(msiPath, ec))
    {
        return Error{"update_invalid", "MSI path does not exist", 0};
    }
    if (ec)
    {
        return Error{"update_invalid", fmt::format("failed to inspect MSI path: {}", ec.message()), 0};
    }
    if (!HasMsiExtension(msiPath))
    {
        return Error{"update_invalid", "installer path must end with .msi", 0};
    }

    const std::wstring msiexecPath = GetMsiexecPath();
    const std::wstring exePath = GetCurrentExePath();

    // Detached cmd bootstrap: waits for our exit, applies the MSI in-place,
    // then relaunches the new VRCSM.exe. Decoupling the msiexec run from our
    // shutdown removes the self-replacement race where /norestart would hit
    // "file in use" while VRCSM.exe was still mapped.
    std::wstring commandLine = BuildInstallCommandLine(msiexecPath, msiPath.wstring(), exePath);

    STARTUPINFOW startupInfo{};
    startupInfo.cb = sizeof(startupInfo);

    PROCESS_INFORMATION processInfo{};
    // Inherit the parent environment (nullptr) — msiexec needs TEMP/PATH/
    // SystemRoot etc. The previous direct-spawn passed an empty environment
    // block, which starved msiexec of those variables.
    if (!CreateProcessW(
            nullptr,
            commandLine.data(),
            nullptr,
            nullptr,
            FALSE,
            DETACHED_PROCESS | CREATE_NO_WINDOW,
            nullptr,
            nullptr,
            &startupInfo,
            &processInfo))
    {
        return Error{"update_spawn", fmt::format("CreateProcessW failed ({})", GetLastError()), 0};
    }

    CloseHandle(processInfo.hThread);
    CloseHandle(processInfo.hProcess);
    return std::monostate{};
}

void UpdateApplier::QuitCurrentProcess()
{
    if (HWND window = GetActiveWindow(); window != nullptr)
    {
        PostMessageW(window, WM_CLOSE, 0, 0);
        return;
    }

    PostQuitMessage(0);
}

} // namespace vrcsm::core::updater
