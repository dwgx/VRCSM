#include "VrcApi.h"

#include "AuthStore.h"
#include "Common.h"
#include "RateLimiter.h"

#include <algorithm>
#include <chrono>
#include <fstream>
#include <functional>
#include <mutex>
#include <system_error>
#include <thread>
#include <unordered_map>

#include <Windows.h>
#include <KnownFolders.h>
#include <ShlObj.h>
#include <winhttp.h>

#include <wil/resource.h>

#include <fmt/format.h>
#include <spdlog/spdlog.h>

#pragma comment(lib, "Winhttp.lib")

// ─────────────────────────────────────────────────────────────────────────
// VrcApi — read-mostly HTTP client against api.vrchat.cloud.
//
// Two dumb things took longer to figure out than they should have:
//
//   1. curl with no -A gets 403 from every /api/1/image/* endpoint. Made
//      the bug invisible from the frontend, because WebView2 sends its own
//      Chrome UA on <img> loads and everything worked there. Only showed up
//      when `dump_thumbnails` (a cold C++ harness) started getting 403s.
//      Fix: always send our own UA on every request. See kUserAgentW below.
//
//   2. /api/1/avatars/{id} refuses anonymous callers with 401 while worlds
//      remain happily public. That means the thumbnail path has to be
//      "best effort": still anonymous for worlds, but automatically carry
//      the saved browser session once the user logs in so avatar lookups
//      start working without the frontend doing anything clever.
// ─────────────────────────────────────────────────────────────────────────

