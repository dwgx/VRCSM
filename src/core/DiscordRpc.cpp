#include "../pch.h"

#include "DiscordRpc.h"

#include "Common.h"

#include <chrono>
#include <cstdint>
#include <cstring>

#include <Windows.h>

#include <fmt/format.h>
#include <spdlog/spdlog.h>

// ─────────────────────────────────────────────────────────────────────────
// DiscordRpc — Windows Named Pipe client for Discord's local RPC gateway.
//
// Protocol is well-documented via the `discord-rpc` C library; the four
// things worth remembering here:
//
//   1. Pipe path is `\\.\pipe\discord-ipc-N` for N in 0..9 — Discord picks
//      the lowest-N pipe that isn't already taken by another running
//      Discord instance. Client tries them in order and picks the first
//      that CreateFile succeeds on.
//   2. Frame is 4 bytes opcode (uint32 LE) + 4 bytes length (uint32 LE)
//      + JSON payload UTF-8. Opcodes: 0 HANDSHAKE, 1 FRAME, 2 CLOSE,
//      3 PING, 4 PONG.
//   3. First message is a HANDSHAKE with `{"v": 1, "client_id": "<app>"}`.
//      Server replies with opcode 1 carrying `{cmd:"DISPATCH", evt:"READY"}`
//      once the connection is live. Any ERROR dispatch means the
//      handshake was rejected — don't retry on the same pipe.
//   4. SET_ACTIVITY is `{cmd:"SET_ACTIVITY", args:{pid, activity}, nonce}`
//      via opcode 1. Clearing presence is the same shape with `activity`
//      omitted or null.
// ─────────────────────────────────────────────────────────────────────────

