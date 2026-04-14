#include "CacheScanner.h"

#include "Common.h"

#include <algorithm>
#include <system_error>

namespace vrcsm::core
{

void to_json(nlohmann::json& j, const CategorySummary& c)
{
    j = nlohmann::json{
        {"key", c.key},
        {"name", c.name},
        {"kind", c.kind},
        {"logical_path", c.logical_path},
        {"exists", c.exists},
        {"lexists", c.lexists},
        {"is_dir", c.is_dir},
        {"is_file", c.is_file},
        {"resolved_path", c.resolved_path},
        {"bytes", c.bytes},
        {"bytes_human", c.bytes_human},
        {"file_count", c.file_count},
        {"latest_mtime", c.latest_mtime ? nlohmann::json(*c.latest_mtime) : nlohmann::json(nullptr)},
        {"oldest_mtime", c.oldest_mtime ? nlohmann::json(*c.oldest_mtime) : nlohmann::json(nullptr)},
    };
}

const std::array<CategoryDef, 12>& categoryDefs()
{
    static const std::array<CategoryDef, 12> defs{{
        {"avatars", "Avatars", "Avatars", "dir", true},
        {"cache_windows_player", "Cache-WindowsPlayer", "Cache-WindowsPlayer", "dir", true},
        {"http_cache", "HTTPCache-WindowsPlayer", "HTTPCache-WindowsPlayer", "dir", true},
        {"texture_cache", "TextureCache-WindowsPlayer", "TextureCache-WindowsPlayer", "dir", true},
        {"local_avatar_data", "LocalAvatarData", "LocalAvatarData", "dir", true},
        {"local_player_moderations", "LocalPlayerModerations", "LocalPlayerModerations", "dir", true},
        {"worldconfig", "worldconfig", "worldconfig", "dir", true},
        {"cookies", "Cookies", "Cookies", "dir", true},
        {"osc", "OSC", "OSC", "dir", false},
        {"tools", "Tools", "Tools", "dir", false},
        {"unity", "Unity", "Unity", "dir", false},
        {"library_index", "Library", "Library", "file", false},
    }};
    return defs;
}

namespace
{
struct DirectoryStats
{
    std::uint64_t bytes = 0;
    std::uint64_t fileCount = 0;
    std::optional<std::filesystem::file_time_type> latest;
    std::optional<std::filesystem::file_time_type> oldest;
};

void scanDirectory(const std::filesystem::path& dir, DirectoryStats& stats)
{
    std::error_code ec;
    std::filesystem::recursive_directory_iterator it(
        dir,
        std::filesystem::directory_options::skip_permission_denied,
        ec);
    if (ec) return;

    for (auto end = std::filesystem::recursive_directory_iterator{}; it != end;)
    {
        std::error_code stepEc;
        if (!it->is_symlink(stepEc) && it->is_regular_file(stepEc))
        {
            const auto sz = it->file_size(stepEc);
            if (!stepEc)
            {
                stats.bytes += sz;
                stats.fileCount += 1;
                if (auto t = safeLastWriteTime(it->path()))
                {
                    if (!stats.latest || *t > *stats.latest) stats.latest = t;
                    if (!stats.oldest || *t < *stats.oldest) stats.oldest = t;
                }
            }
        }
        it.increment(stepEc);
        if (stepEc) break;
    }
}
} // namespace

CategorySummary scanCategory(const std::filesystem::path& baseDir, const CategoryDef& def)
{
    CategorySummary s;
    s.key = std::string(def.key);
    s.name = std::string(def.name);
    s.kind = std::string(def.kind);
    s.logical_path = std::string(def.rel_path);

    const std::filesystem::path target = baseDir / std::filesystem::path(toWide(def.rel_path));

    std::error_code ec;
    auto symStatus = std::filesystem::symlink_status(target, ec);
    s.lexists = !ec && symStatus.type() != std::filesystem::file_type::not_found;

    auto status = std::filesystem::status(target, ec);
    s.exists = !ec && status.type() != std::filesystem::file_type::not_found;
    s.is_dir = s.exists && std::filesystem::is_directory(status);
    s.is_file = s.exists && std::filesystem::is_regular_file(status);

    std::filesystem::path resolved = target;
    auto canonical = std::filesystem::weakly_canonical(target, ec);
    if (!ec) resolved = canonical;
    s.resolved_path = toUtf8(resolved.wstring());

    if (s.is_dir)
    {
        DirectoryStats stats;
        scanDirectory(target, stats);
        s.bytes = stats.bytes;
        s.file_count = stats.fileCount;
        if (stats.latest) s.latest_mtime = isoTimestamp(*stats.latest);
        if (stats.oldest) s.oldest_mtime = isoTimestamp(*stats.oldest);
    }
    else if (s.is_file)
    {
        const auto sz = std::filesystem::file_size(target, ec);
        if (!ec)
        {
            s.bytes = sz;
            s.file_count = 1;
        }
        if (auto t = safeLastWriteTime(target))
        {
            s.latest_mtime = isoTimestamp(*t);
            s.oldest_mtime = s.latest_mtime;
        }
    }

    s.bytes_human = formatBytesHuman(s.bytes);
    return s;
}

std::vector<CategorySummary> CacheScanner::scanAll(const std::filesystem::path& baseDir)
{
    std::vector<CategorySummary> out;
    out.reserve(categoryDefs().size());
    for (const auto& def : categoryDefs())
    {
        out.push_back(scanCategory(baseDir, def));
    }
    return out;
}

} // namespace vrcsm::core
