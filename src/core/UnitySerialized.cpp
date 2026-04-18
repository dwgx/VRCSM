#include "UnitySerialized.h"

#include <cstring>

#include <fmt/format.h>
#include <spdlog/spdlog.h>

namespace vrcsm::core
{

namespace
{

// Sanity caps to prevent a malformed / hostile SerializedFile from
// allocating gigabytes before the parser fails open.
constexpr std::size_t kMaxTypeCount = 0x100000;    // 1M types
constexpr std::size_t kMaxObjectCount = 0x1000000; // 16M objects
constexpr std::size_t kMaxExternalCount = 0x10000; // 64K externals

constexpr std::uint32_t kMinSupportedVersion = 17;
constexpr std::uint32_t kMaxSupportedVersion = 22;

// SerializedFile format version constants that gate structural fields.
// Names match UnityPy's `SerializedFileFormatVersion` enum for easy
// cross-referencing when a VRChat-LTS bump changes layouts.
constexpr std::uint32_t kVerUnity53 = 13;            // HasTypeTreeHashes, TypeTreeEnabled flag
constexpr std::uint32_t kVerUnknown14 = 14;          // 64-bit path IDs
constexpr std::uint32_t kVer16bitRfStripped = 16;    // isStripped byte on SerializedType
constexpr std::uint32_t kVerRefactoredClassId = 17;  // script_type_index field
constexpr std::uint32_t kVerRefTypes = 20;           // Ref types table appears
constexpr std::uint32_t kVerLargeFiles = 22;         // 64-bit byteStart, extended header

// ─── Byte reader with per-method endianness ──────────────────────────
// The SerializedFile header is big-endian regardless of the target
// platform; the remainder of the metadata is in the endianness
// declared by the header's `endianness` byte. Having BE and LE
// variants on the reader lets us mix them without tracking a
// stateful "current endian" flag across the parser.

class ByteReader
{
public:
    ByteReader(const std::uint8_t* data, std::size_t size)
        : m_data(data), m_size(size), m_cursor(0) {}

    bool ok() const { return !m_failed; }
    std::size_t tell() const { return m_cursor; }
    std::size_t remaining() const { return m_failed ? 0 : m_size - m_cursor; }

    void skip(std::size_t n)
    {
        if (n > remaining()) { m_failed = true; return; }
        m_cursor += n;
    }

    void alignTo(std::size_t bytes)
    {
        const std::size_t mod = m_cursor % bytes;
        if (mod != 0) skip(bytes - mod);
    }

    std::uint8_t u8()
    {
        if (remaining() < 1) { m_failed = true; return 0; }
        return m_data[m_cursor++];
    }

    std::uint16_t u16be()
    {
        if (remaining() < 2) { m_failed = true; return 0; }
        std::uint16_t v = (std::uint16_t(m_data[m_cursor]) << 8)
                        |  std::uint16_t(m_data[m_cursor + 1]);
        m_cursor += 2;
        return v;
    }

    std::uint32_t u32be()
    {
        if (remaining() < 4) { m_failed = true; return 0; }
        std::uint32_t v = (std::uint32_t(m_data[m_cursor]) << 24)
                        | (std::uint32_t(m_data[m_cursor + 1]) << 16)
                        | (std::uint32_t(m_data[m_cursor + 2]) << 8)
                        |  std::uint32_t(m_data[m_cursor + 3]);
        m_cursor += 4;
        return v;
    }

    std::uint64_t u64be()
    {
        if (remaining() < 8) { m_failed = true; return 0; }
        std::uint64_t hi = u32be();
        std::uint64_t lo = u32be();
        return (hi << 32) | lo;
    }

    std::uint16_t u16le()
    {
        if (remaining() < 2) { m_failed = true; return 0; }
        std::uint16_t v = std::uint16_t(m_data[m_cursor])
                        | (std::uint16_t(m_data[m_cursor + 1]) << 8);
        m_cursor += 2;
        return v;
    }

    std::uint32_t u32le()
    {
        if (remaining() < 4) { m_failed = true; return 0; }
        std::uint32_t v = std::uint32_t(m_data[m_cursor])
                        | (std::uint32_t(m_data[m_cursor + 1]) << 8)
                        | (std::uint32_t(m_data[m_cursor + 2]) << 16)
                        | (std::uint32_t(m_data[m_cursor + 3]) << 24);
        m_cursor += 4;
        return v;
    }

