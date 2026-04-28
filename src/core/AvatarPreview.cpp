#include "AvatarPreview.h"

#include "Common.h"
#include "PathProbe.h"
#include "TaskQueue.h"
#include "UnityPreview.h"
#include "VrcApi.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cstdio>
#include <cstdint>
#include <cwctype>
#include <fstream>
#include <mutex>
#include <optional>
#include <system_error>
#include <unordered_map>
#include <vector>

#include <Windows.h>
#include <KnownFolders.h>
#include <ShlObj.h>

#include <fmt/format.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

// ─────────────────────────────────────────────────────────────────────────
// AvatarPreview — drives the v0.5.1 in-process 3D preview pipeline.
//
//   1. Cache hit — `preview-cache/<sha1>.glb` exists → return the URL.
//   2. Bundle locator — walks Cache-WindowsPlayer __info descriptors,
//      or pulls from LocalAvatarData, or downloads the .vrca via the
//      VRChat API when we only have an assetUrl.
//   3. Native extractor — calls `extractBundleToGlb` (UnityPreview.cpp)
//      which parses the UnityFS bundle, decodes every Mesh object, runs
//      the adaptive mesh filter, and writes a glTF 2.0 `.glb` — all in
//      this process, no child, no embedded Python binary, no 46 MiB
//      resource bloat.
//
// Error taxonomy (stable — the UI switches on these):
//   "bundle_not_found"        — nothing on disk or downloadable
//   "encrypted"               — VRChat custom-encrypted bundle
//   "preview_failed"          — any other extractor failure
//   "cancelled"               — user switched avatars mid-flight
// ─────────────────────────────────────────────────────────────────────────

namespace vrcsm::core
{

namespace
{

constexpr const char* kPreviewHost = "preview.local";
constexpr std::string_view kPreviewCacheSchema = "preview-v5";

struct BundleMapCache
{
    std::mutex mutex;
    std::unordered_map<std::string, std::filesystem::path> byAvatarId;
    std::filesystem::file_time_type scannedAt{};
    std::filesystem::path scannedRoot;
    bool loadedFromDisk{false};
};

BundleMapCache& bundleMapCache()
{
    static BundleMapCache state;
    return state;
}

std::int64_t fileTimeTicks(const std::filesystem::file_time_type& value)
{
    return static_cast<std::int64_t>(value.time_since_epoch().count());
}

std::int64_t fileTimeTicks(const std::filesystem::path& path)
{
    std::error_code ec;
    const auto value = std::filesystem::last_write_time(path, ec);
    return ec ? 0 : fileTimeTicks(value);
}

std::filesystem::path canonicalBestEffort(const std::filesystem::path& path)
{
    std::error_code ec;
    auto canonical = std::filesystem::weakly_canonical(path, ec);
    return ec ? path.lexically_normal() : canonical;
}

struct PreviewPathLeaseState
{
    int refs{0};
    std::chrono::steady_clock::time_point leaseUntil{};
};

std::mutex& previewPathLeaseMutex()
{
    static std::mutex m;
    return m;
}

std::unordered_map<std::wstring, PreviewPathLeaseState>& previewPathLeases()
{
    static std::unordered_map<std::wstring, PreviewPathLeaseState> leases;
    return leases;
}

std::optional<std::filesystem::path> canonicalExistingPreviewGlbPath(
    const std::filesystem::path& path)
{
    if (path.empty() || _wcsicmp(path.extension().c_str(), L".glb") != 0)
    {
        return std::nullopt;
    }

    std::error_code ec;
    const auto status = std::filesystem::symlink_status(path, ec);
    if (ec || std::filesystem::is_symlink(status) || !std::filesystem::is_regular_file(status))
    {
        return std::nullopt;
    }

    const auto cacheDir = std::filesystem::weakly_canonical(AvatarPreview::PreviewCacheDir(), ec);
    if (ec)
    {
        return std::nullopt;
    }
    const auto canonicalPath = std::filesystem::weakly_canonical(path, ec);
    if (ec || !ensureWithinBase(cacheDir, canonicalPath))
    {
        return std::nullopt;
    }

    return canonicalPath;
}

std::optional<std::wstring> previewLeaseKey(const std::filesystem::path& path)
{
    const auto canonical = canonicalExistingPreviewGlbPath(path);
    if (!canonical.has_value())
    {
        return std::nullopt;
    }

    auto key = canonical->wstring();
    std::transform(key.begin(), key.end(), key.begin(), [](wchar_t ch) {
        return static_cast<wchar_t>(std::towlower(ch));
    });
    return key;
}

void retainPreviewPath(const std::filesystem::path& path)
{
    const auto key = previewLeaseKey(path);
    if (!key.has_value() || key->empty()) return;
    std::lock_guard<std::mutex> lock(previewPathLeaseMutex());
    auto& state = previewPathLeases()[*key];
    state.refs += 1;
}

void releasePreviewPath(const std::filesystem::path& path)
{
    const auto key = previewLeaseKey(path);
    if (!key.has_value() || key->empty()) return;
    std::lock_guard<std::mutex> lock(previewPathLeaseMutex());
    auto& leases = previewPathLeases();
    const auto it = leases.find(*key);
    if (it == leases.end()) return;
    it->second.refs = std::max(0, it->second.refs - 1);
    it->second.leaseUntil = std::chrono::steady_clock::now() + std::chrono::minutes(2);
}

class PreviewPathLease
{
public:
    explicit PreviewPathLease(const std::filesystem::path& path)
        : m_path(path)
    {
        retainPreviewPath(m_path);
    }

