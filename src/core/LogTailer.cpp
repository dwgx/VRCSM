#include "LogTailer.h"

#include <algorithm>
#include <chrono>
#include <regex>
#include <system_error>
#include <vector>

#include <Windows.h>

namespace vrcsm::core
{

namespace
{

constexpr std::size_t kReadBufferSize = 65536;
constexpr auto kPollInterval = std::chrono::milliseconds(1000);
// Defensive cap on the carry-over buffer: if a "line" ever exceeds this
// without hitting a newline, the file is corrupt (or something rotated out
// from under us mid-read) and we drop the buffer so it can't grow forever.
constexpr std::size_t kMaxCarryoverBytes = 1u * 1024u * 1024u;

const std::regex kLogFileRe(R"(^output_log_.*\.txt$)");
// Matches VRChat's per-line prefix: `YYYY.MM.DD HH:MM:SS Log        -  `.
// The padding after "Log"/"Warning"/"Error" is variable (VRChat right-pads
// the severity to align the `-` column), so `+` it.
const std::regex kLinePrefixRe(
    R"((\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}) +(Log|Warning|Error) +- +)");

HANDLE OpenShared(const std::filesystem::path& path)
{
    // FILE_SHARE_WRITE is the critical flag — VRChat holds the log open for
    // writing the entire session, so without it we'd fail every open. The
    // extra FILE_SHARE_DELETE lets us keep reading if the user deletes an
    // older rotated file out from under us.
    return CreateFileW(
        path.c_str(),
        GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        nullptr);
}

std::uint64_t FileSize(HANDLE handle)
{
    LARGE_INTEGER size{};
    if (!GetFileSizeEx(handle, &size))
    {
        return 0;
    }
    return static_cast<std::uint64_t>(size.QuadPart);
}

} // namespace

LogTailer::LogTailer(std::filesystem::path logDir, Callback callback)
    : m_logDir(std::move(logDir)), m_callback(std::move(callback))
{
}

LogTailer::~LogTailer()
{
    Stop();
}

void LogTailer::Start()
{
    if (m_running.exchange(true))
    {
        return;
    }
    m_stop.store(false);
    m_thread = std::thread([this] { Run(); });
}

void LogTailer::Stop()
{
    if (!m_running.exchange(false))
    {
        return;
    }
    m_stop.store(true);
    m_wake.notify_all();
    if (m_thread.joinable())
    {
        m_thread.join();
    }
    m_currentFile.clear();
    m_offset = 0;
    m_carryover.clear();
}

std::filesystem::path LogTailer::FindLatestLog() const
{
    std::error_code ec;
    if (!std::filesystem::exists(m_logDir, ec) || ec)
    {
        return {};
    }

    std::filesystem::path best;
    std::filesystem::file_time_type bestTime{};
    bool haveBest = false;

    for (const auto& entry : std::filesystem::directory_iterator(m_logDir, ec))
    {
        if (ec)
        {
            break;
        }
        std::error_code innerEc;
        if (!entry.is_regular_file(innerEc) || innerEc)
        {
            continue;
        }
        const auto filename = entry.path().filename().string();
        if (!std::regex_match(filename, kLogFileRe))
        {
            continue;
        }
        const auto ft = entry.last_write_time(innerEc);
        if (innerEc)
        {
            continue;
        }
        if (!haveBest || ft > bestTime)
        {
            best = entry.path();
            bestTime = ft;
            haveBest = true;
        }
    }

    return best;
}

void LogTailer::OnFileSwitched(const std::filesystem::path& path)
{
    m_currentFile = path;
    m_carryover.clear();

    // Seek to EOF so the panel doesn't replay history on first attach. The
    // batch `LogParser` already fills the UI with the last session's
    // structured events — this class only produces "what happened since I
    // started watching".
    HANDLE handle = OpenShared(path);
    if (handle == INVALID_HANDLE_VALUE)
    {
        m_offset = 0;
        return;
    }
    m_offset = FileSize(handle);
    CloseHandle(handle);
}

void LogTailer::ReadNewBytes()
{
    if (m_currentFile.empty())
    {
        return;
    }

    HANDLE handle = OpenShared(m_currentFile);
    if (handle == INVALID_HANDLE_VALUE)
    {
        return;
    }

    const std::uint64_t size = FileSize(handle);
    if (size < m_offset)
    {
        // File was truncated — VRChat sometimes rewrites rather than
        // rotating when a session crashes. Reset to byte 0 and re-read.
        m_offset = 0;
        m_carryover.clear();
    }

    if (size == m_offset)
    {
        CloseHandle(handle);
        return;
    }

    LARGE_INTEGER pos{};
    pos.QuadPart = static_cast<LONGLONG>(m_offset);
    if (!SetFilePointerEx(handle, pos, nullptr, FILE_BEGIN))
    {
        CloseHandle(handle);
        return;
    }

    std::vector<char> buffer(kReadBufferSize);
    while (m_offset < size && !m_stop.load())
    {
        const DWORD toRead = static_cast<DWORD>(
            std::min<std::uint64_t>(kReadBufferSize, size - m_offset));
        DWORD bytesRead = 0;
        if (!ReadFile(handle, buffer.data(), toRead, &bytesRead, nullptr) || bytesRead == 0)
        {
            break;
        }
        m_carryover.append(buffer.data(), bytesRead);
        m_offset += bytesRead;

        // Split on '\n'. Anything after the final newline stays in the
        // carry-over for the next tick — VRChat frequently flushes a
        // half-written line (it's using C stdio buffering on top of a
        // serial file handle, so partial writes are the norm).
        std::size_t start = 0;
        std::size_t nl = 0;
        while ((nl = m_carryover.find('\n', start)) != std::string::npos)
        {
            std::string_view piece(m_carryover.data() + start, nl - start);
            if (!piece.empty() && piece.back() == '\r')
            {
                piece.remove_suffix(1);
            }
            if (!piece.empty())
            {
                EmitLine(piece);
            }
            start = nl + 1;
        }
        if (start > 0)
        {
            m_carryover.erase(0, start);
        }
        if (m_carryover.size() > kMaxCarryoverBytes)
        {
            m_carryover.clear();
        }
    }

    CloseHandle(handle);
}

void LogTailer::EmitLine(std::string_view raw)
{
    LogTailLine out;
    out.source = m_currentFile.filename().string();

    // Strip the "YYYY.MM.DD HH:MM:SS Log        -  " prefix and surface its
    // timestamp + severity as separate fields. `std::regex_search` on
    // `string_view` still isn't portable with gcc/msvc in C++17, so we
    // promote to `std::string` here — the dock never sees more than a few
    // hundred lines per second so the copy is cheap.
    std::string text(raw);
    std::smatch match;
    if (std::regex_search(text, match, kLinePrefixRe) && match.position(0) == 0)
    {
        out.iso_time = match[1].str();
        const std::string severity = match[2].str();
        if (severity == "Warning")
        {
            out.level = "warn";
        }
        else if (severity == "Error")
        {
            out.level = "error";
        }
        else
        {
            out.level = "info";
        }
        out.line = text.substr(static_cast<std::size_t>(match.length(0)));
    }
    else
    {
        out.level = "info";
        out.line = std::move(text);
    }

    if (m_callback)
    {
        try
        {
            m_callback(out);
        }
        catch (...)
        {
            // A misbehaving callback cannot be allowed to take the tailer
            // thread down; swallow and keep polling.
        }
    }
}

void LogTailer::Run()
{
    while (!m_stop.load())
    {
        const auto latest = FindLatestLog();
        if (!latest.empty())
        {
            if (latest.native() != m_currentFile.native())
            {
                OnFileSwitched(latest);
            }
            try
            {
                ReadNewBytes();
            }
            catch (...)
            {
                // Any filesystem hiccup — reset the current-file cursor so
                // next tick re-picks the latest log and tries again.
                m_currentFile.clear();
                m_offset = 0;
                m_carryover.clear();
            }
        }

        std::unique_lock<std::mutex> lock(m_wakeMutex);
        m_wake.wait_for(lock, kPollInterval, [this] { return m_stop.load(); });
    }
}

} // namespace vrcsm::core
