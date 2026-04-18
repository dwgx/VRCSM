#pragma once

#include "Common.h"

#include <array>
#include <cstdint>
#include <functional>
#include <string>
#include <utility>
#include <vector>

namespace vrcsm::core
{

// ─────────────────────────────────────────────────────────────────────
// UnityMesh — hand-decoder for Unity `Mesh` (class 43) object payloads.
//
// Produces a simplified `UnityMesh` value with just the attributes the
// avatar preview pipeline cares about: positions, normals, UV0, the
// per-submesh index ranges, and the local AABB. Tangents / colors /
// skin weights are dropped — the preview renders unlit, untextured.
//
// Supported format: Unity 2019.1 through 2022.3 LTS with TypeTree
// disabled, no mesh compression, standard (non-packed) vertex layout.
// If the mesh is compressed, uses streamed resource data with a
// non-empty path, or has no positions, we return an Error — the caller
// (AvatarPreview) decides whether to skip the mesh or fall back.
//
// Source of truth: UnityPy's `classes/Mesh.py` and the SerializedFile
// field order in Unity's `MeshBlob.cpp`. Gated fields carry a comment
// with the Unity version they appeared in.
// ─────────────────────────────────────────────────────────────────────

struct Vec3 { float x{0}, y{0}, z{0}; };

struct MeshAabb
{
    Vec3 center{};
    Vec3 extent{};
};

struct MeshSubmesh
{
    std::uint32_t firstByte{0};     // offset into the raw index buffer (bytes)
    std::uint32_t indexCount{0};
    std::int32_t topology{0};       // 0=Triangles, 3=Lines, 4=LineStrip, 5=Points
    std::uint32_t baseVertex{0};
    std::uint32_t firstVertex{0};
    std::uint32_t vertexCount{0};
    MeshAabb localAABB{};
};

struct MeshVertex
{
    float px{0}, py{0}, pz{0};
    float nx{0}, ny{0}, nz{0};
    float u{0}, v{0};
};

struct UnityMesh
{
    std::string name;
    std::int32_t meshCompression{0};  // 0 = uncompressed (only supported value)

    std::vector<MeshSubmesh> submeshes;
    std::vector<MeshVertex> vertices;
    std::vector<std::uint32_t> indices;   // always u32 internally; we widen u16

    std::uint32_t boneCount{0};           // m_BoneNameHashes.size()
    bool indexFormat32{false};
    MeshAabb localAABB{};
};

// Resolver for `StreamingInfo` → a contiguous byte view. Returns
// {nullptr, 0} when the path cannot be resolved (e.g. referenced .resS
// file not present inside the bundle). `path` is the Unity-side
// resource path string as read from StreamingInfo.
using StreamDataResolver =
    std::function<std::pair<const std::uint8_t*, std::size_t>(const std::string& path)>;

// Parse a Mesh object payload from `data[..size]`. `unityVersion` is
// the Unity revision string from the enclosing SerializedFile (e.g.
// "2022.3.22f1"); major/minor is used to gate version-specific fields.
// `littleEndian` defaults to true (Windows target). `resolver` is
// consulted only when StreamingInfo references external data — pass
// an empty std::function to fail on streamed meshes.
Result<UnityMesh> parseUnityMesh(
    const std::uint8_t* data,
    std::size_t size,
    const std::string& unityVersion,
    bool littleEndian = true,
    StreamDataResolver resolver = {});

} // namespace vrcsm::core