    PreviewPathLease(const PreviewPathLease&) = delete;
    PreviewPathLease& operator=(const PreviewPathLease&) = delete;

    ~PreviewPathLease()
    {
        releasePreviewPath(m_path);
    }

private:
    std::filesystem::path m_path;
};

bool isPreviewPathLeased(const std::filesystem::path& path)
{
    std::lock_guard<std::mutex> lock(previewPathLeaseMutex());
    auto& leases = previewPathLeases();
    const auto now = std::chrono::steady_clock::now();
    for (auto it = leases.begin(); it != leases.end(); )
    {
        if (it->second.refs == 0 && it->second.leaseUntil <= now)
        {
            it = leases.erase(it);
        }
        else
        {
            ++it;
        }
    }

    const auto key = previewLeaseKey(path);
    if (!key.has_value() || key->empty()) return false;

    const auto it = leases.find(*key);
    return it != leases.end()
        && (it->second.refs > 0 || it->second.leaseUntil > now);
}

std::string pathUtf8(const std::filesystem::path& path)
{
    return toUtf8(canonicalBestEffort(path).wstring());
}

std::filesystem::path bundleIndexPath()
{
    return AvatarPreview::PreviewCacheDir() / L"bundle-index.json";
}

bool bundleEntryStillValid(const std::filesystem::path& versionDir)
{
    std::error_code ec;
    const auto dataPath = versionDir / L"__data";
    return std::filesystem::is_regular_file(dataPath, ec)
        && !ec
        && std::filesystem::file_size(dataPath, ec) > 0
        && !ec;
}

void loadBundleIndexUnlocked(
    BundleMapCache& cache,
    const std::filesystem::path& cwpDir,
    const std::filesystem::file_time_type& latestMtime)
{
    if (cache.loadedFromDisk)
    {
        return;
    }
    cache.loadedFromDisk = true;

    std::ifstream in(bundleIndexPath(), std::ios::binary);
    if (!in)
    {
        return;
    }

    try
    {
        const auto doc = nlohmann::json::parse(in);
        if (!doc.is_object()) return;
        if (doc.value("schema", std::string{}) != "bundle-index-v1") return;
        if (doc.value("cacheRoot", std::string{}) != pathUtf8(cwpDir)) return;
        if (doc.value("cacheRootMtime", std::int64_t{}) != fileTimeTicks(latestMtime)) return;

        const auto entriesIt = doc.find("entries");
        if (entriesIt == doc.end() || !entriesIt->is_object()) return;

        for (auto it = entriesIt->begin(); it != entriesIt->end(); ++it)
        {
            if (!it.value().is_object()) continue;
            const auto pathValue = it.value().value("versionPath", std::string{});
            if (pathValue.empty()) continue;
            const auto versionPath = std::filesystem::path(toWide(pathValue));
            if (!bundleEntryStillValid(versionPath)) continue;
            cache.byAvatarId[it.key()] = versionPath;
        }
    }
    catch (const std::exception& ex)
    {
        spdlog::debug("AvatarPreview: ignored stale bundle index: {}", ex.what());
    }
}

void saveBundleIndexUnlocked(const BundleMapCache& cache)
{
    try
    {
        nlohmann::json entries = nlohmann::json::object();
        for (const auto& [avatarId, versionPath] : cache.byAvatarId)
        {
            const auto dataPath = versionPath / L"__data";
            std::error_code ec;
            const auto bytes = std::filesystem::file_size(dataPath, ec);
            entries[avatarId] = {
                {"versionPath", pathUtf8(versionPath)},
                {"dataPath", pathUtf8(dataPath)},
                {"size", ec ? 0ull : static_cast<unsigned long long>(bytes)},
                {"mtime", fileTimeTicks(dataPath)},
            };
        }

        nlohmann::json doc{
            {"schema", "bundle-index-v1"},
            {"cacheRoot", pathUtf8(cache.scannedRoot)},
            {"cacheRootMtime", fileTimeTicks(cache.scannedAt)},
            {"entries", std::move(entries)},
        };

        std::error_code ec;
        const auto path = bundleIndexPath();
        std::filesystem::create_directories(path.parent_path(), ec);
        std::filesystem::path tmp = path;
        tmp += L".part";
        {
            std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
            out << doc.dump(2);
        }
        std::filesystem::rename(tmp, path, ec);
        if (ec)
        {
            std::filesystem::remove(path, ec);
            ec.clear();
            std::filesystem::rename(tmp, path, ec);
        }
    }
    catch (const std::exception& ex)
    {
        spdlog::debug("AvatarPreview: failed to save bundle index: {}", ex.what());
    }
}

std::filesystem::path findBundleForAvatar(
    const std::filesystem::path& cwpDir,
    const std::string& avatarId);

bool isReadableRegularFile(const std::filesystem::path& path)
{
    std::error_code ec;
    return std::filesystem::is_regular_file(path, ec)
        && !ec
        && std::filesystem::file_size(path, ec) > 0
        && !ec;
}

bool hasBundleLikeExtension(const std::filesystem::path& path)
{
    const auto ext = path.extension().wstring();
    return _wcsicmp(ext.c_str(), L".vrca") == 0
        || _wcsicmp(ext.c_str(), L".vrcw") == 0
        || _wcsicmp(ext.c_str(), L".unity3d") == 0;
}

bool isLikelyBundlePayload(const std::filesystem::path& path)
{
    if (!isReadableRegularFile(path))
    {
        return false;
    }

    std::ifstream in(path, std::ios::binary);
    if (!in)
    {
        return false;
    }

    std::array<char, 16> header{};
    in.read(header.data(), static_cast<std::streamsize>(header.size()));
    const auto read = static_cast<std::size_t>(in.gcount());
    if (read == 0)
    {
        return false;
    }

    auto startsWith = [&](std::string_view magic) {
        return read >= magic.size()
            && std::equal(magic.begin(), magic.end(), header.begin());
    };

    if (startsWith("UnityFS")
        || startsWith("UnityWeb")
        || startsWith("UnityRaw")
        || startsWith("UnityArchive"))
    {
        return true;
    }

    if (hasBundleLikeExtension(path))
    {
        return true;
    }

    // LocalAvatarData stores avatar parameter JSON as files named `avtr_*`
    // without an extension. Treat JSON-like content as metadata, not a bundle.
    const auto first = static_cast<unsigned char>(header[0]);
    if (first == '{' || first == '[')
    {
        return false;
    }

    return false;
}

std::vector<std::filesystem::path> knownBundleNames(const std::wstring& avatarDirName)
{
    return {
        std::filesystem::path(L"custom.vrca"),
        std::filesystem::path(L"__data"),
        std::filesystem::path(avatarDirName),
        std::filesystem::path(avatarDirName + L".vrca"),
    };
}

std::filesystem::path normalizeExplicitBundlePath(const std::filesystem::path& candidate)
{
    if (candidate.empty())
    {
        return {};
    }

    if (isLikelyBundlePayload(candidate))
    {
        return candidate;
    }

    std::error_code ec;
    if (!std::filesystem::is_directory(candidate, ec) || ec)
    {
        return {};
    }

    const auto avatarDirName = candidate.filename().wstring();
    for (const auto& knownName : knownBundleNames(avatarDirName))
    {
        const auto knownCandidate = candidate / knownName;
        if (isLikelyBundlePayload(knownCandidate))
        {
            return knownCandidate;
        }
    }

    for (const auto& entry : std::filesystem::directory_iterator(candidate, ec))
    {
        if (ec) break;
        if (!entry.is_regular_file(ec) || ec) continue;
        if (!hasBundleLikeExtension(entry.path()) && !isLikelyBundlePayload(entry.path())) continue;
        if (isLikelyBundlePayload(entry.path()))
        {
            return entry.path();
        }
    }

    return {};
}

std::filesystem::path findLocalAvatarBundle(
    const std::filesystem::path& localAvatarDir,
    const std::string& avatarId)
{
    std::error_code ec;
    if (!std::filesystem::exists(localAvatarDir, ec) || ec)
    {
        return {};
    }

    const auto avatarDirName = toWide(avatarId);
    for (const auto& userEntry : std::filesystem::directory_iterator(localAvatarDir, ec))
    {
        if (ec) break;
        if (!userEntry.is_directory(ec) || ec) continue;

        const auto avatarDir = userEntry.path() / avatarDirName;
        if (!std::filesystem::exists(avatarDir, ec) || ec) continue;
        if (!std::filesystem::is_directory(avatarDir, ec) || ec) continue;

        for (const auto& candidateName : knownBundleNames(avatarDirName))
        {
            const auto candidate = avatarDir / candidateName;
            if (isLikelyBundlePayload(candidate))
            {
                return candidate;
            }
        }

        for (const auto& candidate : std::filesystem::directory_iterator(avatarDir, ec))
        {
            if (ec) break;
            if (!candidate.is_regular_file(ec) || ec) continue;
            if (!hasBundleLikeExtension(candidate.path()) && !isLikelyBundlePayload(candidate.path())) continue;
            if (isLikelyBundlePayload(candidate.path()))
            {
                return candidate.path();
            }
        }
        ec.clear();
    }

    return {};
}

std::filesystem::path resolveBundlePath(
    const std::filesystem::path& vrchatBaseDir,
    const std::string& avatarId)
{
    const auto localBundle = findLocalAvatarBundle(vrchatBaseDir / L"LocalAvatarData", avatarId);
    if (!localBundle.empty())
    {
        return localBundle;
    }

    const auto cwpDir = vrchatBaseDir / L"Cache-WindowsPlayer";
    auto cwpHit = findBundleForAvatar(cwpDir, avatarId);
    if (!cwpHit.empty())
    {
        const auto dataCandidate = cwpHit / L"__data";
        if (isReadableRegularFile(dataCandidate))
        {
            return dataCandidate;
        }
    }

    return {};
}

// Deterministic 40-char hex hash derived from the avatar id. The glb
// filename uses this so two invocations for the same avatar write to
// (and read from) the same cache file. The algorithm is SHA1-ish
// in look but we only need stability, not cryptographic strength —
// a good old FNV-1a gives us that for free without pulling in a
// crypto dependency.
std::string stableHashHex(std::string_view input)
{
    std::uint64_t h = 1469598103934665603ULL; // FNV-1a 64-bit offset basis
    for (unsigned char ch : input)
    {
        h ^= ch;
        h *= 1099511628211ULL; // FNV-1a prime
    }

    // Fold into a 40-hex-char string for visual parity with a sha1.
    // The extra digits just repeat the 64-bit state twice through a
    // simple reseed — collisions are irrelevant because the input
    // domain is `avtr_*` UUIDs which are themselves unique.
    std::string out;
    out.reserve(40);
    for (int round = 0; round < 5; ++round)
    {
        char buf[9]{};
        std::snprintf(buf, sizeof(buf), "%08x", static_cast<std::uint32_t>(h >> 32));
        out.append(buf, 8);
        h = h * 1099511628211ULL + 0xC0FFEE;
    }
    return out;
}

std::string glbUrlForHash(const std::string& hash)
{
    return fmt::format("https://{}/{}.glb", kPreviewHost, hash);
}

std::string bundleCacheKeyForAsset(std::string_view avatarId, std::string_view assetUrl)
{
    std::string seed;
    seed.reserve(32 + avatarId.size() + assetUrl.size());
    seed.append("bundle-v1|");
    seed.append(avatarId);
    seed.push_back('|');
    seed.append(assetUrl);
    return stableHashHex(seed);
}

std::filesystem::path bundleCachePathForAsset(std::string_view avatarId, std::string_view assetUrl)
{
    return AvatarPreview::PreviewCacheDir()
        / L"bundles"
        / (bundleCacheKeyForAsset(avatarId, assetUrl) + ".vrca");
}

std::string sourceSignatureForLocalBundle(
    std::string_view sourceKind,
    const std::filesystem::path& dataPath)
{
    std::error_code ec;
    const auto bytes = std::filesystem::file_size(dataPath, ec);
    const auto sizeValue = ec ? 0ull : static_cast<unsigned long long>(bytes);
    return fmt::format(
        "{}:{}|{}|{}",
        sourceKind,
        pathUtf8(dataPath),
        sizeValue,
        fileTimeTicks(dataPath));
}

std::string sourceSignatureForAssetBundle(
    const std::string& assetUrl,
    const std::filesystem::path& dataPath)
{
    std::error_code ec;
    const auto bytes = std::filesystem::file_size(dataPath, ec);
    const auto sizeValue = ec ? 0ull : static_cast<unsigned long long>(bytes);
    return fmt::format(
        "asset:{}|{}|{}",
        assetUrl,
        sizeValue,
        fileTimeTicks(dataPath));
}

std::filesystem::path sidecarPathForGlb(const std::filesystem::path& glbPath)
{
    auto sidecar = glbPath;
    sidecar += L".json";
    return sidecar;
}

void touchFileBestEffort(const std::filesystem::path& path)
{
    std::error_code ec;
    if (std::filesystem::is_regular_file(path, ec) && !ec)
    {
        std::filesystem::last_write_time(path, std::filesystem::file_time_type::clock::now(), ec);
    }
}

void trimRegularFilesLru(
    const std::filesystem::path& dir,
    std::uintmax_t maxBytes,
    std::wstring_view extension,
    bool removeGlbSidecar)
{
    std::error_code ec;
    if (!std::filesystem::is_directory(dir, ec) || ec) return;

    struct Entry
    {
        std::filesystem::path path;
        std::uintmax_t bytes{0};
        std::filesystem::file_time_type mtime{};
    };

    std::vector<Entry> entries;
    std::uintmax_t total = 0;
    for (const auto& entry : std::filesystem::directory_iterator(dir, ec))
    {
        if (ec) break;
        if (!entry.is_regular_file(ec) || ec) continue;
        const auto path = entry.path();
        if (path.extension() == L".part") continue;
        if (!extension.empty() && _wcsicmp(path.extension().c_str(), extension.data()) != 0) continue;
        const auto bytes = std::filesystem::file_size(path, ec);
        if (ec) { ec.clear(); continue; }
        auto mtime = std::filesystem::last_write_time(path, ec);
        if (ec) { ec.clear(); continue; }
        total += bytes;
        entries.push_back({path, bytes, mtime});
    }

    if (total <= maxBytes) return;

    std::sort(entries.begin(), entries.end(), [](const Entry& a, const Entry& b) {
        return a.mtime < b.mtime;
    });

    for (const auto& entry : entries)
    {
        if (total <= maxBytes) break;
        if (isPreviewPathLeased(entry.path)) continue;
        std::filesystem::remove(entry.path, ec);
        if (!ec && total >= entry.bytes)
        {
            total -= entry.bytes;
        }
        ec.clear();
        if (removeGlbSidecar)
        {
            std::filesystem::remove(sidecarPathForGlb(entry.path), ec);
            ec.clear();
        }
    }
}

void trimPreviewCachesBestEffort()
{
    constexpr std::uintmax_t kBundlesMaxBytes = 4ull * 1024ull * 1024ull * 1024ull;
    constexpr std::uintmax_t kGlbMaxBytes = 1536ull * 1024ull * 1024ull;
    const auto cacheDir = AvatarPreview::PreviewCacheDir();
    trimRegularFilesLru(cacheDir / L"bundles", kBundlesMaxBytes, L".vrca", false);
    trimRegularFilesLru(cacheDir, kGlbMaxBytes, L".glb", true);
}

void writePreviewMetadataBestEffort(
    const std::filesystem::path& glbPath,
    const std::string& avatarId,
    const std::string& sourceSig,
    const std::filesystem::path& dataPath,
    const std::string& cacheSource,
    bool downloaded,
    std::int64_t decodeMs,
    std::int64_t downloadMs)
{
    try
    {
        nlohmann::json doc{
            {"schema", "preview-v5"},
            {"avatarId", avatarId},
            {"sourceSig", sourceSig},
            {"bundlePath", pathUtf8(dataPath)},
            {"bundleSize", static_cast<unsigned long long>(std::filesystem::file_size(dataPath))},
            {"bundleMtime", fileTimeTicks(dataPath)},
            {"cacheSource", cacheSource},
            {"downloaded", downloaded},
            {"decodeMs", decodeMs},
            {"downloadMs", downloadMs},
            {"writtenAtUnixMs", std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count()},
        };
        const auto sidecar = sidecarPathForGlb(glbPath);
        std::ofstream out(sidecar, std::ios::binary | std::ios::trunc);
        out << doc.dump(2);
    }
    catch (const std::exception& ex)
    {
        spdlog::debug("AvatarPreview: failed to write preview metadata: {}", ex.what());
    }
}

struct PreviewSourcePlan
{
    bool ok{false};
    std::filesystem::path dataPath;
    std::string sourceSig;
    std::string cacheSource;
    bool downloaded{false};
    std::int64_t downloadMs{0};
    bool bundleIndexed{false};
    std::string code;
    std::string message;
};

PreviewSourcePlan preparePreviewSource(
    const std::string& avatarId,
    const std::filesystem::path& vrchatBaseDir,
    const std::string& assetUrl,
    const std::string& bundlePath,
    bool allowDownload,
    const AvatarPreview::ProgressCallback& progress)
{
    PreviewSourcePlan plan;

    std::filesystem::path localBundlePath;
    if (!bundlePath.empty())
    {
        if (progress)
        {
            progress("resolving_bundle", "Checking the selected local avatar files");
        }
        localBundlePath = normalizeExplicitBundlePath(toWide(bundlePath));
        if (localBundlePath.empty())
        {
            plan.code = "bundle_not_found";
            plan.message = "The selected bundle path is not a readable VRChat/Unity bundle.";
            return plan;
        }
        plan.ok = true;
        plan.dataPath = localBundlePath;
        plan.cacheSource = "local-bundle";
        plan.sourceSig = sourceSignatureForLocalBundle("explicit", localBundlePath);
        return plan;
    }

    if (assetUrl.empty())
    {
        if (progress)
        {
            progress("resolving_bundle", "Searching VRChat local cache for the avatar bundle");
        }
        localBundlePath = resolveBundlePath(vrchatBaseDir, avatarId);
        if (localBundlePath.empty())
        {
            plan.code = "bundle_not_found";
            plan.message = "No assetUrl provided and bundle not found in LocalAvatarData or Cache-WindowsPlayer.";
            return plan;
        }
        plan.ok = true;
        plan.bundleIndexed = true;
        plan.dataPath = localBundlePath;
        plan.cacheSource = "bundle-index";
        plan.sourceSig = sourceSignatureForLocalBundle("cache", localBundlePath);
        return plan;
    }

    const auto bundlePathOnDisk = bundleCachePathForAsset(avatarId, assetUrl);
    std::error_code ec;
    std::filesystem::create_directories(bundlePathOnDisk.parent_path(), ec);

    if (VrcApi::isTrustedBundleFile(assetUrl, bundlePathOnDisk))
    {
        plan.ok = true;
        plan.dataPath = bundlePathOnDisk;
        plan.cacheSource = "bundle-cache";
        plan.sourceSig = sourceSignatureForAssetBundle(assetUrl, bundlePathOnDisk);
        return plan;
    }

    if (!allowDownload)
    {
        plan.ok = true;
        plan.dataPath = bundlePathOnDisk;
        plan.cacheSource = "network";
        plan.sourceSig = fmt::format("asset:{}|not-downloaded", assetUrl);
        return plan;
    }

    if (progress)
    {
        progress("downloading_bundle", "Downloading the avatar bundle from VRChat");
    }

    spdlog::info("AvatarPreview: downloading bundle for {}...", avatarId);
    const auto started = std::chrono::steady_clock::now();
    if (!VrcApi::downloadFile(assetUrl, bundlePathOnDisk))
    {
        plan.code = "bundle_not_found";
        plan.message = "Failed to download the .vrca bundle from the VRChat API.";
        return plan;
    }
    plan.downloadMs = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - started).count();

