#include "LyricsProxy.h"

#include "Common.h"

#include <array>
#include <cctype>
#include <cstdint>
#include <string>
#include <vector>

#include <Windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <winhttp.h>

#include <fmt/format.h>
#include <spdlog/spdlog.h>

#pragma comment(lib, "Winhttp.lib")
#pragma comment(lib, "Ws2_32.lib")

// ─────────────────────────────────────────────────────────────────────────
// LyricsProxy — a small standalone WinHTTP GET used by the web lyrics chain
// to reach NetEase / LRCLIB without WebView2's CORS/Referer restrictions.
//
// Intentionally independent of VrcApi.cpp (parked). Mirrors the WinHttpHandle
// RAII wrapper + Open/Connect/OpenRequest/SendRequest/ReceiveResponse + body
// drain pattern from Pipeline.cpp, but this is a plain HTTPS GET (no WebSocket
// upgrade). Follows redirects, bounds itself with ~8s timeouts, and never
// throws — every failure is reported through LyricsFetchResult::error.
// ─────────────────────────────────────────────────────────────────────────

namespace vrcsm::core
{

namespace
{

constexpr const wchar_t* kUserAgentW =
    L"Mozilla/5.0 (Windows NT 10.0; Win64; x64) VRCSM-LyricsProxy/1.0";
constexpr int kTimeoutMs = 8000;              // resolve/connect/send/receive
constexpr std::size_t kReadChunk = 16 * 1024; // per-read buffer

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
    explicit operator bool() const { return handle != nullptr; }
};

std::string ToLowerAscii(const std::string& in)
{
    std::string out(in);
    for (auto& c : out)
    {
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }
    return out;
}

// Parse "a.b.c.d" into four octets. Returns false when the string is not a
// dotted-quad IPv4 literal (so hostnames fall through and are allowed).
bool ParseIPv4(const std::string& host, std::array<int, 4>& octets)
{
    int parts = 0;
    std::size_t i = 0;
    while (parts < 4)
    {
        if (i >= host.size() || !std::isdigit(static_cast<unsigned char>(host[i])))
        {
            return false;
        }
        int value = 0;
        std::size_t digits = 0;
        while (i < host.size() && std::isdigit(static_cast<unsigned char>(host[i])))
        {
            value = value * 10 + (host[i] - '0');
            ++i;
            ++digits;
            if (value > 255 || digits > 3)
            {
                return false;
            }
        }
        octets[static_cast<std::size_t>(parts)] = value;
        ++parts;
        if (parts < 4)
        {
            if (i >= host.size() || host[i] != '.')
            {
                return false;
            }
            ++i; // consume '.'
        }
    }
    return i == host.size();
}

// Reject a Referer that carries CR/LF — otherwise a caller-supplied value
// could inject/split additional WinHTTP request headers (header-injection).
bool HasHeaderCrlf(const std::string& value)
{
    return value.find('\r') != std::string::npos
        || value.find('\n') != std::string::npos;
}

} // namespace

bool IsBlockedProxyHost(const std::string& hostRaw)
{
    if (hostRaw.empty())
    {
        return true;
    }

    // Tolerate IPv6 bracket wrappers: "[::1]" → "::1".
    std::string host = hostRaw;
    if (host.size() >= 2 && host.front() == '[' && host.back() == ']')
    {
        host = host.substr(1, host.size() - 2);
    }
    host = ToLowerAscii(host);

    if (host == "localhost")
    {
        return true;
    }

    // IPv6 loopback / unspecified. Also treat IPv4-mapped loopback forms.
    if (host == "::1" || host == "::" || host == "0.0.0.0")
    {
        return true;
    }
    if (host.rfind("::ffff:", 0) == 0)
    {
        // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) — re-check the tail.
        return IsBlockedProxyHost(host.substr(7));
    }
    // Any IPv6 link-local (fe80::/10) is off-limits.
    if (host.rfind("fe80:", 0) == 0)
    {
        return true;
    }

    std::array<int, 4> ip{};
    if (ParseIPv4(host, ip))
    {
        // 127.0.0.0/8 loopback
        if (ip[0] == 127) return true;
        // 10.0.0.0/8 private
        if (ip[0] == 10) return true;
        // 192.168.0.0/16 private
        if (ip[0] == 192 && ip[1] == 168) return true;
        // 172.16.0.0/12 private (172.16 – 172.31)
        if (ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31) return true;
        // 169.254.0.0/16 link-local
        if (ip[0] == 169 && ip[1] == 254) return true;
        // 0.0.0.0/8 "this host"
        if (ip[0] == 0) return true;
    }

    return false;
}

