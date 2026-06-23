# Avatar Preview Unpacking Research

Last updated: 2026-06-23

This is the current working map for local VRChat bundle preview in VRCSM.
The target is read-only local preview of bundles the user already has in
the VRChat cache or explicitly selects. This is not a plan to bypass
VRChat access controls, extract other users' private assets, inject into
the game, or modify cached VRChat data.

## Current VRCSM Path

VRCSM already has an in-process native preview path:

1. `AvatarPreview::runNativeExtractor()` calls `extractBundleToGlb()`.
2. `extractBundleToGlb()` calls `parseUnityBundle()`, scans bundle nodes
   that parse as Unity SerializedFile, then reads only `UnityClass::kMesh`.
3. `parseUnityMesh()` decodes a simplified mesh payload and `writeGlb()`
   emits a geometry-only GLB.

Useful current files:

- `src/core/AvatarPreview.cpp`
- `src/core/UnityBundle.{h,cpp}`
- `src/core/UnitySerialized.{h,cpp}`
- `src/core/UnityMesh.{h,cpp}`
- `src/core/UnityPreview.cpp`

Confirmed native support today:

- UnityFS v6/v7/v8 container parsing.
- Bundle-level None, LZ4, LZ4HC, and LZMA decompression.
- SerializedFile scanning.
- Mesh class extraction.
- Mesh streamed vertex data resolution through `archive:/...resS`.
- GLB output with positions, normals, UV0, submesh index ranges, and
  filtering.

Confirmed limitations today:

- `parseUnityMesh()` rejects `m_MeshCompression != 0`.
- Blend shapes, bind poses, bone hashes, and skin-related fields are
  currently skipped or counted, not exported into GLB.
- Only Position, Normal, and UV0 channels are decoded.
- The extraction pass does not yet build the GameObject/Transform scene
  graph.
- The extraction pass does not yet resolve MeshRenderer,
  SkinnedMeshRenderer, Material, Texture2D, Shader, Animator, Avatar, or
  animation dependencies into the final preview.
- The result is useful for a geometry preview, but it is not a complete
  Unity avatar reconstruction.

## Compression Reality

There are multiple layers that should not be conflated:

- AssetBundle container compression: Unity documents LZMA as a whole
  content stream and LZ4 as chunk-based 128 KB chunks. Unity also notes
  that downloaded/cached AssetBundles are commonly recompressed into LZ4
  for faster client-side loading.
- Serialized Unity object layout: after the bundle is decompressed,
  each SerializedFile still needs version-aware object and TypeTree
  parsing.
- Mesh payload encoding: Unity Mesh data has version-gated fields,
  vertex stream layouts, optional streamed `.resS` data, and optional
  `m_MeshCompression`.
- Texture payload encoding: Texture2D may reference streamed data and
  can be GPU-compressed. PC preview mainly needs BC/DXT handling; Android
  cache would also need ETC/ETC2/ASTC paths.

The current native code solves the first layer and part of Mesh decoding.
The missing work is the object graph and asset-level decoding layer.

Primary references:

- Unity AssetBundle compression formats:
  https://docs.unity3d.com/6000.2/Documentation/Manual/assetbundles-compression-format.html
- AssetRipper:
  https://github.com/AssetRipper/AssetRipper
- UnityPy:
  https://github.com/K0lb3/UnityPy
- AssetsTools.NET:
  https://github.com/nesrak1/AssetsTools.NET
- AssetsTools.NET bundle reading example:
  https://github.com/nesrak1/AssetsTools.NET/wiki/Getting-Started:-Bundle-file-reading
- AssetStudio:
  https://github.com/Perfare/AssetStudio

## vrchat-il2cpp-re Findings

The relevant local repo is `D:\Project\vrchat-il2cpp-re`. Its useful
parts for VRCSM are cache/log correlation and VRChat naming context, not
asset extraction.

Useful code:

- `tools/load_cached_worlds.py`

What it can teach VRCSM safely:

- How to enumerate `Cache-WindowsPlayer/<hash>/<version>/__info` and
  `__data`.
- How to parse cache timestamps and bundle sizes.
- How to correlate recent output logs with world IDs using log lines
  such as AssetBundleDownloadManager unpacking events.
- Useful VRChat runtime names to recognize in logs and diagnostics:
  `AssetBundleDownloadManager`, `VRCAvatarManager`, `ApiAvatar`,
  `ApiWorld`, `Texture2D`, `MeshRenderer`, `SkinnedMeshRenderer`,
  `Animator`, and related UI names.

What must not be imported into VRCSM:

- Frida attach/injection.
- Live `GameAssembly.dll` scanning.
- In-place Il2CppString overwrite and world redirect helpers.
- Any dependency on current VRChat process memory layouts or offsets.

For VRCSM, the safe path is offline, read-only parsing of local files.

## VRCX Comparison

A shallow VRCX clone was checked on 2026-06-23 at commit `e69d1e9`.
VRCX does not implement full avatar `.vrca` model preview or ripping.
Its relevant cache behavior is metadata and cache-location management:

