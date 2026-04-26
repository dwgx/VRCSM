#pragma once

#include <atomic>
#include <condition_variable>
#include <functional>
#include <mutex>
#include <string>
#include <thread>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

// VRChat Pipeline WebSocket client.
//
// Connects to `wss://pipeline.vrchat.cloud/?authToken=<AUTH_COOKIE>` and
// surfaces every event VRChat pushes to the logged-in user in real time:
// friend presence flips (online/offline/active/location), friend-add /
// friend-delete, notifications (invite, friendRequest, message), and
// self user-update.
//
// Event envelope from VRChat is `{type, content}` where `content` is a
// *stringified* JSON blob — we parse it once here so callers get a real
// JSON object rather than a string to parse again.
//
// The client owns a single background thread that wraps WinHTTP's
// native WebSocket upgrade path (no third-party WS library required).
// Disconnects trigger an exponential-backoff reconnect (5s → 10s → 30s →
// 60s cap) until `Stop()` or a fatal auth error.
class Pipeline
{
public:
    enum class ConnState
    {
        Stopped,
        Connecting,
        Connected,
        Reconnecting,
    };

    // Called off the pipeline thread for every successfully-decoded event.
    // `type` is the VRChat event name (e.g. "friend-online"); `content` is
    // the parsed inner JSON (may be null for events with no body).
    using EventCallback = std::function<void(const std::string& type, const nlohmann::json& content)>;

    // Called off the pipeline thread whenever the connection state changes.
    // Intentionally separate from EventCallback so the UI can surface a
    // "reconnecting" toast without inventing a synthetic event type.
    using StateCallback = std::function<void(ConnState state, const std::string& detail)>;

    Pipeline();
    ~Pipeline();

    Pipeline(const Pipeline&) = delete;
    Pipeline& operator=(const Pipeline&) = delete;

    // Starts the worker thread. The thread reads the current auth cookie
    // from AuthStore on each (re)connect attempt — rotating credentials or
    // logging in mid-session will naturally pick up the new cookie on the
    // next reconnect cycle. Safe to call multiple times; subsequent calls
    // are no-ops while the worker is alive.
    void Start(EventCallback onEvent, StateCallback onState);

    // Signals the worker to shut down, closes the WebSocket, and joins.
    // Idempotent. Holds the caller until the thread is gone.
    void Stop();

    bool IsRunning() const { return m_running.load(); }
    ConnState State() const { return m_state.load(); }

private:
    void WorkerLoop();
    bool RunOneConnection(const std::string& wsToken);
    void SetState(ConnState newState, const std::string& detail);

    EventCallback m_onEvent;
    StateCallback m_onState;

    std::thread m_worker;
    std::atomic<bool> m_running{false};
    std::atomic<ConnState> m_state{ConnState::Stopped};

    // Guards the condition_variable used to interrupt the reconnect
    // backoff sleep when Stop() is called.
    std::mutex m_wakeMutex;
    std::condition_variable m_wakeCv;
    bool m_wakeFlag{false};

    // Active WebSocket handle, owned by the worker thread but exposed to
    // Stop() so it can interrupt a blocking WinHttpWebSocketReceive() that
    // would otherwise pin the worker forever during shutdown. Holds an
    // HINTERNET cast to void* so Pipeline.h doesn't need <wininet.h>.
    std::mutex m_activeSocketMutex;
    void* m_activeSocket{nullptr};
};

} // namespace vrcsm::core