    plan.ok = true;
    plan.downloaded = true;
    plan.dataPath = bundlePathOnDisk;
    plan.cacheSource = "network";
    plan.sourceSig = sourceSignatureForAssetBundle(assetUrl, bundlePathOnDisk);
    PreviewPathLease bundleLease(bundlePathOnDisk);
    trimPreviewCachesBestEffort();
    return plan;
}

bool fileContainsAscii(const std::filesystem::path& path, std::string_view needle)
{
    // __info files are small (<2 KB) so slurp + find is trivially
    // cheap. Bail early on files that are obviously too big — they
    // can't be __info descriptors.
    std::error_code ec;
    const auto size = std::filesystem::file_size(path, ec);
    if (ec || size == 0 || size > 16 * 1024)
    {
        return false;
    }

    std::ifstream in(path, std::ios::binary);
    if (!in)
    {
        return false;
    }

    std::string contents(static_cast<std::size_t>(size), '\0');
    in.read(contents.data(), static_cast<std::streamsize>(size));
    contents.resize(static_cast<std::size_t>(in.gcount()));

    return contents.find(needle) != std::string::npos;
}

// Walk Cache-WindowsPlayer looking for a __info file that textually
// references the given avatarId. VRChat packs the avatar id into the
// `__info` descriptor in plain ASCII, so a substring search is
// sufficient to pair the cache directory with an avatar UUID. Runs
// under a file-budget guard (`kMaxInfoFiles`) so a pathologically
// large cache can't stall the IPC worker for minutes.
std::filesystem::path findBundleForAvatar(
    const std::filesystem::path& cwpDir,
    const std::string& avatarId)
{
    std::error_code ec;
    if (!std::filesystem::exists(cwpDir, ec) || ec)
    {
        return {};
    }

    auto& cache = bundleMapCache();
    std::lock_guard<std::mutex> lock(cache.mutex);

    // Invalidate the in-memory map whenever the cwp directory's mtime
    // bumps — VRChat adds a new entry and we want subsequent probes
    // to see it without a full VRCSM restart.
    const auto latestMtime = std::filesystem::last_write_time(cwpDir, ec);
    if (cache.scannedRoot != cwpDir || cache.scannedAt != latestMtime)
    {
        cache.byAvatarId.clear();
        cache.scannedRoot = cwpDir;
        cache.scannedAt = latestMtime;
        cache.loadedFromDisk = false;
        loadBundleIndexUnlocked(cache, cwpDir, latestMtime);
    }
    else if (const auto it = cache.byAvatarId.find(avatarId); it != cache.byAvatarId.end())
    {
        if (bundleEntryStillValid(it->second))
        {
            return it->second;
        }
        cache.byAvatarId.erase(it);
    }
    else
    {
        loadBundleIndexUnlocked(cache, cwpDir, latestMtime);
        if (const auto loadedIt = cache.byAvatarId.find(avatarId); loadedIt != cache.byAvatarId.end())
        {
            if (bundleEntryStillValid(loadedIt->second))
            {
                return loadedIt->second;
            }
            cache.byAvatarId.erase(loadedIt);
        }
    }

    if (const auto it = cache.byAvatarId.find(avatarId); it != cache.byAvatarId.end())
    {
        if (bundleEntryStillValid(it->second))
        {
            return it->second;
        }
        cache.byAvatarId.erase(it);
    }

    // Increase scan budget significantly. A 30GB cache like the user's
    // can easily contain >2000 items. Scanning is fast, and we
    // only do it once per new cache state.
    constexpr std::size_t kMaxInfoFiles = 100000;
    std::size_t scanned = 0;

    // Two-level walk: Cache-WindowsPlayer/<topHash>/<versionHash>/__info
    for (const auto& topEntry : std::filesystem::directory_iterator(cwpDir, ec))
    {
        if (ec) break;
        if (!topEntry.is_directory(ec) || ec) continue;

        for (const auto& versionEntry : std::filesystem::directory_iterator(topEntry.path(), ec))
        {
            if (ec) break;
            if (!versionEntry.is_directory(ec) || ec) continue;

            const auto infoPath = versionEntry.path() / L"__info";
            std::error_code checkEc;
            if (!std::filesystem::exists(infoPath, checkEc) || checkEc) continue;

            ++scanned;
            if (scanned > kMaxInfoFiles)
            {
                spdlog::warn(
                    "AvatarPreview: hit kMaxInfoFiles scan budget at {} — bundle map incomplete",
                    toUtf8(cwpDir.wstring()));
                return {};
            }

            if (fileContainsAscii(infoPath, avatarId))
            {
                cache.byAvatarId[avatarId] = versionEntry.path();
                saveBundleIndexUnlocked(cache);
                return versionEntry.path();
            }
        }
    }

    return {};
}

// Run the in-process UnityFS → glTF extractor. Blocking call; callers
// check cancellation at the boundaries because the extraction itself
// is CPU-bound and typically completes in a few hundred ms on modern
// avatars (the old Python extractor's 46 MiB PyInstaller startup cost
// alone took longer than the entire native path now).
AvatarPreviewResult runNativeExtractor(
    const std::string& avatarId,
    const std::string& hash,
    const std::filesystem::path& dataPath,
    const std::filesystem::path& glbPath,
    const std::string& sourceSig,
    const std::string& cacheSource,
    bool downloaded,
    std::int64_t downloadMs,
    const TaskToken* token,
    const AvatarPreview::ProgressCallback& progress)
{
    AvatarPreviewResult result;
    PreviewPathLease bundleLease(dataPath);

    if (token && token->cancelled)
    {
        result.code = "cancelled";
        result.message = "Request cancelled before extraction";
        return result;
    }

    {
        std::error_code szEc;
        const auto bundleSize = std::filesystem::file_size(dataPath, szEc);
        spdlog::info(
            "AvatarPreview: native extract for {} (hash={}, bundle={} bytes)",
            avatarId,
            hash,
            szEc ? 0 : bundleSize);
    }

    if (progress)
    {
        progress("extracting", "Parsing the avatar bundle");
    }

    const auto decodeStarted = std::chrono::steady_clock::now();
    auto outcome = extractBundleToGlb(dataPath, glbPath);
    const auto decodeMs = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - decodeStarted).count();
    if (!isOk(outcome))
    {
        const auto& err = error(outcome);
        spdlog::error(
            "AvatarPreview: native extract failed ({}): {}",
            err.code, err.message);

        // Map UnityPreview error codes into AvatarPreviewResult taxonomy.
        // Keep the code stable because the React side keys off of it.
        if (err.code == "encrypted")
        {
            result.code = "encrypted";
        }
        else
        {
            result.code = "preview_failed";
        }
        result.message = err.message;

        std::error_code ec;
        std::filesystem::remove(glbPath, ec);
        return result;
    }

