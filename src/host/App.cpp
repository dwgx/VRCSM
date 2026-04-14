#include "../pch.h"

#include "App.h"
#include "MainWindow.h"

namespace
{
std::filesystem::path GetLocalAppDataPath()
{
    std::wstring buffer(static_cast<size_t>(MAX_PATH), L'\0');
    DWORD length = GetEnvironmentVariableW(L"LOCALAPPDATA", buffer.data(), static_cast<DWORD>(buffer.size()));
    if (length == 0)
    {
        throw std::runtime_error("LOCALAPPDATA is not set");
    }

    if (length >= buffer.size())
    {
        buffer.resize(static_cast<size_t>(length));
        length = GetEnvironmentVariableW(L"LOCALAPPDATA", buffer.data(), static_cast<DWORD>(buffer.size()));
        if (length == 0 || length >= buffer.size())
        {
            throw std::runtime_error("Failed to query LOCALAPPDATA");
        }
    }

    buffer.resize(static_cast<size_t>(length));
    return std::filesystem::path(buffer);
}
}

int App::Run(HINSTANCE hInstance, int nShowCmd)
{
    InitializeLogging();

    MainWindow window;
    window.Create(hInstance, nShowCmd);

    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0)
    {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }

    return static_cast<int>(message.wParam);
}

void App::InitializeLogging()
{
    const std::filesystem::path logDir = GetLocalAppDataPath() / L"VRCSM" / L"logs";
    std::filesystem::create_directories(logDir);

    const auto sink = std::make_shared<spdlog::sinks::rotating_file_sink_mt>(
        (logDir / L"vrcsm.log").string(),
        1024 * 1024 * 5,
        3);

    auto logger = std::make_shared<spdlog::logger>("vrcsm", sink);
    logger->set_pattern("%Y-%m-%d %H:%M:%S.%e [%l] %v");
    logger->set_level(spdlog::level::info);

    spdlog::set_default_logger(std::move(logger));
    spdlog::flush_on(spdlog::level::info);
}
