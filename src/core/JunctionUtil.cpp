#include "JunctionUtil.h"

#include "PathProbe.h"

#include <cstring>
#include <system_error>
#include <vector>

#include <Windows.h>
#include <winioctl.h>

namespace vrcsm::core
{

namespace
{
struct ReparseDataBufferMountPoint
{
    DWORD ReparseTag;
    WORD ReparseDataLength;
    WORD Reserved;
    WORD SubstituteNameOffset;
    WORD SubstituteNameLength;
    WORD PrintNameOffset;
    WORD PrintNameLength;
    WCHAR PathBuffer[1];
};

constexpr DWORD kReparseTagMountPoint = 0xA0000003L;

std::wstring withNtPrefix(const std::filesystem::path& target)
{
    auto ws = std::filesystem::absolute(target).wstring();
    if (ws.rfind(L"\\??\\", 0) == 0) return ws;
    return L"\\??\\" + ws;
}
} // namespace

bool JunctionUtil::isReparsePoint(const std::filesystem::path& p)
{
    const DWORD attrs = GetFileAttributesW(p.c_str());
    if (attrs == INVALID_FILE_ATTRIBUTES) return false;
    return (attrs & FILE_ATTRIBUTE_REPARSE_POINT) != 0;
}

std::optional<std::filesystem::path> JunctionUtil::readJunctionTarget(const std::filesystem::path& p)
{
    HANDLE handle = CreateFileW(
        p.c_str(),
        0,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr,
        OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
        nullptr);
    if (handle == INVALID_HANDLE_VALUE) return std::nullopt;

    std::vector<unsigned char> buffer(MAXIMUM_REPARSE_DATA_BUFFER_SIZE);
    DWORD returned = 0;
    const BOOL ok = DeviceIoControl(
        handle,
        FSCTL_GET_REPARSE_POINT,
        nullptr,
        0,
        buffer.data(),
        static_cast<DWORD>(buffer.size()),
        &returned,
        nullptr);
    CloseHandle(handle);
    if (!ok) return std::nullopt;

    const auto* data = reinterpret_cast<const ReparseDataBufferMountPoint*>(buffer.data());
    if (data->ReparseTag != kReparseTagMountPoint) return std::nullopt;

    const wchar_t* base = data->PathBuffer + (data->SubstituteNameOffset / sizeof(WCHAR));
    std::wstring sub(base, data->SubstituteNameLength / sizeof(WCHAR));
    if (sub.rfind(L"\\??\\", 0) == 0) sub = sub.substr(4);
    return std::filesystem::path(sub);
}

Result<std::monostate> JunctionUtil::createJunction(
    const std::filesystem::path& source,
    const std::filesystem::path& target)
{
    std::error_code ec;
    if (!std::filesystem::exists(target, ec))
    {
        return Error{"target_missing", "target path must exist before creating junction"};
    }
    if (std::filesystem::exists(source, ec))
    {
        return Error{"source_exists", "source path already exists; remove it first"};
    }
    if (!std::filesystem::create_directory(source, ec) || ec)
    {
        return Error{"create_dir_failed", ec.message()};
    }

    HANDLE handle = CreateFileW(
        source.c_str(),
        GENERIC_WRITE,
        0,
        nullptr,
        OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
        nullptr);
    if (handle == INVALID_HANDLE_VALUE)
    {
        return Error{"open_failed", "Could not open junction directory for write"};
    }

    const std::wstring substituteName = withNtPrefix(target);
    const std::wstring printName = std::filesystem::absolute(target).wstring();

    const std::size_t pathBytes =
        (substituteName.size() + 1 + printName.size() + 1) * sizeof(WCHAR);
    const std::size_t totalBytes = sizeof(ReparseDataBufferMountPoint) + pathBytes - sizeof(WCHAR);

    std::vector<unsigned char> buffer(totalBytes, 0);
    auto* rdb = reinterpret_cast<ReparseDataBufferMountPoint*>(buffer.data());
    rdb->ReparseTag = kReparseTagMountPoint;
    rdb->ReparseDataLength = static_cast<WORD>(pathBytes + 8);
    rdb->SubstituteNameOffset = 0;
    rdb->SubstituteNameLength = static_cast<WORD>(substituteName.size() * sizeof(WCHAR));
    rdb->PrintNameOffset = static_cast<WORD>((substituteName.size() + 1) * sizeof(WCHAR));
    rdb->PrintNameLength = static_cast<WORD>(printName.size() * sizeof(WCHAR));

    auto* dst = rdb->PathBuffer;
    std::memcpy(dst, substituteName.data(), substituteName.size() * sizeof(WCHAR));
    dst[substituteName.size()] = 0;
    std::memcpy(dst + substituteName.size() + 1, printName.data(), printName.size() * sizeof(WCHAR));
    dst[substituteName.size() + 1 + printName.size()] = 0;

    DWORD returned = 0;
    const BOOL ok = DeviceIoControl(
        handle,
        FSCTL_SET_REPARSE_POINT,
        rdb,
        static_cast<DWORD>(rdb->ReparseDataLength + 8),
        nullptr,
        0,
        &returned,
        nullptr);
    CloseHandle(handle);

    if (!ok)
    {
        std::filesystem::remove(source, ec);
        return Error{"ioctl_failed", "FSCTL_SET_REPARSE_POINT failed"};
    }
    return std::monostate{};
}

Result<std::monostate> JunctionUtil::removeJunction(const std::filesystem::path& p)
{
    if (!isReparsePoint(p))
    {
        return Error{"not_reparse_point", "Path is not a junction"};
    }
    if (RemoveDirectoryW(p.c_str()) == 0)
    {
        return Error{"remove_failed", "RemoveDirectoryW failed"};
    }
    return std::monostate{};
}

nlohmann::json JunctionUtil::Repair(const nlohmann::json& params)
{
    const auto sourceKey = params.contains("source") ? "source" : "path";
    if (!params.contains(sourceKey) || !params[sourceKey].is_string())
    {
        throw std::runtime_error("junction.repair requires 'source' (or legacy 'path')");
    }

    const auto sourceStr = params.at(sourceKey).get<std::string>();
    const auto source = utf8Path(sourceStr);
    const auto probe = PathProbe::Probe();
    if (probe.baseDir.empty() || !ensureWithinBase(probe.baseDir, source))
    {
        throw std::runtime_error("junction.repair source must stay inside the detected VRChat data directory");
    }

    std::optional<std::filesystem::path> target;
    if (params.contains("target") && params["target"].is_string())
    {
        target = utf8Path(params.at("target").get<std::string>());
    }
    else
    {
        target = readJunctionTarget(source);
    }
    if (!target.has_value())
    {
        throw std::runtime_error("junction.repair could not resolve target path");
    }
    if (ensureWithinBase(source, *target))
    {
        throw std::runtime_error("junction.repair target cannot be inside the source path");
    }

    std::error_code ec;
    std::filesystem::create_directories(target->parent_path(), ec);
    if (ec)
    {
        throw std::runtime_error("Failed to create target parent: " + ec.message());
    }
    std::filesystem::create_directories(*target, ec);
    if (ec)
    {
        throw std::runtime_error("Failed to create target directory: " + ec.message());
    }

    if (isReparsePoint(source))
    {
        auto removeRes = removeJunction(source);
        if (!isOk(removeRes))
        {
            throw std::runtime_error(error(removeRes).message);
        }
    }
    else if (std::filesystem::exists(source, ec) && !ec)
    {
        if (std::filesystem::is_directory(source, ec) && !ec)
        {
            if (!std::filesystem::is_empty(source, ec) || ec)
            {
                throw std::runtime_error(
                    "Source path exists as a non-empty directory; refusing to replace it");
            }
            std::filesystem::remove(source, ec);
            if (ec)
            {
                throw std::runtime_error("Failed to remove empty source directory: " + ec.message());
            }
        }
        else
        {
            throw std::runtime_error("Source path exists and is not a junction directory");
        }
    }

    auto createRes = createJunction(source, *target);
    if (!isOk(createRes))
    {
        throw std::runtime_error(error(createRes).message);
    }

    nlohmann::json result;
    result["source"] = sourceStr;
    result["path"] = sourceStr;
    result["isReparsePoint"] = isReparsePoint(source);
    if (auto repairedTarget = readJunctionTarget(source))
    {
        result["target"] = toUtf8(repairedTarget->wstring());
    }
    else
    {
        result["target"] = nullptr;
    }
    result["createdTarget"] = toUtf8(target->wstring());
    result["ok"] = true;
    return result;
}

} // namespace vrcsm::core
