#include "../../pch.h"

#include "UpdateDownloader.h"
#include "UpdatePackage.h"

#include <winhttp.h>

#include <algorithm>
#include <cctype>
#include <fstream>
#include <system_error>

namespace vrcsm::core::updater
{

namespace
{

constexpr const wchar_t* kUserAgent = L"VRCSM-updater/1.0";

struct CrackedUrl
{
    std::wstring host;
    std::wstring path;
    INTERNET_PORT port{INTERNET_DEFAULT_HTTPS_PORT};
    bool https{true};
};

struct HttpResponse
{
    long status{0};
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

std::optional<CrackedUrl> CrackUrl(const std::string& url)
{
    URL_COMPONENTSW components{};
    components.dwStructSize = sizeof(components);
    components.dwHostNameLength = static_cast<DWORD>(-1);
    components.dwUrlPathLength = static_cast<DWORD>(-1);
    components.dwExtraInfoLength = static_cast<DWORD>(-1);
    components.dwSchemeLength = static_cast<DWORD>(-1);

    const auto wideUrl = toWide(url);
    if (!WinHttpCrackUrl(wideUrl.c_str(), 0, 0, &components))
    {
        return std::nullopt;
    }

    CrackedUrl cracked;
    cracked.host.assign(components.lpszHostName, components.dwHostNameLength);
    cracked.path.assign(components.lpszUrlPath, components.dwUrlPathLength);
    if (components.dwExtraInfoLength > 0 && components.lpszExtraInfo != nullptr)
    {
        cracked.path.append(components.lpszExtraInfo, components.dwExtraInfoLength);
    }
    cracked.port = components.nPort;
    cracked.https = components.nScheme == INTERNET_SCHEME_HTTPS;
    if (cracked.path.empty())
    {
        cracked.path = L"/";
    }
    return cracked;
}

void DeleteOldMsis(const std::filesystem::path& updatesDir, const std::filesystem::path& keepPath)
{
    std::error_code ec;
    if (!std::filesystem::is_directory(updatesDir, ec))
    {
        return;
    }

    for (const auto& entry : std::filesystem::directory_iterator(updatesDir, ec))
    {
        if (ec)
        {
            return;
        }

        if (!entry.is_regular_file())
        {
            continue;
        }

        const auto path = entry.path();
        if (_wcsicmp(path.c_str(), keepPath.c_str()) == 0)
        {
            continue;
        }
        if (_wcsicmp(path.extension().c_str(), L".msi") != 0)
        {
            continue;
        }

        std::error_code removeEc;
        std::filesystem::remove(path, removeEc);
    }
}

Result<std::monostate> VerifyExistingFile(const std::filesystem::path& path, const DownloadOptions& options)
{
    const auto size = UpdateFileSize(path);
    if (!size.has_value() || *size != options.expectedSize)
    {
        return Error{"update_size", "existing file size does not match expected size", 0};
    }

    if (options.expectedSha256.has_value())
    {
        auto actualSha = ComputeSha256(path, options.onProgress);
        if (!isOk(actualSha))
        {
            return std::get<Error>(std::move(actualSha));
        }
        std::string actual = value(actualSha);
        std::string expected = *options.expectedSha256;
        std::transform(actual.begin(), actual.end(), actual.begin(), [](unsigned char ch) {
            return static_cast<char>(std::tolower(ch));
        });
        std::transform(expected.begin(), expected.end(), expected.begin(), [](unsigned char ch) {
            return static_cast<char>(std::tolower(ch));
        });
        if (actual != expected)
        {
            return Error{"update_hash", "existing file SHA256 does not match expected hash", 0};
        }
    }

    return std::monostate{};
}

HttpResponse DownloadToFile(
    const CrackedUrl& cracked,
    std::uint64_t startOffset,
    const std::filesystem::path& partPath,
    std::uint64_t expectedSize,
    const std::function<void(std::uint64_t, std::uint64_t)>& onProgress)
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

    WinHttpSetTimeouts(session.get(), 30000, 30000, 30000, 300000);

    UniqueWinHttpHandle connect(WinHttpConnect(session.get(), cracked.host.c_str(), cracked.port, 0));
    if (!connect)
    {
        result.error = fmt::format("WinHttpConnect failed ({})", GetLastError());
        return result;
    }

    const DWORD flags = cracked.https ? WINHTTP_FLAG_SECURE : 0;
    UniqueWinHttpHandle request(WinHttpOpenRequest(
        connect.get(),
        L"GET",
        cracked.path.c_str(),
        nullptr,
        WINHTTP_NO_REFERER,
        WINHTTP_DEFAULT_ACCEPT_TYPES,
        flags));
    if (!request)
    {
        result.error = fmt::format("WinHttpOpenRequest failed ({})", GetLastError());
        return result;
    }

    std::wstring headerBlock = L"Accept: application/octet-stream\r\n";
    if (startOffset > 0)
    {
        // fmt v12 doesn't support wide-format literals without FMT_USE_WSTRING
        // flags — build the narrow string and widen once. Equivalent output,
        // no dependency on wchar_t format support.
        headerBlock += toWide(fmt::format("Range: bytes={}-\r\n", startOffset));
    }

