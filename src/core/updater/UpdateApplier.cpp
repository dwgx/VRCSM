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

} // namespace

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
    // fmt v12 doesn't take wide format strings without enabling wchar support
    // at build time. Build the command line in narrow and widen once; the
    // argument content is all ASCII punctuation + paths already in utf-8.
    std::wstring commandLine = toWide(fmt::format(
        "\"{}\" /i \"{}\" /passive /norestart",
        toUtf8(msiexecPath),
        toUtf8(msiPath.wstring())));

    STARTUPINFOW startupInfo{};
    startupInfo.cb = sizeof(startupInfo);

    PROCESS_INFORMATION processInfo{};
    wchar_t environmentBlock[2] = {L'\0', L'\0'};
    if (!CreateProcessW(
            msiexecPath.c_str(),
            commandLine.data(),
            nullptr,
            nullptr,
            FALSE,
            DETACHED_PROCESS | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
            environmentBlock,
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
