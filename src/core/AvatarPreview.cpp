#include "AvatarPreview.h"

#include "Common.h"
#include "PathProbe.h"
#include "TaskQueue.h"
#include "UnityPreview.h"
#include "VrcApi.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <fstream>
#include <mutex>
#include <system_error>
#include <unordered_map>
#include <vector>

#include <Windows.h>
#include <KnownFolders.h>
#include <ShlObj.h>

#include <fmt/format.h>
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
constexpr std::string_view kPreviewCacheSchema = "preview-v4";

struct BundleMapCache
{
    std::mutex mutex;
    std::unordered_map<std::string, std::filesystem::path> byAvatarId;
    std::filesystem::file_time_type scannedAt{};
    std::filesystem::path scannedRoot;
};

BundleMapCache& bundleMapCache()
{
    static BundleMapCache state;
    return state;
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
    }
    else if (const auto it = cache.byAvatarId.find(avatarId); it != cache.byAvatarId.end())
    {
        return it->second;
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
    const TaskToken* token,
    const AvatarPreview::ProgressCallback& progress)
{
    AvatarPreviewResult result;

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

    auto outcome = extractBundleToGlb(dataPath, glbPath);
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

    result.ok = true;
    result.cached = false;
    result.glbPath = toUtf8(glbPath.wstring());
    result.glbUrl = fmt::format("https://{}/{}.glb", kPreviewHost, hash);
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

std::string AvatarPreview::CacheKeyForAvatarId(std::string_view avatarId)
{
    std::string seed;
    seed.reserve(kPreviewCacheSchema.size() + 1 + avatarId.size());
    seed.append(kPreviewCacheSchema);
    seed.push_back('|');
    seed.append(avatarId);
    return stableHashHex(seed);
}

std::filesystem::path AvatarPreview::CachedGlbPathForAvatarId(std::string_view avatarId)
{
    return PreviewCacheDir() / (CacheKeyForAvatarId(avatarId) + ".glb");
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

    // Shape the hash + target paths up-front. The glb filename is a
    // pure function of the avatarId so cache hits are trivially
    // discoverable without touching the extractor.
    const std::string hash = CacheKeyForAvatarId(avatarId);
    const auto cacheDir = PreviewCacheDir();
    const auto glbPath = CachedGlbPathForAvatarId(avatarId);

    auto buildUrl = [&hash]() {
        return fmt::format("https://{}/{}.glb", kPreviewHost, hash);
    };

    // 1) Hot cache hit — nothing else to do.
    std::error_code ec;
    if (std::filesystem::exists(glbPath, ec) && !ec)
    {
        if (progress)
        {
            progress("cached", "Using cached preview");
        }
        result.ok = true;
        result.cached = true;
        result.glbPath = toUtf8(glbPath.wstring());
        result.glbUrl = buildUrl();
        return result;
    }

    // 2) Download the raw .vrca directly from VRChat API, or fallback to local disk.
    // We check if it's a locally built avatar without an assetUrl first.
    std::filesystem::path localBundlePath;
    if (!bundlePath.empty())
    {
        if (progress)
        {
            progress("resolving_bundle", "Checking the selected local avatar files");
        }
        localBundlePath = normalizeExplicitBundlePath(toWide(bundlePath));
    }

    if (localBundlePath.empty() && assetUrl.empty())
    {
        if (progress)
        {
            progress("resolving_bundle", "Searching VRChat local cache for the avatar bundle");
        }
        localBundlePath = resolveBundlePath(vrchatBaseDir, avatarId);
        if (localBundlePath.empty())
        {
            result.code = "bundle_not_found";
            result.message = "No assetUrl provided and bundle not found in LocalAvatarData or Cache-WindowsPlayer.";
            return result;
        }
    }

    const auto bundleDir = cacheDir / L"bundles";
    std::filesystem::create_directories(bundleDir, ec);
    std::filesystem::path dataPath = bundleDir / (hash + ".vrca");

    if (!localBundlePath.empty())
    {
        dataPath = localBundlePath;
    }
    else if (!std::filesystem::exists(dataPath, ec) || ec)
    {
        if (progress)
        {
            progress("downloading_bundle", "Downloading the avatar bundle from VRChat");
        }
        spdlog::info("AvatarPreview: downloading bundle for {}...", avatarId);
        if (!VrcApi::downloadFile(assetUrl, dataPath))
        {
            result.code = "bundle_not_found";
            result.message = "Failed to download the .vrca bundle from the VRChat API.";
            return result;
        }
    }

    if (!isReadableRegularFile(dataPath))
    {
        result.code = "bundle_not_found";
        result.message = "Bundle path resolved but no readable bundle file was found.";
        return result;
    }

    // 3) Native extractor — in-process UnityFS → glTF pipeline.
    return runNativeExtractor(avatarId, hash, dataPath, glbPath, nullptr, progress);
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

    const std::string hash = CacheKeyForAvatarId(avatarId);
    const auto cacheDir = PreviewCacheDir();
    const auto glbPath = CachedGlbPathForAvatarId(avatarId);

    // 1) Hot cache hit.
    std::error_code ec;
    if (std::filesystem::exists(glbPath, ec) && !ec)
    {
        if (progress)
        {
            progress("cached", "Using cached preview");
        }
        return AvatarPreviewResult{
            true,
            toUtf8(glbPath.wstring()),
            fmt::format("https://{}/{}.glb", kPreviewHost, hash),
            true, {}, {}};
    }

    if (token.cancelled)
    {
        return AvatarPreviewResult{false, {}, {}, false, "cancelled", "Request cancelled"};
    }

    // 2) Resolve bundle (same logic as the base overload).
    std::filesystem::path localBundlePath;
    if (!bundlePath.empty())
    {
        if (progress)
        {
            progress("resolving_bundle", "Checking the selected local avatar files");
        }
        localBundlePath = normalizeExplicitBundlePath(toWide(bundlePath));
    }

    if (localBundlePath.empty() && assetUrl.empty())
    {
        if (progress)
        {
            progress("resolving_bundle", "Searching VRChat local cache for the avatar bundle");
        }
        localBundlePath = resolveBundlePath(vrchatBaseDir, avatarId);
        if (localBundlePath.empty())
        {
            return AvatarPreviewResult{false, {}, {}, false, "bundle_not_found",
                "No assetUrl provided and bundle not found in LocalAvatarData or Cache-WindowsPlayer."};
        }
    }

    const auto bundleDir = cacheDir / L"bundles";
    std::filesystem::create_directories(bundleDir, ec);
    std::filesystem::path dataPath = bundleDir / (hash + ".vrca");

    if (!localBundlePath.empty())
    {
        dataPath = localBundlePath;
    }
    else if (!std::filesystem::exists(dataPath, ec) || ec)
    {
        if (token.cancelled)
        {
            return AvatarPreviewResult{false, {}, {}, false, "cancelled", "Request cancelled"};
        }
        if (progress)
        {
            progress("downloading_bundle", "Downloading the avatar bundle from VRChat");
        }
        spdlog::info("AvatarPreview: downloading bundle for {}...", avatarId);
        if (!VrcApi::downloadFile(assetUrl, dataPath))
        {
            return AvatarPreviewResult{false, {}, {}, false, "bundle_not_found",
                "Failed to download the .vrca bundle from the VRChat API."};
        }
    }

    if (!isReadableRegularFile(dataPath))
    {
        return AvatarPreviewResult{false, {}, {}, false, "bundle_not_found",
            "Bundle path resolved but no readable bundle file was found."};
    }

    // 3) Native extractor — TaskQueue is now vestigial for the blocking
    //    call, but we keep the overload so callers can pass their token
    //    for cancellation at the extract boundaries.
    (void)queue;
    return runNativeExtractor(avatarId, hash, dataPath, glbPath, &token, progress);
}

} // namespace vrcsm::core
