#pragma once

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <mutex>
#include <string>
#include <thread>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

// Placeholder Discord application id. There is intentionally NO real
// snowflake baked in: shipping a published VRCSM app id is a project
// decision and inventing one here would surface a generic / wrong app
// in users' Discord. The empty default keeps the integration
// flag-gated-dark — DiscordRpc refuses to connect with an empty id and
// the frontend requires the user to paste their own id from
// https://discord.com/developers/applications.
//
// TODO(wave3): replace with the official VRCSM Discord application id
// once one is registered, then make it the fallback when the user has
// not supplied their own. Until then this stays empty by design.
constexpr const char* kDiscordPlaceholderClientId = "";

// ── Pure framing / payload helpers (no pipe, unit-testable) ──────────────
// These are split out from the I/O path so the wire format can be tested
// without a live Discord pipe (tests/CommonTests.cpp).

// Encode one IPC frame: [opcode u32 LE][length u32 LE][payload bytes].
// Returns the full byte string ready to write to the pipe.
std::string EncodeFrame(std::uint32_t opcode, const std::string& payload);

// Decode the 8-byte frame header. Returns false if `header` is shorter
// than 8 bytes; otherwise fills opcode + length.
bool DecodeFrameHeader(const std::string& header, std::uint32_t& opcode, std::uint32_t& length);

// Build the SET_ACTIVITY command JSON Discord expects on opcode FRAME.
// An empty / non-object `activity` yields `args.activity = null` (which
// clears the presence panel). `nonce` is passed through verbatim so the
// builder stays deterministic for tests.
nlohmann::json BuildSetActivityPayload(std::int64_t pid, const nlohmann::json& activity, const std::string& nonce);

// Build the v1 handshake JSON: {"v":1,"client_id":"<id>"}.
nlohmann::json BuildHandshakePayload(const std::string& clientId);

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
