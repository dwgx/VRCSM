#include "ProcessGuard.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cwctype>
#include <mutex>
#include <thread>

#include <Windows.h>
#include <TlHelp32.h>

namespace vrcsm::core
{

void to_json(nlohmann::json& j, const ProcessStatus& s)
{
    j = nlohmann::json{
        {"running", s.running},
        {"pid", s.pid ? nlohmann::json(*s.pid) : nlohmann::json(nullptr)},
    };
}

namespace
{
bool iequalsW(const std::wstring& a, const std::wstring& b)
{
    if (a.size() != b.size()) return false;
    for (std::size_t i = 0; i < a.size(); ++i)
    {
        if (std::towlower(a[i]) != std::towlower(b[i])) return false;
    }
    return true;
}

// Shared watcher state. Kept in an anonymous namespace so there is only
// ever a single thread per process — StartWatcher replaces the callback
// rather than spawning a second watcher.
std::mutex g_watcherMutex;
std::thread g_watcherThread;
std::atomic<bool> g_watcherStop{false};
ProcessGuard::StatusCallback g_watcherCallback;

bool StatusEqual(const ProcessStatus& a, const ProcessStatus& b)
{
    if (a.running != b.running) return false;
    if (a.pid.has_value() != b.pid.has_value()) return false;
    if (a.pid.has_value() && *a.pid != *b.pid) return false;
    return true;
}
} // namespace

ProcessStatus ProcessGuard::checkProcess(const std::wstring& exeName)
{
    ProcessStatus status;
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return status;

    PROCESSENTRY32W entry{};
    entry.dwSize = sizeof(entry);
    if (Process32FirstW(snap, &entry))
    {
        do
        {
            if (iequalsW(entry.szExeFile, exeName))
            {
                status.running = true;
                status.pid = static_cast<std::uint32_t>(entry.th32ProcessID);
                break;
            }
        } while (Process32NextW(snap, &entry));
    }
    CloseHandle(snap);
    return status;
}

ProcessStatus ProcessGuard::IsVRChatRunning()
{
    auto status = checkProcess(L"VRChat.exe");
    if (status.running) return status;
    return checkProcess(L"VRChat-Win64-Shipping.exe");
}

void ProcessGuard::StartWatcher(StatusCallback callback)
{
    std::lock_guard<std::mutex> lock(g_watcherMutex);
    g_watcherCallback = std::move(callback);

    if (g_watcherThread.joinable())
    {
        // Already running — the new callback replaces the old and the
        // next tick will deliver the current status to whoever is
        // listening now.
        return;
    }

    g_watcherStop = false;
    g_watcherThread = std::thread([]()
    {
        ProcessStatus last;
        bool first = true;

        while (!g_watcherStop.load())
        {
            const auto now = IsVRChatRunning();

            if (first || !StatusEqual(now, last))
            {
                StatusCallback cb;
                {
                    std::lock_guard<std::mutex> cbLock(g_watcherMutex);
                    cb = g_watcherCallback;
                }
                if (cb)
                {
                    cb(now);
                }
                last = now;
                first = false;
            }

            // Poll cadence: 1 second trades a bit of CPU (~5ms/tick for
            // the toolhelp snapshot on a normal box) for ~5x lower
            // detection latency than the old frontend poll.
            for (int i = 0; i < 10 && !g_watcherStop.load(); ++i)
            {
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
            }
        }
    });
}

void ProcessGuard::StopWatcher()
{
    std::thread toJoin;
    {
        std::lock_guard<std::mutex> lock(g_watcherMutex);
        g_watcherStop = true;
        g_watcherCallback = nullptr;
        if (g_watcherThread.joinable())
        {
            toJoin = std::move(g_watcherThread);
        }
    }
    if (toJoin.joinable())
    {
        toJoin.join();
    }
}

} // namespace vrcsm::core
