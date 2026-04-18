#include "UnityMesh.h"

#include <algorithm>
#include <charconv>
#include <cmath>
#include <cstring>
#include <limits>
#include <string_view>
#include <tuple>

#include <fmt/format.h>
#include <spdlog/spdlog.h>

namespace vrcsm::core
{

namespace
{

// ─── Unity VertexFormat → bytes per component ────────────────────────
// Unity 5.0+ VertexFormat enum. Formats 6..9 are padded to 4 bytes
// in pre-2019 builds; 2019+ uses tight packing. The table below is
// Unity 2019+ (matches what VRChat ships).
constexpr std::array<int, 12> kFormatBpc = {
    4,  // 0  Float32
    2,  // 1  Float16
    1,  // 2  UNorm8
    1,  // 3  SNorm8
    2,  // 4  UNorm16
    2,  // 5  SNorm16
    1,  // 6  UInt8
    1,  // 7  SInt8
    2,  // 8  UInt16
    2,  // 9  SInt16
    4,  // 10 UInt32
    4,  // 11 SInt32
};

enum class ChannelSemantic : int
{
    Position = 0,
    Normal = 1,
    Tangent = 2,
    Color = 3,
    Uv0 = 4,
    Uv1 = 5,
    Uv2 = 6,
    Uv3 = 7,
    Uv4 = 8,
    Uv5 = 9,
    Uv6 = 10,
    Uv7 = 11,
    BlendWeight = 12,
    BlendIndices = 13,
};

struct ChannelInfo
{
    std::uint8_t stream{0};
    std::uint8_t offset{0};
    std::uint8_t format{0};
    std::uint8_t dimension{0};
};

// ─── Versioned byte reader ───────────────────────────────────────────

class MeshReader
{
public:
    MeshReader(const std::uint8_t* data, std::size_t size, bool bigEndian)
        : m_data(data), m_size(size), m_cursor(0), m_bigEndian(bigEndian) {}

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

    std::uint16_t u16()
    {
        if (remaining() < 2) { m_failed = true; return 0; }
        std::uint16_t v;
        if (m_bigEndian)
        {
            v = (std::uint16_t(m_data[m_cursor]) << 8)
              |  std::uint16_t(m_data[m_cursor + 1]);
        }
        else
        {
            v = std::uint16_t(m_data[m_cursor])
              | (std::uint16_t(m_data[m_cursor + 1]) << 8);
        }
        m_cursor += 2;
        return v;
    }

    std::uint32_t u32()
    {
        if (remaining() < 4) { m_failed = true; return 0; }
        std::uint32_t v;
        if (m_bigEndian)
        {
            v = (std::uint32_t(m_data[m_cursor]) << 24)
              | (std::uint32_t(m_data[m_cursor + 1]) << 16)
              | (std::uint32_t(m_data[m_cursor + 2]) << 8)
              |  std::uint32_t(m_data[m_cursor + 3]);
        }
        else
        {
            v = std::uint32_t(m_data[m_cursor])
              | (std::uint32_t(m_data[m_cursor + 1]) << 8)
              | (std::uint32_t(m_data[m_cursor + 2]) << 16)
              | (std::uint32_t(m_data[m_cursor + 3]) << 24);
        }
        m_cursor += 4;
        return v;
    }

    std::int32_t i32() { return static_cast<std::int32_t>(u32()); }

    std::uint64_t u64()
    {
        if (remaining() < 8) { m_failed = true; return 0; }
        if (m_bigEndian)
        {
            std::uint64_t hi = u32();
            std::uint64_t lo = u32();
            return (hi << 32) | lo;
        }
        std::uint64_t lo = u32();
        std::uint64_t hi = u32();
        return (hi << 32) | lo;
    }

    float f32()
    {
        std::uint32_t raw = u32();
        float f;
        std::memcpy(&f, &raw, 4);
        return f;
    }

    // Unity "aligned string": u32 length, UTF-8 bytes, pad to 4.
    std::string alignedString()
    {
        std::uint32_t len = u32();
        if (len > remaining()) { m_failed = true; return {}; }
        std::string s(reinterpret_cast<const char*>(m_data + m_cursor), len);
        m_cursor += len;
        alignTo(4);
        return s;
    }

