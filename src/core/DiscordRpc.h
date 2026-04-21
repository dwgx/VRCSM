#pragma once

#include <atomic>
#include <condition_variable>
#include <mutex>
#include <string>
#include <thread>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

// Discord Rich Presence client over the local IPC named pipe.
//
// Connects to `\\.\pipe\discord-ipc-0` (falling back to -1..-9 if the
// first is busy), performs the v1 handshake with a VRCSM-owned
// application id, then pushes SET_ACTIVITY frames with whatever the
// caller provides.
//
// The class is designed to be fire-and-forget: `Start()` spawns a
// worker thread that reconnects on Discord restart, and
// `SetActivity(json)` just replaces the current presence snapshot —
// the worker thread sends it the next chance it gets. `ClearActivity()`
// sends an empty activity which hides the presence panel.
//
// Failure modes (Discord not running, pipe not reachable, handshake
// rejected) are all silent: we back off and retry every 30s without
// ever raising to the caller. The integration is purely decorative so
// a disabled / uninstalled Discord client should never be visible to
// the rest of the app.
class DiscordRpc
{
public:
    DiscordRpc();
    ~DiscordRpc();

    DiscordRpc(const DiscordRpc&) = delete;
    DiscordRpc& operator=(const DiscordRpc&) = delete;

    // Configure the application id (Discord developer portal). Call before
    // Start(); changes after Start() are ignored until a restart.
    void SetClientId(std::string clientId);

    void Start();
    void Stop();

    // Queue a new presence snapshot. Fields map to Discord's Activity
    // schema — state, details, timestamps (start/end unix seconds),
    // assets (large_image/text/small_image/text), party (id, size[2]),
    // buttons[] (label, url). Empty object ⇒ clear presence.
    void SetActivity(nlohmann::json activity);

    // Equivalent to SetActivity({}). Hides the presence panel in Discord.
    void ClearActivity();

    bool IsConnected() const { return m_connected.load(); }

private:
    void WorkerLoop();
    bool TryConnect();
    bool DoHandshake();
    bool SendActivityIfDirty();
    bool WriteFrame(std::uint32_t opcode, const std::string& payload);
    bool ReadFrame(std::uint32_t& opcode, std::string& payload);
    void CloseHandle();

    std::string m_clientId;

    std::thread m_worker;
    std::atomic<bool> m_running{false};
    std::atomic<bool> m_connected{false};

    std::mutex m_activityMutex;
    nlohmann::json m_activity;
    bool m_activityDirty{false};

    std::mutex m_wakeMutex;
    std::condition_variable m_wakeCv;
    bool m_wakeFlag{false};

    // Opaque HANDLE — kept as a void* so this header doesn't pull in
    // Windows.h. The .cpp reinterpret_casts at the boundary.
    void* m_pipe{nullptr};
};

} // namespace vrcsm::core
