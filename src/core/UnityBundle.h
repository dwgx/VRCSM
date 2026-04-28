#pragma once

#include "Common.h"

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace vrcsm::core
{

// ─────────────────────────────────────────────────────────────────────
// UnityBundle — minimal UnityFS parser.
//
// Produces a "virtual filesystem" from a .vrca/.unity3d/.vrcw bundle:
// each embedded node (usually a SerializedFile) is exposed as a
// contiguous byte range in a decompressed block stream, ready for the
// SerializedFile parser to walk. We only need the subset the avatar
// preview pipeline cares about — enough to find the Mesh objects.
//
// Format references:
//   https://github.com/AssetRipper/AssetRipper (C#, very readable)
//   https://github.com/K0lb3/UnityPy (Python, compact & correct)
//   Unity source (BundleFile.h) for semantics of flags bits.
//
// Supported: UnityFS v6/v7/v8 with LZ4/LZ4HC/LZMA/None compression.
// Not supported: UnityWeb / UnityRaw legacy formats (VRChat never
// ships these; if we see one we return `Error{bundle_invalid}`).
// ─────────────────────────────────────────────────────────────────────

struct UnityBundleNode
{
    // Offset into the decompressed block stream (NOT file offset).
    std::int64_t offset{0};
    // Byte length of this file within the decompressed stream.
    std::int64_t size{0};
    // Node flag bits from the Unity bundle format. Unused today; kept
    // so callers that care (e.g. resource-stream flag 0x04) can peek.
    std::uint32_t flags{0};
    // Node path as it appears in the bundle — usually the filename of
    // the contained SerializedFile, e.g. `CAB-xxxxxxxxxxxx`.
    std::string path;
};

struct UnityBundle
{
    // Unity version string as reported in the bundle header.
    // Example: "2022.3.22f1". Drives per-version parser branches in
    // the SerializedFile / Mesh decoders downstream.
    std::string unityRevision;

    // Bundle format version (6, 7, or 8 today).
    std::uint32_t formatVersion{0};

    // Entire decompressed block stream (all blocks concatenated, in
    // bundle order). Node offsets are relative to this buffer.
    std::vector<std::uint8_t> data;

    // Nodes, in the order they appear in the bundle.
    std::vector<UnityBundleNode> nodes;

    // Convenience: return a non-owning view over the bytes of `node`.
    // Callers must treat the view as invalidated once `this` is moved
    // or destroyed.
    std::pair<const std::uint8_t*, std::size_t> view(const UnityBundleNode& node) const;
};

// Parse and decompress an entire UnityFS bundle file on disk.
// Returns the fully materialized `UnityBundle` on success.
//
// This loads the whole file into memory and decompresses every block
// up-front. For VRChat avatars that's 5-80 MB on average — cheap
// enough to keep the API simple. If we ever need to stream, the
// `UnityBundleNode::offset`/`size` design lets us swap in a
// lazy-decompress variant without changing callers.
Result<UnityBundle> parseUnityBundle(const std::filesystem::path& path);

// Lightweight structural validation used at download-cache boundaries.
// It parses the UnityFS header, blocksInfo, block table, and node table,
// and verifies block/node ranges without materializing the full bundle.
// This catches truncated downloads that still start with "UnityFS".
Result<std::monostate> validateUnityBundleStructure(const std::filesystem::path& path);

} // namespace vrcsm::core