    if (token && token->cancelled)
    {
        std::error_code ec;
        std::filesystem::remove(glbPath, ec);
        result.code = "cancelled";
        result.message = "Request cancelled after extraction";
        return result;
    }

    std::error_code ec;
    if (!std::filesystem::exists(glbPath, ec))
    {
        result.code = "preview_failed";
        result.message = "Pipeline succeeded but output GLB was not produced.";
        return result;
    }

    const auto& summary = value(outcome);
    spdlog::info(
        "AvatarPreview: {} → {} meshes kept/{} total, {} verts, {} tris, unity={}",
        hash,
        summary.keptMeshes,
        summary.totalMeshes,
        summary.totalVertices,
        summary.totalTriangles,
        summary.unityRevision);

    PreviewPathLease glbLease(glbPath);

    result.ok = true;
    result.cached = false;
    result.glbPath = toUtf8(glbPath.wstring());
    result.glbUrl = glbUrlForHash(hash);
    result.sourceSig = sourceSig;
    result.cacheSource = cacheSource;
    result.downloaded = downloaded;
    result.decodeMs = decodeMs;
    result.downloadMs = downloadMs;
    writePreviewMetadataBestEffort(
        glbPath,
        avatarId,
        sourceSig,
        dataPath,
        cacheSource,
        downloaded,
        decodeMs,
        downloadMs);
    trimPreviewCachesBestEffort();
    if (progress)
    {
        progress("finalizing", "Preview cache written");
    }
    return result;
}

} // namespace

