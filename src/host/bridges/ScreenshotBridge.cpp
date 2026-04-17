#include "../../pch.h"
#include "BridgeCommon.h"

#include <KnownFolders.h>
#include <shellapi.h>
#include <shlobj.h>

#include <wil/com.h>
#include <wil/resource.h>

namespace
{

// Percent-encode a path segment so it survives being embedded in a URL.
std::string UrlEncodeSegment(std::string_view input)
{
    std::string out;
    out.reserve(input.size() + 16);
    for (const unsigned char c : input)
    {
        const bool unreserved =
            (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
            || c == '-' || c == '_' || c == '.' || c == '~';
        if (unreserved)
        {
            out.push_back(static_cast<char>(c));
        }
        else
        {
            static const char kHex[] = "0123456789ABCDEF";
            out.push_back('%');
            out.push_back(kHex[(c >> 4) & 0xF]);
            out.push_back(kHex[c & 0xF]);
        }
    }
    return out;
}

std::filesystem::path ScreenshotsRootDir()
{
    wil::unique_cotaskmem_string picturesPath;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_Pictures, 0, nullptr, picturesPath.put())))
    {
        return std::filesystem::path(picturesPath.get()) / L"VRChat";
    }
    wchar_t buffer[MAX_PATH]{};
    const DWORD length = GetEnvironmentVariableW(L"USERPROFILE", buffer, MAX_PATH);
    if (length > 0 && length < MAX_PATH)
    {
        return std::filesystem::path(buffer) / L"Pictures" / L"VRChat";
    }
    return {};
}

} // namespace

nlohmann::json IpcBridge::HandleScreenshotsList(const nlohmann::json&, const std::optional<std::string>&)
{
    const auto folder = ScreenshotsRootDir();
    nlohmann::json screenshots = nlohmann::json::array();

    std::error_code ec;
    if (folder.empty() || !std::filesystem::exists(folder, ec))
    {
        return nlohmann::json{
            {"screenshots", std::move(screenshots)},
            {"folder", folder.empty() ? "" : WideToUtf8(folder.wstring())},
        };
    }

    struct Entry
    {
        std::filesystem::path path;
        std::filesystem::file_time_type mtime;
        std::uintmax_t size;
    };
    std::vector<Entry> entries;
    entries.reserve(256);

    for (auto it = std::filesystem::recursive_directory_iterator(folder, ec);
         it != std::filesystem::recursive_directory_iterator();
         it.increment(ec))
    {
        if (ec) break;
        if (!it->is_regular_file(ec)) continue;
        const auto& p = it->path();
        const auto ext = p.extension().wstring();
        if (ext != L".png" && ext != L".PNG" && ext != L".jpg" && ext != L".jpeg"
            && ext != L".JPG" && ext != L".JPEG")
        {
            continue;
        }
        std::error_code sizeEc;
        const auto size = std::filesystem::file_size(p, sizeEc);
        std::error_code timeEc;
        const auto mtime = std::filesystem::last_write_time(p, timeEc);
        entries.push_back({p, mtime, sizeEc ? 0 : size});
    }

    std::sort(entries.begin(), entries.end(), [](const Entry& a, const Entry& b)
    {
        return a.mtime > b.mtime;
    });
    if (entries.size() > 2000)
    {
        entries.resize(2000);
    }

    for (const auto& entry : entries)
    {
        const auto sysTime = std::chrono::clock_cast<std::chrono::system_clock>(entry.mtime);
        const auto timeT = std::chrono::system_clock::to_time_t(sysTime);
        std::tm tmUtc{};
        gmtime_s(&tmUtc, &timeT);
        char isoBuf[32]{};
        std::strftime(isoBuf, sizeof(isoBuf), "%Y-%m-%dT%H:%M:%SZ", &tmUtc);

        std::error_code relEc;
        const auto rel = std::filesystem::relative(entry.path, folder, relEc);
        std::string urlPath;
        if (!relEc)
        {
            for (const auto& seg : rel)
            {
                if (!urlPath.empty()) urlPath.push_back('/');
                urlPath.append(UrlEncodeSegment(WideToUtf8(seg.wstring())));
            }
        }
        else
        {
            urlPath = UrlEncodeSegment(WideToUtf8(entry.path.filename().wstring()));
        }

        screenshots.push_back({
            {"path", WideToUtf8(entry.path.wstring())},
            {"filename", WideToUtf8(entry.path.filename().wstring())},
            {"created_at", isoBuf},
            {"size_bytes", static_cast<std::uint64_t>(entry.size)},
            {"url", fmt::format("https://screenshots.local/{}", urlPath)},
        });
    }

    return nlohmann::json{
        {"screenshots", std::move(screenshots)},
        {"folder", WideToUtf8(folder.wstring())},
    };
}