namespace
{

// Resolve `host` and return true if ANY resolved address is a loopback /
// private / link-local target the proxy must refuse. This closes the DNS
// bypass where a public name (e.g. "localtest.me") resolves to 127.0.0.1 and
// slips past the literal-host filter. On resolution FAILURE we return false
// (allow): a corporate/proxied setup where direct getaddrinfo fails but the
// WinHTTP proxy can still reach the public host must not be broken, and the
// SSRF attack itself requires a successful resolution to an internal address.
bool ResolvesToBlockedAddress(const std::string& host)
{
    // A bare IP literal was already handled by IsBlockedProxyHost; only names
    // reach a meaningful resolution here, but running getaddrinfo on a literal
    // is harmless and still re-checks it.
    addrinfo hints{};
    hints.ai_family = AF_UNSPEC;    // both A and AAAA
    hints.ai_socktype = SOCK_STREAM;

    addrinfo* results = nullptr;
    const int rc = getaddrinfo(host.c_str(), nullptr, &hints, &results);
    if (rc != 0 || results == nullptr)
    {
        return false; // resolution failed — allow (see note above)
    }

    bool blocked = false;
    for (addrinfo* ai = results; ai != nullptr && !blocked; ai = ai->ai_next)
    {
        char buf[INET6_ADDRSTRLEN]{};
        if (ai->ai_family == AF_INET)
        {
            auto* sa = reinterpret_cast<sockaddr_in*>(ai->ai_addr);
            if (inet_ntop(AF_INET, &sa->sin_addr, buf, sizeof(buf)) != nullptr)
            {
                blocked = IsBlockedProxyHost(buf);
            }
        }
        else if (ai->ai_family == AF_INET6)
        {
            auto* sa = reinterpret_cast<sockaddr_in6*>(ai->ai_addr);
            if (inet_ntop(AF_INET6, &sa->sin6_addr, buf, sizeof(buf)) != nullptr)
            {
                blocked = IsBlockedProxyHost(buf);
            }
        }
    }

    freeaddrinfo(results);
    return blocked;
}

} // namespace