namespace vrcsm::core
{

void to_json(nlohmann::json& j, const ThumbnailResult& r)
{
    j = nlohmann::json{
        {"id", r.id},
        {"url", r.url.has_value() ? nlohmann::json(*r.url) : nlohmann::json(nullptr)},
        {"cached", r.cached},
    };
    if (r.error.has_value())
    {
        j["error"] = *r.error;
    }
    else
    {
        j["error"] = nullptr;
    }
}

namespace
{
// Public API key shipped with every VRChat web/desktop build — required as
// a query param on all anonymous calls. This is not a secret: it appears
// verbatim in VRChat's own client bundles and is used by every community
// tool (VRCX, VRChatAPI-Wrapper, etc.). A curated list of tools publish
// it so the VRChat team can revoke + bump if ever needed.
constexpr const char* kApiKey = "JlE5Jldo5Jibnk5O5hTx6XVqsJu4WJ26";

// VRChat's API rejects requests without a properly formatted UA — the
// format is `<tool>/<version> <contact>`. The contact segment just needs
// to parse as email-ish; it's how VRChat can reach out if a tool misbehaves.
// Bumped in lockstep with package.json / installer / app.rc.
constexpr const wchar_t* kUserAgentW = L"VRCSM/1.0";

constexpr const wchar_t* kApiHostW = L"api.vrchat.cloud";

// Cache layout (on disk, %LocalAppData%\VRCSM\thumb-cache.json):
// { "entries": { "wrld_xxx": { "url": "...", "fetched_at": 1234567, "not_found": false } } }
// not_found=true entries are honoured for 7 days so retries eventually
// happen in case the target later becomes public; url hits are kept
// indefinitely since VRChat rarely re-generates thumbnails.
constexpr std::int64_t kNotFoundTtlSeconds = 7 * 24 * 60 * 60;

struct CacheEntry
{
    std::optional<std::string> url;
    std::int64_t fetchedAt{0};
    bool notFound{false};
};

struct CacheState
{
    std::mutex mutex;
    std::unordered_map<std::string, CacheEntry> entries;
    bool loaded{false};
    std::filesystem::path path;
};

CacheState& cacheState()
{
    static CacheState state;
    return state;
}

std::int64_t unixNow()
{
    return std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

std::filesystem::path resolveCacheFile()
{
    return getAppDataRoot() / L"thumb-cache.json";
}

void loadCacheUnlocked(CacheState& state)
{
    if (state.loaded) return;
    state.loaded = true;
    state.path = resolveCacheFile();

    std::ifstream in(state.path, std::ios::binary);
    if (!in)
    {
        return; // no cache yet, perfectly normal on first run
    }

    try
    {
        nlohmann::json doc = nlohmann::json::parse(in);
        if (!doc.is_object()) return;
        const auto entriesIt = doc.find("entries");
        if (entriesIt == doc.end() || !entriesIt->is_object()) return;

        for (auto it = entriesIt->begin(); it != entriesIt->end(); ++it)
        {
            if (!it.value().is_object()) continue;
            CacheEntry e;
            if (it.value().contains("url") && it.value()["url"].is_string())
            {
                e.url = it.value()["url"].get<std::string>();
            }
            if (it.value().contains("fetched_at") && it.value()["fetched_at"].is_number_integer())
            {
                e.fetchedAt = it.value()["fetched_at"].get<std::int64_t>();
            }
            if (it.value().contains("not_found") && it.value()["not_found"].is_boolean())
            {
                e.notFound = it.value()["not_found"].get<bool>();
            }
            state.entries.emplace(it.key(), std::move(e));
        }
    }
    catch (const std::exception& ex)
    {
        spdlog::warn("VrcApi: failed to parse thumb-cache.json: {}", ex.what());
    }
}

void saveCacheUnlocked(const CacheState& state)
{
    std::error_code ec;
    std::filesystem::create_directories(state.path.parent_path(), ec);

    nlohmann::json doc;
    nlohmann::json entries = nlohmann::json::object();
    for (const auto& [id, e] : state.entries)
    {
        nlohmann::json entry;
        entry["url"] = e.url.has_value() ? nlohmann::json(*e.url) : nlohmann::json(nullptr);
        entry["fetched_at"] = e.fetchedAt;
        entry["not_found"] = e.notFound;
        entries[id] = std::move(entry);
    }
    doc["entries"] = std::move(entries);

    std::ofstream out(state.path, std::ios::binary | std::ios::trunc);
    if (!out)
    {
        spdlog::warn("VrcApi: failed to open cache for write: {}", toUtf8(state.path.wstring()));
        return;
    }
    out << doc.dump(2);
}

// Minimal synchronous WinHTTP GET. Returns body on HTTP 2xx, std::nullopt
// on network error or 4xx/5xx. Internally handles all the h1/tls/session
// cleanup via goto-style exit points so the happy path stays readable.
struct HttpResponse
{
    long status{0};
    std::string body;
    std::optional<std::string> error;
    std::vector<std::string> setCookies;
};

std::string percentEncode(std::string_view input)
{
    constexpr char kHex[] = "0123456789ABCDEF";

    std::string out;
    out.reserve(input.size());
    for (unsigned char ch : input)
    {
        if ((ch >= 'A' && ch <= 'Z')
            || (ch >= 'a' && ch <= 'z')
            || (ch >= '0' && ch <= '9')
            || ch == '-'
            || ch == '_'
            || ch == '.'
            || ch == '~')
        {
            out.push_back(static_cast<char>(ch));
            continue;
        }

        out.push_back('%');
        out.push_back(kHex[(ch >> 4) & 0x0F]);
        out.push_back(kHex[ch & 0x0F]);
    }
    return out;
}

std::string base64Encode(std::string_view input)
{
    constexpr char kTable[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    std::string out;
    out.reserve(((input.size() + 2) / 3) * 4);

    std::size_t index = 0;
    while (index + 3 <= input.size())
    {
        const auto a = static_cast<unsigned char>(input[index++]);
        const auto b = static_cast<unsigned char>(input[index++]);
        const auto c = static_cast<unsigned char>(input[index++]);

        out.push_back(kTable[(a >> 2) & 0x3F]);
        out.push_back(kTable[((a & 0x03) << 4) | ((b >> 4) & 0x0F)]);
        out.push_back(kTable[((b & 0x0F) << 2) | ((c >> 6) & 0x03)]);
        out.push_back(kTable[c & 0x3F]);
    }

    const std::size_t remaining = input.size() - index;
    if (remaining == 1)
    {
        const auto a = static_cast<unsigned char>(input[index]);
        out.push_back(kTable[(a >> 2) & 0x3F]);
        out.push_back(kTable[(a & 0x03) << 4]);
        out.push_back('=');
        out.push_back('=');
    }
    else if (remaining == 2)
    {
        const auto a = static_cast<unsigned char>(input[index]);
        const auto b = static_cast<unsigned char>(input[index + 1]);
        out.push_back(kTable[(a >> 2) & 0x3F]);
        out.push_back(kTable[((a & 0x03) << 4) | ((b >> 4) & 0x0F)]);
        out.push_back(kTable[(b & 0x0F) << 2]);
        out.push_back('=');
    }

    return out;
}

std::string trimAscii(std::string value)
{
    const auto first = value.find_first_not_of(" \t\r\n");
    if (first == std::string::npos)
    {
        return {};
    }

    const auto last = value.find_last_not_of(" \t\r\n");
    return value.substr(first, last - first + 1);
}

std::optional<std::string> extractCookieValue(
    const std::vector<std::string>& setCookies,
    std::string_view cookieName)
{
    for (const auto& rawCookie : setCookies)
    {
        const auto pairEnd = rawCookie.find(';');
        const std::string pair = rawCookie.substr(0, pairEnd);
        const auto equals = pair.find('=');
        if (equals == std::string::npos)
        {
            continue;
        }

        if (trimAscii(pair.substr(0, equals)) != cookieName)
        {
            continue;
        }

        return pair.substr(equals + 1);
    }

    return std::nullopt;
}

std::optional<std::string> jsonStringField(const nlohmann::json& doc, const char* key)
{
    if (const auto it = doc.find(key); it != doc.end() && it->is_string())
    {
        return it->get<std::string>();
    }
    return std::nullopt;
}

bool hasTwoFactorChallenge(const nlohmann::json& doc)
{
    const auto it = doc.find("requiresTwoFactorAuth");
    return it != doc.end() && it->is_array() && !it->empty();
}

std::optional<std::string> extractApiErrorMessage(const std::string& body)
{
    if (body.empty())
    {
        return std::nullopt;
    }

    try
    {
        const auto doc = nlohmann::json::parse(body);
        if (const auto message = jsonStringField(doc, "message"); message.has_value())
        {
            return message;
        }
        if (const auto error = jsonStringField(doc, "error"); error.has_value())
        {
            return error;
        }
        if (const auto errorIt = doc.find("error");
            errorIt != doc.end() && errorIt->is_object())
        {
            if (const auto message = jsonStringField(*errorIt, "message"); message.has_value())
            {
                return message;
            }
        }
    }
    catch (...)
    {
    }

    return std::nullopt;
}

std::string getLoadedCookieHeader()
{
    auto cookieHeader = AuthStore::Instance().BuildCookieHeader();
    if (!cookieHeader.empty())
    {
        return cookieHeader;
    }

    (void)AuthStore::Instance().Load();
    return AuthStore::Instance().BuildCookieHeader();
}

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

std::optional<Error> checkStandardHttpError(const HttpResponse& response, std::string_view label)
{
    if (response.error.has_value()) return Error{"network", *response.error, 0};
    if (response.status == 401) return Error{"auth_expired", "Session expired", 401};
    if (response.status == 429) return Error{"rate_limited", "Too many requests", 429};
    if (response.status < 200 || response.status >= 300)
    {
        // Many endpoints will have explicit 404 checks before this generic check,
        // but for generic failures, surface exactly what the server sent.
        const auto msg = extractApiErrorMessage(response.body);
        return Error{"api_error", msg.value_or(fmt::format("{} returned HTTP {}", label, response.status)), static_cast<int>(response.status)};
    }
    return std::nullopt;
}
} // namespace

std::string describeHttpFailure(const HttpResponse& response, std::string_view label)
{
    if (response.error.has_value())
    {
        return *response.error;
    }

    if (const auto message = extractApiErrorMessage(response.body); message.has_value())
    {
        return *message;
    }

    if (response.status > 0)
    {
        return fmt::format("{} returned HTTP {}", label, response.status);
    }

    return std::string(label);
}

/// Fires a single HTTP request and reads the full response.
/// Does NOT handle rate limiting or retries — see httpRequestWithRetry().
HttpResponse httpRequestOnce(
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

/// Rate-limited wrapper around httpRequestOnce().
/// Acquires a token from the global rate limiter before each attempt and
/// retries up to 3 times on HTTP 429 with exponential backoff (1s, 2s, 4s).
HttpResponse httpRequest(
    const std::wstring& method,
    const std::wstring& host,
    const std::wstring& pathAndQuery,
    const std::vector<std::pair<std::wstring, std::wstring>>& headers = {},
    const std::string& bodyUtf8 = {},
    bool captureSetCookie = false)
{
    static constexpr int kMaxRetries = 3;
    static constexpr int kBaseBackoffMs = 1000; // 1 second

    for (int attempt = 0; attempt <= kMaxRetries; ++attempt)
    {
        vrcsm::core::RateLimiter::Instance().Acquire();

        auto result = httpRequestOnce(
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

HttpResponse httpGet(
    const std::wstring& host,
    const std::wstring& pathAndQuery,
    const std::optional<std::string>& cookieHeader = std::nullopt)
{
    std::vector<std::pair<std::wstring, std::wstring>> headers;
    if (cookieHeader.has_value() && !cookieHeader->empty())
    {
        headers.emplace_back(L"Cookie", toWide(*cookieHeader));
    }
    return httpRequest(L"GET", host, pathAndQuery, headers);
}

std::optional<std::string> extractThumbnailUrl(const std::string& jsonBody)
{
    try
    {
        auto doc = nlohmann::json::parse(jsonBody);
        if (!doc.is_object()) return std::nullopt;
        // Prefer the lower-res thumbnailImageUrl since it loads faster and
        // is the one VRChat's own UI uses in list views. Fall back to the
        // higher-res imageUrl if the thumbnail field is missing.
        if (auto it = doc.find("thumbnailImageUrl"); it != doc.end() && it->is_string())
        {
            return it->get<std::string>();
        }
        if (auto it = doc.find("imageUrl"); it != doc.end() && it->is_string())
        {
            return it->get<std::string>();
        }
    }
    catch (...)
    {
        // Not JSON, or not the shape we expected — treat as no-op.
    }
    return std::nullopt;
}



nlohmann::json parseJsonBody(const HttpResponse& response, std::string_view endpointLabel)
{
    try
    {
        return nlohmann::json::parse(response.body);
    }
    catch (const std::exception& ex)
    {
        throw std::runtime_error(fmt::format(
            "{} returned invalid JSON: {}",
            endpointLabel,
            ex.what()));
    }
}

Result<std::vector<nlohmann::json>> fetchPagedAuthedArray(
    std::string_view endpointLabel,
    const std::function<std::wstring(int limit, int offset)>& buildPath)
{
    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
    {
        return Error{"auth_expired", "Not signed in", 401};
    }

    static constexpr int kPageSize = 100;

    std::vector<nlohmann::json> out;
    for (int offset = 0;; offset += kPageSize)
    {
        const auto response = httpGet(
            kApiHostW,
            buildPath(kPageSize, offset),
            std::make_optional(cookieHeader));
        if (auto err = checkStandardHttpError(response, endpointLabel))
        {
            return *err;
        }

        const auto doc = parseJsonBody(response, endpointLabel);
        if (!doc.is_array())
        {
            return Error{
                "api_error",
                fmt::format("{} returned a non-array payload", endpointLabel),
                0,
            };
        }

        for (const auto& item : doc)
        {
            out.push_back(item);
        }

        if (static_cast<int>(doc.size()) < kPageSize)
        {
            break;
        }
    }

    return out;
}

enum class IdKind
{
    World,
    Avatar,
    Unknown,
};

IdKind classify(const std::string& id)
{
    if (id.rfind("wrld_", 0) == 0) return IdKind::World;
    if (id.rfind("avtr_", 0) == 0) return IdKind::Avatar;
    return IdKind::Unknown;
}

std::wstring buildPath(IdKind kind, const std::string& id)
{
    const char* prefix = kind == IdKind::World ? "/api/1/worlds/" : "/api/1/avatars/";
    return toWide(fmt::format("{}{}?apiKey={}", prefix, id, kApiKey));
}

ThumbnailResult performLookup(const std::string& id)
{
    ThumbnailResult out;
    out.id = id;

    const IdKind kind = classify(id);
    if (kind == IdKind::Unknown)
    {
        out.error = "unknown-id-prefix";
        return out;
    }

    // The old implementation serialised every fetch through one global
    // mutex "so we don't hammer VRChat with 40 requests at once". In
    // practice that turned a 40-thumbnail batch into a 30+ second
    // blocking wall — and because thumbnails.fetch now runs on a
    // per-request worker (see IpcBridge async dispatch), it also
    // blocked every other IPC call coming from the UI. Run fetches in
    // parallel and rely on state.mutex alone to protect the on-disk
    // cache. httpGet already honours a reasonable timeout and the
    // batch size is bounded by the visible avatar list, so VRChat is
    // not at risk of being "hammered".
    auto& state = cacheState();
    {
        std::lock_guard<std::mutex> cacheLock(state.mutex);
        loadCacheUnlocked(state);
        const auto it = state.entries.find(id);
        if (it != state.entries.end())
        {
            const auto& e = it->second;
            const std::int64_t age = unixNow() - e.fetchedAt;
            if (!e.notFound)
            {
                out.url = e.url;
                out.cached = true;
                return out;
            }
            if (e.notFound && age < kNotFoundTtlSeconds)
            {
                out.cached = true; // negative cache hit
                return out;
            }
            // Fall through — not-found TTL expired, re-try network.
        }
    }

    // Network fetch outside the cache-mutex.
    const std::wstring path = buildPath(kind, id);
    const std::string cookieHeader = AuthStore::Instance().BuildCookieHeader();
    HttpResponse resp = httpGet(
        kApiHostW,
        path,
        cookieHeader.empty() ? std::nullopt : std::make_optional(cookieHeader));

    std::optional<std::string> url;
    bool notFound = false;
    if (resp.error.has_value())
    {
        out.error = *resp.error;
        return out;
    }
    if (resp.status == 200)
    {
        url = extractThumbnailUrl(resp.body);
        if (!url.has_value())
        {
            notFound = true; // 200 OK but no thumbnailImageUrl field
        }
    }
    else if (resp.status == 404)
    {
        notFound = true; // genuine "this is private / doesn't exist"
    }
    else if (resp.status == 401)
    {
        // A 401 no longer means "missing forever" once auth exists. Don't
        // negative-cache it or a stale anonymous miss will keep hiding a
        // perfectly valid avatar after login.
        out.error = "unauthorized";
        return out;
    }
    else
    {
        // 429, 500, 503 — treat as transient, report error but don't cache
        out.error = fmt::format("HTTP {}", resp.status);
        return out;
    }

    // Write cache
    {
        std::lock_guard<std::mutex> cacheLock(state.mutex);
        CacheEntry e;
        e.url = url;
        e.fetchedAt = unixNow();
        e.notFound = notFound;
        state.entries[id] = std::move(e);
        saveCacheUnlocked(state);
    }

    out.url = url;
    return out;
}
} // namespace

ThumbnailResult VrcApi::fetchThumbnail(const std::string& id)
{
    return performLookup(id);
}

std::vector<ThumbnailResult> VrcApi::fetchThumbnails(const std::vector<std::string>& ids)
{
    std::vector<ThumbnailResult> out;
    out.reserve(ids.size());
    for (const auto& id : ids)
    {
        out.push_back(performLookup(id));
    }
    return out;
}

Result<nlohmann::json> VrcApi::fetchCurrentUser()
{
    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
    {
        return Error{"auth_expired", "No session cookie", 401};
    }

    const auto response = httpGet(
        kApiHostW,
        L"/api/1/auth/user",
        std::make_optional(cookieHeader));
    if (response.error.has_value())
    {
        return Error{"network", *response.error, 0};
    }
    if (response.status == 401)
    {
        return Error{"auth_expired", "Session expired", 401};
    }
    if (response.status == 429)
    {
        return Error{"rate_limited", "Too many requests", 429};
    }
    if (response.status != 200)
    {
        return Error{"api_error", fmt::format("/auth/user returned HTTP {}", response.status), response.status};
    }

    const auto doc = parseJsonBody(response, "/auth/user");
    if (hasTwoFactorChallenge(doc))
    {
        return Error{"two_factor_required", "Two-factor verification required", 401};
    }
    if (!doc.is_object())
    {
        return Error{"api_error", "/auth/user returned a non-object payload", 0};
    }
    if (!jsonStringField(doc, "id").has_value())
    {
        return Error{"api_error", "/auth/user returned no id field", 0};
    }

    return doc;
}

Result<nlohmann::json> VrcApi::fetchAvatarDetails(const std::string& avatarId)
{
    if (avatarId.empty())
    {
        return Error{"not_found", "Empty avatar id", 404};
    }

    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
    {
        return Error{"auth_expired", "No session cookie", 401};
    }

    const std::wstring path = toWide(fmt::format("/api/1/avatars/{}", avatarId));
    const auto response = httpGet(
        kApiHostW,
        path,
        std::make_optional(cookieHeader));
    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status == 404) return Error{"not_found", fmt::format("Avatar {} not found", avatarId), 404};
    if (response.status != 200) return Error{"api_error", fmt::format("/avatars/{} returned HTTP {}", avatarId, response.status), static_cast<int>(response.status)};

    return parseJsonBody(response, "/avatars/{id}");
}

namespace
{
// VRChat's username+password dance:
//   GET /api/1/auth/user                  (Authorization: Basic base64(user:pass))
// → 200 + full user body                   (logged in, no 2FA gate)
// → 200 + { requiresTwoFactorAuth: [...] } (gated — captures `auth` cookie
//                                            but not `twoFactorAuth` yet)
// → 401                                   (bad password / captcha wall)
//
// The username+password pair is passed percent-encoded BEFORE base64 —
// VRChat runs the raw bytes through `decodeURIComponent` before
// validating. Forgetting to percent-encode means every password with a
// non-ASCII character ("!", ":", Chinese, etc.) silently fails.
std::string buildBasicAuthHeader(const std::string& username, const std::string& password)
{
    // These three intermediates hold the user's plaintext credentials
    // (percent-encoded but recoverable). Wipe them on function exit so
    // the heap buffers don't linger with recognisable credential bytes
    // after the header has been handed off to the caller.
    std::string userPart = percentEncode(username);
    std::string passPart = percentEncode(password);
    std::string combined = userPart + ":" + passPart;
    auto wipe = wil::scope_exit([&]()
    {
        secureClearString(userPart);
        secureClearString(passPart);
        secureClearString(combined);
    });
    return "Basic " + base64Encode(combined);
}

std::vector<std::string> parseTwoFactorMethods(const nlohmann::json& doc)
{
    std::vector<std::string> methods;
    const auto it = doc.find("requiresTwoFactorAuth");
    if (it == doc.end() || !it->is_array())
    {
        return methods;
    }
    for (const auto& v : *it)
    {
        if (v.is_string())
        {
            methods.push_back(v.get<std::string>());
        }
    }
    return methods;
}
} // namespace

LoginResult VrcApi::loginWithPassword(const std::string& username, const std::string& password)
{
    LoginResult out;

    if (username.empty() || password.empty())
    {
        out.status = LoginResult::Status::Error;
        out.error = "username and password are required";
        return out;
    }

    // /auth/user with HTTP Basic — WinHTTP does not auto-inject the
    // Authorization header because we're explicitly avoiding the
    // "negotiate" stack, so we build it by hand.
    //
    // Both the utf8 and wide copies of the Authorization header contain
    // base64(user:password), which is trivially reversible. Own them so we
    // can scrub the buffers on every return path once WinHTTP has copied
    // the bytes onto the wire.
    std::string authHeaderUtf8 = buildBasicAuthHeader(username, password);
    std::vector<std::pair<std::wstring, std::wstring>> headers;
    headers.emplace_back(L"Authorization", toWide(authHeaderUtf8));
    auto wipeAuth = wil::scope_exit([&]()
    {
        secureClearString(authHeaderUtf8);
        for (auto& h : headers)
        {
            secureClearString(h.second);
        }
    });

    HttpResponse response = httpRequest(
        L"GET",
        kApiHostW,
        L"/api/1/auth/user",
        headers,
        /*bodyUtf8*/ {},
        /*captureSetCookie*/ true);

    out.httpStatus = static_cast<int>(response.status);

    if (response.error.has_value())
    {
        out.status = LoginResult::Status::Error;
        out.error = *response.error;
        return out;
    }

    if (response.status == 401)
    {
        // VRChat tells us "Invalid Username/Email or Password" as plain
        // JSON here — lift it verbatim so the UI toast matches the
        // official login page phrasing.
        const auto msg = extractApiErrorMessage(response.body);
        out.status = LoginResult::Status::Error;
        out.error = msg.value_or("Invalid username or password");
        return out;
    }

    if (response.status != 200)
    {
        out.status = LoginResult::Status::Error;
        out.error = describeHttpFailure(response, "/auth/user");
        return out;
    }

    nlohmann::json doc;
    try
    {
        doc = nlohmann::json::parse(response.body);
    }
    catch (const std::exception& ex)
    {
        out.status = LoginResult::Status::Error;
        out.error = fmt::format("/auth/user returned invalid JSON: {}", ex.what());
        return out;
    }

    // VRChat sets the `auth` cookie regardless of whether 2FA is
    // required — the presence of `requiresTwoFactorAuth` is what
    // distinguishes "logged in" from "needs second factor". Capture
    // the cookie either way so the follow-up /twofactorauth/*/verify
    // request has a valid session to attach to.
    const auto authCookie = extractCookieValue(response.setCookies, "auth");
    if (!authCookie.has_value() || authCookie->empty())
    {
        // Defensive: even with a 200, a missing `auth` cookie means
        // VRChat swapped contracts on us. Don't pretend we're logged in.
        spdlog::warn("VrcApi::loginWithPassword: 200 OK but no `auth` cookie in response");
        out.status = LoginResult::Status::Error;
        out.error = "VRChat did not return a session cookie";
        return out;
    }

    // Persist the cookie *now* so the subsequent 2FA verify call can
    // use the same session. We clear the previous twoFactorAuth cookie
    // because it belongs to a stale session and would confuse VRChat.
    AuthStore::Instance().SetCookies(*authCookie, {});
    (void)AuthStore::Instance().Save();

    const auto twoFactorMethods = parseTwoFactorMethods(doc);
    if (!twoFactorMethods.empty())
    {
        out.status = LoginResult::Status::Requires2FA;
        out.twoFactorMethods = twoFactorMethods;
        out.user = doc; // stub — frontend reads `twoFactorMethods`
        return out;
    }

    out.status = LoginResult::Status::Success;
    out.user = doc;
    return out;
}

VerifyResult VrcApi::verifyTwoFactor(const std::string& method, const std::string& code)
{
    VerifyResult out;

    if (method.empty() || code.empty())
    {
        out.ok = false;
        out.error = "method and code are required";
        return out;
    }

    // Only totp and emailOtp are currently used by VRChat. We
    // deliberately allow-list them instead of passing the method
    // straight into the URL so a malformed frontend payload can't
    // build `/twofactorauth/../admin/` style requests.
    if (method != "totp" && method != "emailOtp" && method != "otp")
    {
        out.ok = false;
        out.error = fmt::format("unsupported 2FA method: {}", method);
        return out;
    }

    const std::string cookieHeader = AuthStore::Instance().BuildCookieHeader();
    if (cookieHeader.empty())
    {
        out.ok = false;
        out.error = "no active login session — start over from the username/password step";
        return out;
    }

    // Body is minimal JSON: { "code": "123456" }. VRChat is strict
    // about the Content-Type header — it refuses text/plain.
    nlohmann::json body;
    body["code"] = code;
    const std::string bodyUtf8 = body.dump();

    std::vector<std::pair<std::wstring, std::wstring>> headers;
    headers.emplace_back(L"Cookie", toWide(cookieHeader));
    headers.emplace_back(L"Content-Type", L"application/json");

    const std::wstring path = toWide(fmt::format("/api/1/auth/twofactorauth/{}/verify", method));

    HttpResponse response = httpRequest(
        L"POST",
        kApiHostW,
        path,
        headers,
        bodyUtf8,
        /*captureSetCookie*/ true);

    out.httpStatus = static_cast<int>(response.status);

    if (response.error.has_value())
    {
        out.ok = false;
        out.error = *response.error;
        return out;
    }

    if (response.status != 200)
    {
        // 400 → bad code, 401 → session expired, anything else → surface
        // whatever the server said and let the UI show a toast.
        out.ok = false;
        const auto msg = extractApiErrorMessage(response.body);
        out.error = msg.value_or(
            fmt::format("/twofactorauth/{}/verify returned HTTP {}", method, response.status));
        return out;
    }

    // Response body is `{ "verified": true }` on success. Technically
    // we should check it, but the `twoFactorAuth` Set-Cookie is the
    // load-bearing piece — no cookie means the call failed regardless
    // of what the body says.
    const auto twoFactorCookie = extractCookieValue(response.setCookies, "twoFactorAuth");
    if (!twoFactorCookie.has_value() || twoFactorCookie->empty())
    {
        out.ok = false;
        out.error = "VRChat did not return a 2FA session cookie";
        return out;
    }

    // Merge with the existing `auth` cookie we already have from the
    // loginWithPassword step. SetCookies(new-auth, ...) would wipe it.
    const std::string existingAuth = [&]() {
        const std::string header = AuthStore::Instance().BuildCookieHeader();
        // BuildCookieHeader returns "auth=...; twoFactorAuth=..." — we
        // only want the `auth` value, so re-extract it from the in-memory
        // state via a second read.
        constexpr std::string_view prefix = "auth=";
        if (header.rfind(prefix, 0) != 0)
        {
            return std::string{};
        }
        const auto end = header.find(';');
        return header.substr(prefix.size(),
            end == std::string::npos ? std::string::npos : end - prefix.size());
    }();

    if (existingAuth.empty())
    {
        out.ok = false;
        out.error = "lost the primary session cookie during 2FA verification";
        return out;
    }

    AuthStore::Instance().SetCookies(existingAuth, *twoFactorCookie);
    (void)AuthStore::Instance().Save();

    out.ok = true;
    return out;
}

Result<std::vector<nlohmann::json>> VrcApi::fetchFriends(bool offline)
{
    // v0.9.0: page through `/auth/user/friends` until the server returns
    // fewer rows than we asked for. VRChat caps each page at ~100. Users
    // with 200+ friends were previously seeing a silently-truncated list
    // from the v0.2.0 single-shot implementation.
    const std::string offlineFlag = offline ? "true" : "false";
    return fetchPagedAuthedArray(
        "/auth/user/friends",
        [&offlineFlag](int limit, int offset)
        {
            return toWide(fmt::format(
                "/api/1/auth/user/friends?offline={}&n={}&offset={}",
                offlineFlag,
                limit,
                offset));
        });
}

Result<std::vector<nlohmann::json>> VrcApi::fetchGroups()
{
    // Resolve the authenticated user's id so we can call the correct
    // VRChat API endpoint.  The old `/api/1/auth/user/groups` path
    // does not return group memberships; the right one is
    // `/api/1/users/{userId}/groups`.
    const auto currentUser = fetchCurrentUser();
    if (!isOk(currentUser))
    {
        return std::get<Error>(currentUser);
    }
    const auto& userDoc = value(currentUser);
    const auto idIt = userDoc.find("id");
    if (idIt == userDoc.end() || !idIt->is_string())
    {
        return Error{"api_error", "Current user has no id field", 0};
    }
    const std::string userId = idIt->get<std::string>();

    return fetchPagedAuthedArray(
        "/users/{id}/groups",
        [&userId](int limit, int offset)
        {
            return toWide(fmt::format(
                "/api/1/users/{}/groups?n={}&offset={}",
                userId,
                limit,
                offset));
        });
}

Result<std::vector<nlohmann::json>> VrcApi::fetchCalendar()
{
    return fetchPagedAuthedArray(
        "/calendar",
        [](int limit, int offset)
        {
            return toWide(fmt::format(
                "/api/1/calendar?n={}&offset={}",
                limit,
                offset));
        });
}

Result<std::vector<nlohmann::json>> VrcApi::fetchCalendarDiscover()
{
    return fetchPagedAuthedArray(
        "/calendar/discover",
        [](int limit, int offset)
        {
            return toWide(fmt::format(
                "/api/1/calendar/discover?n={}&offset={}",
                limit,
                offset));
        });
}

Result<std::vector<nlohmann::json>> VrcApi::fetchCalendarFeatured()
{
    return fetchPagedAuthedArray(
        "/calendar/featured",
        [](int limit, int offset)
        {
            return toWide(fmt::format(
                "/api/1/calendar/featured?n={}&offset={}",
                limit,
                offset));
        });
}

Result<nlohmann::json> VrcApi::fetchJams()
{
    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
        return Error{"auth_expired", "No session cookie", 401};

    const auto path = toWide(fmt::format("/api/1/jams?apiKey={}", kApiKey));
    const auto response = httpGet(kApiHostW, path, cookieHeader);
    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status != 200)
        return Error{"api_error",
            fmt::format("/jams returned HTTP {}", response.status),
            static_cast<int>(response.status)};

    return parseJsonBody(response, "/jams");
}

Result<nlohmann::json> VrcApi::fetchJamDetail(const std::string& jamId)
{
    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
        return Error{"auth_expired", "No session cookie", 401};

    const auto path = toWide(fmt::format("/api/1/jams/{}?apiKey={}", jamId, kApiKey));
    const auto response = httpGet(kApiHostW, path, cookieHeader);
    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status != 200)
        return Error{"api_error",
            fmt::format("/jams/{} returned HTTP {}", jamId, response.status),
            static_cast<int>(response.status)};

    return parseJsonBody(response, "/jams/" + jamId);
}

Result<std::vector<nlohmann::json>> VrcApi::fetchPlayerModerations()
{
    return fetchPagedAuthedArray(
        "/auth/user/playermoderations",
        [](int limit, int offset)
        {
            return toWide(fmt::format(
                "/api/1/auth/user/playermoderations?n={}&offset={}",
                limit,
                offset));
        });
}

Result<std::vector<nlohmann::json>> VrcApi::fetchFavoritedAvatars()
{
    return fetchPagedAuthedArray(
        "/avatars/favorites",
        [](int limit, int offset)
        {
            return toWide(fmt::format(
                "/api/1/avatars/favorites?n={}&offset={}&releaseStatus=all",
                limit,
                offset));
        });
}

Result<std::vector<nlohmann::json>> VrcApi::fetchFavoritedWorlds()
{
    return fetchPagedAuthedArray(
        "/worlds/favorites",
        [](int limit, int offset)
        {
            return toWide(fmt::format(
                "/api/1/worlds/favorites?n={}&offset={}&releaseStatus=all",
                limit,
                offset));
        });
}

bool VrcApi::downloadFile(const std::string& url, const std::filesystem::path& destPath)
{
    std::wstring wUrl = toWide(url);
    URL_COMPONENTS urlComp = {0};
    urlComp.dwStructSize = sizeof(urlComp);
    
    std::wstring hostName; hostName.resize(256);
    std::wstring urlPath; urlPath.resize(2048);
    
    urlComp.lpszHostName = hostName.data();
    urlComp.dwHostNameLength = 256;
    urlComp.lpszUrlPath = urlPath.data();
    urlComp.dwUrlPathLength = 2048;

    if (!WinHttpCrackUrl(wUrl.c_str(), 0, 0, &urlComp))
    {
        spdlog::warn("VrcApi: downloadFile failed to crack URL: {}", url);
        return false;
    }
    
    hostName.resize(urlComp.dwHostNameLength);
    urlPath.resize(urlComp.dwUrlPathLength);

    std::vector<std::pair<std::wstring, std::wstring>> headers;
    const auto cookie = getLoadedCookieHeader();
    if (!cookie.empty())
    {
        headers.emplace_back(L"Cookie", toWide(cookie));
    }
    
    UniqueWinHttpHandle hSession(WinHttpOpen(kUserAgentW, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
    if (!hSession) return false;
    WinHttpSetTimeouts(hSession.get(), 60000, 60000, 60000, 300000);
    UniqueWinHttpHandle hConnect(WinHttpConnect(hSession.get(), hostName.c_str(), INTERNET_DEFAULT_HTTPS_PORT, 0));
    if (!hConnect) { return false; }
    UniqueWinHttpHandle hRequest(WinHttpOpenRequest(hConnect.get(), L"GET", urlPath.c_str(), nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE));
    if (!hRequest) { return false; }

    std::wstring headerBlock = L"Accept: */*\r\n";
    for (const auto& [name, value] : headers) {
        headerBlock += name + L": " + value + L"\r\n";
    }

    BOOL ok = WinHttpSendRequest(hRequest.get(), headerBlock.c_str(), static_cast<DWORD>(headerBlock.size()), WINHTTP_NO_REQUEST_DATA, 0, 0, 0);
    if (ok) ok = WinHttpReceiveResponse(hRequest.get(), nullptr);
    if (!ok) { return false; }

    DWORD status = 0;
    DWORD statusSize = sizeof(status);
    WinHttpQueryHeaders(hRequest.get(), WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &status, &statusSize, WINHTTP_NO_HEADER_INDEX);
    if (status < 200 || status >= 300) {
        spdlog::warn("VrcApi: downloadFile failed with HTTP status {}", status);
        return false;
    }

    std::ofstream out(destPath, std::ios::binary | std::ios::trunc);
    if (!out) {
        spdlog::warn("VrcApi: downloadFile failed to open destPath for write.");
        return false;
    }

    DWORD available = 0;
    std::vector<char> chunk(64 * 1024);
    while (WinHttpQueryDataAvailable(hRequest.get(), &available) && available > 0)
    {
        if (available > chunk.size()) chunk.resize(available);
        DWORD read = 0;
        if (!WinHttpReadData(hRequest.get(), chunk.data(), available, &read)) break;
        out.write(chunk.data(), read);
    }

    out.flush();
    return out.good();
}

Result<nlohmann::json> VrcApi::fetchUser(const std::string& userId)
{
    if (userId.empty())
    {
        return Error{"not_found", "Empty user id", 404};
    }

    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
    {
        return Error{"auth_expired", "No session cookie", 401};
    }

    const std::wstring path = toWide(fmt::format("/api/1/users/{}?apiKey={}", userId, kApiKey));
    const auto response = httpGet(
        kApiHostW,
        path,
        std::make_optional(cookieHeader));
    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status == 404) return Error{"not_found", fmt::format("User {} not found", userId), 404};
    if (response.status != 200) return Error{"api_error", fmt::format("/users/{} returned HTTP {}", userId, response.status), static_cast<int>(response.status)};

    return parseJsonBody(response, "/users/{id}");
}

Result<nlohmann::json> VrcApi::selectAvatar(const std::string& avatarId)
{
    if (avatarId.empty())
    {
        return Error{"not_found", "Empty avatar id", 400};
    }

    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
    {
        return Error{"auth_expired", "No session cookie", 401};
    }

    std::vector<std::pair<std::wstring, std::wstring>> headers;
    headers.emplace_back(L"Cookie", toWide(cookieHeader));
    headers.emplace_back(L"Content-Type", L"application/json");

    const std::wstring path = toWide(fmt::format("/api/1/avatars/{}/select", avatarId));
    const auto response = httpRequest(
        L"PUT",
        kApiHostW,
        path,
        headers,
        "{}",
        /*captureSetCookie*/ false);

    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status < 200 || response.status >= 300)
    {
        const auto msg = extractApiErrorMessage(response.body);
        return Error{"api_error", msg.value_or(fmt::format("/avatars/{}/select returned HTTP {}", avatarId, response.status)), static_cast<int>(response.status)};
    }
    return nlohmann::json{{"ok", true}};
}

Result<nlohmann::json> VrcApi::searchAvatars(
    const std::string& query, int count, int offset)
{
    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
    {
        return Error{"auth_expired", "No session cookie", 401};
    }

    std::string encoded;
    for (unsigned char ch : query)
    {
        if (std::isalnum(ch) || ch == '-' || ch == '_' || ch == '.' || ch == '~')
        {
            encoded += static_cast<char>(ch);
        }
        else
        {
            char buf[4];
            std::snprintf(buf, sizeof(buf), "%%%02X", ch);
            encoded.append(buf);
        }
    }

    const auto path = toWide(fmt::format(
        "/api/1/avatars?apiKey={}&releaseStatus=public&sort=relevance"
        "&order=descending&marketplace=all&n={}&offset={}&search={}",
        kApiKey, std::clamp(count, 1, 100), std::max(offset, 0), encoded));

    const auto response = httpGet(kApiHostW, path, cookieHeader);
    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status != 200)
    {
        return Error{"api_error",
            fmt::format("/avatars search returned HTTP {}", response.status),
            static_cast<int>(response.status)};
    }

    auto arr = parseJsonBody(response, "/avatars?search=");
    nlohmann::json results = nlohmann::json::array();
    for (auto& item : arr)
    {
        results.push_back({
            {"id",              item.value("id", "")},
            {"name",            item.value("name", "")},
            {"description",     item.value("description", "")},
            {"authorId",        item.value("authorId", "")},
            {"authorName",      item.value("authorName", "")},
            {"imageUrl",        item.value("imageUrl", "")},
            {"thumbnailImageUrl", item.value("thumbnailImageUrl", "")},
            {"releaseStatus",   item.value("releaseStatus", "")},
            {"version",         item.value("version", 0)},
            {"tags",            item.value("tags", nlohmann::json::array())},
            {"created_at",      item.value("created_at", "")},
            {"updated_at",      item.value("updated_at", "")},
        });
    }
    return nlohmann::json{{"avatars", results}};
}

Result<nlohmann::json> VrcApi::updateAuthUser(const nlohmann::json& patch)
{
    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
    {
        return Error{"auth_expired", "No session cookie", 401};
    }

    // `PUT /users/{id}` needs the currently-authenticated user id.
    const auto current = fetchCurrentUser();
    if (!isOk(current))
    {
        return std::get<Error>(current);
    }
    const auto& currentUser = value(current);
    const auto idIt = currentUser.find("id");
    if (idIt == currentUser.end() || !idIt->is_string())
    {
        return Error{"api_error", "Current user has no id field", 0};
    }
    const std::string userId = idIt->get<std::string>();

    std::vector<std::pair<std::wstring, std::wstring>> headers;
    headers.emplace_back(L"Cookie", toWide(cookieHeader));
    headers.emplace_back(L"Content-Type", L"application/json");

    const std::wstring path = toWide(fmt::format("/api/1/users/{}", userId));
    const std::string bodyUtf8 = patch.dump();
    const auto response = httpRequest(
        L"PUT",
        kApiHostW,
        path,
        headers,
        bodyUtf8,
        /*captureSetCookie*/ false);

    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status < 200 || response.status >= 300)
    {
        const auto msg = extractApiErrorMessage(response.body);
        return Error{"api_error", msg.value_or(fmt::format("/users/{} returned HTTP {}", userId, response.status)), static_cast<int>(response.status)};
    }

