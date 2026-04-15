// Standalone self-test for vrcsm::core::LogTailer.
//
// Spawns a tailer against a temp directory, writes lines that look like
// VRChat output into a fake `output_log_*.txt`, simulates a flush/rotate,
// and verifies the callback fires with the expected level + stripped line.
//
// Exit code is the count of failed checks; 0 means clean. Emits a short
// human-readable summary to stdout so it's also useful as a "does it
// actually see lines?" smoke test from a terminal.

#include <atomic>
#include <chrono>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "core/LogEventClassifier.h"
#include "core/LogTailer.h"

namespace fs = std::filesystem;

namespace
{

struct Collector
{
    std::mutex mutex;
    std::vector<vrcsm::core::LogTailLine> lines;

    void push(const vrcsm::core::LogTailLine& line)
    {
        std::lock_guard<std::mutex> lock(mutex);
        lines.push_back(line);
    }

    std::vector<vrcsm::core::LogTailLine> snapshot()
    {
        std::lock_guard<std::mutex> lock(mutex);
        return lines;
    }
};

void appendTo(const fs::path& file, const std::string& text)
{
    // Opened in append+binary on each write so the tailer's offset-based
    // reader sees the same byte pattern VRChat produces (buffered stdio
    // would hold bytes in a per-process buffer we never flush).
    std::ofstream out(file, std::ios::app | std::ios::binary);
    out.write(text.data(), static_cast<std::streamsize>(text.size()));
}

int fail(const std::string& msg)
{
    std::cerr << "FAIL: " << msg << "\n";
    return 1;
}

} // namespace

