#include "../../pch.h"

#include "UpdateChecker.h"

#include <winhttp.h>

#include <chrono>
#include <cctype>
#include <charconv>
#include <mutex>
#include <regex>

namespace vrcsm::core::updater
{

namespace
{

constexpr const wchar_t* kApiHost = L"api.github.com";
constexpr const wchar_t* kLatestReleasePath = L"/repos/dwgx/VRCSM/releases/latest";
constexpr const wchar_t* kUserAgent = L"VRCSM-updater/1.0";
constexpr const wchar_t* kAccept = L"application/vnd.github+json";
constexpr std::chrono::minutes kCacheTtl{5};

struct HttpResponse
{
    long status{0};
    std::string body;
    std::optional<std::string> error;
};

struct WinHttpHandleDeleter
{
    void operator()(HINTERNET handle) const noexcept
    {
        if (handle != nullptr)
        {
            WinHttpCloseHandle(handle);
        }
    }
};

using UniqueWinHttpHandle = std::unique_ptr<void, WinHttpHandleDeleter>;

struct SemVer
{
    int major{0};
    int minor{0};
    int patch{0};
    std::string pre;

    static std::optional<SemVer> Parse(std::string_view text)
    {
        if (text.empty())
        {
            return std::nullopt;
        }

        SemVer value;
        std::size_t index = 0;

        const auto readPart = [&](int& out) -> bool
        {
            const std::size_t start = index;
            while (index < text.size() && std::isdigit(static_cast<unsigned char>(text[index])))
            {
                ++index;
            }
            if (start == index)
            {
                return false;
            }

            const auto [ptr, ec] = std::from_chars(text.data() + start, text.data() + index, out);
            return ec == std::errc{} && ptr == text.data() + index;
        };

        if (!readPart(value.major)) return std::nullopt;
        if (index >= text.size() || text[index] != '.') return std::nullopt;
        ++index;
        if (!readPart(value.minor)) return std::nullopt;
        if (index >= text.size() || text[index] != '.') return std::nullopt;
        ++index;
        if (!readPart(value.patch)) return std::nullopt;

        if (index < text.size())
        {
            if (text[index] != '-')
            {
                return std::nullopt;
            }
            ++index;
            value.pre = std::string(text.substr(index));
        }

        return value;
    }