    return parseJsonBody(response, "/users/{id}");
}

Result<nlohmann::json> VrcApi::fetchWorldDetails(const std::string& worldId)
{
    if (worldId.empty())
    {
        return Error{"not_found", "Empty world id", 404};
    }

    const std::string cookieHeader = getLoadedCookieHeader();
    std::optional<std::string> authHeader = cookieHeader.empty() ? std::nullopt : std::make_optional(cookieHeader);

    const std::wstring path = toWide(fmt::format("/api/1/worlds/{}?apiKey={}", worldId, kApiKey));
    const auto response = httpGet(kApiHostW, path, authHeader);

    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status == 404) return Error{"not_found", fmt::format("World {} not found", worldId), 404};
    if (response.status != 200) return Error{"api_error", fmt::format("/worlds/{} returned HTTP {}", worldId, response.status), static_cast<int>(response.status)};

    return parseJsonBody(response, "/worlds/{id}");
}

Result<nlohmann::json> VrcApi::inviteSelf(const std::string& instanceLocation)
{
    if (instanceLocation.empty())
    {
        return Error{"invalid_params", "Empty instance location", 400};
    }

    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
    {
        return Error{"auth_expired", "No session cookie", 401};
    }

    std::vector<std::pair<std::wstring, std::wstring>> headers;
    headers.emplace_back(L"Cookie", toWide(cookieHeader));
    headers.emplace_back(L"Content-Type", L"application/json");

    const auto body = nlohmann::json{{"instanceId", instanceLocation}}.dump();
    const auto response = httpRequest(
        L"POST", kApiHostW,
        toWide(fmt::format("/api/1/invite/myself?apiKey={}", kApiKey)),
        headers, body, false);

    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status < 200 || response.status >= 300)
    {
        const auto msg = extractApiErrorMessage(response.body);
        return Error{"api_error", msg.value_or(fmt::format("invite/myself returned HTTP {}", response.status)),
            static_cast<int>(response.status)};
    }
    return nlohmann::json{{"ok", true}};
}

