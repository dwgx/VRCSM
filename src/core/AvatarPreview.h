#pragma once

#include <cstdint>
#include <filesystem>
#include <functional>
#include <string>
#include <string_view>

namespace vrcsm::core
{

class TaskQueue;
struct TaskToken;

// Outcome of an avatar-preview request. Successful runs produce an
// absolute glb path plus the web-facing URL the React renderer should
// load (served over the `preview.local` virtual host); failures carry
// a stable error `code` the frontend can switch on to pick a fallback
// state ("Asset Encrypted", "Extractor Missing", etc.). Keep the code
// taxonomy stable across versions — renaming one silently breaks the
// UI's empty-state selection.
struct AvatarPreviewResult
{
    bool ok{false};

    // Absolute filesystem path to the cached `.glb` (empty on failure).
    std::string glbPath;

    // Web-facing URL under the `preview.local` virtual host mapping.
    // Example: `http://preview.local/abc123.glb`. Always empty on
    // failure so the frontend doesn't try to render a broken URL.
    std::string glbUrl;

    // True when we hit the on-disk glb cache and skipped the full
    // AssetRipper + fbx2gltf conversion pipeline. Useful for the
    // "Cached preview" chip in the inspector.
    bool cached{false};

    // Stable failure code. Known values:
    //   "cache_missing"         — Cache-WindowsPlayer doesn't exist
    //   "bundle_not_found"      — no __data bundle references this avatarId
    //   "extractor_missing"     — AssetRipper.CLI.exe not installed
    //   "extractor_failed"      — AssetRipper ran but crashed / returned non-zero
    //   "converter_missing"     — fbx2gltf.exe not installed
    //   "converter_failed"      — fbx2gltf ran but crashed
    //   "encrypted"             — bundle present but AssetRipper reported
    //                             an encrypted payload (VRChat 2023+)
    //   "preview_failed"        — any other unclassified failure
    std::string code;

    // Human-readable message for logging + dev tools. The React side
    // may surface it in a <details> block but never renders it as the
    // primary empty-state text (we prefer i18n'd strings keyed off
    // `code`).
    std::string message;

    // Source signature used by preview-v5. It includes avatarId at the
    // cache-key layer plus source identity (assetUrl/bundle path), file size,
    // and mtime when a local bundle is known.
    std::string sourceSig;

    // Where the GLB came from: "glb-cache", "local-bundle",
    // "bundle-index", "bundle-cache", or "network".
    std::string cacheSource;

    // True only when Request had to download a .vrca before decoding.
    bool downloaded{false};

    // Timing telemetry for UI/logging. Cache hits report 0.
    std::int64_t decodeMs{0};
    std::int64_t downloadMs{0};
};

struct AvatarPreviewStatusResult
{
    bool cached{false};
    std::string glbPath;
    std::string glbUrl;
    bool bundleIndexed{false};
    std::string sourceSig;
    std::string cacheSource;
    std::string code;
    std::string message;
};

class AvatarPreview
{
public:
    using ProgressCallback = std::function<void(std::string_view phase, std::string_view message)>;

    /// Deterministic cache key for a given `avtr_*` id. The key is safe to
    /// use as a filename stem and changes whenever the preview cache schema
    /// version changes.
    static std::string CacheKeyForAvatarId(std::string_view avatarId);

    /// Deterministic cache key for a specific avatar/source pair. The
    /// source signature should include bundle identity + size + mtime so
    /// updated avatar bundles naturally invalidate old GLBs.
    static std::string CacheKeyForAvatarSource(
        std::string_view avatarId,
        std::string_view sourceSig);

    /// Absolute path to the cached GLB for a given avatar id under
    /// `%LocalAppData%\VRCSM\preview-cache`.
    static std::filesystem::path CachedGlbPathForAvatarId(std::string_view avatarId);

    static std::filesystem::path CachedGlbPathForSource(
        std::string_view avatarId,
        std::string_view sourceSig);

    /// Fast cache probe used by visible-item prewarming. It resolves the
    /// source signature and checks for an existing GLB, but never downloads
    /// or decodes.
    static AvatarPreviewStatusResult Status(
        const std::string& avatarId,
        const std::filesystem::path& vrchatBaseDir,
        const std::string& assetUrl = "",
        const std::string& bundlePath = "");

    /// Best-effort preview pipeline for a single avatar. `avatarId`
    /// is the `avtr_*` UUID string; `vrchatBaseDir` is the VRChat
    /// `LocalLow\VRChat\VRChat` directory where Cache-WindowsPlayer
    /// lives. Safe to call from any thread (the handler runs on the
    /// async worker pool already) — all state is local to the call
    /// except the on-disk glb cache, which is write-once and safe for
    /// concurrent readers.
    static AvatarPreviewResult Request(
        const std::string& avatarId,
        const std::filesystem::path& vrchatBaseDir,
        const std::string& assetUrl = "",
        const std::string& bundlePath = "",
        ProgressCallback progress = {});

    /// Cancellation-aware variant. Uses `queue` for child process
    /// management (Job Object, concurrency=1) and checks `token` at
    /// every phase boundary so the worker bails early when the user
    /// switches avatars.
    static AvatarPreviewResult Request(
        const std::string& avatarId,
        const std::filesystem::path& vrchatBaseDir,
        const std::string& assetUrl,
        const std::string& bundlePath,
        TaskQueue& queue,
        const TaskToken& token,
        ProgressCallback progress = {});

    /// Directory where converted glbs land.
    /// `%LocalAppData%\VRCSM\preview-cache`. Created on first access.
    static std::filesystem::path PreviewCacheDir();

    /// Retain/release a preview cache path while WebView is actively
    /// displaying it. LRU cleanup skips retained paths and keeps a short
    /// grace period after release so stale object URLs do not race cleanup.
    static void RetainPreviewPath(const std::filesystem::path& path);
    static void ReleasePreviewPath(const std::filesystem::path& path);
    static bool IsPreviewPathRetained(const std::filesystem::path& path);

    // Test seam for LRU/lease regression coverage.
    static void TrimPreviewCacheDirectoryForTests(
        const std::filesystem::path& dir,
        std::uintmax_t maxBytes,
        std::wstring_view extension,
        bool removeGlbSidecar);
};

} // namespace vrcsm::core
