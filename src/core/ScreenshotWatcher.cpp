#include "../pch.h"

#include "ScreenshotWatcher.h"

#include "Common.h"

#include <chrono>
#include <mutex>
#include <thread>
#include <unordered_set>

#include <Windows.h>
#include <ShlObj.h>
#include <KnownFolders.h>

#include <spdlog/spdlog.h>

// ─────────────────────────────────────────────────────────────────────────
// ScreenshotWatcher — ReadDirectoryChangesW-based folder monitor for
// VRChat's capture directory.
//
// Why ReadDirectoryChangesW (not a polling scan): the VRChat client
// writes large frames in bursts and a poll-based scheme would either
// miss short-lived files or fire callbacks before the file is fully
// flushed. ReadDirectoryChangesW lets us observe create + last-write
// notifications and wait until the write phase settles.
//
// We debounce duplicates by tracking recently-reported paths for 10
// seconds — ReadDirectoryChangesW can surface multiple events for the
// same write (one CREATE, one or more LAST_WRITE) which otherwise
// would trigger the callback over and over.
// ─────────────────────────────────────────────────────────────────────────

namespace vrcsm::core
{

namespace
{

struct RecentPath
{
    std::wstring path;
    std::chrono::steady_clock::time_point seenAt;
};

bool IsPngExtension(const std::wstring& filename)
{
    if (filename.size() < 4) return false;
    const auto pos = filename.find_last_of(L'.');
    if (pos == std::wstring::npos) return false;
    std::wstring ext = filename.substr(pos);
    for (auto& c : ext) c = static_cast<wchar_t>(::towlower(c));
    return ext == L".png";
}

} // namespace

ScreenshotWatcher::ScreenshotWatcher() = default;

ScreenshotWatcher::~ScreenshotWatcher()
{
    Stop();
}

std::filesystem::path ScreenshotWatcher::DefaultScreenshotsFolder()
{
    PWSTR path = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_Pictures, 0, nullptr, &path)) && path)
    {
        std::filesystem::path out(path);
        CoTaskMemFree(path);
        return out / L"VRChat";
    }
    return {};
}

bool ScreenshotWatcher::Start(const std::filesystem::path& folder, Callback onNewFile)
{
    Stop();

    if (folder.empty())
    {
        return false;
    }

    // Auto-create the folder so the watch can attach even before
    // VRChat has dropped its first screenshot.
    std::error_code ec;
    std::filesystem::create_directories(folder, ec);

    HANDLE h = CreateFileW(
        folder.c_str(),
        FILE_LIST_DIRECTORY,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr,
        OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS,
        nullptr);
    if (h == INVALID_HANDLE_VALUE)
    {
        spdlog::warn("ScreenshotWatcher: CreateFileW failed ({}) for {}",
                     GetLastError(), toUtf8(folder.wstring()));
        return false;
    }

    m_folder = folder;
    m_callback = std::move(onNewFile);
    m_dirHandle = h;
    m_running.store(true);
    m_worker = std::thread(&ScreenshotWatcher::WatchLoop, this);
    return true;
}

void ScreenshotWatcher::Stop()
{
    if (!m_running.exchange(false))
    {
        return;
    }

    HANDLE h = static_cast<HANDLE>(m_dirHandle);
    if (h != nullptr && h != INVALID_HANDLE_VALUE)
    {
        // Closing the handle unblocks the worker's ReadDirectoryChangesW.
        CancelIoEx(h, nullptr);
        ::CloseHandle(h);
        m_dirHandle = nullptr;
    }

    if (m_worker.joinable())
    {
        m_worker.join();
    }
}

void ScreenshotWatcher::WatchLoop()
{
    HANDLE h = static_cast<HANDLE>(m_dirHandle);
    if (h == nullptr || h == INVALID_HANDLE_VALUE) return;

    std::vector<std::uint8_t> buffer(64 * 1024);
    std::vector<RecentPath> recent;

    const auto cleanupRecent = [&recent]()
    {
        const auto now = std::chrono::steady_clock::now();
        recent.erase(
            std::remove_if(recent.begin(), recent.end(),
                [&](const RecentPath& r)
                {
                    return now - r.seenAt > std::chrono::seconds(10);
                }),
            recent.end());
    };

    while (m_running.load())
    {
        DWORD bytesReturned = 0;
        const BOOL ok = ReadDirectoryChangesW(
            h,
            buffer.data(),
            static_cast<DWORD>(buffer.size()),
            /*bWatchSubtree=*/TRUE,
            FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_LAST_WRITE,
            &bytesReturned,
            nullptr,
            nullptr);
        if (!ok || bytesReturned == 0 || !m_running.load())
        {
            break;
        }

        cleanupRecent();

        std::size_t offset = 0;
        while (offset < bytesReturned)
        {
            auto* info = reinterpret_cast<FILE_NOTIFY_INFORMATION*>(buffer.data() + offset);

            const std::wstring name(
                info->FileName,
                info->FileNameLength / sizeof(wchar_t));

            const bool interesting =
                (info->Action == FILE_ACTION_ADDED ||
                 info->Action == FILE_ACTION_MODIFIED ||
                 info->Action == FILE_ACTION_RENAMED_NEW_NAME) &&
                IsPngExtension(name);

            if (interesting)
            {
                const std::filesystem::path full = m_folder / name;
                const std::wstring key = full.wstring();

                const auto already = std::find_if(
                    recent.begin(), recent.end(),
                    [&](const RecentPath& r) { return r.path == key; });

                if (already == recent.end())
                {
                    recent.push_back({key, std::chrono::steady_clock::now()});

                    // Give VRChat a beat to finish flushing the file
                    // before the caller reads it back — 250 ms is
                    // generous enough for a 6 K capture on spinning
                    // rust and still tight enough to feel instant.
                    std::this_thread::sleep_for(std::chrono::milliseconds(250));

                    if (m_callback)
                    {
                        try
                        {
                            m_callback(full);
                        }
                        catch (const std::exception& ex)
                        {
                            spdlog::warn("ScreenshotWatcher: callback threw: {}", ex.what());
                        }
                    }
                }
            }

            if (info->NextEntryOffset == 0) break;
            offset += info->NextEntryOffset;
        }
    }
}

} // namespace vrcsm::core
