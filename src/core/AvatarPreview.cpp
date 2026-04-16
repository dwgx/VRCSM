#include "AvatarPreview.h"

#include "Common.h"
#include "PathProbe.h"
#include "VrcApi.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <fstream>
#include <mutex>
#include <system_error>
#include <unordered_map>

#include <Windows.h>
#include <KnownFolders.h>
#include <ShlObj.h>

#include <fmt/format.h>
#include <spdlog/spdlog.h>

// ─────────────────────────────────────────────────────────────────────────
// AvatarPreview — scaffolds the v0.5.0 real 3D preview pipeline.
//
// What it does today (scaffold, honest about its limits):
//   1. Cache hit path — if `preview-cache/<sha1>.glb` already exists,
//      return its URL immediately. This is the hot path on repeat
//      inspections and never touches the extractor.
//   2. Bundle locator — walks Cache-WindowsPlayer looking for a `__info`
//      file that mentions the given `avtr_*` id. Runs under a strict
//      file-limit budget so the walk stays under a second even on a
//      thousand-entry cache. Populates an in-process memo so subsequent
//      lookups are free.
//   3. Extractor gate — resolves AssetRipper.CLI.exe next to the VRCSM
//      binary or on PATH. If missing we return `extractor_missing` so
//      the frontend renders the "install AssetRipper to enable 3D
//      previews" empty state instead of pretending the request
//      succeeded.
//   4. Converter gate — same story for fbx2gltf.exe.
//
// What it does NOT do yet (Phase 2/3 of docs/v0.5.0-3d-preview-research.md):
//   - Actually spawn AssetRipper / fbx2gltf. Both are large binaries
//     we don't yet bundle with the MSI, so we return the
//     `extractor_missing` code and let the React layer fall back to
//     the 2D thumbnail cleanly. When the binaries land, replace the
//     `extractor_missing` return with CreateProcessW calls and the
//     rest of the pipeline (cache, URL, error mapping) is ready.
//   - Encrypted-bundle detection. When AssetRipper actually runs it
//     will surface an error code; we map that to `encrypted`.
//
// Why the scaffold ships now: so the frontend half can land in the
// same release (v0.5.0) and every caller-visible contract — IPC
// shape, error codes, URL format, cache path — is the final one.
// Phase 2 will swap the extractor stub for the real spawn without
// changing any other file.
// ─────────────────────────────────────────────────────────────────────────

namespace vrcsm::core
{

namespace
{

constexpr const char* kPreviewHost = "preview.local";

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

std::filesystem::path executableDir()
{
    std::wstring buffer(static_cast<std::size_t>(MAX_PATH), L'\0');
    DWORD length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
    while (length >= buffer.size())
    {
        buffer.resize(buffer.size() * 2);
        length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
        if (length == 0) break;
    }
    if (length == 0) return {};
    buffer.resize(length);
    return std::filesystem::path(buffer).parent_path();
}

std::optional<std::filesystem::path> resolveToolBinary(std::wstring_view filename)
{
    const auto exeDir = executableDir();
    if (!exeDir.empty())
    {
        // Look next to VRCSM.exe first. The MSI installs any
        // co-bundled extractor tools under `extractor/` so we check
        // both the flat and the subdir layouts.
        std::array<std::filesystem::path, 2> candidates{
            exeDir / filename,
            exeDir / L"extractor" / filename,
        };
        for (const auto& candidate : candidates)
        {
            std::error_code ec;
            if (std::filesystem::exists(candidate, ec) && !ec)
            {
                return candidate;
            }
        }
    }

    // Fallback: plain PATH lookup via SearchPathW so a dev-mode user
    // who installed AssetRipper globally still gets the preview.
    std::wstring found(static_cast<std::size_t>(MAX_PATH), L'\0');
    const DWORD n = SearchPathW(
        nullptr,
        filename.data(),
        nullptr,
        static_cast<DWORD>(found.size()),
        found.data(),
        nullptr);
    if (n > 0 && n < found.size())
    {
        found.resize(n);
        return std::filesystem::path(found);
    }
    return std::nullopt;
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

    constexpr std::size_t kMaxInfoFiles = 2000;
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

} // namespace

std::filesystem::path AvatarPreview::PreviewCacheDir()
{
    PWSTR raw = nullptr;
    if (FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &raw)) || raw == nullptr)
    {
        if (raw) CoTaskMemFree(raw);
        return std::filesystem::path(L"preview-cache");
    }
    std::filesystem::path base(raw);
    CoTaskMemFree(raw);
    const auto dir = base / L"VRCSM" / L"preview-cache";

