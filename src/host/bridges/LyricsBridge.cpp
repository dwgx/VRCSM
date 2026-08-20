#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/Common.h"
#include "../../core/LyricsProxy.h"

#include <cctype>
#include <fstream>

// lyrics.fetch — proxy a plain HTTPS GET through the host so the web lyrics
// chain (LRCLIB + NetEase) can bypass WebView2's CORS/Referer restrictions.
// Registered in AsyncMethodSet() because it performs network I/O and must run
// off the WebView2 UI thread.
//
// Params:  { url: string, referer?: string }
// Returns: { status: number, body: string }
// Throws IpcException on the SSRF-rail rejection or a hard WinHTTP failure so
// the frontend receives a structured error (never a partial success).
nlohmann::json IpcBridge::HandleLyricsFetch(const nlohmann::json& params, const std::optional<std::string>&)
{
    if (!params.is_object() || !params.contains("url") || !params["url"].is_string())
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_params", "lyrics.fetch: missing 'url'", 0});
    }

    const std::string url = params["url"].get<std::string>();
    const std::string referer =
        (params.contains("referer") && params["referer"].is_string())
            ? params["referer"].get<std::string>()
            : std::string{};

    const auto res = vrcsm::core::LyricsFetch(url, referer);
    if (!res.error.empty())
    {
        // SSRF-rail rejection and hard WinHTTP failures both surface here with
        // status 0. Convert to a structured IPC error the frontend can treat
        // as "provider unavailable" and fall through gracefully.
        throw IpcException(vrcsm::core::Error{
            "lyrics_fetch_failed", res.error, 0});
    }

    return nlohmann::json{
        {"status", res.status},
        {"body", res.body},
    };
}

nlohmann::json IpcBridge::HandleLyricsReadFolder(const nlohmann::json& params, const std::optional<std::string>&)
{
    namespace fs = std::filesystem;
    if (!params.is_object() || !params.contains("dir") || !params["dir"].is_string())
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_params", "lyrics.readFolder: missing 'dir'", 0});
    }
    const std::string dirUtf8 = params["dir"].get<std::string>();
    const auto dir = fs::path(Utf8ToWide(dirUtf8));
    if (dirUtf8.empty() || dir.empty() || !dir.is_absolute())
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_params", "lyrics.readFolder: directory must be an absolute path", 0});
    }
    std::error_code ec;
    const auto canon = fs::weakly_canonical(dir, ec);
    if (ec || !fs::is_directory(canon, ec))
    {
        throw IpcException(vrcsm::core::Error{
            "not_found", "lyrics.readFolder: directory does not exist", 0});
    }
    if (canon == canon.root_path())
    {
        throw IpcException(vrcsm::core::Error{
            "invalid_params", "lyrics.readFolder: refusing a drive root", 0});
    }

    nlohmann::json files = nlohmann::json::array();
    constexpr int kMaxFiles = 64;
    constexpr std::uintmax_t kMaxBytes = 256 * 1024;
    int n = 0;
    ec.clear();
    const auto opts = fs::directory_options::skip_permission_denied;
    for (const auto& entry : fs::directory_iterator(canon, opts, ec))
    {
        if (ec) break;
        if (n >= kMaxFiles) break;
        std::error_code fec;
        if (entry.is_symlink(fec)) continue;
        const DWORD attrs = ::GetFileAttributesW(entry.path().c_str());
        if (attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_REPARSE_POINT))
        {
            continue;
        }
        if (!vrcsm::core::ensureWithinBase(canon, entry.path())) continue;
        if (!entry.is_regular_file(fec) || fec) continue;
        const std::string nameUtf8 = WideToUtf8(entry.path().filename().wstring());
        if (nameUtf8.size() < 4) continue;
        auto lower = nameUtf8;
        for (auto& c : lower) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        if (lower.size() < 4 || lower.substr(lower.size() - 4) != ".lrc") continue;
        fec.clear();
        const auto sz = entry.file_size(fec);
        if (fec || sz == 0 || sz > kMaxBytes) continue;
        std::ifstream in(entry.path(), std::ios::binary);
        if (!in) continue;
        std::string text(static_cast<size_t>(sz), '\0');
        in.read(text.data(), static_cast<std::streamsize>(sz));
        if (!in) continue;
        files.push_back({{"name", nameUtf8}, {"text", text}});
        ++n;
    }
    return nlohmann::json{{"files", files}};
}