Result<nlohmann::json> VrcApi::addPlayerModeration(
    const std::string& type, const std::string& targetUserId)
{
    if (targetUserId.empty())
    {
        return Error{"invalid_params", "Empty targetUserId", 400};
    }

    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
    {
        return Error{"auth_expired", "No session cookie", 401};
    }

    std::vector<std::pair<std::wstring, std::wstring>> headers;
    headers.emplace_back(L"Cookie", toWide(cookieHeader));
    headers.emplace_back(L"Content-Type", L"application/json");

    const auto body = nlohmann::json{{"type", type}, {"moderated", targetUserId}}.dump();
    const auto response = httpRequest(
        L"POST", kApiHostW,
        toWide(fmt::format("/api/1/auth/user/playermoderations?apiKey={}", kApiKey)),
        headers, body, false);

    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status < 200 || response.status >= 300)
    {
        const auto msg = extractApiErrorMessage(response.body);
        return Error{"api_error", msg.value_or(fmt::format("playermoderations POST returned HTTP {}", response.status)),
            static_cast<int>(response.status)};
    }
    return parseJsonBody(response, "/auth/user/playermoderations");
}

Result<nlohmann::json> VrcApi::removePlayerModeration(const std::string& moderationId)
{
    if (moderationId.empty())
    {
        return Error{"invalid_params", "Empty moderationId", 400};
    }

    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
    {
        return Error{"auth_expired", "No session cookie", 401};
    }

    std::vector<std::pair<std::wstring, std::wstring>> headers;
    headers.emplace_back(L"Cookie", toWide(cookieHeader));

    const auto response = httpRequest(
        L"DELETE", kApiHostW,
        toWide(fmt::format("/api/1/auth/user/playermoderations/{}?apiKey={}", moderationId, kApiKey)),
        headers, "", false);

    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status < 200 || response.status >= 300)
    {
        const auto msg = extractApiErrorMessage(response.body);
        return Error{"api_error", msg.value_or(fmt::format("playermoderations DELETE returned HTTP {}", response.status)),
            static_cast<int>(response.status)};
    }
    return nlohmann::json{{"ok", true}};
}