int main()
{
    int failures = 0;

    const auto tempRoot = fs::temp_directory_path() / "vrcsm_tail_probe";
    std::error_code ec;
    fs::remove_all(tempRoot, ec);
    fs::create_directories(tempRoot);

    Collector collector;
    vrcsm::core::LogTailer tailer(tempRoot,
        [&collector](const vrcsm::core::LogTailLine& line) { collector.push(line); });

    // Case 1 — create the first log file with one existing line BEFORE the
    // tailer starts, then start. The existing line should NOT be replayed
    // (tailer seeks to EOF on switch).
    const auto fileA = tempRoot / "output_log_2026-04-15_09-00-00.txt";
    appendTo(fileA,
        "2026.04.15 09:00:01 Log        -  [Behaviour] OnPlayerJoined olderLine\r\n");

    tailer.Start();
    // Give the worker one poll cycle to pick up the file and seek to EOF.
    std::this_thread::sleep_for(std::chrono::milliseconds(1400));

    if (!collector.snapshot().empty())
    {
        failures += fail("pre-start line replayed on first read");
    }

    // Case 2 — append two lines, one Log and one Warning. Both should be
    // emitted with the prefix stripped and the right level.
    appendTo(fileA,
        "2026.04.15 09:00:02 Log        -  [Behaviour] OnPlayerLeft leftUser\r\n"
        "2026.04.15 09:00:03 Warning    -  [Behaviour] avatar hiccup\r\n");
    std::this_thread::sleep_for(std::chrono::milliseconds(1400));

    {
        const auto lines = collector.snapshot();
        if (lines.size() != 2)
        {
            failures += fail("expected 2 lines after first append, got " +
                             std::to_string(lines.size()));
        }
        else
        {
            if (lines[0].level != "info" || lines[0].line.find("OnPlayerLeft") == std::string::npos)
            {
                failures += fail("line 0 level/text mismatch: [" + lines[0].level + "] " + lines[0].line);
            }
            if (lines[0].iso_time != "2026.04.15 09:00:02")
            {
                failures += fail("line 0 iso_time mismatch: " + lines[0].iso_time);
            }
            if (lines[1].level != "warn" || lines[1].line.find("avatar hiccup") == std::string::npos)
            {
                failures += fail("line 1 level/text mismatch: [" + lines[1].level + "] " + lines[1].line);
            }
        }
    }

    // Case 3 — half-line flush. VRChat often writes partial lines; the
    // carry-over buffer should hold the partial until its newline arrives.
    appendTo(fileA, "2026.04.15 09:00:04 Log        -  partial ");
    std::this_thread::sleep_for(std::chrono::milliseconds(1400));
    const auto midCount = collector.snapshot().size();
    appendTo(fileA, "then rest\r\n");
    std::this_thread::sleep_for(std::chrono::milliseconds(1400));
    {
        const auto lines = collector.snapshot();
        if (lines.size() != midCount + 1)
        {
            failures += fail("carry-over emitted wrong count: +" +
                             std::to_string(lines.size() - midCount));
        }
        else if (lines.back().line.find("partial then rest") == std::string::npos)
        {
            failures += fail("carry-over did not reassemble: " + lines.back().line);
        }
    }

    // Case 4 — rotation. A newer `output_log_*.txt` should become the
    // active target on the next tick; lines written to the old file should
    // NOT keep being emitted. NTFS has 100ns mtime granularity so a
    // 50ms gap is plenty to get a strictly newer last_write_time.
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    const auto fileB = tempRoot / "output_log_2026-04-15_10-00-00.txt";
    appendTo(fileB, "");
    std::this_thread::sleep_for(std::chrono::milliseconds(1400));

    const auto preRotationCount = collector.snapshot().size();
    appendTo(fileB,
        "2026.04.15 10:00:01 Log        -  [Behaviour] OnPlayerJoined newSession\r\n");
    std::this_thread::sleep_for(std::chrono::milliseconds(1400));
    {
        const auto lines = collector.snapshot();
        if (lines.size() != preRotationCount + 1)
        {
            failures += fail("rotation emitted wrong count: +" +
                             std::to_string(lines.size() - preRotationCount));
        }
        else if (lines.back().source != fileB.filename().string())
        {
            failures += fail("rotation source mismatch: " + lines.back().source);
        }
    }

    // Case 5 — stop must join the worker and stop producing events.
    tailer.Stop();
    const auto afterStop = collector.snapshot().size();
    appendTo(fileB,
        "2026.04.15 10:00:99 Log        -  [Behaviour] ignored after stop\r\n");
    std::this_thread::sleep_for(std::chrono::milliseconds(1400));
    if (collector.snapshot().size() != afterStop)
    {
        failures += fail("tailer still emitting after Stop()");
    }

    // Case 6 — classifier smoke tests. These are independent of LogTailer
    // but we run them from the same harness so one binary covers the full
    // live-tail chain. Each case constructs a `LogTailLine` by hand with
    // the prefix already stripped (that's what LogTailer hands the
    // classifier in production) and asserts the classified JSON carries
    // the right `kind` + `data` fields.
    {
        using vrcsm::core::LogTailLine;
        using vrcsm::core::ClassifyStreamLine;

        auto lineOf = [](std::string body, std::string iso) {
            LogTailLine l;
            l.line = std::move(body);
            l.level = "info";
            l.iso_time = std::move(iso);
            l.source = "synthetic.txt";
            return l;
        };

        auto joined = ClassifyStreamLine(lineOf(
            "[Behaviour] OnPlayerJoined Alice (usr_11111111-2222-3333-4444-555555555555)",
            "2026.04.15 12:00:01"));
        if (joined.is_null() || joined.value("kind", "") != "player"
            || joined["data"].value("kind", "") != "joined"
            || joined["data"].value("display_name", "") != "Alice"
            || joined["data"].value("user_id", "") != "usr_11111111-2222-3333-4444-555555555555")
        {
            failures += fail("classifier: OnPlayerJoined mismatch: " + joined.dump());
        }

        auto left = ClassifyStreamLine(lineOf(
            "[Behaviour] OnPlayerLeft Bob", "2026.04.15 12:00:02"));
        if (left.is_null() || left.value("kind", "") != "player"
            || left["data"].value("kind", "") != "left"
            || left["data"].value("display_name", "") != "Bob")
        {
            failures += fail("classifier: OnPlayerLeft mismatch: " + left.dump());
        }

        auto swap = ClassifyStreamLine(lineOf(
            "[Behaviour] Switching Alice to avatar CoolRobot",
            "2026.04.15 12:00:03"));
        if (swap.is_null() || swap.value("kind", "") != "avatarSwitch"
            || swap["data"].value("actor", "") != "Alice"
            || swap["data"].value("avatar_name", "") != "CoolRobot")
        {
            failures += fail("classifier: Switching mismatch: " + swap.dump());
        }

        auto shot = ClassifyStreamLine(lineOf(
            "[VRC Camera] Took screenshot to: C:\\Users\\x\\Pictures\\VRChat\\2026-04\\pic.png",
            "2026.04.15 12:00:04"));
        if (shot.is_null() || shot.value("kind", "") != "screenshot"
            || shot["data"].value("path", "").find("pic.png") == std::string::npos)
        {
            failures += fail("classifier: screenshot mismatch: " + shot.dump());
        }

        auto noise = ClassifyStreamLine(lineOf(
            "[UIManager] some Udon chatter", "2026.04.15 12:00:05"));
        if (!noise.is_null())
        {
            failures += fail("classifier: noise line misclassified: " + noise.dump());
        }
    }

    // Human summary
    std::cout << "tail_probe: " << collector.snapshot().size() << " lines observed\n";
    for (const auto& line : collector.snapshot())
    {
        std::cout << "  [" << line.level << "] " << line.iso_time << " | "
                  << line.line << " (" << line.source << ")\n";
    }

    if (failures == 0)
    {
        std::cout << "tail_probe: OK\n";
    }
    else
    {
        std::cout << "tail_probe: " << failures << " failure(s)\n";
    }

    // Cleanup
    fs::remove_all(tempRoot, ec);
    return failures;
}
