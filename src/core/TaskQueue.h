#pragma once

#include <atomic>
#include <condition_variable>
#include <filesystem>
#include <functional>
#include <mutex>
#include <optional>
#include <queue>
#include <string>
#include <thread>
#include <unordered_map>

#include <Windows.h>

namespace vrcsm::core
{

// Cancellation token shared between the queue and the caller. The
// caller (or a subsequent request for the same key) can set `cancelled`
// to signal the worker to bail early. The worker checks it at every
// phase boundary so we never wait for a 30-second extractor that the
// user already abandoned.
struct TaskToken
{
    std::atomic<bool> cancelled{false};
};

// Result of a queued task — either a value or an error message.
struct TaskResult
{
    bool ok{false};
    std::string value;   // serialised JSON on success
    std::string error;   // human-readable on failure
};

using TaskCallback = std::function<void(const TaskResult&)>;

// A single unit of work. `key` is used for dedup/cancellation (e.g.
// the avatarId). `work` is the blocking function that produces the
// result. `onDone` fires on the worker thread when the task finishes
// or is cancelled.
struct Task
{
    std::string key;
    std::function<TaskResult(const TaskToken&)> work;
    TaskCallback onDone;
    std::shared_ptr<TaskToken> token;
};

// Serialised task queue with Windows Job Object child-process management.
//
// Design:
//   - One worker thread processes tasks sequentially (concurrency = 1).
//     Avatar extraction is CPU-heavy and disk-heavy; running N in
//     parallel just makes all N slower. Sequential execution with
//     cancellation gives the user the LAST avatar they clicked, fast.
//   - `Submit()` with a key that matches an in-flight or queued task
//     cancels the older one and enqueues the new one. This is the
//     "rapid click" defence: 10 clicks = 9 cancellations + 1 real run.
//   - A Windows Job Object is created once and every child process
//     spawned via `SpawnInJob()` is assigned to it. When the Job is
//     closed (or VRCSM exits), Windows force-terminates all children.
//     This prevents orphaned PyInstaller processes surviving a crash.
class TaskQueue
{
public:
    TaskQueue();
    ~TaskQueue();

    TaskQueue(const TaskQueue&) = delete;
    TaskQueue& operator=(const TaskQueue&) = delete;

    // Enqueue work. If a task with the same `key` is already queued or
    // running, the old one is cancelled before the new one is pushed.
    // Returns the token so the caller can observe cancellation.
    std::shared_ptr<TaskToken> Submit(Task task);

    // Cancel all tasks with the given key (queued and in-flight).
    void Cancel(const std::string& key);

    // Spawn a child process inside the Job Object. Returns the process
    // handle on success. The caller owns the handle and must close it.
    // `token` is checked before and after CreateProcessW so a cancelled
    // task never waits on a stale child.
    struct SpawnResult
    {
        bool ok{false};
        HANDLE hProcess{nullptr};
        DWORD exitCode{0};
    };

    // Spawn a process, wait for it (with cancellation checks every
    // 500ms), and return the exit code. If cancelled mid-wait, the
    // child is terminated immediately.
    SpawnResult SpawnAndWait(
        const std::wstring& cmdLine,
        const std::filesystem::path& cwd,
        const std::filesystem::path& logPath,
        const TaskToken& token);

    // Number of tasks currently queued (not counting the in-flight one).
    std::size_t PendingCount() const;

private:
    void WorkerLoop();

    mutable std::mutex m_mutex;
    std::condition_variable m_cv;
    std::queue<Task> m_queue;
    std::atomic<bool> m_stopping{false};
    std::thread m_worker;

    // In-flight task's token + key, protected by m_mutex.
    std::shared_ptr<TaskToken> m_activeToken;
    std::string m_activeKey;

    // Job Object — every child process is assigned here.
    HANDLE m_hJob{nullptr};
};

} // namespace vrcsm::core