namespace vrcsm::core
{

namespace
{

constexpr std::uint32_t kOpHandshake = 0;
constexpr std::uint32_t kOpFrame     = 1;
constexpr std::uint32_t kOpClose     = 2;
constexpr std::uint32_t kOpPing      = 3;
constexpr std::uint32_t kOpPong      = 4;

constexpr std::size_t kMaxFrame = 64 * 1024;

// Generate a short random nonce. Discord doesn't require UUIDs, just
// something unique per request so server responses can be paired — a
// tick-count + counter is plenty for our fire-and-forget usage.
std::string MakeNonce()
{
    static std::atomic<std::uint64_t> counter{0};
    const auto tick = GetTickCount64();
    const auto id = counter.fetch_add(1, std::memory_order_relaxed);
    return fmt::format("vrcsm-{}-{}", tick, id);
}

// Write a little-endian uint32 into a byte buffer.
void WriteLe32(std::uint8_t* dst, std::uint32_t v)
{
    dst[0] = static_cast<std::uint8_t>(v & 0xff);
    dst[1] = static_cast<std::uint8_t>((v >> 8) & 0xff);
    dst[2] = static_cast<std::uint8_t>((v >> 16) & 0xff);
    dst[3] = static_cast<std::uint8_t>((v >> 24) & 0xff);
}

std::uint32_t ReadLe32(const std::uint8_t* src)
{
    return static_cast<std::uint32_t>(src[0]) |
           (static_cast<std::uint32_t>(src[1]) << 8) |
           (static_cast<std::uint32_t>(src[2]) << 16) |
           (static_cast<std::uint32_t>(src[3]) << 24);
}

} // namespace

DiscordRpc::DiscordRpc() = default;

DiscordRpc::~DiscordRpc()
{
    Stop();
}

void DiscordRpc::SetClientId(std::string clientId)
{
    // Guarded only against casual racing; the class contract says this
    // must happen before Start() so no extra synchronisation is needed.
    m_clientId = std::move(clientId);
}

void DiscordRpc::Start()
{
    if (m_running.exchange(true))
    {
        return;
    }
    m_worker = std::thread(&DiscordRpc::WorkerLoop, this);
}

void DiscordRpc::Stop()
{
    if (!m_running.exchange(false))
    {
        return;
    }

    {
        std::lock_guard<std::mutex> lk(m_wakeMutex);
        m_wakeFlag = true;
    }
    m_wakeCv.notify_all();

    // Close the pipe handle so a blocked ReadFrame returns immediately.
    CloseHandle();

    if (m_worker.joinable())
    {
        m_worker.join();
    }
}

void DiscordRpc::SetActivity(nlohmann::json activity)
{
    {
        std::lock_guard<std::mutex> lk(m_activityMutex);
        m_activity = std::move(activity);
        m_activityDirty = true;
    }
    {
        std::lock_guard<std::mutex> lk(m_wakeMutex);
        m_wakeFlag = true;
    }
    m_wakeCv.notify_all();
}

void DiscordRpc::ClearActivity()
{
    SetActivity(nlohmann::json::object());
}

void DiscordRpc::CloseHandle()
{
    HANDLE h = static_cast<HANDLE>(m_pipe);
    if (h != nullptr && h != INVALID_HANDLE_VALUE)
    {
        ::CloseHandle(h);
        m_pipe = nullptr;
    }
    m_connected.store(false);
}

bool DiscordRpc::TryConnect()
{
    if (m_clientId.empty())
    {
        return false;
    }

    for (int i = 0; i < 10; ++i)
    {
        const std::wstring path = toWide(fmt::format("\\\\.\\pipe\\discord-ipc-{}", i));
        HANDLE h = CreateFileW(
            path.c_str(),
            GENERIC_READ | GENERIC_WRITE,
            0,
            nullptr,
            OPEN_EXISTING,
            0,
            nullptr);
        if (h != INVALID_HANDLE_VALUE)
        {
            m_pipe = h;
            return true;
        }

        const DWORD err = GetLastError();
        if (err != ERROR_FILE_NOT_FOUND && err != ERROR_PIPE_BUSY)
        {
            spdlog::debug("DiscordRpc: CreateFile {} failed ({})", i, err);
        }
    }
    return false;
}

bool DiscordRpc::WriteFrame(std::uint32_t opcode, const std::string& payload)
{
    HANDLE h = static_cast<HANDLE>(m_pipe);
    if (h == nullptr || h == INVALID_HANDLE_VALUE)
    {
        return false;
    }

    if (payload.size() > kMaxFrame)
    {
        spdlog::warn("DiscordRpc: payload too large ({})", payload.size());
        return false;
    }

    std::uint8_t header[8];
    WriteLe32(header, opcode);
    WriteLe32(header + 4, static_cast<std::uint32_t>(payload.size()));

    DWORD written = 0;
    if (!WriteFile(h, header, sizeof(header), &written, nullptr) || written != sizeof(header))
    {
        return false;
    }
    if (!payload.empty())
    {
        if (!WriteFile(h, payload.data(), static_cast<DWORD>(payload.size()), &written, nullptr) ||
            written != payload.size())
        {
            return false;
        }
    }
    return true;
}

bool DiscordRpc::ReadFrame(std::uint32_t& opcode, std::string& payload)
{
    HANDLE h = static_cast<HANDLE>(m_pipe);
    if (h == nullptr || h == INVALID_HANDLE_VALUE)
    {
        return false;
    }

    std::uint8_t header[8];
    DWORD read = 0;
    if (!ReadFile(h, header, sizeof(header), &read, nullptr) || read != sizeof(header))
    {
        return false;
    }
    opcode = ReadLe32(header);
    const std::uint32_t length = ReadLe32(header + 4);
    if (length > kMaxFrame)
    {
        spdlog::warn("DiscordRpc: frame too large ({})", length);
        return false;
    }

    payload.assign(length, '\0');
    if (length > 0)
    {
        if (!ReadFile(h, payload.data(), length, &read, nullptr) || read != length)
        {
            return false;
        }
    }
    return true;
}

bool DiscordRpc::DoHandshake()
{
    const nlohmann::json hs{
        {"v", 1},
        {"client_id", m_clientId},
    };
    if (!WriteFrame(kOpHandshake, hs.dump()))
    {
        return false;
    }

    std::uint32_t op = 0;
    std::string body;
    if (!ReadFrame(op, body))
    {
        return false;
    }

    if (op != kOpFrame)
    {
        spdlog::warn("DiscordRpc: handshake got opcode {}", op);
        return false;
    }

    try
    {
        const auto doc = nlohmann::json::parse(body);
        const auto evt = doc.value("evt", "");
        if (evt == "READY")
        {
            return true;
        }
        if (evt == "ERROR")
        {
            spdlog::warn("DiscordRpc: handshake rejected: {}", body);
            return false;
        }
    }
    catch (const std::exception& ex)
    {
        spdlog::warn("DiscordRpc: handshake parse error: {}", ex.what());
        return false;
    }
    return false;
}

bool DiscordRpc::SendActivityIfDirty()
{
    nlohmann::json activity;
    bool dirty = false;
    {
        std::lock_guard<std::mutex> lk(m_activityMutex);
        dirty = m_activityDirty;
        if (dirty)
        {
            activity = m_activity;
            m_activityDirty = false;
        }
    }
    if (!dirty)
    {
        return true;
    }

    nlohmann::json args{{"pid", static_cast<std::int64_t>(GetCurrentProcessId())}};
    if (!activity.empty() && activity.is_object())
    {
        args["activity"] = std::move(activity);
    }
    else
    {
        // Empty object clears the presence panel.
        args["activity"] = nullptr;
    }

    const nlohmann::json frame{
        {"cmd", "SET_ACTIVITY"},
        {"args", args},
        {"nonce", MakeNonce()},
    };

    if (!WriteFrame(kOpFrame, frame.dump()))
    {
        return false;
    }

    // Drain one response — Discord echoes the SET_ACTIVITY ack back on
    // opcode 1. We don't care about the contents, just that the pipe
    // is still alive after the write.
    std::uint32_t op = 0;
    std::string body;
    if (!ReadFrame(op, body))
    {
        return false;
    }
    return true;
}

void DiscordRpc::WorkerLoop()
{
    while (m_running.load())
    {
        if (!TryConnect() || !DoHandshake())
        {
            CloseHandle();

            // Discord isn't running or the handshake failed (bad
            // client_id, blocked user). Wait 30s then retry — if the
            // user starts Discord mid-session we'll pick it up
            // without restart.
            std::unique_lock<std::mutex> lk(m_wakeMutex);
            m_wakeCv.wait_for(lk, std::chrono::seconds(30),
                              [this] { return m_wakeFlag || !m_running.load(); });
            m_wakeFlag = false;
            continue;
        }

        m_connected.store(true);
        spdlog::info("DiscordRpc: connected");

        // Force an initial SET_ACTIVITY so the currently-configured
        // presence (if any) surfaces immediately after (re)connect.
        {
            std::lock_guard<std::mutex> lk(m_activityMutex);
            if (!m_activity.empty())
            {
                m_activityDirty = true;
            }
        }

        while (m_running.load())
        {
            if (!SendActivityIfDirty())
            {
                break;
            }

            std::unique_lock<std::mutex> lk(m_wakeMutex);
            m_wakeCv.wait_for(lk, std::chrono::seconds(15),
                              [this] { return m_wakeFlag || !m_running.load(); });
            m_wakeFlag = false;
        }

        CloseHandle();
    }
}

} // namespace vrcsm::core
