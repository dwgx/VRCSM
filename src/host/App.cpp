#include "../pch.h"

#include "App.h"
#include "MainWindow.h"
#include "../core/Common.h"

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
    const std::filesystem::path logDir = vrcsm::core::getAppDataRoot() / L"logs";
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