    BOOL ok = WinHttpSendRequest(
        request.get(),
        headerBlock.c_str(),
        static_cast<DWORD>(headerBlock.size()),
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

    std::ios::openmode mode = std::ios::binary;
    if (startOffset > 0 && status == 206)
    {
        mode |= std::ios::app;
    }
    else
    {
        mode |= std::ios::trunc;
    }

    std::ofstream output(partPath, mode);
    if (!output)
    {
        result.error = "failed to open partial update file for write";
        return result;
    }

    std::uint64_t done = (startOffset > 0 && status == 206) ? startOffset : 0;
    if (onProgress)
    {
        onProgress(done, expectedSize);
    }

    DWORD available = 0;
    std::vector<char> buffer(128 * 1024);
    while (WinHttpQueryDataAvailable(request.get(), &available) && available > 0)
    {
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

        output.write(buffer.data(), static_cast<std::streamsize>(read));
        if (!output)
        {
            result.error = "failed while writing partial update file";
            return result;
        }

        done += read;
        if (onProgress)
        {
            onProgress(done, expectedSize);
        }
    }

    output.flush();
    if (!output)
    {
        result.error = "failed while flushing partial update file";
    }

    return result;
}

} // namespace

Result<std::filesystem::path> UpdateDownloader::Download(const DownloadOptions& options)
{
    if (options.url.empty())
    {
        return Error{"update_invalid", "download URL is required", 0};
    }
    if (options.expectedSize == 0)
    {
        return Error{"update_invalid", "expectedSize must be greater than zero", 0};
    }
    if (options.targetFileName.empty())
    {
        return Error{"update_invalid", "targetFileName is required", 0};
    }

    const std::filesystem::path targetPath = BuildUpdateTargetPath(options.targetFileName);
    const std::string normalizedTargetName = toUtf8(targetPath.filename().wstring());
    if (!IsSafeMsiFileName(options.targetFileName) || normalizedTargetName != options.targetFileName)
    {
        return Error{"update_invalid", "targetFileName must be a single .msi file name", 0};
    }

    const std::filesystem::path partPath = targetPath.native() + L".part";
    const auto cracked = CrackUrl(options.url);
    if (!cracked.has_value())
    {
        return Error{"update_invalid", fmt::format("invalid download URL: {}", options.url), 0};
    }
    // Defense-in-depth: an installer must come over https. The install-time
    // SHA256 gate is the primary defense, but refusing a plaintext transport
    // here stops a MITM from even feeding us bytes to hash.
    if (!cracked->https)
    {
        return Error{"update_invalid", "download URL must use https", 0};
    }

    if (const auto verified = VerifyExistingFile(targetPath, options); isOk(verified))
    {
        DeleteOldMsis(targetPath.parent_path(), targetPath);
        return targetPath;
    }

    std::error_code ec;
    std::filesystem::remove(targetPath, ec);

    std::uint64_t resumeBytes = UpdateFileSize(partPath).value_or(0);
    if (resumeBytes > options.expectedSize)
    {
        std::filesystem::remove(partPath, ec);
        resumeBytes = 0;
    }

    for (int attempt = 0; attempt < 2; ++attempt)
    {
        const HttpResponse response = DownloadToFile(
            *cracked,
            resumeBytes,
            partPath,
            options.expectedSize,
            options.onProgress);
        if (response.error.has_value())
        {
            return Error{"update_network", *response.error, 0};
        }

        if (response.status == 416 && resumeBytes > 0)
        {
            std::filesystem::remove(partPath, ec);
            resumeBytes = 0;
            continue;
        }

        if (response.status != 200 && response.status != 206)
        {
            return Error{
                "update_network",
                fmt::format("download returned HTTP {}", response.status),
                static_cast<int>(response.status)};
        }

        break;
    }

    const auto finalPartSize = UpdateFileSize(partPath);
    if (!finalPartSize.has_value() || *finalPartSize != options.expectedSize)
    {
        return Error{"update_size", "downloaded file size does not match expected size", 0};
    }

    if (options.expectedSha256.has_value())
    {
        auto actualSha = ComputeSha256(partPath, options.onProgress);
        if (!isOk(actualSha))
        {
            std::filesystem::remove(partPath, ec);
            return std::get<Error>(std::move(actualSha));
        }
        std::string actual = value(actualSha);
        std::string expected = *options.expectedSha256;
        std::transform(actual.begin(), actual.end(), actual.begin(), [](unsigned char ch) {
            return static_cast<char>(std::tolower(ch));
        });
        std::transform(expected.begin(), expected.end(), expected.begin(), [](unsigned char ch) {
            return static_cast<char>(std::tolower(ch));
        });
        if (actual != expected)
        {
            std::filesystem::remove(partPath, ec);
            return Error{"update_hash", "downloaded file SHA256 does not match expected hash", 0};
        }
    }

    std::filesystem::remove(targetPath, ec);
    std::filesystem::rename(partPath, targetPath, ec);
    if (ec)
    {
        return Error{"update_io", fmt::format("failed to finalize MSI: {}", ec.message()), 0};
    }

    DeleteOldMsis(targetPath.parent_path(), targetPath);
    return targetPath;
}

} // namespace vrcsm::core::updater