std::filesystem::path AvatarPreview::PreviewCacheDir()
{
    const auto dir = getAppDataRoot() / L"preview-cache";

    std::error_code ec;
    std::filesystem::create_directories(dir, ec);
    return dir;
}

void AvatarPreview::RetainPreviewPath(const std::filesystem::path& path)
{
    retainPreviewPath(path);
}

void AvatarPreview::ReleasePreviewPath(const std::filesystem::path& path)
{
    releasePreviewPath(path);
}

bool AvatarPreview::IsPreviewPathRetained(const std::filesystem::path& path)
{
    return isPreviewPathLeased(path);
}

void AvatarPreview::TrimPreviewCacheDirectoryForTests(
    const std::filesystem::path& dir,
    std::uintmax_t maxBytes,
    std::wstring_view extension,
    bool removeGlbSidecar)
{
    trimRegularFilesLru(dir, maxBytes, extension, removeGlbSidecar);
}

std::string AvatarPreview::CacheKeyForAvatarId(std::string_view avatarId)
{
    std::string seed;
    seed.reserve(kPreviewCacheSchema.size() + 1 + avatarId.size());
    seed.append(kPreviewCacheSchema);
    seed.push_back('|');
    seed.append(avatarId);
    return stableHashHex(seed);
}

std::string AvatarPreview::CacheKeyForAvatarSource(
    std::string_view avatarId,
    std::string_view sourceSig)
{
    std::string seed;
    seed.reserve(kPreviewCacheSchema.size() + 2 + avatarId.size() + sourceSig.size());
    seed.append(kPreviewCacheSchema);
    seed.push_back('|');
    seed.append(avatarId);
    seed.push_back('|');
    seed.append(sourceSig);
    return stableHashHex(seed);
}

