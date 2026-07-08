#pragma once

// HttpClient — the standalone WinHTTP transport extracted from VrcApi.cpp.
//
// This is the plain request/response mechanism against api.vrchat.cloud (and
// any other https host callers name): open session → connect → open request →
// send → receive → drain body, with a rate-limited + 429-retrying wrapper.
//
// It is intentionally free of VRChat semantics: it does not know about API
// keys, auth cookies (callers pass the Cookie header), or how to interpret a
// 401/429 as a domain error. Those live in VrcApi.cpp. This layer only moves
// bytes and reports transport-level failures through HttpResponse::error.
//
// The file-download path (streaming to disk with its own longer timeouts and
// Accept header) stays in VrcApi.cpp but reuses crackUrl() from here.

#include <cstdint>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace vrcsm::core::http
{

// User-Agent sent on every request. VRChat's /api/1/image/* endpoints 403 a
// request with no UA, so one is always sent — see the note in VrcApi.cpp.
inline constexpr const wchar_t* kUserAgentW = L"VRCSM/1.0";

// Full response of a single HTTP exchange.
//   status     — HTTP status code (0 when the request never completed).
//   body       — full response body (drained regardless of status).
//   error      — set on any WinHTTP-level failure; empty on a completed
//                exchange (even a 4xx/5xx, which is reported via status).
//   setCookies — raw Set-Cookie header lines, populated only when the caller
//                asked for them (login flow).
struct HttpResponse
{
    long status{0};
    std::string body;
    std::optional<std::string> error;
    std::vector<std::string> setCookies;
};

// Parsed URL components. Uses portable types (no winhttp.h leak into the
// header): `port` is the numeric port, `https` is true for the https scheme.
struct CrackedUrl
{
    std::wstring host;
    std::wstring pathAndQuery;
    std::uint16_t port{443};
    bool https{true};
};

// Crack an absolute http/https URL into host + path-and-query + port + scheme.
// Returns nullopt when WinHttpCrackUrl rejects the input. An empty path is
// normalized to "/".
std::optional<CrackedUrl> crackUrl(const std::string& url);

// Fire a single request and read the full response. Does NOT rate-limit or
// retry — see request(). `headers` are extra request headers (an
// "Accept: application/json" line is always prepended). `bodyUtf8` is sent
// as-is (binary-safe). When `captureSetCookie` is true, Set-Cookie response
// headers are collected into HttpResponse::setCookies.
HttpResponse requestOnce(
    const std::wstring& method,
    const std::wstring& host,
    const std::wstring& pathAndQuery,
    const std::vector<std::pair<std::wstring, std::wstring>>& headers,
    const std::string& bodyUtf8,
    bool captureSetCookie);

// Rate-limited wrapper around requestOnce(): acquires a global rate-limiter
// token before each attempt and retries up to 3 times on HTTP 429 with
// exponential backoff (1s, 2s, 4s).
HttpResponse request(
    const std::wstring& method,
    const std::wstring& host,
    const std::wstring& pathAndQuery,
    const std::vector<std::pair<std::wstring, std::wstring>>& headers = {},
    const std::string& bodyUtf8 = {},
    bool captureSetCookie = false);

// Convenience GET: threads an optional Cookie header through request().
HttpResponse get(
    const std::wstring& host,
    const std::wstring& pathAndQuery,
    const std::optional<std::string>& cookieHeader = std::nullopt);

} // namespace vrcsm::core::http
