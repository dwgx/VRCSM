#pragma once

#include <cstdint>
#include <functional>
#include <optional>
#include <string>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

struct ProcessStatus
{
    bool running = false;
    std::optional<std::uint32_t> pid;
};

void to_json(nlohmann::json& j, const ProcessStatus& s);

class ProcessGuard
{
public:
    static ProcessStatus IsVRChatRunning();

    static ProcessStatus checkProcess(const std::wstring& exeName);

    /// Background watcher that polls `IsVRChatRunning()` once per second
    /// and fires `callback` only when the status transitions (start /
    /// stop / pid change). Replaces the old pattern of the frontend
    /// polling a `process.vrcRunning` IPC every 5 seconds: detection is
    /// now ~1s instead of ~5s, and there is zero round-trip overhead on
    /// ticks where nothing changed.
    ///
    /// Calling `StartWatcher` a second time replaces the existing
    /// callback — there is only ever one background thread. `StopWatcher`
    /// is idempotent and safe to call from any thread.
    using StatusCallback = std::function<void(const ProcessStatus&)>;
    static void StartWatcher(StatusCallback callback);
    static void StopWatcher();
};

} // namespace vrcsm::core
