#pragma once

#include "Common.h"

#include <filesystem>
#include <string>

namespace vrcsm::core
{

// ─────────────────────────────────────────────────────────────────────
// UnityPreview — drives the full bundle → glb extraction pipeline.
//
// Replaces the external Python/PyInstaller `vrcsm_extractor.exe` that
// used to do this out-of-process. Runs fully in-process: no child
// processes, no 46 MiB extractor resource, no startup cost beyond the
// first LZ4/LZMA decompression of the bundle itself.
//
// Pipeline stages:
//   1. Parse the `.vrca` / `__data` as a UnityFS bundle
//   2. Parse every CAB node as a SerializedFile
//   3. Hand-decode every `Mesh` (class 43) object payload
//   4. Apply the adaptive filter (skinned-prefer, volume-outlier,
//      spatial-outlier, LOD-dedup, keyword-reject)
//   5. Emit a minimal glTF 2.0 binary (`.glb`) to `glbPath`
//
// Failure modes are surfaced via stable `Error.code` values matching
// the Python extractor's codes so the React side doesn't need to know
// whether a native or external extractor ran:
//   "bundle_invalid"             — not a UnityFS bundle
//   "encrypted"                  — Unity custom encryption flag set
//   "typetree_unsupported"       — SerializedFile has TypeTreeEnabled
//   "no_meshes"                  — no parseable Mesh objects found
//   "preview_failed"             — any other unclassified pipeline issue
// ─────────────────────────────────────────────────────────────────────

struct PreviewExtractSummary
{
    int totalMeshes{0};     // meshes seen in the bundle
    int keptMeshes{0};      // meshes that survived the filter
    int totalVertices{0};
    int totalTriangles{0};
    std::string unityRevision;
};

Result<PreviewExtractSummary> extractBundleToGlb(
    const std::filesystem::path& bundlePath,
    const std::filesystem::path& glbPath);

} // namespace vrcsm::core