    std::error_code ec;
    std::filesystem::create_directories(dir, ec);
    return dir;
}

AvatarPreviewResult AvatarPreview::Request(
    const std::string& avatarId,
    const std::filesystem::path& vrchatBaseDir,
    const std::string& assetUrl)
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
    const std::string hash = stableHashHex(avatarId);
    const auto cacheDir = PreviewCacheDir();
    const auto glbPath = cacheDir / (hash + ".glb");

    auto buildUrl = [&hash]() {
        return fmt::format("https://{}/{}.glb", kPreviewHost, hash);
    };

    // 1) Hot cache hit — nothing else to do.
    std::error_code ec;
    if (std::filesystem::exists(glbPath, ec) && !ec)
    {
        result.ok = true;
        result.cached = true;
        result.glbPath = toUtf8(glbPath.wstring());
        result.glbUrl = buildUrl();
        return result;
    }

    // 2) Download the raw .vrca directly from VRChat API, or fallback to local disk.
    // We check if it's a locally built avatar without an assetUrl first.
    std::filesystem::path localBundlePath;
    if (assetUrl.empty())
    {
        const auto localAvatarDir = vrchatBaseDir / L"LocalAvatarData";
        std::error_code l_ec;
        if (std::filesystem::exists(localAvatarDir, l_ec))
        {
            for (const auto& userEntry : std::filesystem::directory_iterator(localAvatarDir, l_ec))
            {
                if (l_ec || !userEntry.is_directory(l_ec)) continue;
                auto potentialPath = userEntry.path() / toWide(avatarId) / L"custom.vrca";
                if (std::filesystem::exists(potentialPath, l_ec))
                {
                    localBundlePath = potentialPath;
                    break;
                }
            }
        }
        
        if (localBundlePath.empty())
        {
            result.code = "bundle_not_found";
            result.message = "No assetUrl provided and offline cache sweeps are unsupported.";
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
        spdlog::info("AvatarPreview: downloading bundle for {}...", avatarId);
        if (!VrcApi::downloadFile(assetUrl, dataPath))
        {
            result.code = "bundle_not_found";
            result.message = "Failed to download the .vrca bundle from the VRChat API.";
            return result;
        }
    }

    if (!std::filesystem::exists(dataPath, ec))
    {
        result.code = "bundle_not_found";
        result.message = "Bundle directory found but __data file is missing";
        return result;
    }

    // 4) Extractor gate. If AssetRipper / fbx2gltf aren't installed
    //    yet, we honestly tell the frontend so it falls back to the
    //    2D thumbnail + empty-state banner. The scaffold stops here
    //    until Phase 2 of the pipeline lands (see research doc).
    // -------------------------------------------------------------------------
    // Phase 2 implementation — Extract and Convert using our UnityPy backend.
    // This replaces AssetStudioModCLI which crashes on VRChat 2022's LZ4 bundles.
    // -------------------------------------------------------------------------
    
    std::optional<std::filesystem::path> extractorPath = resolveToolBinary(L"vrcsm_extractor.exe");
    if (!extractorPath.has_value())
    {
        // Try looking in current working directory for local testing
        std::filesystem::path localExe = std::filesystem::current_path() / "dist" / "vrcsm_extractor.exe";
        if (std::filesystem::exists(localExe)) {
            extractorPath = localExe;
        } else {
            result.code = "extractor_missing";
            result.message = "vrcsm_extractor.exe is not available — 3D preview disabled";
            return result;
        }
    }

    // Spawn the extractor with its stdout+stderr redirected to a
    // per-avatar log file. Silently-failing child processes are the
    // worst class of bug to chase — every run now leaves a breadcrumb
    // at `preview-cache/logs/<hash>.log` so a bad bundle or a Python
    // traceback is one file away instead of invisible.
    const auto logsDir = cacheDir / L"logs";
    std::filesystem::create_directories(logsDir, ec);
    const auto extractorLogPath = logsDir / (hash + ".log");

    auto spawnProcess = [&extractorLogPath](const std::wstring& cmd, const std::filesystem::path& cwd) -> bool {
        SECURITY_ATTRIBUTES sa{};
        sa.nLength = sizeof(sa);
        sa.bInheritHandle = TRUE;
        sa.lpSecurityDescriptor = nullptr;

        HANDLE hLog = CreateFileW(
            extractorLogPath.c_str(),
            GENERIC_WRITE,
            FILE_SHARE_READ,
            &sa,
            CREATE_ALWAYS,
            FILE_ATTRIBUTE_NORMAL,
            nullptr);
        if (hLog == INVALID_HANDLE_VALUE)
        {
            spdlog::warn("AvatarPreview: could not open log file {}", toUtf8(extractorLogPath.wstring()));
            hLog = nullptr;
        }

        std::wstring mutableCmd = cmd;
        STARTUPINFOW si{};
        si.cb = sizeof(si);
        if (hLog)
        {
            si.dwFlags = STARTF_USESTDHANDLES;
            si.hStdInput  = GetStdHandle(STD_INPUT_HANDLE);
            si.hStdOutput = hLog;
            si.hStdError  = hLog;
        }
        PROCESS_INFORMATION pi{};

        if (!CreateProcessW(
            nullptr,
            mutableCmd.data(),
            nullptr,
            nullptr,
            hLog ? TRUE : FALSE,
            CREATE_NO_WINDOW,
            nullptr,
            cwd.empty() ? nullptr : cwd.c_str(),
            &si,
            &pi))
        {
            spdlog::error("AvatarPreview: CreateProcessW failed with error code: {}", GetLastError());
            if (hLog) CloseHandle(hLog);
            return false;
        }

        WaitForSingleObject(pi.hProcess, INFINITE);
        DWORD exitCode = 1;
        GetExitCodeProcess(pi.hProcess, &exitCode);
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
        if (hLog) CloseHandle(hLog);

        if (exitCode != 0) {
            spdlog::error(
                "AvatarPreview: extractor exited with code {} — see {}",
                exitCode,
                toUtf8(extractorLogPath.wstring()));
        }
        return exitCode == 0;
    };

    const auto tempExportDir = cacheDir / (hash + "_export");
    std::filesystem::remove_all(tempExportDir, ec);

    std::wstring cmdLine = L"\"" + extractorPath->wstring() + L"\" \"" + dataPath.wstring() + L"\" \"" + glbPath.wstring() + L"\"";

    {
        std::error_code szEc;
        const auto bundleSize = std::filesystem::file_size(dataPath, szEc);
        spdlog::info(
            "AvatarPreview: spawning extractor for {} (hash={}, bundle={} bytes)",
            avatarId,
            hash,
            szEc ? 0 : bundleSize);
    }

    if (!spawnProcess(cmdLine, cacheDir))
    {
        result.code = "preview_failed";
        result.message = "Extraction pipeline script failed (see preview-cache/logs/<hash>.log)";
        std::filesystem::remove_all(tempExportDir, ec);
        return result;
    }

    std::filesystem::remove_all(tempExportDir, ec);

    if (!std::filesystem::exists(glbPath, ec))
    {
        result.code = "preview_failed";
        result.message = "Pipeline succeeded but output GLB was not produced.";
        return result;
    }

    result.ok = true;
    result.cached = false;
    result.glbPath = toUtf8(glbPath.wstring());
    result.glbUrl = buildUrl();
    return result;
}

} // namespace vrcsm::core
