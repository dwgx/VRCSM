#pragma once

#include "Common.h"

#include <array>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace vrcsm::core
{

// ─────────────────────────────────────────────────────────────────────
// UnitySerialized — parse a Unity SerializedFile (the `CAB-xxx` blobs
// that live inside an AssetBundle).
//
// We only decode the metadata tables we need to locate Mesh payloads:
//   • header (version, endianness, data offset, unity revision)
//   • Types table (classId per type index)
//   • Objects table (pathID, byteStart, byteSize, type index)
//   • Externals (for completeness; unused by the preview pipeline)
//
// TypeTree is intentionally NOT parsed — VRChat ships bundles with
// `TypeTreeEnabled == false`, and we hand-decode object payloads using
// the Unity 2022.3 field layouts directly. If we ever encounter a
// typetree-enabled bundle we return `Error{sf_typetree_unsupported}`
// so the caller can fall back to the Python extractor.
//
// Supported SerializedFile format versions: 17 through 22 (covers
// Unity 2019.4 LTS through Unity 2022.3 LTS).
// ─────────────────────────────────────────────────────────────────────

// Well-known Unity class IDs we care about.
namespace UnityClass
{
constexpr std::int32_t kGameObject = 1;
constexpr std::int32_t kTransform = 4;
constexpr std::int32_t kMeshRenderer = 23;
constexpr std::int32_t kMeshFilter = 33;
constexpr std::int32_t kMesh = 43;
constexpr std::int32_t kSkinnedMeshRenderer = 137;
constexpr std::int32_t kMonoBehaviour = 114;
}

struct SerializedType
{
    std::int32_t classId{0};
    bool isStripped{false};
    std::int16_t scriptTypeIndex{0};
    std::array<std::uint8_t, 16> scriptID{};
    std::array<std::uint8_t, 16> oldTypeHash{};
};

struct SerializedObject
{
    std::int64_t pathID{0};
    // Offset into the SerializedFile buffer, relative to the file's
    // `dataOffset`. Add `SerializedFile::dataOffset` to get the
    // absolute byte position within the buffer.
    std::int64_t byteStart{0};
    std::int32_t byteSize{0};
    std::int32_t typeIndex{0};    // index into SerializedFile::types
    std::int32_t classId{0};      // denormalized from types[typeIndex]
    bool isStripped{false};
};

struct SerializedExternal
{
    std::array<std::uint8_t, 16> guid{};
    std::int32_t type{0};
    std::string pathname;
};

struct SerializedFile
{
    // Header-derived fields
    std::uint32_t version{0};         // e.g. 22 for Unity 2022.3
    std::int64_t dataOffset{0};       // start of object payloads (relative to `base`)
    bool bigEndian{false};
    std::string unityRevision;        // e.g. "2022.3.22f1"
    std::int32_t targetPlatform{0};   // 19 = StandaloneWindows64
    bool typeTreeEnabled{false};

    std::vector<SerializedType> types;
    std::vector<SerializedObject> objects;
    std::vector<SerializedExternal> externals;

    // Non-owning. Must outlive this struct — typically a UnityBundle node view.
    const std::uint8_t* base{nullptr};
    std::size_t size{0};

    // Convenience: pointers to all objects whose resolved classId matches.
    std::vector<const SerializedObject*> objectsOfClass(std::int32_t classId) const;

    // Returns a view of `obj`'s raw payload bytes within `base`.
    std::pair<const std::uint8_t*, std::size_t> objectPayload(const SerializedObject& obj) const;
};

// Parse a SerializedFile from an in-memory buffer (typically a node view
// from a UnityBundle). The buffer must outlive the returned struct.
Result<SerializedFile> parseSerializedFile(const std::uint8_t* data, std::size_t size);

} // namespace vrcsm::core
