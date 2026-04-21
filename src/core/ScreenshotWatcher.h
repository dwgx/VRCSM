#pragma once

#include <atomic>
#include <filesystem>
#include <functional>
#include <string>
#include <thread>

namespace vrcsm::core
{

// Filesystem watcher over VRChat's screenshots folder. Uses
// ReadDirectoryChangesW to surface new .png files as soon as the
// capture is flushed to disk, then hands each path back via a callback
// off the watcher thread.
//
// The folder layout VRChat uses is
// `%USERPROFILE%\Pictures\VRChat\YYYY-MM\VRChat_<date>_<time>.png`, so
// the watch is recursive by default — a new month's sub-folder just
// comes in as a regular file-creation event.
class ScreenshotWatcher
{
public:
    using Callback = std::function<void(const std::filesystem::path& path)>;

    ScreenshotWatcher();
    ~ScreenshotWatcher();

    ScreenshotWatcher(const ScreenshotWatcher&) = delete;
    ScreenshotWatcher& operator=(const ScreenshotWatcher&) = delete;

    // Start watching `folder`. Idempotent — if already running, the
    // previous watcher is torn down first. Returns false only on fatal
    // setup errors (missing folder, CreateFile failure).
    bool Start(const std::filesystem::path& folder, Callback onNewFile);
    void Stop();

    bool IsRunning() const { return m_running.load(); }

    // Resolves `%USERPROFILE%\Pictures\VRChat`. Returns an empty path
    // if the Pictures folder can't be determined (rare).
    static std::filesystem::path DefaultScreenshotsFolder();

private:
    void WatchLoop();

    std::filesystem::path m_folder;
    Callback m_callback;
    std::atomic<bool> m_running{false};
    std::thread m_worker;

    // Opaque HANDLE (kept as void* so the header stays Windows.h-free).
    void* m_dirHandle{nullptr};
};

} // namespace vrcsm::core