    bool operator<(const SemVer& other) const noexcept
    {
        if (major != other.major) return major < other.major;
        if (minor != other.minor) return minor < other.minor;
        if (patch != other.patch) return patch < other.patch;
        if (pre.empty() && !other.pre.empty()) return false;
        if (!pre.empty() && other.pre.empty()) return true;
        return pre < other.pre;
    }
};

struct CachedValue
{
    std::chrono::steady_clock::time_point fetchedAt{};
    Result<UpdateInfo> result;
};

std::mutex& CacheMutex()
{
    static std::mutex mutex;
    return mutex;
}

std::optional<CachedValue>& CacheSlot()
{
    static std::optional<CachedValue> slot;
    return slot;
}

std::string StripLeadingV(std::string value)
{
    if (!value.empty() && (value.front() == 'v' || value.front() == 'V'))
    {
        value.erase(value.begin());
    }
    return value;
}

std::string ToLowerAscii(std::string value)
{
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch)
    {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

bool EndsWithCaseInsensitive(std::string_view value, std::string_view suffix)
{
    if (value.size() < suffix.size())
    {
        return false;
    }

    const std::size_t offset = value.size() - suffix.size();
    for (std::size_t i = 0; i < suffix.size(); ++i)
    {
        const auto lhs = static_cast<unsigned char>(value[offset + i]);
        const auto rhs = static_cast<unsigned char>(suffix[i]);
        if (std::tolower(lhs) != std::tolower(rhs))
        {
            return false;
        }
    }
    return true;
}

HttpResponse HttpsGet(
    const std::wstring& host,
    const std::wstring& pathAndQuery,
    const std::vector<std::pair<std::wstring, std::wstring>>& headers)
{
    HttpResponse result;

    UniqueWinHttpHandle session(WinHttpOpen(
        kUserAgent,
        WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
        WINHTTP_NO_PROXY_NAME,
        WINHTTP_NO_PROXY_BYPASS,
        0));
    if (!session)
    {
        result.error = fmt::format("WinHttpOpen failed ({})", GetLastError());
        return result;
    }

    WinHttpSetTimeouts(session.get(), 10000, 10000, 10000, 10000);

    UniqueWinHttpHandle connect(WinHttpConnect(
        session.get(),
        host.c_str(),
        INTERNET_DEFAULT_HTTPS_PORT,
        0));
    if (!connect)
    {
        result.error = fmt::format("WinHttpConnect failed ({})", GetLastError());
        return result;
    }

    UniqueWinHttpHandle request(WinHttpOpenRequest(
        connect.get(),
        L"GET",
        pathAndQuery.c_str(),
        nullptr,
        WINHTTP_NO_REFERER,
        WINHTTP_DEFAULT_ACCEPT_TYPES,
        WINHTTP_FLAG_SECURE));
    if (!request)
    {
        result.error = fmt::format("WinHttpOpenRequest failed ({})", GetLastError());
        return result;
    }

    std::wstring headerBlock;
    for (const auto& [name, value] : headers)
    {
        headerBlock += name;
        headerBlock += L": ";
        headerBlock += value;
        headerBlock += L"\r\n";
    }

    BOOL ok = WinHttpSendRequest(
        request.get(),
        headerBlock.empty() ? WINHTTP_NO_ADDITIONAL_HEADERS : headerBlock.c_str(),
        headerBlock.empty() ? 0 : static_cast<DWORD>(headerBlock.size()),
        WINHTTP_NO_REQUEST_DATA,
        0,
        0,
        0);
    if (ok)
    {
        ok = WinHttpReceiveResponse(request.get(), nullptr);
    }
    if (!ok)
    {
        result.error = fmt::format("WinHTTP request failed ({})", GetLastError());
        return result;
    }

    DWORD status = 0;
    DWORD statusSize = sizeof(status);
    if (!WinHttpQueryHeaders(
            request.get(),
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            WINHTTP_HEADER_NAME_BY_INDEX,
            &status,
            &statusSize,
            WINHTTP_NO_HEADER_INDEX))
    {
        result.error = fmt::format("WinHttpQueryHeaders failed ({})", GetLastError());
        return result;
    }
    result.status = static_cast<long>(status);

    DWORD available = 0;
    while (WinHttpQueryDataAvailable(request.get(), &available) && available > 0)
    {
        std::string chunk(available, '\0');
        DWORD read = 0;
        if (!WinHttpReadData(request.get(), chunk.data(), available, &read))
        {
            result.error = fmt::format("WinHttpReadData failed ({})", GetLastError());
            return result;
        }
        chunk.resize(read);
        result.body.append(chunk);
    }

    return result;
}

std::optional<std::string> JsonStringField(const nlohmann::json& json, const char* key)
{
    const auto it = json.find(key);
    if (it != json.end() && it->is_string())
    {
        return it->get<std::string>();
    }
    return std::nullopt;
}

std::optional<std::uint64_t> JsonUInt64Field(const nlohmann::json& json, const char* key)
{
    const auto it = json.find(key);
    if (it != json.end() && it->is_number_unsigned())
    {
        return it->get<std::uint64_t>();
    }
    if (it != json.end() && it->is_number_integer())
    {
        const auto value = it->get<std::int64_t>();
        if (value >= 0)
        {
            return static_cast<std::uint64_t>(value);
        }
    }
    return std::nullopt;
}

Result<UpdateInfo> FetchLatest()
{
    std::vector<std::pair<std::wstring, std::wstring>> headers;
    headers.emplace_back(L"Accept", kAccept);

    const HttpResponse response = HttpsGet(kApiHost, kLatestReleasePath, headers);
    if (response.error.has_value())
    {
        return Error{"update_network", *response.error, 0};
    }
    if (response.status < 200 || response.status >= 300)
    {
        return Error{
            "update_network",
            fmt::format("GitHub releases/latest returned HTTP {}", response.status),
            static_cast<int>(response.status)};
    }

    nlohmann::json doc;
    try
    {
        doc = nlohmann::json::parse(response.body);
    }
    catch (const std::exception& ex)
    {
        return Error{"update_invalid", fmt::format("release JSON parse failed: {}", ex.what()), 0};
    }

    const std::string currentVersion = VRCSM_VERSION_STRING;
    const auto currentSemVer = SemVer::Parse(currentVersion);
    if (!currentSemVer.has_value())
    {
        return Error{"update_invalid", fmt::format("invalid current version: {}", currentVersion), 0};
    }

    const std::string latestVersion = StripLeadingV(JsonStringField(doc, "tag_name").value_or(""));
    const auto latestSemVer = SemVer::Parse(latestVersion);
    if (!latestSemVer.has_value())
    {
        return Error{"update_invalid", "release tag_name missing or not a SemVer", 0};
    }

    UpdateInfo info;
    info.currentVersion = currentVersion;
    info.latestVersion = latestVersion;
    info.available = *currentSemVer < *latestSemVer;
    info.releaseNotesMarkdown = JsonStringField(doc, "body").value_or("");
    info.releaseUrl = JsonStringField(doc, "html_url").value_or(
        fmt::format("https://github.com/dwgx/VRCSM/releases/tag/v{}", latestVersion));

    if (const auto assetsIt = doc.find("assets"); assetsIt != doc.end() && assetsIt->is_array())
    {
        for (const auto& asset : *assetsIt)
        {
            const std::string name = JsonStringField(asset, "name").value_or("");
            if (!EndsWithCaseInsensitive(name, ".msi"))
            {
                continue;
            }

            info.downloadUrl = JsonStringField(asset, "browser_download_url");
            info.downloadSize = JsonUInt64Field(asset, "size");
            break;
        }
    }

    static const std::regex kShaRegex(
        R"(SHA256:\s*([0-9a-fA-F]{64}))",
        std::regex::icase);
    std::smatch match;
    if (std::regex_search(info.releaseNotesMarkdown, match, kShaRegex) && match.size() >= 2)
    {
        info.sha256 = ToLowerAscii(match[1].str());
    }

    return info;
}

} // namespace

Result<UpdateInfo> UpdateChecker::CheckLatest(bool forceRefresh)
{
    std::lock_guard<std::mutex> lock(CacheMutex());

    auto& cache = CacheSlot();
    const auto now = std::chrono::steady_clock::now();
    if (!forceRefresh && cache.has_value() && (now - cache->fetchedAt) < kCacheTtl)
    {
        return cache->result;
    }

    Result<UpdateInfo> result = FetchLatest();
    cache = CachedValue{now, result};
    return result;
}

} // namespace vrcsm::core::updater
