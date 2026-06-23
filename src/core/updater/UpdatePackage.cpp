#include "../../pch.h"

#include "UpdatePackage.h"

#include <bcrypt.h>

#include <array>
#include <cctype>
#include <fstream>

namespace vrcsm::core::updater
{

namespace
{

std::string ToLowerAscii(std::string value)
{
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch)
    {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

bool EqualsIgnoreCase(std::string_view lhs, std::string_view rhs)
{
    if (lhs.size() != rhs.size())
    {
        return false;
    }

    for (std::size_t i = 0; i < lhs.size(); ++i)
    {
        if (std::tolower(static_cast<unsigned char>(lhs[i]))
            != std::tolower(static_cast<unsigned char>(rhs[i])))
        {
            return false;
        }
    }
    return true;
}

} // namespace

std::filesystem::path UpdatesDirectory()
{
    std::filesystem::path dir = getAppDataRoot() / L"updates";
    std::error_code ec;
    std::filesystem::create_directories(dir, ec);
    return dir;
}

std::filesystem::path BuildUpdateTargetPath(std::string_view targetFileName)
{
    const std::filesystem::path requested = utf8Path(targetFileName);
    return UpdatesDirectory() / requested.filename();
}

std::filesystem::path TargetPathForVersion(const std::string& version)
{
    return BuildUpdateTargetPath(fmt::format("VRCSM-{}.msi", version));
}

bool IsMsiFileName(std::string_view value)
{
    if (value.size() < 4)
    {
        return false;
    }
    return EqualsIgnoreCase(value.substr(value.size() - 4), ".msi");
}

bool IsSafeMsiFileName(std::string_view value)
{
    if (value.empty() || !IsMsiFileName(value))
    {
        return false;
    }

    const std::string asString(value);
    const std::filesystem::path requested = utf8Path(asString);
    return requested.filename() == requested;
}

std::optional<std::uint64_t> UpdateFileSize(const std::filesystem::path& path)
{
    std::error_code ec;
    if (!std::filesystem::is_regular_file(path, ec))
    {
        return std::nullopt;
    }

    const auto size = std::filesystem::file_size(path, ec);
    if (ec)
    {
        return std::nullopt;
    }
    return size;
}

Result<std::string> ComputeSha256(
    const std::filesystem::path& path,
    const std::function<void(std::uint64_t, std::uint64_t)>& onProgress)
{
    const auto total = UpdateFileSize(path);
    if (!total.has_value())
    {
        return Error{"update_io", "file missing before hash verification", 0};
    }

    std::ifstream input(path, std::ios::binary);
    if (!input)
    {
        return Error{"update_io", "failed to open file for hash verification", 0};
    }

    BCRYPT_ALG_HANDLE algorithm = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    std::vector<UCHAR> objectBuffer;
    std::vector<UCHAR> hashBuffer;

    auto cleanup = wil::scope_exit([&]()
    {
        if (hash != nullptr)
        {
            BCryptDestroyHash(hash);
        }
        if (algorithm != nullptr)
        {
            BCryptCloseAlgorithmProvider(algorithm, 0);
        }
    });

    if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) < 0)
    {
        return Error{"update_hash", "BCryptOpenAlgorithmProvider failed", 0};
    }

    DWORD objectSize = 0;
    DWORD cbResult = 0;
    if (BCryptGetProperty(
            algorithm,
            BCRYPT_OBJECT_LENGTH,
            reinterpret_cast<PUCHAR>(&objectSize),
            sizeof(objectSize),
            &cbResult,
            0) < 0)
    {
        return Error{"update_hash", "BCryptGetProperty(object length) failed", 0};
    }

    DWORD hashSize = 0;
    if (BCryptGetProperty(
            algorithm,
            BCRYPT_HASH_LENGTH,
            reinterpret_cast<PUCHAR>(&hashSize),
            sizeof(hashSize),
            &cbResult,
            0) < 0)
    {
        return Error{"update_hash", "BCryptGetProperty(hash length) failed", 0};
    }

    objectBuffer.resize(objectSize);
    hashBuffer.resize(hashSize);