    // Unity `vector<byte>`: u32 count, raw bytes, pad to 4.
    std::vector<std::uint8_t> byteVector()
    {
        std::uint32_t len = u32();
        if (len > remaining()) { m_failed = true; return {}; }
        std::vector<std::uint8_t> out(m_data + m_cursor, m_data + m_cursor + len);
        m_cursor += len;
        alignTo(4);
        return out;
    }

    const std::uint8_t* rawAt(std::size_t pos) const
    {
        return (pos <= m_size) ? (m_data + pos) : nullptr;
    }

private:
    const std::uint8_t* m_data;
    std::size_t m_size;
    std::size_t m_cursor;
    bool m_bigEndian;
    bool m_failed{false};
};

// ─── Unity version helpers ───────────────────────────────────────────

struct UnityVer { int major{0}, minor{0}; };

UnityVer parseVersion(const std::string& s)
{
    UnityVer v{};
    std::string_view sv(s);
    const auto dot = sv.find('.');
    if (dot == std::string_view::npos) return v;

    auto parseInt = [](std::string_view piece) -> int
    {
        int out = 0;
        auto [p, ec] = std::from_chars(piece.data(), piece.data() + piece.size(), out);
        (void)p;
        if (ec != std::errc{}) return 0;
        return out;
    };

    v.major = parseInt(sv.substr(0, dot));
    auto rest = sv.substr(dot + 1);
    const auto dot2 = rest.find('.');
    v.minor = parseInt(dot2 == std::string_view::npos ? rest : rest.substr(0, dot2));
    return v;
}

bool ver_ge(const UnityVer& v, int major, int minor)
{
    return (v.major > major) || (v.major == major && v.minor >= minor);
}

// ─── Skippers for chunks we don't consume ────────────────────────────

void skipBlendShapeData(MeshReader& r)
{
    // vertices: count + items(40 bytes: 3*Vec3 + u32)
    const std::uint32_t vertCount = r.u32();
    r.skip(static_cast<std::size_t>(vertCount) * 40);

    // shapes: count + items(4 fields + align4)
    const std::uint32_t shapeCount = r.u32();
    for (std::uint32_t i = 0; i < shapeCount; ++i)
    {
        r.skip(4);       // firstVertex u32
        r.skip(4);       // vertexCount u32
        r.skip(1);       // hasNormals bool
        r.skip(1);       // hasTangents bool
        r.alignTo(4);
    }

    // channels: count + items(aligned-str name, nameHash u32, frameIndex i32, frameCount i32)
    const std::uint32_t chanCount = r.u32();
    for (std::uint32_t i = 0; i < chanCount; ++i)
    {
        (void)r.alignedString();
        r.skip(12);
    }

    // fullWeights: count + floats
    const std::uint32_t weightCount = r.u32();
    r.skip(static_cast<std::size_t>(weightCount) * 4);
}

void skipPackedFloatVector(MeshReader& r)
{
    (void)r.u32();          // m_NumItems
    (void)r.f32();          // m_Range
    (void)r.f32();          // m_Start
    (void)r.byteVector();   // m_Data (already aligns)
    r.skip(1);              // m_BitSize byte
    r.alignTo(4);
}

void skipPackedIntVector(MeshReader& r)
{
    (void)r.u32();
    (void)r.byteVector();
    r.skip(1);
    r.alignTo(4);
}

void skipCompressedMesh(MeshReader& r, const UnityVer& v)
{
    skipPackedFloatVector(r);   // m_Vertices
    skipPackedFloatVector(r);   // m_UV
    if (!ver_ge(v, 5, 0))
    {
        skipPackedFloatVector(r); // m_BindPoses (pre-5.0)
    }
    skipPackedFloatVector(r);   // m_Normals
    skipPackedFloatVector(r);   // m_Tangents
    skipPackedIntVector(r);     // m_Weights
    skipPackedIntVector(r);     // m_NormalSigns
    skipPackedIntVector(r);     // m_TangentSigns
    if (ver_ge(v, 5, 1))
    {
        skipPackedFloatVector(r); // m_FloatColors
    }
    skipPackedIntVector(r);     // m_BoneIndices
    skipPackedIntVector(r);     // m_Triangles
    if (ver_ge(v, 5, 6))
    {
        (void)r.u32();            // m_UVInfo
    }
}

// ─── Channel decode ──────────────────────────────────────────────────

// Decode a specific channel's per-vertex scalar data into `out`
// (pre-resized to count*dim floats). Returns false on failure.
bool decodeChannel(
    const std::uint8_t* raw, std::size_t rawSize,
    std::size_t streamBase, std::size_t stride,
    std::uint32_t count, std::uint8_t chOff,
    std::uint8_t fmt, std::uint8_t dim,
    float* out)
{
    if (dim == 0 || count == 0) return true;

    const int bpc = (fmt < kFormatBpc.size()) ? kFormatBpc[fmt] : 4;
    const std::size_t chanBytes = static_cast<std::size_t>(bpc) * dim;

    for (std::uint32_t i = 0; i < count; ++i)
    {
        const std::size_t src = streamBase + std::size_t(i) * stride + chOff;
        if (src + chanBytes > rawSize) return false;
        const std::uint8_t* p = raw + src;
        float* dst = out + std::size_t(i) * dim;

        for (std::uint8_t d = 0; d < dim; ++d)
        {
            const std::uint8_t* q = p + std::size_t(d) * bpc;
            switch (fmt)
            {
            case 0:   // Float32
            {
                std::uint32_t u;
                std::memcpy(&u, q, 4);
                float f;
                std::memcpy(&f, &u, 4);
                dst[d] = f;
                break;
            }
            case 1:   // Float16
            {
                std::uint16_t h;
                std::memcpy(&h, q, 2);
                // IEEE 754 binary16 → binary32 (no NaN/Inf care — positions).
                const std::uint32_t sign = (h & 0x8000u) << 16;
                std::uint32_t exp = (h & 0x7C00u) >> 10;
                std::uint32_t mant = (h & 0x03FFu);
                std::uint32_t bits;
                if (exp == 0)
                {
                    if (mant == 0) { bits = sign; }
                    else
                    {
                        exp = 1;
                        while ((mant & 0x0400u) == 0) { mant <<= 1; exp--; }
                        mant &= 0x03FFu;
                        bits = sign | ((exp + 127u - 15u) << 23) | (mant << 13);
                    }
                }
                else if (exp == 31)
                {
                    bits = sign | 0x7F800000u | (mant << 13);
                }
                else
                {
                    bits = sign | ((exp + 127u - 15u) << 23) | (mant << 13);
                }
                float f;
                std::memcpy(&f, &bits, 4);
                dst[d] = f;
                break;
            }
            case 2:   // UNorm8
                dst[d] = float(*q) / 255.0f; break;
            case 3:   // SNorm8
                dst[d] = float(static_cast<std::int8_t>(*q)) / 127.0f; break;
            case 4:   // UNorm16
            {
                std::uint16_t v;
                std::memcpy(&v, q, 2);
                dst[d] = float(v) / 65535.0f;
                break;
            }
            case 5:   // SNorm16
            {
                std::int16_t v;
                std::memcpy(&v, q, 2);
                dst[d] = float(v) / 32767.0f;
                break;
            }
            default:  // integer formats — treat as raw int (positions never use these)
                dst[d] = 0.0f;
                break;
            }
        }
    }
    return true;
}

} // namespace

Result<UnityMesh> parseUnityMesh(
    const std::uint8_t* data,
    std::size_t size,
    const std::string& unityVersionString,
    bool littleEndian,
    StreamDataResolver resolver)
{
    const UnityVer ver = parseVersion(unityVersionString);
    if (ver.major < 5)
    {
        return Error{"mesh_unsupported_unity",
                     fmt::format("Unity version '{}' (parsed {}.{}) not supported",
                                 unityVersionString, ver.major, ver.minor)};
    }

    MeshReader r(data, size, !littleEndian);
    UnityMesh mesh{};

    // ─── Name (aligned string) ───────────────────────────────────────
    mesh.name = r.alignedString();

    // ─── SubMeshes ───────────────────────────────────────────────────
    {
        const std::uint32_t count = r.u32();
        if (count > 0x10000)
        {
            return Error{"mesh_submesh_insane",
                         fmt::format("submesh count {} > 65536", count)};
        }
        mesh.submeshes.reserve(count);
        for (std::uint32_t i = 0; i < count; ++i)
        {
            MeshSubmesh sm{};
            sm.firstByte = r.u32();
            sm.indexCount = r.u32();
            sm.topology = r.i32();
            if (ver_ge(ver, 5, 6))
            {
                sm.baseVertex = r.u32();
            }
            sm.firstVertex = r.u32();
            sm.vertexCount = r.u32();
            // localAABB
            sm.localAABB.center.x = r.f32();
            sm.localAABB.center.y = r.f32();
            sm.localAABB.center.z = r.f32();
            sm.localAABB.extent.x = r.f32();
            sm.localAABB.extent.y = r.f32();
            sm.localAABB.extent.z = r.f32();
            mesh.submeshes.push_back(sm);
        }
    }

    // ─── BlendShapes ─────────────────────────────────────────────────
    skipBlendShapeData(r);

    // ─── BindPose (Matrix4x4 = 64 bytes each) ────────────────────────
    {
        const std::uint32_t count = r.u32();
        r.skip(static_cast<std::size_t>(count) * 64);
    }

    // ─── BoneNameHashes (u32 each) ───────────────────────────────────
    {
        mesh.boneCount = r.u32();
        r.skip(static_cast<std::size_t>(mesh.boneCount) * 4);
    }

    // ─── RootBoneNameHash ────────────────────────────────────────────
    (void)r.u32();

    // ─── BonesAABB / VariableBoneCountWeights (Unity 2019.1+) ────────
    if (ver_ge(ver, 2019, 1))
    {
        const std::uint32_t aabbCount = r.u32();
        // Each MinMaxAABB = 24 bytes (2x Vec3)
        r.skip(static_cast<std::size_t>(aabbCount) * 24);
        // m_VariableBoneCountWeights wraps a vector<uint>
        const std::uint32_t wCount = r.u32();
        r.skip(static_cast<std::size_t>(wCount) * 4);
    }

    // ─── MeshCompression / IsReadable / KeepVertices / KeepIndices ───
    mesh.meshCompression = static_cast<std::int32_t>(r.u8());
    (void)r.u8();       // m_IsReadable
    (void)r.u8();       // m_KeepVertices
    (void)r.u8();       // m_KeepIndices
    r.alignTo(4);

    if (mesh.meshCompression != 0)
    {
        return Error{"mesh_compressed",
                     fmt::format("m_MeshCompression={} not supported (only 0=None)",
                                 mesh.meshCompression)};
    }

    // ─── IndexFormat (Unity 2017.4+) ─────────────────────────────────
    if (ver_ge(ver, 2017, 4))
    {
        const std::int32_t fmt = r.i32();
        mesh.indexFormat32 = (fmt == 1);
    }

    // ─── IndexBuffer (aligned byte vector) ───────────────────────────
    std::vector<std::uint8_t> indexBuffer = r.byteVector();

    // ─── VertexData ──────────────────────────────────────────────────
    // Unity 2018+: no m_CurrentChannels field.
    std::uint32_t vertexCount = 0;
    std::vector<ChannelInfo> channels;
    std::vector<std::uint8_t> vertexBytes;
    {
        if (!ver_ge(ver, 2018, 0))
        {
            (void)r.u32();   // m_CurrentChannels
        }
        vertexCount = r.u32();

        const std::uint32_t chanCount = r.u32();
        if (chanCount > 64)
        {
            return Error{"mesh_channel_insane",
                         fmt::format("channel count {} > 64", chanCount)};
        }
        channels.reserve(chanCount);
        for (std::uint32_t i = 0; i < chanCount; ++i)
        {
            ChannelInfo c{};
            c.stream = r.u8();
            c.offset = r.u8();
            c.format = r.u8();
            c.dimension = r.u8();
            channels.push_back(c);
        }

        // m_DataSize + raw bytes
        vertexBytes = r.byteVector();
    }

    // ─── CompressedMesh (skipped — always empty when m_MeshCompression=0) ───
    skipCompressedMesh(r, ver);

    // ─── LocalAABB + MeshUsageFlags + CollisionMeshes + MeshMetrics ───
    mesh.localAABB.center.x = r.f32();
    mesh.localAABB.center.y = r.f32();
    mesh.localAABB.center.z = r.f32();
    mesh.localAABB.extent.x = r.f32();
    mesh.localAABB.extent.y = r.f32();
    mesh.localAABB.extent.z = r.f32();

    (void)r.i32();                       // m_MeshUsageFlags
    if (ver_ge(ver, 2017, 3))
    {
        (void)r.i32();                   // m_CookingOptions
    }
    (void)r.byteVector();                // m_BakedConvexCollisionMesh
    (void)r.byteVector();                // m_BakedTriangleCollisionMesh

    if (ver_ge(ver, 2018, 2))
    {
        (void)r.f32(); (void)r.f32();    // m_MeshMetrics[2]
    }

    // ─── StreamData (StreamingInfo) ──────────────────────────────────
    std::string streamPath;
    std::uint64_t streamOffset = 0;
    std::uint32_t streamSize = 0;
    if (ver_ge(ver, 2018, 2))
    {
        r.alignTo(4);
        if (ver_ge(ver, 2020, 0))
        {
            streamOffset = r.u64();
        }
        else
        {
            streamOffset = r.u32();
        }
        streamSize = r.u32();
        streamPath = r.alignedString();
    }

    if (!r.ok())
    {
        return Error{"mesh_truncated",
                     fmt::format("Mesh payload truncated at cursor={}", r.tell())};
    }

    // ─── Resolve streamed data if any ────────────────────────────────
    // When StreamingInfo.path is non-empty the vertex data is
    // stored in an external .resS file (often embedded as a separate
    // node inside the bundle with flag 0x04). Ask the resolver.
    if (!streamPath.empty() && streamSize > 0)
    {
        if (!resolver)
        {
            return Error{"mesh_streamed_no_resolver",
                         fmt::format("Mesh '{}' uses streamed data '{}' but no resolver",
                                     mesh.name, streamPath)};
        }
        auto [p, n] = resolver(streamPath);
        if (p == nullptr || streamOffset + streamSize > n)
        {
            return Error{"mesh_streamed_unresolved",
                         fmt::format("Mesh '{}' streamed data '{}' (+{}..{}) not found",
                                     mesh.name, streamPath, streamOffset, streamSize)};
        }
        vertexBytes.assign(p + streamOffset, p + streamOffset + streamSize);
    }

    if (vertexCount == 0 || channels.empty() || vertexBytes.empty())
    {
        return Error{"mesh_no_vertices",
                     fmt::format("Mesh '{}' has no decodable vertices", mesh.name)};
    }

    // ─── Compute per-stream stride & base offsets ────────────────────
    std::array<std::uint32_t, 8> streamStride{};
    for (const auto& c : channels)
    {
        if (c.dimension == 0 || c.stream >= streamStride.size()) continue;
        const int bpc = (c.format < kFormatBpc.size()) ? kFormatBpc[c.format] : 4;
        const std::uint32_t end = std::uint32_t(c.offset) + std::uint32_t(bpc) * c.dimension;
        if (end > streamStride[c.stream]) streamStride[c.stream] = end;
    }
    for (auto& s : streamStride)
    {
        const std::uint32_t r4 = s % 4;
        if (r4) s += 4 - r4;
    }
    std::array<std::size_t, 8> streamBase{};
    {
        std::size_t off = 0;
        for (std::size_t i = 0; i < streamBase.size(); ++i)
        {
            streamBase[i] = off;
            off += std::size_t(streamStride[i]) * vertexCount;
        }
    }

    // ─── Decode wanted channels (Position / Normal / UV0) ────────────
    std::vector<float> pos, nrm, uv0;
    for (std::size_t ci = 0; ci < channels.size(); ++ci)
    {
        const auto& c = channels[ci];
        if (c.dimension == 0) continue;
        const auto sem = static_cast<ChannelSemantic>(ci);
        std::vector<float>* target = nullptr;
        std::uint8_t wanted = 0;
        if (sem == ChannelSemantic::Position && c.dimension >= 3)
        {
            target = &pos; wanted = 3;
        }
        else if (sem == ChannelSemantic::Normal && c.dimension >= 3)
        {
            target = &nrm; wanted = 3;
        }
        else if (sem == ChannelSemantic::Uv0 && c.dimension >= 2)
        {
            target = &uv0; wanted = 2;
        }
        if (!target) continue;

        std::vector<float> buf(std::size_t(vertexCount) * c.dimension);
        if (!decodeChannel(vertexBytes.data(), vertexBytes.size(),
                           streamBase[c.stream], streamStride[c.stream],
                           vertexCount, c.offset, c.format, c.dimension,
                           buf.data()))
        {
            return Error{"mesh_channel_decode",
                         fmt::format("Failed to decode channel {} of '{}'", ci, mesh.name)};
        }
        // Truncate to `wanted` components per vertex.
        target->resize(std::size_t(vertexCount) * wanted);
        for (std::uint32_t i = 0; i < vertexCount; ++i)
        {
            for (std::uint8_t d = 0; d < wanted; ++d)
            {
                (*target)[std::size_t(i) * wanted + d] =
                    buf[std::size_t(i) * c.dimension + d];
            }
        }
    }

    if (pos.size() != std::size_t(vertexCount) * 3)
    {
        return Error{"mesh_no_positions",
                     fmt::format("Mesh '{}' missing position channel", mesh.name)};
    }

    mesh.vertices.resize(vertexCount);
    for (std::uint32_t i = 0; i < vertexCount; ++i)
    {
        MeshVertex& v = mesh.vertices[i];
        v.px = pos[std::size_t(i) * 3 + 0];
        v.py = pos[std::size_t(i) * 3 + 1];
        v.pz = pos[std::size_t(i) * 3 + 2];
        if (!nrm.empty())
        {
            v.nx = nrm[std::size_t(i) * 3 + 0];
            v.ny = nrm[std::size_t(i) * 3 + 1];
            v.nz = nrm[std::size_t(i) * 3 + 2];
        }
        if (!uv0.empty())
        {
            v.u = uv0[std::size_t(i) * 2 + 0];
            v.v = uv0[std::size_t(i) * 2 + 1];
        }
    }

    // ─── Decode IndexBuffer into u32 indices ─────────────────────────
    const std::size_t idxStride = mesh.indexFormat32 ? 4 : 2;
    if (indexBuffer.size() % idxStride != 0)
    {
        return Error{"mesh_index_buffer_misaligned",
                     fmt::format("Mesh '{}' indexBuffer {} % {} != 0",
                                 mesh.name, indexBuffer.size(), idxStride)};
    }
    const std::size_t totalIndices = indexBuffer.size() / idxStride;
    mesh.indices.resize(totalIndices);
    if (mesh.indexFormat32)
    {
        for (std::size_t i = 0; i < totalIndices; ++i)
        {
            std::uint32_t v;
            std::memcpy(&v, indexBuffer.data() + i * 4, 4);
            mesh.indices[i] = v;
        }
    }
    else
    {
        for (std::size_t i = 0; i < totalIndices; ++i)
        {
            std::uint16_t v;
            std::memcpy(&v, indexBuffer.data() + i * 2, 2);
            mesh.indices[i] = v;
        }
    }

    // Translate per-submesh `firstByte` into a firstIndex (bytes / stride)
    // so glTF consumers don't need to know the index width.
    for (auto& sm : mesh.submeshes)
    {
        sm.firstByte = static_cast<std::uint32_t>(sm.firstByte / idxStride);
    }

    return mesh;
}

} // namespace vrcsm::core
