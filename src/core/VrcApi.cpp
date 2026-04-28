#include "VrcApi.h"

#include "AuthStore.h"
#include "Common.h"
#include "RateLimiter.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cctype>
#include <cstdlib>
#include <cstdio>
#include <fstream>
#include <functional>
#include <future>
#include <mutex>
#include <sstream>
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
        {"localUrl", r.localUrl.has_value() ? nlohmann::json(*r.localUrl) : nlohmann::json(nullptr)},
        {"cached", r.cached},
        {"imageCached", r.imageCached},
        {"source", r.source},
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

void to_json(nlohmann::json& j, const CachedImageResult& r)
{
    j = nlohmann::json{
        {"id", r.id},
        {"url", r.url},
        {"localUrl", r.localUrl.has_value() ? nlohmann::json(*r.localUrl) : nlohmann::json(nullptr)},
        {"imageCached", r.imageCached},
        {"source", r.source},
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

std::filesystem::path thumbCacheDir()
{
    const auto dir = getAppDataRoot() / L"thumb-cache-files";
    std::error_code ec;
    std::filesystem::create_directories(dir, ec);
    return dir;
}

std::string stableHashHex(std::string_view input)
{
    std::uint64_t h = 1469598103934665603ULL;
    for (unsigned char ch : input)
    {
        h ^= ch;
        h *= 1099511628211ULL;
    }

    std::string out;
    out.reserve(16);
    for (int round = 0; round < 2; ++round)
    {
        char buf[9]{};
        std::snprintf(buf, sizeof(buf), "%08x", static_cast<std::uint32_t>(h >> 32));
        out.append(buf, 8);
        h = h * 1099511628211ULL + 0x9E3779B97F4A7C15ULL;
    }
    return out;
}

std::wstring thumbnailExtensionFromUrl(const std::string& url)
{
    const auto q = url.find_first_of("?#");
    const auto pathOnly = q == std::string::npos ? url : url.substr(0, q);
    const auto slash = pathOnly.find_last_of('/');
    const auto dot = pathOnly.find_last_of('.');
    if (dot != std::string::npos && (slash == std::string::npos || dot > slash))
    {
        std::string ext = pathOnly.substr(dot);
        std::transform(ext.begin(), ext.end(), ext.begin(),
            [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        if (ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".webp")
        {
            return toWide(ext);
        }
    }
    return L".jpg";
}

std::filesystem::path thumbnailFileFor(const std::string& id, const std::string& url)
{
    const std::string key = stableHashHex(id + "|" + url);
    return thumbCacheDir() / toWide(key + std::string(toUtf8(thumbnailExtensionFromUrl(url))));
}

std::string readTextFile(const std::filesystem::path& path)
{
    std::ifstream in(path, std::ios::binary);
    if (!in) return {};
    std::stringstream buf;
    buf << in.rdbuf();
    return buf.str();
}

bool looksLikeImageFile(const std::filesystem::path& path);

bool trustedDownloadMetadataMatches(
    const std::filesystem::path& path,
    const std::string& url,
    std::uintmax_t bytes);

std::optional<std::string> localThumbnailUrlFor(
    const std::filesystem::path& path,
    const std::string& sourceUrl)
{
    std::error_code ec;
    if (!std::filesystem::is_regular_file(path, ec) || ec)
    {
        return std::nullopt;
    }
    if (std::filesystem::file_size(path, ec) == 0 || ec)
    {
        return std::nullopt;
    }
    const auto bytes = std::filesystem::file_size(path, ec);
    if (ec || !looksLikeImageFile(path) || !trustedDownloadMetadataMatches(path, sourceUrl, bytes))
    {
        return std::nullopt;
    }
    return fmt::format("https://thumb.local/{}", toUtf8(path.filename().wstring()));
}

bool looksLikeImageFile(const std::filesystem::path& path)
{
    std::ifstream in(path, std::ios::binary);
    if (!in) return false;
    std::array<unsigned char, 12> header{};
    in.read(reinterpret_cast<char*>(header.data()), static_cast<std::streamsize>(header.size()));
    const auto n = static_cast<std::size_t>(in.gcount());
    if (n >= 8
        && header[0] == 0x89 && header[1] == 'P' && header[2] == 'N' && header[3] == 'G'
        && header[4] == 0x0D && header[5] == 0x0A && header[6] == 0x1A && header[7] == 0x0A)
    {
        return true;
    }
    if (n >= 3 && header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF)
    {
        return true;
    }
    if (n >= 12
        && header[0] == 'R' && header[1] == 'I' && header[2] == 'F' && header[3] == 'F'
        && header[8] == 'W' && header[9] == 'E' && header[10] == 'B' && header[11] == 'P')
    {
        return true;
    }
    return false;
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

struct CrackedUrl
{
    std::wstring host;
    std::wstring pathAndQuery;
    INTERNET_PORT port{INTERNET_DEFAULT_HTTPS_PORT};
    DWORD flags{WINHTTP_FLAG_SECURE};
};

std::optional<CrackedUrl> crackHttpUrl(const std::string& url)
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
    out.port = urlComp.nPort;
    out.flags = _wcsicmp(scheme.c_str(), L"https") == 0 ? WINHTTP_FLAG_SECURE : 0;
    if (out.pathAndQuery.empty())
    {
        out.pathAndQuery = L"/";
    }
    return out;
}

bool isTrustedVrchatImageUrl(const std::string& url)
{
    const auto cracked = crackHttpUrl(url);
    if (!cracked || (cracked->flags & WINHTTP_FLAG_SECURE) == 0)
    {
        return false;
    }

    std::string host = toUtf8(cracked->host);
    std::transform(host.begin(), host.end(), host.begin(),
        [](unsigned char c) { return static_cast<char>(std::tolower(c)); });

    auto endsWith = [](const std::string& value, const std::string& suffix)
    {
        return value.size() >= suffix.size()
            && value.compare(value.size() - suffix.size(), suffix.size(), suffix) == 0;
    };

    return host == "api.vrchat.cloud"
        || endsWith(host, ".vrchat.cloud")
        || host == "assets.vrchat.com"
        || endsWith(host, ".assets.vrchat.com");
}

bool fileStartsWithAny(const std::filesystem::path& path, const std::vector<std::string>& magic)
{
    std::ifstream in(path, std::ios::binary);
    if (!in) return false;
    std::array<char, 16> header{};
    in.read(header.data(), static_cast<std::streamsize>(header.size()));
    const auto n = static_cast<std::size_t>(in.gcount());
    for (std::string_view m : magic)
    {
        if (n >= m.size() && std::equal(m.begin(), m.end(), header.begin()))
        {
            return true;
        }
    }
    return false;
}

std::filesystem::path downloadMetadataPath(const std::filesystem::path& path)
{
    std::filesystem::path meta = path;
    meta += L".download.json";
    return meta;
}

std::optional<std::uint64_t> queryContentLength(HINTERNET request)
{
    wchar_t buffer[64]{};
    DWORD size = sizeof(buffer);
    if (!WinHttpQueryHeaders(
            request,
            WINHTTP_QUERY_CONTENT_LENGTH,
            WINHTTP_HEADER_NAME_BY_INDEX,
            buffer,
            &size,
            WINHTTP_NO_HEADER_INDEX))
    {
        return std::nullopt;
    }

    wchar_t* end = nullptr;
    const auto value = std::wcstoull(buffer, &end, 10);
    if (end == buffer)
    {
        return std::nullopt;
    }
    return static_cast<std::uint64_t>(value);
}

bool trustedDownloadMetadataMatches(
    const std::filesystem::path& path,
    const std::string& url,
    std::uintmax_t bytes)
{
    const auto meta = nlohmann::json::parse(readTextFile(downloadMetadataPath(path)), nullptr, false);
    if (!meta.is_object())
    {
        return false;
    }
    return meta.value("url", std::string{}) == url
        && meta.value("bytes", std::uintmax_t{0}) == bytes
        && meta.value("complete", false);
}

void writeDownloadMetadataBestEffort(
    const std::filesystem::path& path,
    const std::string& url,
    std::uintmax_t bytes)
{
    const nlohmann::json meta{
        {"schema", 1},
        {"url", url},
        {"bytes", bytes},
        {"complete", true},
        {"writtenAt", nowIso()},
    };
    std::ofstream out(downloadMetadataPath(path), std::ios::binary | std::ios::trunc);
    if (out)
    {
        out << meta.dump(2);
    }
}

bool downloadUrlToFileAtomic(
    const std::string& url,
    const std::filesystem::path& destPath,
    const std::function<bool(const std::filesystem::path&)>& validate,
    bool allowExisting)
{
    std::error_code ec;
    if (allowExisting && std::filesystem::is_regular_file(destPath, ec) && !ec)
    {
        const auto existingBytes = std::filesystem::file_size(destPath, ec);
        if (!ec
            && existingBytes > 0
            && (!validate || validate(destPath))
            && trustedDownloadMetadataMatches(destPath, url, existingBytes))
        {
            return true;
        }
        ec.clear();
    }

    std::filesystem::create_directories(destPath.parent_path(), ec);
    if (ec)
    {
        spdlog::warn("VrcApi: failed to create download directory: {}", ec.message());
        return false;
    }

    const auto cracked = crackHttpUrl(url);
    if (!cracked)
    {
        spdlog::warn("VrcApi: download failed to crack URL: {}", url);
        return false;
    }

    std::filesystem::path partPath = destPath;
    partPath += L".part";
    std::filesystem::remove(partPath, ec);

    UniqueWinHttpHandle hSession(WinHttpOpen(
        kUserAgentW,
        WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
        WINHTTP_NO_PROXY_NAME,
        WINHTTP_NO_PROXY_BYPASS,
        0));
    if (!hSession) return false;
    WinHttpSetTimeouts(hSession.get(), 60000, 60000, 60000, 300000);

    UniqueWinHttpHandle hConnect(WinHttpConnect(hSession.get(), cracked->host.c_str(), cracked->port, 0));
    if (!hConnect) return false;
    UniqueWinHttpHandle hRequest(WinHttpOpenRequest(
        hConnect.get(),
        L"GET",
        cracked->pathAndQuery.c_str(),
        nullptr,
        WINHTTP_NO_REFERER,
        WINHTTP_DEFAULT_ACCEPT_TYPES,
        cracked->flags));
    if (!hRequest) return false;

    std::wstring headerBlock = L"Accept: */*\r\n";
    const auto cookie = getLoadedCookieHeader();
    if (!cookie.empty())
    {
        headerBlock += L"Cookie: " + toWide(cookie) + L"\r\n";
    }

    BOOL ok = WinHttpSendRequest(
        hRequest.get(),
        headerBlock.c_str(),
        static_cast<DWORD>(headerBlock.size()),
        WINHTTP_NO_REQUEST_DATA,
        0,
        0,
        0);
    if (ok) ok = WinHttpReceiveResponse(hRequest.get(), nullptr);
    if (!ok) return false;

    DWORD status = 0;
    DWORD statusSize = sizeof(status);
    WinHttpQueryHeaders(
        hRequest.get(),
        WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
        WINHTTP_HEADER_NAME_BY_INDEX,
        &status,
        &statusSize,
        WINHTTP_NO_HEADER_INDEX);
    if (status < 200 || status >= 300)
    {
        spdlog::warn("VrcApi: download failed with HTTP status {}", status);
        return false;
    }
    const auto expectedBytes = queryContentLength(hRequest.get());

    std::ofstream out(partPath, std::ios::binary | std::ios::trunc);
    if (!out)
    {
        spdlog::warn("VrcApi: download failed to open temp file for write");
        return false;
    }

    DWORD available = 0;
    bool readOk = true;
    std::uint64_t totalRead = 0;
    std::vector<char> chunk(128 * 1024);
    while (true)
    {
        if (!WinHttpQueryDataAvailable(hRequest.get(), &available))
        {
            readOk = false;
            break;
        }
        if (available == 0)
        {
            break;
        }
        if (available > chunk.size()) chunk.resize(available);
        DWORD read = 0;
        if (!WinHttpReadData(hRequest.get(), chunk.data(), available, &read))
        {
            readOk = false;
            break;
        }
        if (read == 0)
        {
            break;
        }
        out.write(chunk.data(), read);
        if (!out)
        {
            readOk = false;
            break;
        }
        totalRead += read;
    }
    out.flush();
    if (!out)
    {
        readOk = false;
    }
    out.close();

    const auto partBytes = std::filesystem::is_regular_file(partPath, ec)
        ? std::filesystem::file_size(partPath, ec)
        : 0;
    if (!readOk
        || ec
        || partBytes == 0
        || (expectedBytes && partBytes != *expectedBytes)
        || (expectedBytes && totalRead != *expectedBytes)
        || !std::filesystem::is_regular_file(partPath, ec)
        || ec
        || (validate && !validate(partPath)))
    {
        std::filesystem::remove(partPath, ec);
        return false;
    }

    std::filesystem::remove(destPath, ec);
    ec.clear();
    std::filesystem::rename(partPath, destPath, ec);
    if (ec)
    {
        std::filesystem::remove(partPath, ec);
        return false;
    }
    writeDownloadMetadataBestEffort(destPath, url, partBytes);
    return true;
}

void trimCacheDirectory(const std::filesystem::path& dir, std::uintmax_t maxBytes)
{
    std::error_code ec;
    if (!std::filesystem::exists(dir, ec) || ec) return;

    struct Entry
    {
        std::filesystem::path path;
        std::uintmax_t bytes{0};
        std::filesystem::file_time_type atime{};
    };

    std::vector<Entry> entries;
    std::uintmax_t total = 0;
    for (const auto& entry : std::filesystem::directory_iterator(dir, ec))
    {
        if (ec) break;
        if (!entry.is_regular_file(ec) || ec) continue;
        const auto path = entry.path();
        if (path.extension() == L".part") continue;
        const auto bytes = std::filesystem::file_size(path, ec);
        if (ec) continue;
        total += bytes;
        entries.push_back({path, bytes, std::filesystem::last_write_time(path, ec)});
        ec.clear();
    }
    if (total <= maxBytes) return;

    std::sort(entries.begin(), entries.end(), [](const Entry& a, const Entry& b) {
        return a.atime < b.atime;
    });
    for (const auto& entry : entries)
    {
        if (total <= maxBytes) break;
        std::filesystem::remove(entry.path, ec);
        if (!ec && total >= entry.bytes)
        {
            total -= entry.bytes;
        }
        ec.clear();
    }
}

void ensureLocalThumbnail(ThumbnailResult& out)
{
    if (!out.url.has_value() || out.url->empty())
    {
        return;
    }

    const auto path = thumbnailFileFor(out.id, *out.url);
    if (auto localUrl = localThumbnailUrlFor(path, *out.url))
    {
        out.localUrl = localUrl;
        out.imageCached = true;
        std::error_code ec;
        (void)std::filesystem::last_write_time(path, std::filesystem::file_time_type::clock::now(), ec);
        return;
    }

    if (downloadUrlToFileAtomic(*out.url, path, looksLikeImageFile, false))
    {
        out.localUrl = localThumbnailUrlFor(path, *out.url);
        out.imageCached = out.localUrl.has_value();
        trimCacheDirectory(thumbCacheDir(), 512ull * 1024ull * 1024ull);
    }
}

CachedImageResult cacheRawImageUrl(const std::string& id, const std::string& url)
{
    CachedImageResult out;
    out.id = id;
    out.url = url;
    out.source = "network";

    if (id.empty() || url.empty())
    {
        out.source = "negative";
        out.error = "missing-id-or-url";
        return out;
    }
    if (!isTrustedVrchatImageUrl(url))
    {
        out.source = "negative";
        out.error = "untrusted-image-url";
        return out;
    }

    const auto path = thumbnailFileFor("image|" + id, url);
    if (auto localUrl = localThumbnailUrlFor(path, url))
    {
        out.localUrl = localUrl;
        out.imageCached = true;
        out.source = "disk";
        std::error_code ec;
        (void)std::filesystem::last_write_time(path, std::filesystem::file_time_type::clock::now(), ec);
        return out;
    }

    if (downloadUrlToFileAtomic(url, path, looksLikeImageFile, false))
    {
        out.localUrl = localThumbnailUrlFor(path, url);
        out.imageCached = out.localUrl.has_value();
        out.source = out.imageCached ? "network" : "negative";
        trimCacheDirectory(thumbCacheDir(), 512ull * 1024ull * 1024ull);
    }
    else
    {
        out.source = "negative";
        out.error = "download-failed";
    }

    return out;
}

ThumbnailResult performLookup(const std::string& id, bool downloadImage)
{
    ThumbnailResult out;
    out.id = id;
    out.source = "network";

    const IdKind kind = classify(id);
    if (kind == IdKind::Unknown)
    {
        out.error = "unknown-id-prefix";
        out.source = "negative";
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
                out.source = "disk";
                if (downloadImage) ensureLocalThumbnail(out);
                return out;
            }
            if (e.notFound && age < kNotFoundTtlSeconds)
            {
                out.cached = true; // negative cache hit
                out.source = "negative";
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
        out.source = "network";
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
        out.source = "network";
        return out;
    }
    else
    {
        // 429, 500, 503 — treat as transient, report error but don't cache
        out.error = fmt::format("HTTP {}", resp.status);
        out.source = "network";
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
    out.source = notFound ? "negative" : "network";
    if (downloadImage) ensureLocalThumbnail(out);
    return out;
}
} // namespace

bool VrcApi::isTrustedBundleFile(
    const std::string& url,
    const std::filesystem::path& path)
{
    std::error_code ec;
    if (!std::filesystem::is_regular_file(path, ec) || ec)
    {
        return false;
    }
    const auto bytes = std::filesystem::file_size(path, ec);
    return !ec
        && bytes > 0
        && fileStartsWithAny(path, {"UnityFS", "UnityWeb", "UnityRaw", "UnityArchive"})
        && trustedDownloadMetadataMatches(path, url, bytes);
}

ThumbnailResult VrcApi::fetchThumbnail(const std::string& id, bool downloadImage)
{
    return performLookup(id, downloadImage);
}

std::vector<ThumbnailResult> VrcApi::fetchThumbnails(const std::vector<std::string>& ids, bool downloadImages)
{
    // Fire performLookup() in parallel up to a small fan-out so a 40-row
    // avatar list resolves in roughly one HTTP RTT instead of N. The on-disk
    // cache mutex inside performLookup serializes the cache section only;
    // the network leg is already lock-free per the existing comment block.
    constexpr std::size_t kMaxConcurrent = 8;
    std::vector<ThumbnailResult> out(ids.size());
    if (ids.empty()) return out;

    // Deduplicate within the batch so a list with the same id repeated does
    // not race two parallel network requests for it. The first occurrence
    // does the lookup; later occurrences copy the result.
    std::unordered_map<std::string, std::size_t> firstIndex;
    firstIndex.reserve(ids.size());
    std::vector<std::size_t> uniqueIndices;
    uniqueIndices.reserve(ids.size());
    for (std::size_t i = 0; i < ids.size(); ++i)
    {
        if (firstIndex.try_emplace(ids[i], i).second)
        {
            uniqueIndices.push_back(i);
        }
    }

    std::size_t cursor = 0;
    while (cursor < uniqueIndices.size())
    {
        const std::size_t batchEnd = std::min(cursor + kMaxConcurrent, uniqueIndices.size());
        std::vector<std::future<ThumbnailResult>> futures;
        futures.reserve(batchEnd - cursor);
        for (std::size_t i = cursor; i < batchEnd; ++i)
        {
            const std::size_t idx = uniqueIndices[i];
            futures.push_back(std::async(std::launch::async,
                [id = ids[idx], downloadImages]() { return performLookup(id, downloadImages); }));
        }
        for (std::size_t i = cursor; i < batchEnd; ++i)
        {
            out[uniqueIndices[i]] = futures[i - cursor].get();
        }
        cursor = batchEnd;
    }

    // Fill in duplicate slots from their canonical first-occurrence result.
    for (std::size_t i = 0; i < ids.size(); ++i)
    {
        const auto it = firstIndex.find(ids[i]);
        if (it != firstIndex.end() && it->second != i)
        {
            out[i] = out[it->second];
        }
    }
    return out;
}

CachedImageResult VrcApi::cacheImageUrl(const std::string& id, const std::string& url)
{
    return cacheRawImageUrl(id, url);
}

std::vector<CachedImageResult> VrcApi::cacheImageUrls(
    const std::vector<std::pair<std::string, std::string>>& items)
{
    constexpr std::size_t kMaxConcurrent = 4;
    std::vector<CachedImageResult> out(items.size());
    if (items.empty()) return out;

    std::size_t cursor = 0;
    while (cursor < items.size())
    {
        const std::size_t batchEnd = std::min(cursor + kMaxConcurrent, items.size());
        std::vector<std::future<CachedImageResult>> futures;
        futures.reserve(batchEnd - cursor);
        for (std::size_t i = cursor; i < batchEnd; ++i)
        {
            const auto [id, url] = items[i];
            futures.push_back(std::async(std::launch::async, [id, url] {
                return cacheRawImageUrl(id, url);
            }));
        }
        for (std::size_t i = cursor; i < batchEnd; ++i)
        {
            out[i] = futures[i - cursor].get();
        }
        cursor = batchEnd;
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
    return downloadUrlToFileAtomic(
        url,
        destPath,
        [](const std::filesystem::path& path)
        {
            return fileStartsWithAny(path, {"UnityFS", "UnityWeb", "UnityRaw", "UnityArchive"});
        },
        true);
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

Result<nlohmann::json> VrcApi::searchUsers(
    const std::string& query, int count, int offset)
{
    const std::string cookieHeader = getLoadedCookieHeader();
    if (cookieHeader.empty())
    {
        return Error{"auth_expired", "No session cookie", 401};
    }

    const auto path = toWide(fmt::format(
        "/api/1/users?apiKey={}&n={}&offset={}&search={}",
        kApiKey, std::clamp(count, 1, 50), std::max(offset, 0), percentEncode(query)));

    const auto response = httpGet(kApiHostW, path, cookieHeader);
    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status != 200)
    {
        return Error{"api_error",
            fmt::format("/users search returned HTTP {}", response.status),
            static_cast<int>(response.status)};
    }

    const auto arr = parseJsonBody(response, "/users?search=");
    if (!arr.is_array())
    {
        return Error{"api_error", "/users search returned a non-array payload", 0};
    }

    nlohmann::json results = nlohmann::json::array();
    for (const auto& item : arr)
    {
        results.push_back({
            {"id", item.value("id", "")},
            {"displayName", item.value("displayName", "")},
            {"profilePicOverride", item.value("profilePicOverride", "")},
            {"currentAvatarImageUrl", item.value("currentAvatarImageUrl", "")},
            {"currentAvatarThumbnailImageUrl", item.value("currentAvatarThumbnailImageUrl", "")},
            {"status", item.value("status", "")},
        });
    }
    return nlohmann::json{{"users", results}};
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

Result<nlohmann::json> VrcApi::requestInvite(const std::string& targetUserId, int requestSlot)
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

    nlohmann::json body = nlohmann::json::object();
    if (requestSlot > 0) body["requestSlot"] = requestSlot;

    const auto response = httpRequest(
        L"POST", kApiHostW,
        toWide(fmt::format("/api/1/requestInvite/{}?apiKey={}", targetUserId, kApiKey)),
        headers, body.dump(), false);

    if (auto err = checkStandardHttpError(response, "")) return *err;
    if (response.status < 200 || response.status >= 300)
    {
        const auto msg = extractApiErrorMessage(response.body);
        return Error{"api_error",
            msg.value_or(fmt::format("requestInvite/{} returned HTTP {}", targetUserId, response.status)),
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

    // VRChat quietly routes "not a friend" / "channel disabled" / "rate
    // limited" to a generic 'endpoint not implemented' 404. Log the raw
    // status + body at debug level so we can distinguish those cases when
    // a user reports a failure.
    spdlog::debug("sendUserMessage target={} status={} body={}",
        targetUserId, response.status,
        response.body.size() > 500 ? response.body.substr(0, 500) : response.body);

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
