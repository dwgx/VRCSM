#include "HttpClient.h"

#include "Common.h"
#include "RateLimiter.h"

#include <chrono>
#include <memory>
#include <thread>

#include <Windows.h>
#include <winhttp.h>

#include <fmt/format.h>
#include <spdlog/spdlog.h>

#pragma comment(lib, "Winhttp.lib")

// ─────────────────────────────────────────────────────────────────────────
// HttpClient — WinHTTP transport extracted verbatim from VrcApi.cpp. The
// request/response byte flow, timeouts, retry policy, and Set-Cookie capture
// are unchanged; only the home of the code moved. VRChat-specific error
// interpretation stays in VrcApi.cpp.
// ─────────────────────────────────────────────────────────────────────────

namespace vrcsm::core::http
{

namespace
{

struct WinHttpHandleDeleter
{
    void operator()(HINTERNET h) const noexcept
    {
        if (h) WinHttpCloseHandle(h);
    }
};
using UniqueWinHttpHandle = std::unique_ptr<void, WinHttpHandleDeleter>;

} // namespace

std::optional<CrackedUrl> crackUrl(const std::string& url)
{
    std::wstring wUrl = toWide(url);
    std::wstring scheme;
    std::wstring host;
    std::wstring path;
    std::wstring extra;
    scheme.resize(16);
    host.resize(512);
    path.resize(4096);
    extra.resize(4096);

    URL_COMPONENTS urlComp = {0};
    urlComp.dwStructSize = sizeof(urlComp);
    urlComp.lpszScheme = scheme.data();
    urlComp.dwSchemeLength = static_cast<DWORD>(scheme.size());
    urlComp.lpszHostName = host.data();
    urlComp.dwHostNameLength = static_cast<DWORD>(host.size());
    urlComp.lpszUrlPath = path.data();
    urlComp.dwUrlPathLength = static_cast<DWORD>(path.size());
    urlComp.lpszExtraInfo = extra.data();
    urlComp.dwExtraInfoLength = static_cast<DWORD>(extra.size());

    if (!WinHttpCrackUrl(wUrl.c_str(), 0, 0, &urlComp))
    {
        return std::nullopt;
    }

    scheme.resize(urlComp.dwSchemeLength);
    host.resize(urlComp.dwHostNameLength);
    path.resize(urlComp.dwUrlPathLength);
    extra.resize(urlComp.dwExtraInfoLength);

    CrackedUrl out;
    out.host = std::move(host);
    out.pathAndQuery = path + extra;
    out.port = static_cast<std::uint16_t>(urlComp.nPort);
    out.https = _wcsicmp(scheme.c_str(), L"https") == 0;
    if (out.pathAndQuery.empty())
    {
        out.pathAndQuery = L"/";
    }
    return out;
}

/// Fires a single HTTP request and reads the full response.
/// Does NOT handle rate limiting or retries — see request().
HttpResponse requestOnce(
    const std::wstring& method,
    const std::wstring& host,
    const std::wstring& pathAndQuery,
    const std::vector<std::pair<std::wstring, std::wstring>>& headers,
    const std::string& bodyUtf8,
    bool captureSetCookie)
{
    HttpResponse result;

    UniqueWinHttpHandle hSession(WinHttpOpen(
        kUserAgentW,
        WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
        WINHTTP_NO_PROXY_NAME,
        WINHTTP_NO_PROXY_BYPASS,
        0));
    if (!hSession)
    {
        result.error = fmt::format("WinHttpOpen failed ({})", GetLastError());
        return result;
    }

    // 8s for each phase — VRChat API usually answers in well under 1s.
    WinHttpSetTimeouts(hSession.get(), 8000, 8000, 8000, 8000);

    UniqueWinHttpHandle hConnect(WinHttpConnect(hSession.get(), host.c_str(), INTERNET_DEFAULT_HTTPS_PORT, 0));
    if (!hConnect)
    {
        result.error = fmt::format("WinHttpConnect failed ({})", GetLastError());
        return result;
    }

    UniqueWinHttpHandle hRequest(WinHttpOpenRequest(
        hConnect.get(),
        method.c_str(),
        pathAndQuery.c_str(),
        nullptr,
        WINHTTP_NO_REFERER,
        WINHTTP_DEFAULT_ACCEPT_TYPES,
        WINHTTP_FLAG_SECURE));
    if (!hRequest)
    {
        result.error = fmt::format("WinHttpOpenRequest failed ({})", GetLastError());
        return result;
    }

    std::wstring headerBlock = L"Accept: application/json\r\n";
    for (const auto& [name, value] : headers)
    {
        headerBlock += name;
        headerBlock += L": ";
        headerBlock += value;
        headerBlock += L"\r\n";
    }

    LPVOID body = WINHTTP_NO_REQUEST_DATA;
    DWORD bodySize = 0;
    if (!bodyUtf8.empty())
    {
        body = const_cast<char*>(bodyUtf8.data());
        bodySize = static_cast<DWORD>(bodyUtf8.size());
    }

    BOOL ok = WinHttpSendRequest(
        hRequest.get(),
        headerBlock.c_str(),
        static_cast<DWORD>(headerBlock.size()),
        body,
        bodySize,
        bodySize,
        0);
    if (ok) ok = WinHttpReceiveResponse(hRequest.get(), nullptr);
    if (!ok)
    {
        result.error = fmt::format("WinHttp request failed ({})", GetLastError());
        return result;
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
    result.status = static_cast<long>(status);

    if (captureSetCookie)
    {
        for (DWORD index = 0;; ++index)
        {
            DWORD bufferSize = 0;
            DWORD headerIndex = index;
            if (!WinHttpQueryHeaders(
                    hRequest.get(),
                    WINHTTP_QUERY_SET_COOKIE,
                    WINHTTP_HEADER_NAME_BY_INDEX,
                    WINHTTP_NO_OUTPUT_BUFFER,
                    &bufferSize,
                    &headerIndex))
            {
                const DWORD error = GetLastError();
                if (error == ERROR_WINHTTP_HEADER_NOT_FOUND)
                {
                    break;
                }
                if (error != ERROR_INSUFFICIENT_BUFFER)
                {
                    result.error = fmt::format("WinHttpQueryHeaders(Set-Cookie) failed ({})", error);
                    break;
                }
            }

            std::wstring rawCookie(static_cast<std::size_t>(bufferSize / sizeof(wchar_t)), L'\0');
            headerIndex = index;
            if (!WinHttpQueryHeaders(
                    hRequest.get(),
                    WINHTTP_QUERY_SET_COOKIE,
                    WINHTTP_HEADER_NAME_BY_INDEX,
                    rawCookie.data(),
                    &bufferSize,
                    &headerIndex))
            {
                const DWORD error = GetLastError();
                if (error == ERROR_WINHTTP_HEADER_NOT_FOUND)
                {
                    break;
                }
                result.error = fmt::format("WinHttpQueryHeaders(Set-Cookie) failed ({})", error);
                break;
            }

            if (!rawCookie.empty() && rawCookie.back() == L'\0')
            {
                rawCookie.pop_back();
            }
            result.setCookies.push_back(toUtf8(rawCookie));
        }
    }

    // Drain body regardless of status — useful for error messages.
    DWORD available = 0;
    while (WinHttpQueryDataAvailable(hRequest.get(), &available) && available > 0)
    {
        std::string chunk(available, '\0');
        DWORD read = 0;
        if (!WinHttpReadData(hRequest.get(), chunk.data(), available, &read))
        {
            break;
        }
        chunk.resize(read);
        result.body.append(chunk);
    }

    return result;
}

/// Rate-limited wrapper around requestOnce().
/// Acquires a token from the global rate limiter before each attempt and
/// retries up to 3 times on HTTP 429 with exponential backoff (1s, 2s, 4s).
HttpResponse request(
    const std::wstring& method,
    const std::wstring& host,
    const std::wstring& pathAndQuery,
    const std::vector<std::pair<std::wstring, std::wstring>>& headers,
    const std::string& bodyUtf8,
    bool captureSetCookie)
{
    static constexpr int kMaxRetries = 3;
    static constexpr int kBaseBackoffMs = 1000; // 1 second

    for (int attempt = 0; attempt <= kMaxRetries; ++attempt)
    {
        vrcsm::core::RateLimiter::Instance().Acquire();

        auto result = requestOnce(
            method, host, pathAndQuery, headers, bodyUtf8, captureSetCookie);

        if (result.status != 429)
        {
            return result;
        }

        // Last attempt — give up and return the 429 as-is.
        if (attempt == kMaxRetries)
        {
            spdlog::warn("HTTP 429 after {} retries, giving up", kMaxRetries);
            return result;
        }

        int backoffMs = kBaseBackoffMs * (1 << attempt); // 1s, 2s, 4s
        spdlog::warn(
            "HTTP 429 on attempt {}/{}, backing off {}ms",
            attempt + 1, kMaxRetries + 1, backoffMs);
        std::this_thread::sleep_for(std::chrono::milliseconds(backoffMs));
    }

    // Unreachable, but keeps the compiler happy.
    return {};
}

HttpResponse get(
    const std::wstring& host,
    const std::wstring& pathAndQuery,
    const std::optional<std::string>& cookieHeader)
{
    std::vector<std::pair<std::wstring, std::wstring>> headers;
    if (cookieHeader.has_value() && !cookieHeader->empty())
    {
        headers.emplace_back(L"Cookie", toWide(*cookieHeader));
    }
    return request(L"GET", host, pathAndQuery, headers);
}

} // namespace vrcsm::core::http