// ─────────────────────────────────────────────────────────────────────────
// Notifications inbox — the other half of the Pipeline WebSocket work.
// Pipeline pushes new notifications in real time; these endpoints cover
// the initial fetch (bootstrap on login), hide/clear (clear the unread
// badge), and accept/respond (actually act on invites + friend requests).
// ─────────────────────────────────────────────────────────────────────────

Result<std::string> VrcApi::fetchPipelineToken()
{
    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
    {
        return Error{"auth_expired", "No session cookie", 401};
    }

    const auto response = httpGet(kApiHostW,
        toWide(fmt::format("/api/1/auth?apiKey={}", kApiKey)),
        cookieHeader);
    if (auto err = checkStandardHttpError(response, "/auth")) return *err;

    try
    {
        auto json = parseJsonBody(response, "/auth");
        if (!json.is_object() || !json.contains("token"))
        {
            return Error{"api_error", "auth response missing token", 0};
        }
        return json["token"].get<std::string>();
    }
    catch (const std::exception& ex)
    {
        return Error{"api_error", ex.what(), 0};
    }
}

Result<std::vector<nlohmann::json>> VrcApi::fetchNotifications(int count)
{
    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
    {
        return Error{"auth_expired", "No session cookie", 401};
    }

    const int clamped = std::clamp(count, 1, 100);
    const std::wstring path = toWide(fmt::format(
        "/api/1/auth/user/notifications?type=all&hidden=false&n={}&apiKey={}",
        clamped, kApiKey));

    const auto response = httpGet(kApiHostW, path, cookieHeader);
    if (auto err = checkStandardHttpError(response, "/auth/user/notifications")) return *err;

    try
    {
        auto json = parseJsonBody(response, "/auth/user/notifications");
        if (!json.is_array())
        {
            return Error{"api_error", "notifications response is not an array", 0};
        }
        std::vector<nlohmann::json> out;
        out.reserve(json.size());
        for (auto& entry : json)
        {
            out.push_back(std::move(entry));
        }
        return out;
    }
    catch (const std::exception& ex)
    {
        return Error{"api_error", ex.what(), 0};
    }
}

