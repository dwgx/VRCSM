#pragma once

#include <filesystem>
#include <string>

namespace vrcsm::core
{

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
};

class AvatarPreview
{
public:
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
        const std::string& assetUrl = "");

    /// Directory where converted glbs land.
    /// `%LocalAppData%\VRCSM\preview-cache`. Created on first access.
    static std::filesystem::path PreviewCacheDir();
};

} // namespace vrcsm::core