std::filesystem::path AvatarPreview::CachedGlbPathForAvatarId(std::string_view avatarId)
{
    return PreviewCacheDir() / (CacheKeyForAvatarId(avatarId) + ".glb");
}

std::filesystem::path AvatarPreview::CachedGlbPathForSource(
    std::string_view avatarId,
    std::string_view sourceSig)
{
    return PreviewCacheDir() / (CacheKeyForAvatarSource(avatarId, sourceSig) + ".glb");
}

AvatarPreviewStatusResult AvatarPreview::Status(
    const std::string& avatarId,
    const std::filesystem::path& vrchatBaseDir,
    const std::string& assetUrl,
    const std::string& bundlePath)
{
    AvatarPreviewStatusResult status;
    if (avatarId.empty())
    {
        status.code = "missing_avatar_id";
        status.message = "avatarId is required";
        return status;
    }

    const auto plan = preparePreviewSource(
        avatarId,
        vrchatBaseDir,
        assetUrl,
        bundlePath,
        false,
        {});
    status.bundleIndexed = plan.bundleIndexed;
    status.sourceSig = plan.sourceSig;
    status.cacheSource = plan.cacheSource;
    if (!plan.ok)
    {
        status.code = plan.code;
        status.message = plan.message;
        return status;
    }

    const auto hash = CacheKeyForAvatarSource(avatarId, plan.sourceSig);
    const auto glbPath = PreviewCacheDir() / (hash + ".glb");
    std::error_code ec;
    if (std::filesystem::is_regular_file(glbPath, ec) && !ec)
    {
        PreviewPathLease lease(glbPath);
        status.cached = true;
        status.glbPath = toUtf8(glbPath.wstring());
        status.glbUrl = glbUrlForHash(hash);
        touchFileBestEffort(glbPath);
    }
    return status;
}