Result<nlohmann::json> VrcApi::acceptFriendRequest(const std::string& notificationId)
{
    if (notificationId.empty())
    {
        return Error{"invalid_params", "Empty notificationId", 400};
    }

    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
    {
        return Error{"auth_expired", "No session cookie", 401};
    }

    std::vector<std::pair<std::wstring, std::wstring>> headers;
    headers.emplace_back(L"Cookie", toWide(cookieHeader));

    const auto response = httpRequest(
        L"PUT", kApiHostW,
        toWide(fmt::format("/api/1/auth/user/notifications/{}/accept?apiKey={}",
                           notificationId, kApiKey)),
        headers, "", false);

    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status < 200 || response.status >= 300)
    {
        const auto msg = extractApiErrorMessage(response.body);
        return Error{"api_error",
            msg.value_or(fmt::format("notifications/accept returned HTTP {}", response.status)),
            static_cast<int>(response.status)};
    }
    return nlohmann::json{{"ok", true}};
}

Result<nlohmann::json> VrcApi::respondNotification(
    const std::string& notificationId,
    int responseSlot,
    const std::string& message)
{
    if (notificationId.empty())
    {
        return Error{"invalid_params", "Empty notificationId", 400};
    }

    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
    {
        return Error{"auth_expired", "No session cookie", 401};
    }

    std::vector<std::pair<std::wstring, std::wstring>> headers;
    headers.emplace_back(L"Cookie", toWide(cookieHeader));
    headers.emplace_back(L"Content-Type", L"application/json");

    nlohmann::json body{
        {"responseType", "message"},
        {"responseData", message},
    };
    // VRChat's invite response endpoint also supports a "slot" field
    // referencing saved message templates. Only send when non-zero so
    // the server defaults to the free-text path.
    if (responseSlot > 0)
    {
        body["slot"] = responseSlot;
    }

    const auto response = httpRequest(
        L"POST", kApiHostW,
        toWide(fmt::format("/api/1/invite/{}/response?apiKey={}",
                           notificationId, kApiKey)),
        headers, body.dump(), false);

    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status < 200 || response.status >= 300)
    {
        const auto msg = extractApiErrorMessage(response.body);
        return Error{"api_error",
            msg.value_or(fmt::format("invite/response returned HTTP {}", response.status)),
            static_cast<int>(response.status)};
    }
    return nlohmann::json{{"ok", true}};
}

