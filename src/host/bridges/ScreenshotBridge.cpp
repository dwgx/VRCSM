#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/Common.h"
#include "../ScreenshotThumbs.h"
#include "../VrchatPaths.h"

#include <KnownFolders.h>
#include <shellapi.h>

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

bool IsSupportedScreenshotExtension(const std::filesystem::path& path)
{
    const auto ext = path.extension().wstring();
    return _wcsicmp(ext.c_str(), L".png") == 0
        || _wcsicmp(ext.c_str(), L".jpg") == 0
        || _wcsicmp(ext.c_str(), L".jpeg") == 0;
}

} // namespace

nlohmann::json IpcBridge::HandleScreenshotsList(const nlohmann::json&, const std::optional<std::string>&)
{
    const auto folder = DetectPrimaryVrchatScreenshotRoot();
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

    for (auto it = std::filesystem::recursive_directory_iterator(
             folder,
             std::filesystem::directory_options::skip_permission_denied,
             ec);
         it != std::filesystem::recursive_directory_iterator();
         it.increment(ec))
    {
        if (ec)
        {
            ec.clear();
            continue;
        }

        std::error_code fileEc;
        if (!it->is_regular_file(fileEc) || fileEc)
        {
            continue;
        }
        const auto& p = it->path();
        if (!IsSupportedScreenshotExtension(p))
        {
            continue;
        }

        std::error_code sizeEc;
        const auto size = std::filesystem::file_size(p, sizeEc);
        std::error_code timeEc;
        const auto mtime = std::filesystem::last_write_time(p, timeEc);
        if (timeEc)
        {
            continue;
        }

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

    // Target size for grid-tile thumbnails. 360 px long-edge comfortably
    // covers the ~200 px CSS tile at up to ~1.8× device-pixel ratio;
    // resulting JPEGs are typically 25-50 KB, vs 3-8 MB PNG originals.
    constexpr int kThumbMaxEdge = 360;

    std::vector<std::filesystem::path> thumbSources;
    thumbSources.reserve(entries.size());

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

        // Thumbnail URL resolves to the same cache file we will populate
        // in the background below. If the cache hasn't caught up when
        // the frontend asks for it, WebView2 returns 404 and the tile's
        // onError fallback swaps to the full-size URL.
        const auto thumbName = vrcsm::host::ScreenshotThumbs::CacheFileName(
            entry.path, kThumbMaxEdge);

        screenshots.push_back({
            {"path", WideToUtf8(entry.path.wstring())},
            {"filename", WideToUtf8(entry.path.filename().wstring())},
            {"created_at", isoBuf},
            {"size_bytes", static_cast<std::uint64_t>(entry.size)},
            {"url", fmt::format("https://screenshots.local/{}", urlPath)},
            {"thumb_url", fmt::format("https://screenshot-thumbs.local/{}", thumbName)},
        });

        thumbSources.push_back(entry.path);
    }

    // Kick off background thumbnail generation. Non-blocking — the
    // response returns immediately and the cache fills in over the
    // next ~seconds-to-minutes depending on library size.
    vrcsm::host::ScreenshotThumbs::EnqueueBatch(thumbSources, kThumbMaxEdge);

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
    const auto root = DetectPrimaryVrchatScreenshotRoot();
    if (root.empty())
    {
        throw std::runtime_error("screenshots.open: screenshots folder unavailable");
    }

    std::error_code ec;
    const auto absTarget = std::filesystem::weakly_canonical(target, ec);
    if (ec || !vrcsm::core::ensureWithinBase(root, absTarget))
    {
        throw std::runtime_error("screenshots.open: path escapes screenshots root");
    }
    if (!IsSupportedScreenshotExtension(absTarget))
    {
        throw std::runtime_error("screenshots.open: unsupported file type");
    }

    const auto targetStr = absTarget.wstring();
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
    const auto root = DetectPrimaryVrchatScreenshotRoot();
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
    if (ec || !vrcsm::core::ensureWithinBase(root, absTarget))
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

    const auto root = DetectPrimaryVrchatScreenshotRoot();
    if (root.empty())
    {
        throw std::runtime_error("screenshots.delete: screenshots folder unavailable");
    }

    std::error_code rootEc;
    const auto absRoot = std::filesystem::weakly_canonical(root, rootEc);
    if (rootEc)
    {
        throw std::runtime_error("screenshots.delete: failed to resolve screenshots root");
    }

    for (const auto& pathStr : paths)
    {
        std::error_code ec;
        const std::filesystem::path target = Utf8ToWide(pathStr);
        const auto absTarget = std::filesystem::weakly_canonical(target, ec);

        if (ec || !vrcsm::core::ensureWithinBase(absRoot, absTarget))
        {
            failed.push_back(pathStr);
            continue;
        }

        if (!IsSupportedScreenshotExtension(absTarget))
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