    if (BCryptCreateHash(
            algorithm,
            &hash,
            objectBuffer.data(),
            static_cast<ULONG>(objectBuffer.size()),
            nullptr,
            0,
            0) < 0)
    {
        return Error{"update_hash", "BCryptCreateHash failed", 0};
    }

    std::vector<char> buffer(256 * 1024);
    std::uint64_t processed = 0;
    if (onProgress)
    {
        onProgress(0, *total);
    }

    while (input)
    {
        input.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
        const auto got = input.gcount();
        if (got <= 0)
        {
            break;
        }

        if (BCryptHashData(
                hash,
                reinterpret_cast<PUCHAR>(buffer.data()),
                static_cast<ULONG>(got),
                0) < 0)
        {
            return Error{"update_hash", "BCryptHashData failed", 0};
        }

        processed += static_cast<std::uint64_t>(got);
        if (onProgress)
        {
            onProgress(processed, *total);
        }
    }

    if (!input.eof() && input.fail())
    {
        return Error{"update_io", "failed while reading file for hash verification", 0};
    }

    if (BCryptFinishHash(hash, hashBuffer.data(), static_cast<ULONG>(hashBuffer.size()), 0) < 0)
    {
        return Error{"update_hash", "BCryptFinishHash failed", 0};
    }

    static constexpr char kHex[] = "0123456789abcdef";
    std::string hex;
    hex.reserve(hashBuffer.size() * 2);
    for (unsigned char byte : hashBuffer)
    {
        hex.push_back(kHex[(byte >> 4) & 0x0F]);
        hex.push_back(kHex[byte & 0x0F]);
    }

    return hex;
}

Result<std::monostate> ValidateDownloadedPackage(
    const std::filesystem::path& path,
    const PackageValidationOptions& options)
{
    if (options.version.empty())
    {
        return Error{"update_invalid", "installer version is required", 0};
    }
    if (options.expectedSize == 0)
    {
        return Error{"update_invalid", "installer expected size is required", 0};
    }
    if (!options.expectedFileName.empty() && !IsSafeMsiFileName(options.expectedFileName))
    {
        return Error{"update_invalid", "installer fileName must be a single .msi file name", 0};
    }

    std::error_code ec;
    const auto canonicalUpdatesDir = std::filesystem::weakly_canonical(UpdatesDirectory(), ec);
    if (ec)
    {
        return Error{"update_invalid", fmt::format("failed to resolve updates directory: {}", ec.message()), 0};
    }

    const auto canonicalPath = std::filesystem::weakly_canonical(path, ec);
    if (ec)
    {
        return Error{"update_invalid", fmt::format("failed to resolve installer path: {}", ec.message()), 0};
    }

    if (!ensureWithinBase(canonicalUpdatesDir, canonicalPath))
    {
        return Error{"update_invalid", "installer must be in the VRCSM updates directory", 0};
    }

    const auto expectedPath = std::filesystem::weakly_canonical(
        options.expectedFileName.empty()
            ? TargetPathForVersion(options.version)
            : BuildUpdateTargetPath(options.expectedFileName),
        ec);
    if (ec)
    {
        return Error{"update_invalid", fmt::format("failed to resolve expected installer path: {}", ec.message()), 0};
    }
    if (_wcsicmp(canonicalPath.c_str(), expectedPath.c_str()) != 0)
    {
        return Error{"update_invalid", "installer path does not match the requested version", 0};
    }

    if (!IsMsiFileName(toUtf8(canonicalPath.filename().wstring())))
    {
        return Error{"update_invalid", "installer path must end with .msi", 0};
    }

    const auto size = UpdateFileSize(canonicalPath);
    if (!size.has_value() || *size != options.expectedSize)
    {
        return Error{"update_size", "installer size does not match expected size", 0};
    }

    if (options.expectedSha256.has_value() && !options.expectedSha256->empty())
    {
        auto actualSha = ComputeSha256(canonicalPath, options.onProgress);
        if (!isOk(actualSha))
        {
            return std::get<Error>(std::move(actualSha));
        }
        if (ToLowerAscii(value(actualSha)) != ToLowerAscii(*options.expectedSha256))
        {
            return Error{"update_hash", "installer SHA256 does not match expected hash", 0};
        }
    }

    return std::monostate{};
}

} // namespace vrcsm::core::updater
