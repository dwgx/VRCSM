#pragma once

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <mutex>
#include <string>
#include <string_view>
#include <thread>

namespace vrcsm::core
{

/// One line emitted by the tailer as VRChat flushes it to disk. `line` is the
/// message text with the `YYYY.MM.DD HH:MM:SS Log        -  ` prefix stripped
/// off, UTF-8, no trailing newline. `iso_time` is the VRChat-supplied stamp
/// from that prefix (empty on continuation lines like stack traces that don't
/// repeat the stamp). `level` is `info` / `warn` / `error`, mapped from
/// VRChat's `Log` / `Warning` / `Error` severity field. `source` is just the
/// basename of the current log file so the UI can label or filter by session.
struct LogTailLine
{
    std::string line;
    std::string level;
    std::string iso_time;
    std::string source;
};

/// Follow VRChat's newest `output_log_*.txt` the same way VRCX's LogWatcher.cs
/// does: a background thread wakes up roughly once per second, opens the
/// latest file with `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE`
/// (so we don't fight VRChat's own handle), reads from the remembered byte
/// offset to EOF, splits on `\n`, and fires the callback once per complete
/// line. Anything past the final newline stays in a carry-over buffer for the
/// next tick — VRChat flushes mid-line constantly, so a naive splitter would
/// emit partial lines.
///
/// When a newer `output_log_*.txt` appears (VRChat launched a new session),
/// the tailer switches files on the next tick, resets the offset, and
/// resumes.
///
/// Why not FileSystemWatcher: VRChat writes the log buffered, so change
/// notifications fire on flush rather than on append — you miss real events
/// and get phantoms on rotation. VRCX hit this and left a terse
/// `// FileSystemWatcher() is unreliable` at the top of LogWatcher.cs. Poll
/// every second, like they do.
///
/// Start semantics: on the first tick we seek to EOF of the current file so
/// the dock doesn't get spammed with historical content — the batch LogParser
/// handles history, this class handles "new since you opened the panel".
///
/// `Stop()` is synchronous: it signals the worker, joins it, and clears
/// internal state, so it's safe to destruct immediately after.
class LogTailer
{
public:
    using Callback = std::function<void(const LogTailLine&)>;

    LogTailer(std::filesystem::path logDir, Callback callback);
    ~LogTailer();

    LogTailer(const LogTailer&) = delete;
    LogTailer& operator=(const LogTailer&) = delete;

    void Start();
    void Stop();

    bool Running() const noexcept { return m_running.load(); }

private:
    void Run();
    std::filesystem::path FindLatestLog() const;
    void OnFileSwitched(const std::filesystem::path& path);
    void ReadNewBytes();
    void EmitLine(std::string_view raw);

    std::filesystem::path m_logDir;
    Callback m_callback;

    std::thread m_thread;
    std::atomic<bool> m_running{false};
    std::atomic<bool> m_stop{false};
    std::mutex m_wakeMutex;
    std::condition_variable m_wake;

    std::filesystem::path m_currentFile;
    std::uint64_t m_offset{0};
    std::string m_carryover;
};

} // namespace vrcsm::core