AvatarPreviewResult AvatarPreview::Request(
    const std::string& avatarId,
    const std::filesystem::path& vrchatBaseDir,
    const std::string& assetUrl,
    const std::string& bundlePath,
    ProgressCallback progress)
{
    AvatarPreviewResult result;

    if (avatarId.empty())
    {
        result.code = "missing_avatar_id";
        result.message = "avatarId is required";
        return result;
    }

    auto plan = preparePreviewSource(
        avatarId,
        vrchatBaseDir,
        assetUrl,
        bundlePath,
        true,
        progress);
    if (!plan.ok)
    {
        result.code = plan.code;
        result.message = plan.message;
        return result;
    }

    if (!isReadableRegularFile(plan.dataPath))
    {
        result.code = "bundle_not_found";
        result.message = "Bundle path resolved but no readable bundle file was found.";
        return result;
    }

    const std::string hash = CacheKeyForAvatarSource(avatarId, plan.sourceSig);
    const auto glbPath = PreviewCacheDir() / (hash + ".glb");

    std::error_code ec;
    if (std::filesystem::is_regular_file(glbPath, ec) && !ec)
    {
        PreviewPathLease lease(glbPath);
        if (progress)
        {
            progress("cached", "Using cached preview");
        }
        touchFileBestEffort(glbPath);
        result.ok = true;
        result.cached = true;
        result.glbPath = toUtf8(glbPath.wstring());
        result.glbUrl = glbUrlForHash(hash);
        result.sourceSig = plan.sourceSig;
        result.cacheSource = "glb-cache";
        return result;
    }

    return runNativeExtractor(
        avatarId,
        hash,
        plan.dataPath,
        glbPath,
        plan.sourceSig,
        plan.cacheSource,
        plan.downloaded,
        plan.downloadMs,
        nullptr,
        progress);
}