    std::uint64_t u64le()
    {
        if (remaining() < 8) { m_failed = true; return 0; }
        std::uint64_t lo = u32le();
        std::uint64_t hi = u32le();
        return (hi << 32) | lo;
    }

    // Null-terminated ASCII string.
    std::string cstr()
    {
        std::string out;
        while (m_cursor < m_size)
        {
            std::uint8_t c = m_data[m_cursor++];
            if (c == 0) return out;
            out.push_back(static_cast<char>(c));
        }
        m_failed = true;
        return out;
    }

    void readBytes(void* dst, std::size_t n)
    {
        if (remaining() < n) { m_failed = true; return; }
        std::memcpy(dst, m_data + m_cursor, n);
        m_cursor += n;
    }

private:
    const std::uint8_t* m_data;
    std::size_t m_size;
    std::size_t m_cursor;
    bool m_failed{false};
};

} // namespace

std::vector<const SerializedObject*>
SerializedFile::objectsOfClass(std::int32_t classId) const
{
    std::vector<const SerializedObject*> out;
    for (const auto& obj : objects)
    {
        if (obj.classId == classId) out.push_back(&obj);
    }
    return out;
}

std::pair<const std::uint8_t*, std::size_t>
SerializedFile::objectPayload(const SerializedObject& obj) const
{
    const std::int64_t abs = dataOffset + obj.byteStart;
    return { base + abs, static_cast<std::size_t>(obj.byteSize) };
}

Result<SerializedFile> parseSerializedFile(const std::uint8_t* data, std::size_t size)
{
    if (size < 20)
    {
        return Error{"sf_too_small", fmt::format("SerializedFile size {} < 20", size)};
    }

    ByteReader r(data, size);
    SerializedFile sf{};
    sf.base = data;
    sf.size = size;

    // ─── Header (big-endian, always) ─────────────────────────────────
    // Layout through v21:
    //   u32 metadataSize
    //   u32 fileSize
    //   u32 version
    //   u32 dataOffset
    //   u8  endianness        (v9+)
    //   u8[3] reserved        (v9+)
    //
    // v22+ appends extended u64 sizes after the reserved bytes:
    //   u32 metadataSize (again)
    //   u64 fileSize
    //   u64 dataOffset
    //   u64 unknown
    std::uint32_t legacyMetadataSize = r.u32be();
    std::uint32_t legacyFileSize = r.u32be();
    std::uint32_t version = r.u32be();
    std::uint32_t legacyDataOffset = r.u32be();

    if (!r.ok())
    {
        return Error{"sf_header_truncated", "SerializedFile header < 16 bytes"};
    }

    if (version < kMinSupportedVersion || version > kMaxSupportedVersion)
    {
        return Error{"sf_unsupported_version",
                     fmt::format("SerializedFile version {} not in [{}, {}]",
                                 version, kMinSupportedVersion, kMaxSupportedVersion)};
    }

    if (version >= 9)
    {
        sf.bigEndian = (r.u8() != 0);
        r.skip(3);  // reserved
    }

    std::uint64_t fileSize64 = legacyFileSize;
    std::uint64_t dataOffset64 = legacyDataOffset;

    if (version >= kVerLargeFiles)
    {
        (void)r.u32be();                // metadataSize (big-endian, superseded)
        fileSize64 = r.u64be();
        dataOffset64 = r.u64be();
        (void)r.u64be();                // reserved / unknown
    }

    (void)legacyMetadataSize;
    (void)fileSize64;

    if (!r.ok())
    {
        return Error{"sf_header_truncated", "SerializedFile extended header truncated"};
    }

    sf.version = version;
    sf.dataOffset = static_cast<std::int64_t>(dataOffset64);

    if (sf.dataOffset < 0 || static_cast<std::size_t>(sf.dataOffset) > size)
    {
        return Error{"sf_invalid_offset",
                     fmt::format("dataOffset {} outside buffer size {}",
                                 sf.dataOffset, size)};
    }

    // After the header, everything is in the declared endianness.
    auto u16 = [&](){ return sf.bigEndian ? r.u16be() : r.u16le(); };
    auto u32 = [&](){ return sf.bigEndian ? r.u32be() : r.u32le(); };
    auto u64 = [&](){ return sf.bigEndian ? r.u64be() : r.u64le(); };
    auto i16 = [&](){ return static_cast<std::int16_t>(u16()); };
    auto i32 = [&](){ return static_cast<std::int32_t>(u32()); };
    auto i64 = [&](){ return static_cast<std::int64_t>(u64()); };

    // ─── Unity revision string (v7+) ─────────────────────────────────
    if (version >= 7)
    {
        sf.unityRevision = r.cstr();
        if (!r.ok())
        {
            return Error{"sf_unity_ver_truncated", "unityRevision cstring overruns buffer"};
        }
    }

    // ─── Target platform (v8+) ───────────────────────────────────────
    if (version >= 8)
    {
        sf.targetPlatform = i32();
    }

    // ─── TypeTreeEnabled flag (v13+) ─────────────────────────────────
    if (version >= kVerUnity53)
    {
        sf.typeTreeEnabled = (r.u8() != 0);
    }

    // ─── Types ───────────────────────────────────────────────────────
    std::uint32_t typeCount = u32();
    if (!r.ok())
    {
        return Error{"sf_type_count_truncated", "types count truncated"};
    }
    if (typeCount > kMaxTypeCount)
    {
        return Error{"sf_type_count_insane",
                     fmt::format("type count {} > cap {}", typeCount, kMaxTypeCount)};
    }
    sf.types.reserve(typeCount);

    // TypeTree node layout for v12+ blob format:
    //   u16 version, u8 level, u8 typeFlags,
    //   u32 typeStrOffset, u32 nameStrOffset,
    //   i32 byteSize, i32 index, i32 metaFlag
    //   u64 refTypeHash        (only v19+)
    // Followed by a `stringBufferSize`-byte string pool.
    const std::size_t kTypeTreeNodeSize = (version >= 19) ? 32 : 24;

    for (std::uint32_t ti = 0; ti < typeCount; ++ti)
    {
        SerializedType t{};
        t.classId = i32();

        if (version >= kVer16bitRfStripped)
        {
            t.isStripped = (r.u8() != 0);
        }

        if (version >= kVerRefactoredClassId)
        {
            t.scriptTypeIndex = i16();
        }

        if (version >= kVerUnity53)
        {
            const bool needsScriptId =
                (version < kVerRefactoredClassId && t.classId < 0) ||
                (version >= kVerRefactoredClassId && t.classId == UnityClass::kMonoBehaviour);

            if (needsScriptId)
            {
                r.readBytes(t.scriptID.data(), 16);
            }
            r.readBytes(t.oldTypeHash.data(), 16);
        }

        if (sf.typeTreeEnabled)
        {
            // We don't actually interpret the typetree — our Mesh
            // decoder assumes Unity 2022.3 payload layout directly
            // (which is stable across VRChat builds). We just skip
            // past the bytes to reach the objects table.
            std::uint32_t nodeCount = u32();
            std::uint32_t stringBufferSize = u32();
            if (!r.ok())
            {
                return Error{"sf_typetree_truncated",
                             fmt::format("typetree header truncated (type {})", ti)};
            }
            // Sanity clamp
            if (nodeCount > 0x100000 || stringBufferSize > 0x4000000)
            {
                return Error{"sf_typetree_insane",
                             fmt::format("typetree sizes out of range ({} nodes, {} string bytes)",
                                         nodeCount, stringBufferSize)};
            }
            r.skip(static_cast<std::size_t>(nodeCount) * kTypeTreeNodeSize);
            r.skip(stringBufferSize);

            // v21+ stores type dependencies as an int32 array after the
            // type tree (or class-path triple for ref types, which we
            // don't track here — non-ref types always use the array).
            if (version >= 21)
            {
                std::uint32_t depCount = u32();
                if (!r.ok() || depCount > 0x10000)
                {
                    return Error{"sf_typetree_deps_insane",
                                 fmt::format("type dependency count {} out of range", depCount)};
                }
                r.skip(static_cast<std::size_t>(depCount) * 4);
            }
        }

        if (!r.ok())
        {
            return Error{"sf_type_truncated",
                         fmt::format("type record {} truncated", ti)};
        }

        sf.types.push_back(t);
    }

    // ─── bigID flag (v7..13); v14+ is always 64-bit path IDs ─────────
    bool bigIdEnabled = (version >= kVerUnknown14);
    if (version >= 7 && version < kVerUnknown14)
    {
        bigIdEnabled = (u32() != 0);
    }

    // ─── Objects ─────────────────────────────────────────────────────
    std::uint32_t objectCount = u32();
    if (!r.ok())
    {
        return Error{"sf_obj_count_truncated", "object count truncated"};
    }
    if (objectCount > kMaxObjectCount)
    {
        return Error{"sf_obj_count_insane",
                     fmt::format("object count {} > cap {}", objectCount, kMaxObjectCount)};
    }
    sf.objects.reserve(objectCount);

    for (std::uint32_t oi = 0; oi < objectCount; ++oi)
    {
        SerializedObject obj{};

        if (version >= kVerUnknown14)
        {
            r.alignTo(4);
            obj.pathID = i64();
        }
        else if (bigIdEnabled)
        {
            obj.pathID = i64();
        }
        else
        {
            obj.pathID = static_cast<std::int64_t>(i32());
        }

        if (version >= kVerLargeFiles)
        {
            obj.byteStart = i64();
        }
        else
        {
            obj.byteStart = static_cast<std::int64_t>(u32());
        }

        obj.byteSize = i32();
        obj.typeIndex = i32();

        if (version < kVerRefactoredClassId)
        {
            // pre-v17 stored the classId inline on the object (v<=15 has
            // an `isDestroyed` short; v16 dropped it). We already derive
            // classId from the type table below, so these are discarded.
            (void)i16();
            if (version <= 15)
            {
                (void)i16();
            }
        }
        if (version == 15 || version == 16)
        {
            obj.isStripped = (r.u8() != 0);
        }

        if (obj.typeIndex >= 0 &&
            static_cast<std::size_t>(obj.typeIndex) < sf.types.size())
        {
            obj.classId = sf.types[obj.typeIndex].classId;
        }

        if (!r.ok())
        {
            return Error{"sf_obj_truncated",
                         fmt::format("object record {} truncated", oi)};
        }

        sf.objects.push_back(obj);
    }

    // ─── Script types (v11+) — skipped ───────────────────────────────
    if (version >= 11)
    {
        std::uint32_t scriptCount = u32();
        if (!r.ok())
        {
            return Error{"sf_script_count_truncated", "script count truncated"};
        }
        if (scriptCount > kMaxExternalCount)
        {
            return Error{"sf_script_count_insane",
                         fmt::format("script count {} > cap {}", scriptCount, kMaxExternalCount)};
        }
        for (std::uint32_t si = 0; si < scriptCount; ++si)
        {
            (void)i32();               // localSerializedFileIndex
            if (version >= kVerUnknown14)
            {
                r.alignTo(4);
                (void)i64();           // identifierInFile
            }
            else
            {
                (void)i32();
            }
            if (!r.ok())
            {
                return Error{"sf_script_truncated",
                             fmt::format("script record {} truncated", si)};
            }
        }
    }

    // ─── Externals ───────────────────────────────────────────────────
    std::uint32_t extCount = u32();
    if (!r.ok())
    {
        return Error{"sf_ext_count_truncated", "externals count truncated"};
    }
    if (extCount > kMaxExternalCount)
    {
        return Error{"sf_ext_count_insane",
                     fmt::format("externals count {} > cap {}", extCount, kMaxExternalCount)};
    }
    sf.externals.reserve(extCount);

    for (std::uint32_t ei = 0; ei < extCount; ++ei)
    {
        SerializedExternal ex{};
        if (version >= 6)
        {
            (void)r.cstr();             // tempEmpty — always ""
        }
        if (version >= 5)
        {
            r.readBytes(ex.guid.data(), 16);
            ex.type = i32();
        }
        ex.pathname = r.cstr();
        if (!r.ok())
        {
            return Error{"sf_ext_truncated",
                         fmt::format("external record {} truncated", ei)};
        }
        sf.externals.push_back(ex);
    }

    // ─── Ref types (v20+) — skipped ──────────────────────────────────
    // We don't consume the ref types table; the remaining tail (user
    // info string) is also unused. Callers never read beyond externals.
    (void)kVerRefTypes;

    // ─── Validate object extents against the buffer ──────────────────
    for (const auto& obj : sf.objects)
    {
        const std::int64_t abs = sf.dataOffset + obj.byteStart;
        if (obj.byteStart < 0 || obj.byteSize < 0
            || abs < 0
            || static_cast<std::size_t>(abs) > size
            || static_cast<std::size_t>(abs + obj.byteSize) > size)
        {
            return Error{"sf_obj_oob",
                         fmt::format("Object pathID={} extends past buffer (start={}, size={}, file={})",
                                     obj.pathID, abs, obj.byteSize, size)};
        }
    }

    return sf;
}

} // namespace vrcsm::core