LyricsFetchResult LyricsFetch(const std::string& url, const std::string& referer)
{
    LyricsFetchResult result;

    if (url.empty())
    {
        result.error = "empty url";
        return result;
    }

    // SSRF/header-injection rail: a Referer with embedded CR/LF could split or
    // inject additional request headers on the off-box HTTPS request.
    if (HasHeaderCrlf(referer))
    {
        result.error = "blocked: referer contains control characters";
        return result;
    }

    const std::wstring wideUrl = toWide(url);

    // Crack the URL into components so we can pull scheme/host/path.
    URL_COMPONENTS uc{};
    uc.dwStructSize = sizeof(uc);
    wchar_t hostBuf[256]{};
    wchar_t pathBuf[4096]{};
    uc.lpszHostName = hostBuf;
    uc.dwHostNameLength = static_cast<DWORD>(std::size(hostBuf));
    uc.lpszUrlPath = pathBuf;
    uc.dwUrlPathLength = static_cast<DWORD>(std::size(pathBuf));
    // Extra info (query string / fragment) is contiguous with the path when we
    // leave lpszExtraInfo null and dwUrlPathLength spans the remainder.

    if (!WinHttpCrackUrl(wideUrl.c_str(), 0, 0, &uc))
    {
        result.error = fmt::format("WinHttpCrackUrl failed ({})", GetLastError());
        return result;
    }

    // SSRF rail: https only.
    if (uc.nScheme != INTERNET_SCHEME_HTTPS)
    {
        result.error = "blocked: only https is permitted";
        return result;
    }

    const std::wstring hostW(uc.lpszHostName, uc.dwHostNameLength);
    const std::string hostUtf8(hostW.begin(), hostW.end());

    // SSRF rail: refuse loopback / link-local / private-range literal hosts.
    if (IsBlockedProxyHost(hostUtf8))
    {
        result.error = fmt::format("blocked: host '{}' is not allowed", hostUtf8);
        return result;
    }

    // SSRF rail (DNS bypass): a public NAME that resolves to a private/loopback
    // address (DNS-rebind style) passes the literal-host filter above but must
    // still be refused. Resolution failure is allowed (proxied setups).
    if (ResolvesToBlockedAddress(hostUtf8))
    {
        result.error = fmt::format("blocked: host '{}' resolves to a private address", hostUtf8);
        return result;
    }

    // Path + query. WinHttpCrackUrl leaves the query contiguous with the path
    // in pathBuf because lpszExtraInfo is null, but re-append defensively from
    // dwUrlPathLength which spans the full remainder.
    std::wstring pathW(uc.lpszUrlPath, uc.dwUrlPathLength);
    if (pathW.empty())
    {
        pathW = L"/";
    }

    const INTERNET_PORT port = uc.nPort != 0 ? uc.nPort : INTERNET_DEFAULT_HTTPS_PORT;

    WinHttpHandle session(WinHttpOpen(
        kUserAgentW,
        WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
        WINHTTP_NO_PROXY_NAME,
        WINHTTP_NO_PROXY_BYPASS,
        0));
    if (!session)
    {
        result.error = fmt::format("WinHttpOpen failed ({})", GetLastError());
        return result;
    }

    // Bound every phase to ~8s so a slow host cannot hang the worker thread.
    WinHttpSetTimeouts(session.get(), kTimeoutMs, kTimeoutMs, kTimeoutMs, kTimeoutMs);

    WinHttpHandle connect(WinHttpConnect(session.get(), hostW.c_str(), port, 0));
    if (!connect)
    {
        result.error = fmt::format("WinHttpConnect failed ({})", GetLastError());
        return result;
    }

    WinHttpHandle request(WinHttpOpenRequest(
        connect.get(),
        L"GET",
        pathW.c_str(),
        nullptr,
        WINHTTP_NO_REFERER,
        WINHTTP_DEFAULT_ACCEPT_TYPES,
        WINHTTP_FLAG_SECURE));
    if (!request)
    {
        result.error = fmt::format("WinHttpOpenRequest failed ({})", GetLastError());
        return result;
    }

    // SSRF rail: do NOT auto-follow redirects. WinHTTP's ALWAYS policy would
    // follow a 302 to an intranet host (incl. an https→http downgrade) without
    // re-checking it. We disable following and treat any 3xx as a hard error;
    // the legit lyric providers (NetEase / LRCLIB) answer 200 directly.
    DWORD redirectPolicy = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
    WinHttpSetOption(request.get(), WINHTTP_OPTION_REDIRECT_POLICY,
                     &redirectPolicy, sizeof(redirectPolicy));

    // Optional Referer request header — some APIs (NetEase) gate on it.
    if (!referer.empty())
    {
        std::wstring refererHeader = L"Referer: ";
        refererHeader.append(referer.begin(), referer.end());
        WinHttpAddRequestHeaders(
            request.get(),
            refererHeader.c_str(),
            static_cast<DWORD>(-1),
            WINHTTP_ADDREQ_FLAG_ADD | WINHTTP_ADDREQ_FLAG_REPLACE);
    }

    if (!WinHttpSendRequest(
            request.get(),
            WINHTTP_NO_ADDITIONAL_HEADERS,
            0,
            WINHTTP_NO_REQUEST_DATA,
            0,
            0,
            0))
    {
        result.error = fmt::format("WinHttpSendRequest failed ({})", GetLastError());
        return result;
    }

    if (!WinHttpReceiveResponse(request.get(), nullptr))
    {
        result.error = fmt::format("WinHttpReceiveResponse failed ({})", GetLastError());
        return result;
    }

    DWORD status = 0;
    DWORD statusSize = sizeof(status);
    WinHttpQueryHeaders(
        request.get(),
        WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
        WINHTTP_HEADER_NAME_BY_INDEX,
        &status,
        &statusSize,
        WINHTTP_NO_HEADER_INDEX);
    result.status = static_cast<long>(status);

    // With redirect-following disabled, a 3xx means the server tried to send us
    // elsewhere (potentially an internal host). Refuse rather than expose the
    // Location target or silently return an empty body.
    if (status >= 300 && status < 400)
    {
        result.error = fmt::format("blocked: server returned redirect {} (not followed)", status);
        return result;
    }

    // Drain the full response body.
    std::string body;
    std::vector<char> buffer(kReadChunk);
    for (;;)
    {
        DWORD available = 0;
        if (!WinHttpQueryDataAvailable(request.get(), &available))
        {
            result.error = fmt::format("WinHttpQueryDataAvailable failed ({})", GetLastError());
            return result;
        }
        if (available == 0)
        {
            break;
        }
        if (available > buffer.size())
        {
            buffer.resize(available);
        }
        DWORD read = 0;
        if (!WinHttpReadData(request.get(), buffer.data(), available, &read))
        {
            result.error = fmt::format("WinHttpReadData failed ({})", GetLastError());
            return result;
        }
        if (read == 0)
        {
            break;
        }
        body.append(buffer.data(), read);
    }

    result.body = std::move(body);
    return result;
}

} // namespace vrcsm::core
