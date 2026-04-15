#include "BundleSniff.h"

#include "Common.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <fstream>
#include <future>
#include <system_error>
#include <thread>

namespace vrcsm::core
{

void to_json(nlohmann::json& j, const BundleEntry& e)
{
    j = nlohmann::json{
        {"entry", e.entry},
        {"path", e.path},
        {"bytes", e.bytes},
        {"bytes_human", e.bytes_human},
        {"file_count", e.file_count},
        {"latest_mtime", e.latest_mtime ? nlohmann::json(*e.latest_mtime) : nlohmann::json(nullptr)},
        {"oldest_mtime", e.oldest_mtime ? nlohmann::json(*e.oldest_mtime) : nlohmann::json(nullptr)},
        {"bundle_format", e.bundle_format},
    };
}

void to_json(nlohmann::json& j, const BundleSniffResult& r)
{
    j = nlohmann::json{
        {"magic", r.magic},
        {"bundle_format", r.bundle_format},
        {"fileTree", r.fileTree},
    };
}

namespace
{
constexpr std::array<std::string_view, 2> kReservedNames{"__info", "vrc-version"};

bool isReserved(const std::filesystem::path& p)
{
    const auto name = p.filename().string();
    for (const auto& r : kReservedNames)
    {
        if (name == r) return true;
    }
    return false;
}

struct EntryStats
{
    std::uint64_t bytes = 0;
    std::uint64_t fileCount = 0;
    std::optional<std::filesystem::file_time_type> latest;
    std::optional<std::filesystem::file_time_type> oldest;
    std::optional<std::filesystem::path> dataFile;
};

void aggregate(const std::filesystem::path& root, EntryStats& stats)
{
    std::error_code ec;
    std::filesystem::recursive_directory_iterator it(
        root, std::filesystem::directory_options::skip_permission_denied, ec);
    if (ec) return;

    for (auto end = std::filesystem::recursive_directory_iterator{}; it != end;)
    {
        std::error_code stepEc;
        if (it->is_regular_file(stepEc))
        {
            const auto sz = it->file_size(stepEc);
            if (!stepEc)
            {
                stats.bytes += sz;
                stats.fileCount += 1;
                if (it->path().filename() == "__data" && !stats.dataFile)
                {
                    stats.dataFile = it->path();
                }
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

std::string readMagic(const std::filesystem::path& dataFile)
{
    std::ifstream f(dataFile, std::ios::binary);
    if (!f) return {};
    char buf[8] = {0};
    f.read(buf, sizeof(buf));
    const auto n = static_cast<std::size_t>(f.gcount());
    std::string magic;
    magic.reserve(n);
    for (std::size_t i = 0; i < n; ++i)
    {
        const unsigned char c = static_cast<unsigned char>(buf[i]);
        if (c >= 32 && c < 127)
        {
            magic.push_back(static_cast<char>(c));
        }
        else
        {
            break;
        }
    }
    return magic;
}
} // namespace

std::string BundleSniff::classifyMagic(const std::string& magic)
{
    if (magic.rfind("UnityFS", 0) == 0) return "UnityFS";
    if (magic.rfind("UnityWeb", 0) == 0) return "UnityWeb";
    if (magic.rfind("UnityRaw", 0) == 0) return "UnityRaw";
    if (magic.rfind("UnityArchive", 0) == 0) return "UnityArchive";
    return "unknown";
}

std::vector<BundleEntry> BundleSniff::scanCacheWindowsPlayer(const std::filesystem::path& cwpDir)
{
    std::vector<BundleEntry> out;
    std::error_code ec;
    if (!std::filesystem::exists(cwpDir, ec) || ec) return out;

    // Enumerate top-level hash dirs up front, then fan out the
    // per-hash aggregation onto a thread pool. On a 9.9 GB cache with
    // thousands of hash dirs this is the single dominant cost of the
    // whole scan, and it's embarrassingly parallel — each aggregate()
    // only touches one subtree. We cap parallelism at hardware
    // concurrency so we don't launch 10k threads.
    std::vector<std::filesystem::path> pending;
    pending.reserve(256);
    for (const auto& entry : std::filesystem::directory_iterator(cwpDir, ec))
    {
        if (ec) break;
        if (isReserved(entry.path())) continue;
        if (!entry.is_directory()) continue;
        pending.push_back(entry.path());
    }

    struct AggRow
    {
        BundleEntry be;
        std::optional<std::filesystem::path> dataFile;
    };

    const std::size_t poolSize = std::max<std::size_t>(
        1, std::min<std::size_t>(pending.size(), std::thread::hardware_concurrency()));
    std::vector<AggRow> rows(pending.size());
    std::atomic<std::size_t> next{0};

    auto worker = [&]() {
        for (;;)
        {
            const std::size_t idx = next.fetch_add(1, std::memory_order_relaxed);
            if (idx >= pending.size()) return;
            const auto& dir = pending[idx];

            AggRow row;
            row.be.entry = dir.filename().string();
            row.be.path = toUtf8(dir.wstring());

            EntryStats stats;
            aggregate(dir, stats);
            row.be.bytes = stats.bytes;
            row.be.file_count = stats.fileCount;
            row.be.bytes_human = formatBytesHuman(stats.bytes);
            if (stats.latest) row.be.latest_mtime = isoTimestamp(*stats.latest);
            if (stats.oldest) row.be.oldest_mtime = isoTimestamp(*stats.oldest);

            // Leave bundle_format unknown here. readMagic opens a file
            // per bundle; with thousands of bundles that used to be
            // thousands of pointless syscalls, and the frontend only
            // surfaces `bundle_format` via the UnityFS badge on
            // largest_entries. We back-fill the format for the top-N
            // after sorting.
            row.be.bundle_format = "unknown";
            row.dataFile = stats.dataFile;

            rows[idx] = std::move(row);
        }
    };

    std::vector<std::thread> threads;
    threads.reserve(poolSize);
    for (std::size_t i = 0; i < poolSize; ++i)
    {
        threads.emplace_back(worker);
    }
    for (auto& t : threads) t.join();

    std::sort(rows.begin(), rows.end(), [](const AggRow& a, const AggRow& b) {
        return a.be.bytes > b.be.bytes;
    });

    // Back-fill UnityFS classification for just the largest entries —
    // Report.cpp caps displayed rows at 10 and the frontend only
    // colours the badge on those, so reading magic for the rest is
    // pure waste.
    constexpr std::size_t kMagicLimit = 16;
    const std::size_t magicCount = std::min<std::size_t>(rows.size(), kMagicLimit);
    for (std::size_t i = 0; i < magicCount; ++i)
    {
        if (rows[i].dataFile)
        {
            const auto magic = readMagic(*rows[i].dataFile);
            rows[i].be.bundle_format = classifyMagic(magic);
        }
    }

    out.reserve(rows.size());
    for (auto& row : rows)
    {
        out.push_back(std::move(row.be));
    }
    return out;
}

BundleSniffResult BundleSniff::sniff(const std::filesystem::path& dataPath)
{
    BundleSniffResult result;
    std::error_code ec;
    if (std::filesystem::is_directory(dataPath, ec))
    {
        EntryStats stats;
        aggregate(dataPath, stats);
        if (stats.dataFile)
        {
            result.magic = readMagic(*stats.dataFile);
        }
        for (const auto& f : std::filesystem::recursive_directory_iterator(
                 dataPath, std::filesystem::directory_options::skip_permission_denied, ec))
        {
            if (ec) break;
            if (f.is_regular_file())
            {
                result.fileTree.push_back(toUtf8(f.path().lexically_relative(dataPath).wstring()));
            }
        }
    }
    else
    {
        result.magic = readMagic(dataPath);
        result.fileTree.push_back(dataPath.filename().string());
    }
    result.bundle_format = classifyMagic(result.magic);
    return result;
}

} // namespace vrcsm::core
