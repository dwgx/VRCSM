#include "VrcApi.h"

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
// VrcApi — anonymous read-only HTTP client against api.vrchat.cloud.
//
// Two dumb things took longer to figure out than they should have:
//
//   1. curl with no -A gets 403 from every /api/1/image/* endpoint. Made
//      the bug invisible from the frontend, because WebView2 sends its own
//      Chrome UA on <img> loads and everything worked there. Only showed up
//      when `dump_thumbnails` (a cold C++ harness) started getting 403s.
//      Fix: always send our own UA on every request. See kUserAgentW below.
//
//   2. /api/1/avatars/{id} refuses all anonymous callers with 401 — not
//      just private ones, *every* avatar. The public API key helps for
//      worlds but does nothing for avatars. Both VRCX and vrchatapi-python
//      require a real session cookie for avatar GETs, so we do too (read:
//      we don't, yet — we short-circuit the avatar branch in performLookup
//      and let the frontend fall back to a procedural cube).
//
// When v0.1.3 lands real auth, most of the `avatar-api-requires-auth`
// guard rail below becomes dead code.
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
constexpr const wchar_t* kUserAgentW = L"VRCSM/0.1.3 dwgx@vrcsm.local";

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
};

HttpResponse httpGet(const std::wstring& host, const std::wstring& pathAndQuery)
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
        L"GET",
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

    const std::wstring headers = L"Accept: application/json\r\n";

    BOOL ok = WinHttpSendRequest(
        hRequest,
        headers.c_str(),
        static_cast<DWORD>(headers.size()),
        WINHTTP_NO_REQUEST_DATA,
        0,
        0,
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

    // VRChat's `/api/1/avatars/{id}` endpoint refuses all anonymous
    // requests with HTTP 401 — even when given the public API key and even
    // when the target avatar is public. This is documented-but-undocumented
    // behaviour: the community API wrappers (VRCX, VRChatAPI-Wrapper)
    // require a real user session for any avatar lookup. Worlds are the
    // outlier — `/api/1/worlds/{id}` is genuinely anonymous.
    //
    // Rather than silently hammering the API on every page open and
    // polluting the disk cache with useless not_found entries, we
    // short-circuit the avatar branch here. The frontend knows to fall
    // back to a procedural preview. If/when VRCSM grows a VRChat login
    // flow, this guard comes out and `performLookup` learns to carry the
    // session cookie.
    if (kind == IdKind::Avatar)
    {
        out.error = "avatar-api-requires-auth";
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
    HttpResponse resp = httpGet(kApiHostW, path);

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
    else if (resp.status == 404 || resp.status == 401)
    {
        notFound = true; // genuine "this is private / doesn't exist"
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

} // namespace vrcsm::core
