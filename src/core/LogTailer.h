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
    /// True for lines replayed from the tail of an already-existing log on
    /// first attach (see `OnFileSwitched`). Consumers should surface these in
    /// a raw console/dock view for immediate history, but must NOT feed them
    /// into live/stateful panels or re-persist them — the batch `LogParser`
    /// already owns history for the current session.
    bool backfill{false};
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
/// Start semantics: on the first tick we replay the last `kBackfillLines`
/// lines of the current file (marked `backfill=true`) so a panel opened while
/// VRChat is already running shows immediate history instead of a blank view,
/// then continue tailing from EOF for genuinely-new lines. Backfilled lines
/// are flagged so stateful consumers can ignore them — the batch LogParser
/// still owns structured session history; this replay is purely so the raw
/// console/GameLog dock isn't empty until the next append.
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
    void BackfillTail();
    void ReadNewBytes();
    void EmitLine(std::string_view raw, bool backfill = false);

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
    // True for the very first file we attach to. After that, every
    // OnFileSwitched is a VRChat log rotation: start that new file at
    // byte 0 instead of EOF so we don't lose the lines written between
    // file creation and the next 1-second poll.
    bool m_attachedOnce{false};
    // Set on first attach to an existing file; consumed by the first
    // ReadNewBytes tick to replay the tail before live-tailing continues.
    bool m_pendingBackfill{false};
};

} // namespace vrcsm::core