- `Dotnet/AssetBundleManager.cs` hashes file id + variant with SHA-256
  and derives the VRChat cache folder and version folder.
- `src/coordinators/cacheCoordinator.js` selects the suitable
  `unityPackages` entry, prefers `standalonewindows`, uses SDK Unity
  version comparisons, checks cache size/lock/path, and queries
  `fileAnalysis` metadata.
- `src/shared/utils/base/devtool.js` exposes a developer helper that
  resolves an asset URL to a local `__data` path.

VRCX discussion #465 also records the important boundary: `.unitypackage`
downloads are available only when the avatar was uploaded with future
proof publish; `.vrca` is an avatar bundle and VRCX explicitly says
that ripping it is not what they do.

Reference:

- VRCX discussion #465:
  https://github.com/vrcx-team/VRCX/discussions/465
- VRCX AssetBundleManager:
  https://github.com/vrcx-team/VRCX/blob/master/Dotnet/AssetBundleManager.cs
- VRCX cache coordinator:
  https://github.com/vrcx-team/VRCX/blob/master/src/coordinators/cacheCoordinator.js

## Recommended Architecture

Use a layered pipeline, not one large extractor blob:

1. `CacheAssetIndex`
   - Derive local cache paths from VRChat file id, file version,
     platform, variant, and variant version.
   - Also support cache/log correlation when only a local cache entry is
     known.
   - Preserve existing delete safety rules: never remove `__info` or
     `vrc-version` during broad cache operations.

2. `BundleInspector`
   - Wrap existing `parseUnityBundle()` and add an inspect-only API.
   - Return Unity revision, format version, compression modes, block
     count, node list, node flags, serialized files, and parse errors.
   - This should power diagnostics and tests before full preview work.

3. `SerializedAssetGraph`
   - Build an object index by pathID/classID.
   - Add PPtr resolution and external reference accounting.
   - Use TypeTree when present; report a precise `typetree_missing` or
     `classdb_missing` state when not.

4. `PreviewSceneExtractor`
   - Walk GameObject, Transform, MeshFilter, MeshRenderer,
     SkinnedMeshRenderer, Material, Texture2D, Animator, Avatar, and Mesh.
   - Produce a preview scene model independent of GLB output.
   - Keep the current mesh-only path as a fast fallback.

5. `PreviewGlbWriter`
   - Emit geometry, transforms, materials, textures, skin weights, joints,
     bind poses, and blend shapes as support is added.
   - Keep output deterministic and cache it by bundle hash plus extractor
     version.

6. Optional full-fidelity backend
   - Evaluate a pinned external worker only after the native inspector can
     classify failures.
   - AssetRipper is strong for full Unity project recovery, but its
     license and automation surface must be reviewed before bundling.
   - UnityPy is useful as a reference and test oracle, but shipping a
     Python worker reintroduces runtime and packaging cost.
   - AssetsTools.NET is a good .NET library candidate if VRCSM grows a
     small managed helper process.
   - AssetStudio is a mature reference for Texture2D and model export
     behavior, but its latest release is older and GUI-oriented.

## Implementation Slices

Start with slices that reduce uncertainty and do not require private
asset fixtures:

1. Add `BundleInspector` on top of current native code.
   - Unit test UnityFS header/block/node parsing with synthetic or small
     checked-in fixtures.
   - Add counters for mesh parse failure codes, including
     `mesh_compressed`, `mesh_streamed_unresolved`, and
     `typetree_unsupported`.

2. Add `CacheAssetIndex`.
   - Port the VRCX cache path derivation into C++.
   - Add safe read-only APIs for `assetUrl -> __data path` and
     `cache entry -> metadata`.
   - Do not delete anything in this slice.

3. Add local log correlation.
   - Port only the read-only regex ideas from `load_cached_worlds.py`.
   - Extend for avatar events separately after confirming real VRChat log
     lines from the user's current logs.

4. Add object graph indexing.
   - Parse object table into a stable pathID index.
   - Add class histogram output for every bundle.
   - Add PPtr read helpers.

5. Add scene/material/texture preview.
   - Walk GameObject/Transform/Renderer links.
   - Decode Texture2D with streamed data support.
   - Write material and texture data to GLB.

6. Add skinned avatar support.
   - Preserve bind poses, bone weights, joints, and blend shapes.
   - Export GLB skin and morph target data.

## Validation Plan

- Do not use arbitrary downloaded avatar bundles as committed fixtures.
- Use synthetic UnityFS fixtures where possible.
- Use user-provided/local authorized bundles only for local smoke tests.
- Record only structural counts and error codes in logs, not private
  asset names unless the UI is explicitly showing the user's own data.
- Browser smoke should verify the preview canvas is nonblank, framed,
  and does not hang when extraction returns `no_meshes`,
  `mesh_compressed`, `typetree_unsupported`, or `preview_failed`.