Result<nlohmann::json> VrcApi::seeNotification(const std::string& notificationId)
{
    if (notificationId.empty())
    {
        return Error{"invalid_params", "Empty notificationId", 400};
    }

    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
    {
        return Error{"auth_expired", "No session cookie", 401};
    }

    std::vector<std::pair<std::wstring, std::wstring>> headers;
    headers.emplace_back(L"Cookie", toWide(cookieHeader));

    const auto response = httpRequest(
        L"PUT", kApiHostW,
        toWide(fmt::format("/api/1/auth/user/notifications/{}/see?apiKey={}",
                           notificationId, kApiKey)),
        headers, "", false);

    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status < 200 || response.status >= 300)
    {
        const auto msg = extractApiErrorMessage(response.body);
        return Error{"api_error",
            msg.value_or(fmt::format("notifications/see returned HTTP {}", response.status)),
            static_cast<int>(response.status)};
    }
    return nlohmann::json{{"ok", true}};
}

Result<nlohmann::json> VrcApi::hideNotification(const std::string& notificationId)
{
    if (notificationId.empty())
    {
        return Error{"invalid_params", "Empty notificationId", 400};
    }

    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
    {
        return Error{"auth_expired", "No session cookie", 401};
    }

    std::vector<std::pair<std::wstring, std::wstring>> headers;
    headers.emplace_back(L"Cookie", toWide(cookieHeader));

    const auto response = httpRequest(
        L"PUT", kApiHostW,
        toWide(fmt::format("/api/1/auth/user/notifications/{}/hide?apiKey={}",
                           notificationId, kApiKey)),
        headers, "", false);

    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status < 200 || response.status >= 300)
    {
        const auto msg = extractApiErrorMessage(response.body);
        return Error{"api_error",
            msg.value_or(fmt::format("notifications/hide returned HTTP {}", response.status)),
            static_cast<int>(response.status)};
    }
    return nlohmann::json{{"ok", true}};
}

