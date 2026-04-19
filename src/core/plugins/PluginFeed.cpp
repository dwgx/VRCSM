#include "PluginFeed.h"

#include "PluginStore.h"

#include <spdlog/spdlog.h>

#include <Windows.h>
#include <winhttp.h>

#include <fstream>

#pragma comment(lib, "Winhttp.lib")

namespace vrcsm::core::plugins
{

namespace
{

constexpr const wchar_t* kUserAgent = L"VRCSM-PluginFeed/1.0";
constexpr std::string_view kDefaultFeed = "https://dwgx.github.io/VRCSM/plugins.json";
constexpr std::chrono::minutes kCacheTtl{5};

struct CrackedUrl
{
    std::wstring host;
    std::wstring path;
    INTERNET_PORT port{INTERNET_DEFAULT_HTTPS_PORT};
    bool https{true};
};

std::optional<CrackedUrl> CrackUrl(const std::string& url)
{
    URL_COMPONENTSW comp{};
    comp.dwStructSize = sizeof(comp);
    comp.dwHostNameLength = (DWORD)-1;
    comp.dwUrlPathLength = (DWORD)-1;
    comp.dwSchemeLength = (DWORD)-1;

    const auto wUrl = toWide(url);
    if (!WinHttpCrackUrl(wUrl.c_str(), 0, 0, &comp)) return std::nullopt;

    CrackedUrl out;
    out.host.assign(comp.lpszHostName, comp.dwHostNameLength);
    out.path.assign(comp.lpszUrlPath, comp.dwUrlPathLength);
    out.port = comp.nPort;
    out.https = comp.nScheme == INTERNET_SCHEME_HTTPS;
    return out;
}

Error NetErr(std::string_view msg, int http = 0)
{
    return Error{"feed_network", std::string(msg), http};
}

Result<std::vector<std::byte>> HttpGetBytes(const std::string& url)
{
    const auto cracked = CrackUrl(url);
    if (!cracked) return NetErr(fmt::format("invalid URL: {}", url));

    using UniqueH = std::unique_ptr<void, decltype(&WinHttpCloseHandle)>;

    UniqueH hSession(WinHttpOpen(kUserAgent, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                                  WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0),
                      WinHttpCloseHandle);
    if (!hSession) return NetErr("WinHttpOpen failed");
    WinHttpSetTimeouts(hSession.get(), 30000, 30000, 30000, 120000);

    UniqueH hConnect(WinHttpConnect(hSession.get(), cracked->host.c_str(),
                                     cracked->port, 0),
                      WinHttpCloseHandle);
    if (!hConnect) return NetErr("WinHttpConnect failed");

    DWORD flags = cracked->https ? WINHTTP_FLAG_SECURE : 0;
    UniqueH hRequest(WinHttpOpenRequest(hConnect.get(), L"GET",
                                         cracked->path.empty() ? L"/" : cracked->path.c_str(),
                                         nullptr, WINHTTP_NO_REFERER,
                                         WINHTTP_DEFAULT_ACCEPT_TYPES, flags),
                      WinHttpCloseHandle);
    if (!hRequest) return NetErr("WinHttpOpenRequest failed");

    if (!WinHttpSendRequest(hRequest.get(),
                            WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                            WINHTTP_NO_REQUEST_DATA, 0, 0, 0))
    {
        return NetErr("WinHttpSendRequest failed");
    }
    if (!WinHttpReceiveResponse(hRequest.get(), nullptr))
    {
        return NetErr("WinHttpReceiveResponse failed");
    }

    DWORD status = 0;
    DWORD statusSize = sizeof(status);
    if (!WinHttpQueryHeaders(hRequest.get(),
                             WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                             WINHTTP_HEADER_NAME_BY_INDEX,
                             &status, &statusSize, WINHTTP_NO_HEADER_INDEX))
    {
        return NetErr("WinHttpQueryHeaders failed");
    }
    if (status < 200 || status >= 300)
    {
        return NetErr(fmt::format("HTTP {}", status), static_cast<int>(status));
    }

    std::vector<std::byte> body;
    std::vector<std::byte> chunk(64 * 1024);
    DWORD available = 0;
    while (WinHttpQueryDataAvailable(hRequest.get(), &available) && available > 0)
    {
        if (available > chunk.size()) chunk.resize(available);
        DWORD read = 0;
        if (!WinHttpReadData(hRequest.get(), chunk.data(), available, &read)) break;
        body.insert(body.end(), chunk.begin(), chunk.begin() + read);
    }
    return body;
}

std::optional<PluginShape> ParseShapeName(std::string_view raw)
{
    if (raw == "panel") return PluginShape::Panel;
    if (raw == "service") return PluginShape::Service;
    if (raw == "app") return PluginShape::App;
    return std::nullopt;
}

} // namespace

PluginFeed::PluginFeed() : m_feedUrl(kDefaultFeed) {}

PluginFeed& PluginFeed::Instance()
{
    static PluginFeed f;
    return f;
}

void PluginFeed::SetFeedUrl(std::string url)
{
    std::lock_guard<std::mutex> lk(m_mutex);
    m_feedUrl = std::move(url);
}

std::string PluginFeed::FeedUrl() const
{
    std::lock_guard<std::mutex> lk(m_mutex);
    return m_feedUrl;
}

std::filesystem::path PluginFeed::CacheFilePath() const
{
    return getAppDataRoot() / L"plugin-feed-cache.json";
}

Result<std::string> PluginFeed::DownloadText(const std::string& url)
{
    auto bytes = HttpGetBytes(url);
    if (!isOk(bytes)) return std::get<Error>(std::move(bytes));
    const auto& vec = std::get<std::vector<std::byte>>(bytes);
    return std::string(reinterpret_cast<const char*>(vec.data()), vec.size());
}

Result<std::vector<std::byte>> PluginFeed::DownloadBinary(const std::string& url)
{
    return HttpGetBytes(url);
}

Result<std::vector<std::byte>> PluginFeed::DownloadArchive(const std::string& url)
{
    return HttpGetBytes(url);
}

Result<MarketFeed> PluginFeed::ParseFeed(const std::string& text)
{
    nlohmann::json doc;
    try { doc = nlohmann::json::parse(text); }
    catch (...) { return Error{"feed_invalid", "feed JSON parse failed", 0}; }
    if (!doc.is_object()) return Error{"feed_invalid", "feed root must be object", 0};

    MarketFeed f;
    if (doc.contains("version") && doc["version"].is_number_integer()) f.version = doc["version"].get<int>();
    if (doc.contains("generated") && doc["generated"].is_string()) f.generated = doc["generated"].get<std::string>();

    if (!doc.contains("plugins") || !doc["plugins"].is_array())
    {
        return Error{"feed_invalid", "feed missing plugins array", 0};
    }

    for (const auto& j : doc["plugins"])
    {
        MarketEntry e;
        if (j.contains("id") && j["id"].is_string()) e.id = j["id"].get<std::string>();
        if (j.contains("name") && j["name"].is_string()) e.name = j["name"].get<std::string>();
        if (j.contains("version") && j["version"].is_string())
        {
            if (auto v = SemVer::parse(j["version"].get<std::string>())) e.version = *v;
        }
        if (j.contains("hostMin") && j["hostMin"].is_string())
        {
            if (auto v = SemVer::parse(j["hostMin"].get<std::string>())) e.hostMin = *v;
        }
        if (j.contains("shape") && j["shape"].is_string())
        {
            if (auto s = ParseShapeName(j["shape"].get<std::string>())) e.shape = *s;
        }
        if (j.contains("description") && j["description"].is_string()) e.description = j["description"].get<std::string>();
        if (j.contains("homepage") && j["homepage"].is_string()) e.homepage = j["homepage"].get<std::string>();
        if (j.contains("icon") && j["icon"].is_string()) e.iconUrl = j["icon"].get<std::string>();
        if (j.contains("download") && j["download"].is_string()) e.download = j["download"].get<std::string>();
        if (j.contains("sha256") && j["sha256"].is_string()) e.sha256 = j["sha256"].get<std::string>();
        if (j.contains("author"))
        {
            const auto& a = j["author"];
            if (a.is_string()) e.authorName = a.get<std::string>();
            else if (a.is_object())
            {
                if (a.contains("name") && a["name"].is_string()) e.authorName = a["name"].get<std::string>();
                if (a.contains("url") && a["url"].is_string()) e.authorUrl = a["url"].get<std::string>();
            }
        }
        // Accept entries without a download URL (useful for
        // "coming-soon" feed entries).
        if (e.id.empty() || e.name.empty()) continue;
        f.plugins.push_back(std::move(e));
    }
    return f;
}

Result<MarketFeed> PluginFeed::Fetch(bool force)
{
    const auto cachePath = CacheFilePath();
    std::error_code ec;

    if (!force)
    {
        if (auto lw = safeLastWriteTime(cachePath))
        {
            const auto age = std::filesystem::file_time_type::clock::now() - *lw;
            if (age < kCacheTtl)
            {
                std::ifstream in(cachePath, std::ios::binary);
                if (in)
                {
                    std::string text((std::istreambuf_iterator<char>(in)), {});
                    auto parsed = ParseFeed(text);
                    if (isOk(parsed)) return parsed;
                }
            }
        }
    }

    auto text = DownloadText(FeedUrl());
    if (!isOk(text))
    {
        // Fall back to cache on network failure if it exists at all.
        if (std::filesystem::is_regular_file(cachePath, ec))
        {
            std::ifstream in(cachePath, std::ios::binary);
            if (in)
            {
                std::string cached((std::istreambuf_iterator<char>(in)), {});
                auto parsed = ParseFeed(cached);
                if (isOk(parsed))
                {
                    spdlog::warn("[plugins] feed fetch failed ({}), served stale cache",
                                 std::get<Error>(text).message);
                    return parsed;
                }
            }
        }
        return std::get<Error>(std::move(text));
    }

    // Persist the raw text (so the cache survives even if we later
    // change the parser — we parse on read, not write).
    std::ofstream out(cachePath, std::ios::binary | std::ios::trunc);
    if (out)
    {
        out << std::get<std::string>(text);
        out.flush();
    }

    return ParseFeed(std::get<std::string>(text));
}

} // namespace vrcsm::core::plugins
