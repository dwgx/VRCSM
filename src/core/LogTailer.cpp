#include "LogTailer.h"

#include "LogAtoms.h"

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
// On first attach to an already-existing log, replay at most this many
// trailing lines so a panel opened mid-session shows immediate history.
constexpr std::size_t kBackfillLines = 400;
// Cap how far back from EOF we scan to gather those lines. VRChat log lines
// are typically well under a few hundred bytes, so 512 KiB comfortably holds
// far more than kBackfillLines while bounding the read on a huge file.
constexpr std::uint64_t kBackfillScanBytes = 512u * 1024u;
// Defensive cap on the carry-over buffer: if a "line" ever exceeds this
// without hitting a newline, the file is corrupt (or something rotated out
// from under us mid-read) and we drop the buffer so it can't grow forever.
constexpr std::size_t kMaxCarryoverBytes = 1u * 1024u * 1024u;

const std::regex kLogFileRe(R"(^output_log_.*\.txt$)");
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
    m_attachedOnce = false;
    m_pendingBackfill = false;
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
    const bool firstAttach = !m_attachedOnce;
    m_currentFile = path;
    m_carryover.clear();
    m_attachedOnce = true;

    // Subsequent file switches mean VRChat rotated to a new output_log_*.
    // VRChat may have written several seconds of lines between file
    // creation and our 1-second poll noticing it. Start at byte 0 so those
    // lines aren't silently dropped.
    if (!firstAttach)
    {
        m_offset = 0;
        return;
    }

    // First attach: replay the tail of the existing file so a panel opened
    // while VRChat is already running shows immediate history, then continue
    // live-tailing from EOF. Previously we seeked straight to EOF, which left
    // GameLog / the console dock blank until VRChat happened to append a new
    // line — for an idle-but-running session that could be a very long wait,
    // and if VRChat wasn't writing at all the panel looked broken. The batch
    // `LogParser` still owns structured session history; backfilled raw lines
    // are flagged so stateful consumers ignore them.
    HANDLE handle = OpenShared(path);
    if (handle == INVALID_HANDLE_VALUE)
    {
        m_offset = 0;
        return;
    }
    m_offset = FileSize(handle);
    CloseHandle(handle);
    m_pendingBackfill = true;
}

void LogTailer::BackfillTail()
{
    m_pendingBackfill = false;

    if (m_currentFile.empty() || m_offset == 0)
    {
        return;
    }

    HANDLE handle = OpenShared(m_currentFile);
    if (handle == INVALID_HANDLE_VALUE)
    {
        return;
    }

    // Read the trailing window [start, m_offset) where m_offset is EOF as of
    // OnFileSwitched. We only replay complete lines: the first partial line in
    // the window (everything before the first '\n') is dropped so we never
    // emit a fragment.
    const std::uint64_t eof = m_offset;
    const std::uint64_t start = eof > kBackfillScanBytes ? eof - kBackfillScanBytes : 0;
    const std::uint64_t span = eof - start;

    LARGE_INTEGER pos{};
    pos.QuadPart = static_cast<LONGLONG>(start);
    if (!SetFilePointerEx(handle, pos, nullptr, FILE_BEGIN))
    {
        CloseHandle(handle);
        return;
    }

    std::string window;
    window.reserve(static_cast<std::size_t>(span));
    std::vector<char> buffer(kReadBufferSize);
    std::uint64_t remaining = span;
    while (remaining > 0 && !m_stop.load())
    {
        const DWORD toRead = static_cast<DWORD>(
            std::min<std::uint64_t>(kReadBufferSize, remaining));
        DWORD bytesRead = 0;
        if (!ReadFile(handle, buffer.data(), toRead, &bytesRead, nullptr) || bytesRead == 0)
        {
            break;
        }
        window.append(buffer.data(), bytesRead);
        remaining -= bytesRead;
    }
    CloseHandle(handle);

    // Split into complete lines. Drop a leading partial line if we started
    // mid-file (start > 0), and drop anything after the final newline (that
    // trailing fragment is picked up by the live ReadNewBytes carry-over,
    // whose offset is EOF, so it isn't lost — VRChat will terminate it).
    std::vector<std::string_view> lines;
    std::size_t lineStart = 0;
    if (start > 0)
    {
        const std::size_t firstNl = window.find('\n');
        if (firstNl == std::string::npos)
        {
            return; // Window held no complete line.
        }
        lineStart = firstNl + 1;
    }
    std::size_t nl = 0;
    while ((nl = window.find('\n', lineStart)) != std::string::npos)
    {
        std::string_view piece(window.data() + lineStart, nl - lineStart);
        if (!piece.empty() && piece.back() == '\r')
        {
            piece.remove_suffix(1);
        }
        if (!piece.empty())
        {
            lines.push_back(piece);
        }
        lineStart = nl + 1;
    }

    // Keep only the last kBackfillLines so a giant window doesn't flood the UI.
    std::size_t begin = lines.size() > kBackfillLines ? lines.size() - kBackfillLines : 0;
    for (std::size_t i = begin; i < lines.size() && !m_stop.load(); ++i)
    {
        EmitLine(lines[i], /*backfill=*/true);
    }
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

void LogTailer::EmitLine(std::string_view raw, bool backfill)
{
    LogTailLine out;
    out.source = m_currentFile.filename().string();
    out.backfill = backfill;

    // Strip the "YYYY.MM.DD HH:MM:SS Log        -  " prefix and surface its
    // timestamp + severity as separate fields. `std::regex_search` on
    // `string_view` still isn't portable with gcc/msvc in C++17, so we
    // promote to `std::string` here — the dock never sees more than a few
    // hundred lines per second so the copy is cheap.
    const auto parsed = ParseVrchatLogLine(raw);
    out.level = parsed.level;
    out.line = parsed.body;
    if (parsed.iso_time)
    {
        out.iso_time = *parsed.iso_time;
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
                if (m_pendingBackfill)
                {
                    BackfillTail();
                }
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
