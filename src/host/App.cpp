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

    // Wipe the dirs the live WebView2 renderer holds open. During the in-app
    // factory reset (HandleAppFactoryReset) the renderer is still alive and
    // keeps file handles on WebView2 user data AND on any thumbnail/preview
    // images it has loaded (thumb.local / images.cache / screenshot thumbs),
    // so remove_all there hits sharing violations and silently skips them —
    // that is why the thumbnail cache "won't clear". This next-launch pass runs
    // BEFORE WebView2 re-initializes, so nothing holds those handles now and
    // the deletion succeeds.
    for (const wchar_t* sub : {L"WebView2", L"thumb-cache-files", L"preview-cache", L"screenshot-thumbs"})
    {
        const auto dir = root / sub;
        if (!std::filesystem::exists(dir, ec))
        {
            continue;
        }
        std::error_code rmEc;
        std::filesystem::remove_all(dir, rmEc);
        if (rmEc)
        {
            spdlog::warn("factory-reset: failed to wipe {}: {}",
                         vrcsm::core::toUtf8(std::wstring(sub)), rmEc.message());
        }
        else
        {
            spdlog::info("factory-reset: wiped {}", vrcsm::core::toUtf8(std::wstring(sub)));
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
