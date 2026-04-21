#include "../pch.h"

#include "Pipeline.h"

#include "AuthStore.h"
#include "Common.h"
#include "VrcApi.h"

#include <chrono>
#include <memory>
#include <vector>

#include <Windows.h>
#include <winhttp.h>

#include <fmt/format.h>
#include <spdlog/spdlog.h>

#pragma comment(lib, "Winhttp.lib")

// ─────────────────────────────────────────────────────────────────────────
// Pipeline — VRChat real-time event WebSocket over WinHTTP.
//
// Design notes:
//   * WinHTTP has native WebSocket support since Windows 8 (WinHttpWebSocket*
//     family). No third-party lib needed, and we stay aligned with every
//     other HTTP path in VrcApi / UpdateChecker / PluginFeed / HwProfileFeed.
//   * VRChat closes the connection when it gets a new one for the same
//     auth cookie — so we only ever maintain one at a time. Reconnect
//     backoff is exponential (5s → 10s → 30s → 60s cap) capped at 60s;
//     an auth rejection short-circuits the loop.
//   * The inner `content` field from VRChat is a JSON *string*, not an
//     object — we parse it once here so callback consumers never see the
//     double-stringify gotcha.
// ─────────────────────────────────────────────────────────────────────────

namespace vrcsm::core
{

namespace
{

constexpr const wchar_t* kHostW = L"pipeline.vrchat.cloud";
constexpr const wchar_t* kUserAgentW = L"VRCSM/1.0";
constexpr std::size_t kReceiveBufSize = 16 * 1024; // 16 KiB per read chunk

struct WinHttpHandle
{
    HINTERNET handle{nullptr};
    WinHttpHandle() = default;
    explicit WinHttpHandle(HINTERNET h) : handle(h) {}
    ~WinHttpHandle()
    {
        if (handle != nullptr)
        {
            WinHttpCloseHandle(handle);
        }
    }
    WinHttpHandle(const WinHttpHandle&) = delete;
    WinHttpHandle& operator=(const WinHttpHandle&) = delete;
    WinHttpHandle(WinHttpHandle&& other) noexcept : handle(other.handle) { other.handle = nullptr; }
    HINTERNET get() const { return handle; }
    HINTERNET release() { HINTERNET h = handle; handle = nullptr; return h; }
    explicit operator bool() const { return handle != nullptr; }
};

// URL-encodes the bits of the auth cookie that could trip the query
// string — VRChat's cookies are base64-style and already safe for the
// URL query, but future rotations could include '+' / '/' so we encode
// defensively.
std::wstring UrlEncodeQueryValue(const std::string& raw)
{
    std::wstring out;
    out.reserve(raw.size() + 8);
    for (char c : raw)
    {
        const unsigned char uc = static_cast<unsigned char>(c);
        const bool safe =
            (uc >= 'A' && uc <= 'Z') ||
            (uc >= 'a' && uc <= 'z') ||
            (uc >= '0' && uc <= '9') ||
            uc == '-' || uc == '_' || uc == '.' || uc == '~';
        if (safe)
        {
            out.push_back(static_cast<wchar_t>(uc));
        }
        else
        {
            wchar_t buf[4]{};
            swprintf(buf, 4, L"%%%02X", uc);
            out.append(buf);
        }
    }
    return out;
}

} // namespace

Pipeline::Pipeline() = default;

Pipeline::~Pipeline()
{
    Stop();
}

void Pipeline::Start(EventCallback onEvent, StateCallback onState)
{
    if (m_running.exchange(true))
    {
        return; // already running
    }

    m_onEvent = std::move(onEvent);
    m_onState = std::move(onState);
    m_state.store(ConnState::Connecting);

    m_worker = std::thread(&Pipeline::WorkerLoop, this);
}

void Pipeline::Stop()
{
    if (!m_running.exchange(false))
    {
        return;
    }

    {
        std::lock_guard<std::mutex> lock(m_wakeMutex);
        m_wakeFlag = true;
    }
    m_wakeCv.notify_all();

    if (m_worker.joinable())
    {
        m_worker.join();
    }

    SetState(ConnState::Stopped, "");
}

void Pipeline::SetState(ConnState newState, const std::string& detail)
{
    m_state.store(newState);
    if (m_onState)
    {
        try
        {
            m_onState(newState, detail);
        }
        catch (...)
        {
        }
    }
}

void Pipeline::WorkerLoop()
{
    while (m_running.load())
    {
        if (!AuthStore::Instance().HasSession())
        {
            SetState(ConnState::Reconnecting, "no-auth");
            // Wait 30s then retry — user may be in the middle of
            // signing in and cookie shows up mid-loop.
            std::unique_lock<std::mutex> lk(m_wakeMutex);
            m_wakeCv.wait_for(lk, std::chrono::seconds(30), [this] { return m_wakeFlag || !m_running.load(); });
            m_wakeFlag = false;
            continue;
        }

        // VRChat rejects the pipeline socket if you pass the raw
        // session cookie as the query token — it requires a
        // short-lived WebSocket token from `GET /auth`. Fetch a fresh
        // one on every (re)connect; the token is one-shot.
        auto tokenRes = VrcApi::fetchPipelineToken();
        if (!isOk(tokenRes))
        {
            const auto& err = error(tokenRes);
            SetState(ConnState::Reconnecting,
                err.code == "auth_expired" ? "auth-rejected" : "token-fetch-failed");
            const int seconds = err.code == "auth_expired" ? 60 : 10;
            std::unique_lock<std::mutex> lk(m_wakeMutex);
            m_wakeCv.wait_for(lk, std::chrono::seconds(seconds), [this] { return m_wakeFlag || !m_running.load(); });
            m_wakeFlag = false;
            continue;
        }

        SetState(ConnState::Connecting, "");
        RunOneConnection(std::get<std::string>(std::move(tokenRes)));
        if (!m_running.load())
        {
            break;
        }

        // VRCX uses a flat 5s reconnect with no backoff — copy that,
        // it's what VRChat's infra is tuned for.
        SetState(ConnState::Reconnecting, "backoff-5s");
        std::unique_lock<std::mutex> lk(m_wakeMutex);
        m_wakeCv.wait_for(lk, std::chrono::seconds(5), [this] { return m_wakeFlag || !m_running.load(); });
        m_wakeFlag = false;
    }
}

bool Pipeline::RunOneConnection(const std::string& wsToken)
{
    WinHttpHandle hSession(WinHttpOpen(
        kUserAgentW,
        WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
        WINHTTP_NO_PROXY_NAME,
        WINHTTP_NO_PROXY_BYPASS,
        0));
    if (!hSession)
    {
        spdlog::warn("Pipeline: WinHttpOpen failed ({})", GetLastError());
        return false;
    }

    // 20s connect, no receive timeout — the socket should idle
    // indefinitely and only wake on data.
    WinHttpSetTimeouts(hSession.get(), 20000, 20000, 20000, 0);

    WinHttpHandle hConnect(WinHttpConnect(hSession.get(), kHostW, INTERNET_DEFAULT_HTTPS_PORT, 0));
    if (!hConnect)
    {
        spdlog::warn("Pipeline: WinHttpConnect failed ({})", GetLastError());
        return false;
    }

    // Target path: /?auth=<token>. Note the query key is `auth` (not
    // `authToken`) and the value is the short-lived token from
    // VrcApi::fetchPipelineToken() — the raw session cookie is
    // rejected at upgrade time.
    std::wstring path = L"/?auth=";
    path += UrlEncodeQueryValue(wsToken);

    WinHttpHandle hRequest(WinHttpOpenRequest(
        hConnect.get(),
        L"GET",
        path.c_str(),
        nullptr,
        WINHTTP_NO_REFERER,
        WINHTTP_DEFAULT_ACCEPT_TYPES,
        WINHTTP_FLAG_SECURE));
    if (!hRequest)
    {
        spdlog::warn("Pipeline: WinHttpOpenRequest failed ({})", GetLastError());
        return false;
    }

    // Flag the request for WS upgrade *before* sending.
    if (!WinHttpSetOption(hRequest.get(), WINHTTP_OPTION_UPGRADE_TO_WEB_SOCKET, nullptr, 0))
    {
        spdlog::warn("Pipeline: WinHttpSetOption(UPGRADE_TO_WEB_SOCKET) failed ({})", GetLastError());
        return false;
    }

    BOOL ok = WinHttpSendRequest(
        hRequest.get(),
        WINHTTP_NO_ADDITIONAL_HEADERS,
        0,
        WINHTTP_NO_REQUEST_DATA,
        0,
        0,
        0);
    if (!ok)
    {
        spdlog::warn("Pipeline: WinHttpSendRequest failed ({})", GetLastError());
        return false;
    }

    if (!WinHttpReceiveResponse(hRequest.get(), nullptr))
    {
        spdlog::warn("Pipeline: WinHttpReceiveResponse failed ({})", GetLastError());
        return false;
    }

    DWORD status = 0;
    DWORD statusSize = sizeof(status);
    WinHttpQueryHeaders(
        hRequest.get(),
        WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
        WINHTTP_HEADER_NAME_BY_INDEX,
        &status,
        &statusSize,
        WINHTTP_NO_HEADER_INDEX);

    if (status != 101)
    {
        spdlog::warn("Pipeline: upgrade rejected, HTTP {}", status);
        // 401 / 403 means the auth cookie is stale — don't thrash.
        if (status == 401 || status == 403)
        {
            SetState(ConnState::Reconnecting, "auth-rejected");
            // Stall longer on auth failure (60s) since nothing will
            // unstick us except the user signing in again.
            std::unique_lock<std::mutex> lk(m_wakeMutex);
            m_wakeCv.wait_for(lk, std::chrono::seconds(60), [this] { return m_wakeFlag || !m_running.load(); });
            m_wakeFlag = false;
        }
        return false;
    }

    WinHttpHandle hWebSocket(WinHttpWebSocketCompleteUpgrade(hRequest.get(), 0));
    if (!hWebSocket)
    {
        spdlog::warn("Pipeline: WinHttpWebSocketCompleteUpgrade failed ({})", GetLastError());
        return false;
    }

    // The request handle has served its purpose — close it so we only
    // hold the WebSocket handle for the lifetime of the connection.
    if (HINTERNET rh = hRequest.release())
    {
        WinHttpCloseHandle(rh);
    }

    spdlog::info("Pipeline: connected to pipeline.vrchat.cloud");
    SetState(ConnState::Connected, "");

    // Receive loop. VRChat frames are typically short JSON envelopes
    // well under 16 KiB, but large friend-location payloads can push
    // 32 KiB+ — accumulate across BUFFER_TYPE_*_FRAGMENT flags.
    std::vector<std::uint8_t> frame;
    frame.reserve(kReceiveBufSize);

    std::uint8_t buffer[kReceiveBufSize];
    while (m_running.load())
    {
        DWORD bytesRead = 0;
        WINHTTP_WEB_SOCKET_BUFFER_TYPE bufferType{};
        const DWORD rc = WinHttpWebSocketReceive(
            hWebSocket.get(),
            buffer,
            static_cast<DWORD>(sizeof(buffer)),
            &bytesRead,
            &bufferType);
        if (rc != NO_ERROR)
        {
            spdlog::info("Pipeline: receive ended ({})", rc);
            return false;
        }

        if (bufferType == WINHTTP_WEB_SOCKET_CLOSE_BUFFER_TYPE)
        {
            // Peer-initiated close. Drain the close payload so the
            // handle can be torn down cleanly, then exit — the worker
            // loop will decide whether to reconnect.
            USHORT closeStatus = 0;
            std::uint8_t reason[123]{};
            DWORD reasonLen = 0;
            WinHttpWebSocketQueryCloseStatus(
                hWebSocket.get(),
                &closeStatus,
                reason,
                sizeof(reason),
                &reasonLen);
            spdlog::info("Pipeline: server closed ({})", closeStatus);
            WinHttpWebSocketClose(hWebSocket.get(), WINHTTP_WEB_SOCKET_SUCCESS_CLOSE_STATUS, nullptr, 0);
            return true; // clean close → reset backoff
        }

        frame.insert(frame.end(), buffer, buffer + bytesRead);

        const bool messageComplete =
            bufferType == WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE ||
            bufferType == WINHTTP_WEB_SOCKET_BINARY_MESSAGE_BUFFER_TYPE;
        if (!messageComplete)
        {
            continue;
        }

        if (bufferType != WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE)
        {
            // VRChat never sends binary frames — ignore and reset.
            frame.clear();
            continue;
        }

        std::string text(frame.begin(), frame.end());
        frame.clear();

        try
        {
            auto envelope = nlohmann::json::parse(text);
            if (!envelope.is_object() || !envelope.contains("type"))
            {
                continue;
            }

            const std::string type = envelope.value("type", "");

            // `content` arrives stringified in every VRChat event I've
            // ever seen; but guard against the day they change it to a
            // real object.
            nlohmann::json content;
            if (envelope.contains("content"))
            {
                const auto& raw = envelope["content"];
                if (raw.is_string())
                {
                    try
                    {
                        content = nlohmann::json::parse(raw.get<std::string>());
                    }
                    catch (...)
                    {
                        content = raw;
                    }
                }
                else
                {
                    content = raw;
                }
            }

            if (m_onEvent)
            {
                try
                {
                    m_onEvent(type, content);
                }
                catch (const std::exception& ex)
                {
                    spdlog::warn("Pipeline: event callback threw: {}", ex.what());
                }
            }
        }
        catch (const std::exception& ex)
        {
            spdlog::warn("Pipeline: malformed event envelope: {}", ex.what());
        }
    }

    // m_running went false — tell the server and unwind.
    WinHttpWebSocketClose(hWebSocket.get(), WINHTTP_WEB_SOCKET_SUCCESS_CLOSE_STATUS, nullptr, 0);
    return true;
}

} // namespace vrcsm::core
