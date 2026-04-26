#include "../pch.h"

#include "App.h"
#include "MainWindow.h"
#include "../core/Common.h"

namespace
{
// Marker file path lives under appDataRoot itself so it survives the
// factory-reset wipe (which only deletes children, not the root). Stays
// in sync with the const in ShellBridge.cpp.
constexpr const wchar_t* kFactoryResetMarker = L".factory-reset-pending";

// On startup, if the previous session ended in a factory reset, the
// WebView2 user-data folder is the last piece of stale state we couldn't
// touch while the WebView2 environment was still alive. Wipe it now,
// before WebViewHost::Initialize creates a new environment, so the next
// React boot has no cached IndexedDB / localStorage / service-worker
// state pointing at deleted backing files (the cause of the post-reset
// white screen).
void HandlePendingFactoryReset()
{
    const auto root = vrcsm::core::getAppDataRoot();
    const auto marker = root / kFactoryResetMarker;
    std::error_code ec;
    if (!std::filesystem::exists(marker, ec))
    {
        return;
    }

    const auto wv2 = root / L"WebView2";
    if (std::filesystem::exists(wv2, ec))
    {
        std::error_code rmEc;
        std::filesystem::remove_all(wv2, rmEc);
        if (rmEc)
        {
            spdlog::warn(
                "factory-reset: failed to wipe WebView2 user data: {}",
                rmEc.message());
        }
        else
        {
            spdlog::info("factory-reset: wiped WebView2 user data folder");
        }
    }

    std::error_code unlinkEc;
    std::filesystem::remove(marker, unlinkEc);
}
} // namespace

int App::Run(HINSTANCE hInstance, int nShowCmd)
{
    InitializeLogging();
    HandlePendingFactoryReset();

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
