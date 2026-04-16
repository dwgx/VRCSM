#include "TaskQueue.h"

#include "Common.h"

#include <filesystem>

#include <fmt/format.h>
#include <spdlog/spdlog.h>

namespace vrcsm::core
{

TaskQueue::TaskQueue()
{
    // Create a Job Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE so
    // every child process is force-terminated when VRCSM exits (even
    // on crash — the kernel closes all handles).
    m_hJob = CreateJobObjectW(nullptr, nullptr);
    if (m_hJob)
    {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION info{};
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(m_hJob, JobObjectExtendedLimitInformation, &info, sizeof(info));
    }
    else
    {
        spdlog::warn("TaskQueue: CreateJobObject failed ({}), child processes won't auto-terminate", GetLastError());
    }

    m_worker = std::thread([this]() { WorkerLoop(); });
}

TaskQueue::~TaskQueue()
{
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_stopping = true;
        // Cancel in-flight work so the worker doesn't block on a child.
        if (m_activeToken)
        {
            m_activeToken->cancelled = true;
        }
    }
    m_cv.notify_one();

    if (m_worker.joinable())
    {
        m_worker.join();
    }

    // Closing the Job handle kills all remaining children.
    if (m_hJob)
    {
        CloseHandle(m_hJob);
    }
}

std::shared_ptr<TaskToken> TaskQueue::Submit(Task task)
{
    auto token = std::make_shared<TaskToken>();
    task.token = token;

    {
        std::lock_guard<std::mutex> lock(m_mutex);

        // Cancel any existing task with the same key — both queued and
        // in-flight. This is the "rapid click" defence.
        if (!task.key.empty())
        {
            // Cancel in-flight if same key.
            if (m_activeKey == task.key && m_activeToken)
            {
                spdlog::debug("TaskQueue: cancelling in-flight task for key '{}'", task.key);
                m_activeToken->cancelled = true;
            }

            // Drain queued tasks with the same key.
            std::queue<Task> filtered;
            while (!m_queue.empty())
            {
                auto& front = m_queue.front();
                if (front.key == task.key)
                {
                    if (front.token) front.token->cancelled = true;
                    if (front.onDone)
                    {
                        front.onDone(TaskResult{false, {}, "cancelled"});
                    }
                }
                else
                {
                    filtered.push(std::move(front));
                }
                m_queue.pop();
            }
            m_queue = std::move(filtered);
        }

        m_queue.push(std::move(task));
    }
    m_cv.notify_one();
    return token;
}

void TaskQueue::Cancel(const std::string& key)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_activeKey == key && m_activeToken)
    {
        m_activeToken->cancelled = true;
    }

    std::queue<Task> filtered;
    while (!m_queue.empty())
    {
        auto& front = m_queue.front();
        if (front.key == key)
        {
            if (front.token) front.token->cancelled = true;
            if (front.onDone)
            {
                front.onDone(TaskResult{false, {}, "cancelled"});
            }
        }
        else
        {
            filtered.push(std::move(front));
        }
        m_queue.pop();
    }
    m_queue = std::move(filtered);
}

std::size_t TaskQueue::PendingCount() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_queue.size();
}

void TaskQueue::WorkerLoop()
{
    while (true)
    {
        Task task;
        {
            std::unique_lock<std::mutex> lock(m_mutex);
            m_cv.wait(lock, [this]() { return m_stopping || !m_queue.empty(); });

            if (m_stopping && m_queue.empty())
            {
                return;
            }

            task = std::move(m_queue.front());
            m_queue.pop();

            m_activeToken = task.token;
            m_activeKey = task.key;
        }

        // Skip if already cancelled before we even started.
        if (task.token && task.token->cancelled)
        {
            if (task.onDone)
            {
                task.onDone(TaskResult{false, {}, "cancelled"});
            }
            std::lock_guard<std::mutex> lock(m_mutex);
            m_activeToken.reset();
            m_activeKey.clear();
            continue;
        }

        TaskResult result;
        try
        {
            result = task.work(*task.token);
        }
        catch (const std::exception& ex)
        {
            result.ok = false;
            result.error = ex.what();
        }
        catch (...)
        {
            result.ok = false;
            result.error = "unknown task failure";
        }

        if (task.onDone)
        {
            task.onDone(result);
        }

        {
            std::lock_guard<std::mutex> lock(m_mutex);
            m_activeToken.reset();
            m_activeKey.clear();
        }
    }
}

TaskQueue::SpawnResult TaskQueue::SpawnAndWait(
    const std::wstring& cmdLine,
    const std::filesystem::path& cwd,
    const std::filesystem::path& logPath,
    const TaskToken& token)
{
    SpawnResult out;

    if (token.cancelled)
    {
        out.ok = false;
        return out;
    }

    // Open log file for stdout/stderr redirection.
    SECURITY_ATTRIBUTES sa{};
    sa.nLength = sizeof(sa);
    sa.bInheritHandle = TRUE;

    HANDLE hLog = CreateFileW(
        logPath.c_str(),
        GENERIC_WRITE,
        FILE_SHARE_READ,
        &sa,
        CREATE_ALWAYS,
        FILE_ATTRIBUTE_NORMAL,
        nullptr);
    if (hLog == INVALID_HANDLE_VALUE)
    {
        spdlog::warn("TaskQueue: could not open log file {}", toUtf8(logPath.wstring()));
        hLog = nullptr;
    }

    std::wstring mutableCmd = cmdLine;
    STARTUPINFOW si{};
    si.cb = sizeof(si);
    if (hLog)
    {
        si.dwFlags = STARTF_USESTDHANDLES;
        si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
        si.hStdOutput = hLog;
        si.hStdError = hLog;
    }
    PROCESS_INFORMATION pi{};

    if (!CreateProcessW(
            nullptr,
            mutableCmd.data(),
            nullptr,
            nullptr,
            hLog ? TRUE : FALSE,
            CREATE_NO_WINDOW | CREATE_SUSPENDED,
            nullptr,
            cwd.empty() ? nullptr : cwd.c_str(),
            &si,
            &pi))
    {
        spdlog::error("TaskQueue: CreateProcessW failed ({})", GetLastError());
        if (hLog) CloseHandle(hLog);
        return out;
    }

    // Assign to Job Object BEFORE resuming so the child can't escape.
    if (m_hJob)
    {
        AssignProcessToJobObject(m_hJob, pi.hProcess);
    }
    ResumeThread(pi.hThread);
    CloseHandle(pi.hThread);

    // Poll with 500ms intervals so we can react to cancellation
    // without burning CPU. A full extractor run is 5-30s, so 500ms
    // granularity is fine.
    while (true)
    {
        DWORD waitResult = WaitForSingleObject(pi.hProcess, 500);

        if (waitResult == WAIT_OBJECT_0)
        {
            // Process exited normally.
            GetExitCodeProcess(pi.hProcess, &out.exitCode);
            out.ok = (out.exitCode == 0);
            out.hProcess = nullptr;
            CloseHandle(pi.hProcess);
            if (hLog) CloseHandle(hLog);
            return out;
        }

        if (token.cancelled)
        {
            spdlog::info("TaskQueue: cancellation requested, terminating child process");
            TerminateProcess(pi.hProcess, 1);
            WaitForSingleObject(pi.hProcess, 2000);
            CloseHandle(pi.hProcess);
            if (hLog) CloseHandle(hLog);
            out.ok = false;
            return out;
        }

        // WAIT_TIMEOUT — keep polling.
    }
}

} // namespace vrcsm::core