Result<nlohmann::json> VrcApi::clearNotifications()
{
    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
    {
        return Error{"auth_expired", "No session cookie", 401};
    }

    std::vector<std::pair<std::wstring, std::wstring>> headers;
    headers.emplace_back(L"Cookie", toWide(cookieHeader));

    const auto response = httpRequest(
        L"PUT", kApiHostW,
        toWide(fmt::format("/api/1/auth/user/notifications/clear?apiKey={}", kApiKey)),
        headers, "", false);

    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status < 200 || response.status >= 300)
    {
        const auto msg = extractApiErrorMessage(response.body);
        return Error{"api_error",
            msg.value_or(fmt::format("notifications/clear returned HTTP {}", response.status)),
            static_cast<int>(response.status)};
    }
    return nlohmann::json{{"ok", true}};
}

Result<nlohmann::json> VrcApi::sendUserMessage(
    const std::string& targetUserId,
    const std::string& message)
{
    if (targetUserId.empty() || message.empty())
    {
        return Error{"invalid_params", "targetUserId and message required", 400};
    }

    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
    {
        return Error{"auth_expired", "No session cookie", 401};
    }

    std::vector<std::pair<std::wstring, std::wstring>> headers;
    headers.emplace_back(L"Cookie", toWide(cookieHeader));
    headers.emplace_back(L"Content-Type", L"application/json");

    // VRChat hard-caps message bodies at 2048 chars — clip with a
    // conservative-but-safe cutoff so the server doesn't reject the
    // whole message for a stray trailing paragraph.
    std::string clipped = message;
    if (clipped.size() > 2000)
    {
        clipped.resize(2000);
    }

    const auto body = nlohmann::json{
        {"slot", 0},
        {"message", clipped},
        {"messageType", "message"},
    }.dump();

    const auto response = httpRequest(
        L"POST", kApiHostW,
        toWide(fmt::format("/api/1/user/{}/message?apiKey={}",
                           targetUserId, kApiKey)),
        headers, body, false);

    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status < 200 || response.status >= 300)
    {
        const auto msg = extractApiErrorMessage(response.body);
        return Error{"api_error",
            msg.value_or(fmt::format("message send returned HTTP {}", response.status)),
            static_cast<int>(response.status)};
    }
    return nlohmann::json{{"ok", true}};
}

Result<nlohmann::json> VrcApi::inviteUser(
    const std::string& targetUserId,
    const std::string& instanceLocation,
    int messageSlot)
{
    if (targetUserId.empty() || instanceLocation.empty())
    {
        return Error{"invalid_params", "targetUserId and instanceLocation required", 400};
    }

    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
    {
        return Error{"auth_expired", "No session cookie", 401};
    }

    std::vector<std::pair<std::wstring, std::wstring>> headers;
    headers.emplace_back(L"Cookie", toWide(cookieHeader));
    headers.emplace_back(L"Content-Type", L"application/json");

    nlohmann::json body{
        {"instanceId", instanceLocation},
    };
    if (messageSlot > 0)
    {
        body["messageSlot"] = messageSlot;
    }

    const auto response = httpRequest(
        L"POST", kApiHostW,
        toWide(fmt::format("/api/1/invite/{}?apiKey={}", targetUserId, kApiKey)),
        headers, body.dump(), false);

    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status < 200 || response.status >= 300)
    {
        const auto msg = extractApiErrorMessage(response.body);
        return Error{"api_error",
            msg.value_or(fmt::format("invite/{} returned HTTP {}", targetUserId, response.status)),
            static_cast<int>(response.status)};
    }
    return nlohmann::json{{"ok", true}};
}

Result<nlohmann::json> VrcApi::searchWorlds(
    const std::string& query, const std::string& sort, int count, int offset)
{
    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
        return Error{"auth_expired", "No session cookie", 401};

    std::string encoded;
    for (unsigned char ch : query)
    {
        if (std::isalnum(ch) || ch == '-' || ch == '_' || ch == '.' || ch == '~')
            encoded += static_cast<char>(ch);
        else
        {
            char buf[4];
            std::snprintf(buf, sizeof(buf), "%%%02X", ch);
            encoded.append(buf);
        }
    }

    const auto path = toWide(fmt::format(
        "/api/1/worlds?apiKey={}&sort={}&order=descending&n={}&offset={}&search={}",
        kApiKey, sort, std::clamp(count, 1, 100), std::max(offset, 0), encoded));

    const auto response = httpGet(kApiHostW, path, cookieHeader);
    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status != 200)
        return Error{"api_error",
            fmt::format("/worlds search returned HTTP {}", response.status),
            static_cast<int>(response.status)};

    auto arr = parseJsonBody(response, "/worlds?search=");
    nlohmann::json results = nlohmann::json::array();
    for (auto& item : arr)
    {
        results.push_back({
            {"id",              item.value("id", "")},
            {"name",            item.value("name", "")},
            {"description",     item.value("description", "")},
            {"authorId",        item.value("authorId", "")},
            {"authorName",      item.value("authorName", "")},
            {"imageUrl",        item.value("imageUrl", "")},
            {"thumbnailImageUrl", item.value("thumbnailImageUrl", "")},
            {"releaseStatus",   item.value("releaseStatus", "")},
            {"capacity",        item.value("capacity", 0)},
            {"occupants",       item.value("occupants", 0)},
            {"favorites",       item.value("favorites", 0)},
            {"tags",            item.value("tags", nlohmann::json::array())},
            {"created_at",      item.value("created_at", "")},
            {"updated_at",      item.value("updated_at", "")},
        });
    }
    return nlohmann::json{{"worlds", results}};
}

Result<nlohmann::json> VrcApi::unfriend(const std::string& userId)
{
    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
        return Error{"auth_expired", "No session cookie", 401};

    std::vector<std::pair<std::wstring, std::wstring>> headers;
    headers.emplace_back(L"Cookie", toWide(cookieHeader));

    const auto path = toWide(fmt::format("/api/1/auth/user/friends/{}", userId));
    const auto response = httpRequest(L"DELETE", kApiHostW, path, headers, "");
    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status != 200 && response.status != 204)
        return Error{"api_error",
            fmt::format("unfriend returned HTTP {}", response.status),
            static_cast<int>(response.status)};

    return nlohmann::json{{"ok", true}};
}

Result<nlohmann::json> VrcApi::sendFriendRequest(const std::string& userId)
{
    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
        return Error{"auth_expired", "No session cookie", 401};

    std::vector<std::pair<std::wstring, std::wstring>> headers;
    headers.emplace_back(L"Cookie", toWide(cookieHeader));
    headers.emplace_back(L"Content-Type", L"application/json");

    const auto path = toWide(fmt::format("/api/1/user/{}/friendRequest", userId));
    const auto response = httpRequest(L"POST", kApiHostW, path, headers, "{}");
    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status != 200)
        return Error{"api_error",
            fmt::format("friendRequest returned HTTP {}", response.status),
            static_cast<int>(response.status)};

    return nlohmann::json{{"ok", true}};
}

Result<nlohmann::json> VrcApi::setGroupRepresentation(
    const std::string& groupId, bool isRepresenting)
{
    if (groupId.empty())
        return Error{"invalid_argument", "Empty group id", 400};

    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
        return Error{"auth_expired", "No session cookie", 401};

    std::vector<std::pair<std::wstring, std::wstring>> headers;
    headers.emplace_back(L"Cookie", toWide(cookieHeader));
    headers.emplace_back(L"Content-Type", L"application/json");

    const auto path = toWide(fmt::format("/api/1/groups/{}/representation", groupId));
    const nlohmann::json body = {{"isRepresenting", isRepresenting}};
    const auto response = httpRequest(L"PUT", kApiHostW, path, headers, body.dump());

    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status < 200 || response.status >= 300)
    {
        const auto msg = extractApiErrorMessage(response.body);
        return Error{"api_error",
            msg.value_or(fmt::format("/groups/{}/representation returned HTTP {}", groupId, response.status)),
            static_cast<int>(response.status)};
    }
    return nlohmann::json{{"ok", true}};
}

} // namespace vrcsm::core