AvatarPreviewResult AvatarPreview::Request(
    const std::string& avatarId,
    const std::filesystem::path& vrchatBaseDir,
    const std::string& assetUrl,
    const std::string& bundlePath,
    TaskQueue& queue,
    const TaskToken& token,
    ProgressCallback progress)
{
    if (token.cancelled)
    {
        return AvatarPreviewResult{false, {}, {}, false, "cancelled", "Request cancelled"};
    }

    if (avatarId.empty())
    {
        return AvatarPreviewResult{false, {}, {}, false, "missing_avatar_id", "avatarId is required"};
    }

    if (token.cancelled)
    {
        return AvatarPreviewResult{false, {}, {}, false, "cancelled", "Request cancelled"};
    }

    auto plan = preparePreviewSource(
        avatarId,
        vrchatBaseDir,
        assetUrl,
        bundlePath,
        true,
        progress);
    if (!plan.ok)
    {
        return AvatarPreviewResult{false, {}, {}, false, plan.code, plan.message};
    }

    if (token.cancelled)
    {
        return AvatarPreviewResult{false, {}, {}, false, "cancelled", "Request cancelled"};
    }

    if (!isReadableRegularFile(plan.dataPath))
    {
        return AvatarPreviewResult{false, {}, {}, false, "bundle_not_found",
            "Bundle path resolved but no readable bundle file was found."};
    }

    const std::string hash = CacheKeyForAvatarSource(avatarId, plan.sourceSig);
    const auto glbPath = PreviewCacheDir() / (hash + ".glb");

    std::error_code ec;
    if (std::filesystem::is_regular_file(glbPath, ec) && !ec)
    {
        PreviewPathLease lease(glbPath);
        if (progress)
        {
            progress("cached", "Using cached preview");
        }
        touchFileBestEffort(glbPath);
        AvatarPreviewResult result;
        result.ok = true;
        result.cached = true;
        result.glbPath = toUtf8(glbPath.wstring());
        result.glbUrl = glbUrlForHash(hash);
        result.sourceSig = plan.sourceSig;
        result.cacheSource = "glb-cache";
        return result;
    }

    // 3) Native extractor — TaskQueue is now vestigial for the blocking
    //    call, but we keep the overload so callers can pass their token
    //    for cancellation at the extract boundaries.
    (void)queue;
    return runNativeExtractor(
        avatarId,
        hash,
        plan.dataPath,
        glbPath,
        plan.sourceSig,
        plan.cacheSource,
        plan.downloaded,
        plan.downloadMs,
        &token,
        progress);
}

} // namespace vrcsm::core
