#include "VrcApi.h"

#include "AuthStore.h"
#include "Common.h"

#include <chrono>
#include <fstream>
#include <mutex>
#include <system_error>
#include <unordered_map>

#include <Windows.h>
#include <KnownFolders.h>
#include <ShlObj.h>
#include <winhttp.h>

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
constexpr const wchar_t* kUserAgentW = L"VRCSM/0.2.0 dwgx@vrcsm.local";

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
    PWSTR raw = nullptr;
    if (FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &raw)) || raw == nullptr)
    {
        if (raw) CoTaskMemFree(raw);
        return std::filesystem::path{L"thumb-cache.json"}; // degraded fallback — cwd
    }
    std::filesystem::path base(raw);
    CoTaskMemFree(raw);
    return base / L"VRCSM" / L"thumb-cache.json";
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

HttpResponse httpRequest(
    const std::wstring& method,
    const std::wstring& host,
    const std::wstring& pathAndQuery,
    const std::vector<std::pair<std::wstring, std::wstring>>& headers = {},
    const std::string& bodyUtf8 = {},
    bool captureSetCookie = false)
{
    HttpResponse result;

    HINTERNET hSession = WinHttpOpen(
        kUserAgentW,
        WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
        WINHTTP_NO_PROXY_NAME,
        WINHTTP_NO_PROXY_BYPASS,
        0);
    if (!hSession)
    {
        result.error = fmt::format("WinHttpOpen failed ({})", GetLastError());
        return result;
    }

    // 8s for each phase — VRChat API usually answers in well under 1s.
    WinHttpSetTimeouts(hSession, 8000, 8000, 8000, 8000);

    HINTERNET hConnect = WinHttpConnect(hSession, host.c_str(), INTERNET_DEFAULT_HTTPS_PORT, 0);
    if (!hConnect)
    {
        result.error = fmt::format("WinHttpConnect failed ({})", GetLastError());
        WinHttpCloseHandle(hSession);
        return result;
    }

    HINTERNET hRequest = WinHttpOpenRequest(
        hConnect,
        method.c_str(),
        pathAndQuery.c_str(),
        nullptr,
        WINHTTP_NO_REFERER,
        WINHTTP_DEFAULT_ACCEPT_TYPES,
        WINHTTP_FLAG_SECURE);
    if (!hRequest)
    {
        result.error = fmt::format("WinHttpOpenRequest failed ({})", GetLastError());
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
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
        hRequest,
        headerBlock.c_str(),
        static_cast<DWORD>(headerBlock.size()),
        body,
        bodySize,
        bodySize,
        0);
    if (ok) ok = WinHttpReceiveResponse(hRequest, nullptr);
    if (!ok)
    {
        result.error = fmt::format("WinHttp request failed ({})", GetLastError());
        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        return result;
    }

    DWORD status = 0;
    DWORD statusSize = sizeof(status);
    WinHttpQueryHeaders(
        hRequest,
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
                    hRequest,
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
                    hRequest,
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
    while (WinHttpQueryDataAvailable(hRequest, &available) && available > 0)
    {
        std::string chunk(available, '\0');
        DWORD read = 0;
        if (!WinHttpReadData(hRequest, chunk.data(), available, &read))
        {
            break;
        }
        chunk.resize(read);
        result.body.append(chunk);
    }

    WinHttpCloseHandle(hRequest);
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);
    return result;
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

// Serialise network access so we don't hammer VRChat when the frontend
// asks for 40 thumbnails at once. One mutex for the full fetch-and-cache
// sequence — turns a "stampede" into a simple queue.
std::mutex& networkMutex()
{
    static std::mutex m;
    return m;
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

    // Cache lookup first — under the network mutex so we also serialise
    // writes through `cacheState`.
    std::lock_guard<std::mutex> lock(networkMutex());
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

std::optional<nlohmann::json> VrcApi::fetchCurrentUser()
{
    const std::string cookieHeader = AuthStore::Instance().BuildCookieHeader();
    if (cookieHeader.empty())
    {
        return std::nullopt;
    }

    // `/auth/user` is the cheapest "is this cookie still valid?" probe.
    // Keep the contract narrow: 401 becomes nullopt so callers can sign
    // out; everything else surfaces as an actual failure.
    const auto response = httpGet(
        kApiHostW,
        L"/api/1/auth/user",
        std::make_optional(cookieHeader));
    if (response.error.has_value())
    {
        throw std::runtime_error(*response.error);
    }
    if (response.status == 401)
    {
        return std::nullopt;
    }
    if (response.status != 200)
    {
        throw std::runtime_error(fmt::format("/auth/user returned HTTP {}", response.status));
    }

    return parseJsonBody(response, "/auth/user");
}

std::optional<nlohmann::json> VrcApi::fetchAvatarDetails(const std::string& avatarId)
{
    if (avatarId.empty())
    {
        return std::nullopt;
    }

    const std::string cookieHeader = AuthStore::Instance().BuildCookieHeader();
    if (cookieHeader.empty())
    {
        // Anonymous callers get 401 here; bail out early so we don't
        // even touch the network.
        return std::nullopt;
    }

    const std::wstring path = toWide(fmt::format("/api/1/avatars/{}", avatarId));
    const auto response = httpGet(
        kApiHostW,
        path,
        std::make_optional(cookieHeader));
    if (response.error.has_value())
    {
        throw std::runtime_error(*response.error);
    }
    if (response.status == 401 || response.status == 404)
    {
        // 401 — cookie stale or avatar private to someone else.
        // 404 — the avatar was deleted upstream. Both are
        // "nothing to show", not "blow up the inspector".
        return std::nullopt;
    }
    if (response.status != 200)
    {
        throw std::runtime_error(fmt::format("/avatars/{} returned HTTP {}", avatarId, response.status));
    }

    return parseJsonBody(response, "/avatars/{id}");
}

std::vector<nlohmann::json> VrcApi::fetchFriends(bool offline)
{
    const std::string cookieHeader = AuthStore::Instance().BuildCookieHeader();
    if (cookieHeader.empty())
    {
        return {};
    }

    // v0.2.0 keeps this intentionally boring: one page, 100 rows, enough
    // for the first frontend slice without inventing pagination state.
    const auto response = httpGet(
        kApiHostW,
        toWide(fmt::format(
            "/api/1/auth/user/friends?offline={}&n=100",
            offline ? "true" : "false")),
        std::make_optional(cookieHeader));
    if (response.error.has_value())
    {
        throw std::runtime_error(*response.error);
    }
    if (response.status == 401)
    {
        return {};
    }
    if (response.status != 200)
    {
        throw std::runtime_error(fmt::format("/auth/user/friends returned HTTP {}", response.status));
    }

    const auto doc = parseJsonBody(response, "/auth/user/friends");
    if (!doc.is_array())
    {
        throw std::runtime_error("/auth/user/friends returned a non-array payload");
    }

    std::vector<nlohmann::json> out;
    out.reserve(doc.size());
    for (const auto& item : doc)
    {
        out.push_back(item);
    }
    return out;
}

} // namespace vrcsm::core