nlohmann::json IpcBridge::HandleScreenshotsOpen(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto pathStr = JsonStringField(params, "path");
    if (!pathStr.has_value() || pathStr->empty())
    {
        throw std::runtime_error("screenshots.open: missing 'path'");
    }
    const std::filesystem::path target = Utf8ToWide(*pathStr);
    const auto root = ScreenshotsRootDir();
    if (root.empty())
    {
        throw std::runtime_error("screenshots.open: screenshots folder unavailable");
    }

    std::error_code ec;
    const auto absTarget = std::filesystem::weakly_canonical(target, ec);
    const auto absRoot = std::filesystem::weakly_canonical(root, ec);
    const auto targetStr = absTarget.wstring();
    const auto rootStr = absRoot.wstring();
    if (targetStr.rfind(rootStr, 0) != 0)
    {
        throw std::runtime_error("screenshots.open: path escapes screenshots root");
    }
    const auto ext = target.extension().wstring();
    if (ext != L".png" && ext != L".PNG" && ext != L".jpg" && ext != L".jpeg"
        && ext != L".JPG" && ext != L".JPEG")
    {
        throw std::runtime_error("screenshots.open: unsupported file type");
    }

    const HINSTANCE h = ShellExecuteW(nullptr, L"open", targetStr.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    if (reinterpret_cast<INT_PTR>(h) <= 32)
    {
        throw std::runtime_error("screenshots.open: ShellExecute failed");
    }
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleScreenshotsFolder(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto pathStr = JsonStringField(params, "path");
    const auto root = ScreenshotsRootDir();
    if (root.empty())
    {
        throw std::runtime_error("screenshots.folder: screenshots folder unavailable");
    }

    if (!pathStr.has_value() || pathStr->empty())
    {
        const HINSTANCE h = ShellExecuteW(nullptr, L"open", root.wstring().c_str(),
            nullptr, nullptr, SW_SHOWNORMAL);
        if (reinterpret_cast<INT_PTR>(h) <= 32)
        {
            throw std::runtime_error("screenshots.folder: ShellExecute failed");
        }
        return nlohmann::json{{"ok", true}};
    }

    const std::filesystem::path target = Utf8ToWide(*pathStr);
    std::error_code ec;
    const auto absTarget = std::filesystem::weakly_canonical(target, ec);
    const auto absRoot = std::filesystem::weakly_canonical(root, ec);
    if (absTarget.wstring().rfind(absRoot.wstring(), 0) != 0)
    {
        throw std::runtime_error("screenshots.folder: path escapes screenshots root");
    }

    const std::wstring args = L"/select,\"" + absTarget.wstring() + L"\"";
    const HINSTANCE h = ShellExecuteW(nullptr, L"open", L"explorer.exe",
        args.c_str(), nullptr, SW_SHOWNORMAL);
    if (reinterpret_cast<INT_PTR>(h) <= 32)
    {
        throw std::runtime_error("screenshots.folder: ShellExecute failed");
    }
    return nlohmann::json{{"ok", true}};
}

nlohmann::json IpcBridge::HandleScreenshotsDelete(const nlohmann::json& params, const std::optional<std::string>&)
{
    const auto paths = params.value("paths", std::vector<std::string>{});
    int deleted = 0;
    std::vector<std::string> failed;

    const auto root = ScreenshotsRootDir();
    if (root.empty())
    {
        throw std::runtime_error("screenshots.delete: screenshots folder unavailable");
    }

    std::error_code rootEc;
    const auto absRoot = std::filesystem::weakly_canonical(root, rootEc);
    const auto rootStr = absRoot.wstring();

    for (const auto& pathStr : paths)
    {
        std::error_code ec;
        const std::filesystem::path target = Utf8ToWide(pathStr);
        const auto absTarget = std::filesystem::weakly_canonical(target, ec);

        if (absTarget.wstring().rfind(rootStr, 0) != 0)
        {
            failed.push_back(pathStr);
            continue;
        }

        const auto ext = target.extension().wstring();
        if (ext != L".png" && ext != L".PNG" && ext != L".jpg" && ext != L".jpeg"
            && ext != L".JPG" && ext != L".JPEG")
        {
            failed.push_back(pathStr);
            continue;
        }

        if (std::filesystem::remove(absTarget, ec))
        {
            deleted++;
        }
        else
        {
            failed.push_back(pathStr);
        }
    }

    return nlohmann::json{
        {"deleted", deleted},
        {"failed", failed}
    };
}
