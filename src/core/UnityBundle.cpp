#include "UnityBundle.h"

#include "Common.h"

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string_view>

#include <fmt/format.h>
#include <spdlog/spdlog.h>

#include <lz4.h>
#include <lzma.h>

namespace vrcsm::core
{

namespace
{

// ─── Big-endian scalar readers ───────────────────────────────────────
// Unity bundle headers are network-byte-order regardless of the target
// platform's endianness, which differs from the nested SerializedFile
// whose endianness is declared by a header byte. We keep the two clearly
// separated so we don't accidentally byte-swap the wrong thing.

class ByteReader
{
public:
    ByteReader(const std::uint8_t* data, std::size_t size)
        : m_data(data), m_size(size), m_cursor(0) {}

    bool ok() const { return !m_failed; }
    std::size_t tell() const { return m_cursor; }
    std::size_t remaining() const { return m_failed ? 0 : m_size - m_cursor; }

    void seek(std::size_t pos)
    {
        if (pos > m_size)
        {
            m_failed = true;
            return;
        }
        m_cursor = pos;
    }

    void skip(std::size_t n)
    {
        if (n > remaining())
        {
            m_failed = true;
            return;
        }
        m_cursor += n;
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

    std::int64_t i64be()
    {
        return static_cast<std::int64_t>(u64be());
    }

    // Null-terminated ASCII string. Returns empty on overflow.
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

    // Copy `n` raw bytes out of the stream.
    std::vector<std::uint8_t> bytes(std::size_t n)
    {
        if (remaining() < n) { m_failed = true; return {}; }
        std::vector<std::uint8_t> out(m_data + m_cursor, m_data + m_cursor + n);
        m_cursor += n;
        return out;
    }

    // Align to a power-of-two boundary. Unity uses 16-byte alignment
    // for the header-to-blocksInfo padding in UnityFS v7+.
    void alignTo(std::size_t bytes)
    {
        const std::size_t mod = m_cursor % bytes;
        if (mod != 0)
        {
            const std::size_t pad = bytes - mod;
            skip(pad);
        }
    }

private:
    const std::uint8_t* m_data;
    std::size_t m_size;
    std::size_t m_cursor;
    bool m_failed{false};
};

// ─── Block decompression ─────────────────────────────────────────────

enum class Compression : std::uint8_t
{
    None = 0,
    Lzma = 1,
    Lz4 = 2,
    Lz4Hc = 3,
    // 4/5 are Lzham in the spec but Unity never ships them for games.
};

// Decompress `src` into a freshly-allocated vector of exactly
// `uncompressedSize` bytes. Returns empty on failure.
std::vector<std::uint8_t> decompressBlock(
    const std::uint8_t* src,
    std::size_t compressedSize,
    std::size_t uncompressedSize,
    Compression kind)
{
    std::vector<std::uint8_t> out;
    switch (kind)
    {
    case Compression::None:
    {
        if (compressedSize != uncompressedSize)
        {
            spdlog::error("UnityBundle: uncompressed block size mismatch ({} vs {})",
                compressedSize, uncompressedSize);
            return {};
        }
        out.assign(src, src + compressedSize);
        return out;
    }
    case Compression::Lz4:
    case Compression::Lz4Hc:
    {
        out.resize(uncompressedSize);
        const int produced = LZ4_decompress_safe(
            reinterpret_cast<const char*>(src),
            reinterpret_cast<char*>(out.data()),
            static_cast<int>(compressedSize),
            static_cast<int>(uncompressedSize));
        if (produced < 0 || static_cast<std::size_t>(produced) != uncompressedSize)
        {
            spdlog::error("UnityBundle: LZ4_decompress_safe failed (returned {}, expected {})",
                produced, uncompressedSize);
            return {};
        }
        return out;
    }
    case Compression::Lzma:
    {
        // Unity stores LZMA as a 5-byte props header followed by raw
        // LZMA1 stream data — NO size suffix (cf. UnityPy's
        // `lzma_decompress`). xz-utils' `lzma_alone_decoder` expects
        // the .lzma format (props + size + data), so we drop down to
        // a raw decoder with the props decoded explicitly.
        if (compressedSize < 5)
        {
            spdlog::error("UnityBundle: LZMA block too small for props header");
            return {};
        }

        // lzma_properties_decode() allocates a fresh lzma_options_lzma via
        // the allocator (malloc when allocator is null) and overwrites
        // propsFilter.options with the pointer — it does NOT populate any
        // caller-provided struct. Passing a stack `opts` here and then
        // handing `&opts` to the decoder would feed it a zero-initialised
        // options struct (dict_size=lc=lp=pb=0), so every real stream
        // decodes as LZMA_DATA_ERROR. Use propsFilter.options directly
        // and free it after the decoder is done.
        lzma_filter propsFilter{};
        propsFilter.id = LZMA_FILTER_LZMA1;
        propsFilter.options = nullptr;
        if (lzma_properties_decode(&propsFilter, nullptr, src, 5) != LZMA_OK)
        {
            spdlog::error("UnityBundle: lzma_properties_decode failed");
            return {};
        }

        lzma_filter filters[2] = {
            { LZMA_FILTER_LZMA1, propsFilter.options },
            { LZMA_VLI_UNKNOWN, nullptr },
        };

        lzma_stream strm = LZMA_STREAM_INIT;
        if (lzma_raw_decoder(&strm, filters) != LZMA_OK)
        {
            spdlog::error("UnityBundle: lzma_raw_decoder init failed");
            free(propsFilter.options);
            return {};
        }

        out.resize(uncompressedSize);
        strm.next_in = src + 5;
        strm.avail_in = compressedSize - 5;
        strm.next_out = out.data();
        strm.avail_out = uncompressedSize;

        const lzma_ret ret = lzma_code(&strm, LZMA_FINISH);
        const auto producedOut = strm.total_out;
        lzma_end(&strm);
        free(propsFilter.options);

        if (ret != LZMA_STREAM_END && ret != LZMA_OK)
        {
            spdlog::error("UnityBundle: lzma_code failed with code {}", static_cast<int>(ret));
            return {};
        }
        if (producedOut != uncompressedSize)
        {
            spdlog::error("UnityBundle: LZMA produced {} bytes, expected {}",
                producedOut, uncompressedSize);
            return {};
        }
        return out;
    }
    default:
        spdlog::error("UnityBundle: unsupported compression kind {}", static_cast<int>(kind));
        return {};
    }
}

} // namespace

std::pair<const std::uint8_t*, std::size_t> UnityBundle::view(const UnityBundleNode& node) const
{
    if (node.offset < 0 || node.size < 0) return {nullptr, 0};
    const auto start = static_cast<std::size_t>(node.offset);
    const auto len = static_cast<std::size_t>(node.size);
    if (start > data.size() || start + len > data.size()) return {nullptr, 0};
    return {data.data() + start, len};
}

Result<UnityBundle> parseUnityBundle(const std::filesystem::path& path)
{
    std::error_code ec;
    const auto fileSize = std::filesystem::file_size(path, ec);
    if (ec || fileSize == 0)
    {
        return Error{"bundle_invalid", fmt::format("Bundle is empty or unreadable: {}", toUtf8(path.wstring()))};
    }
    if (fileSize > (std::uint64_t(2) << 30)) // 2 GiB sanity cap
    {
        return Error{"bundle_invalid", "Bundle file exceeds 2 GiB sanity cap"};
    }

    // Slurp the file. Avatar bundles are at most a few hundred MB;
    // loading them in one shot keeps the parser simple.
    std::vector<std::uint8_t> raw(static_cast<std::size_t>(fileSize));
    {
        std::ifstream in(path, std::ios::binary);
        if (!in)
        {
            return Error{"bundle_invalid", "Could not open bundle for reading"};
        }
        in.read(reinterpret_cast<char*>(raw.data()), static_cast<std::streamsize>(fileSize));
        if (!in || static_cast<std::uint64_t>(in.gcount()) != fileSize)
        {
            return Error{"bundle_invalid", "Short read on bundle"};
        }
    }

    ByteReader reader(raw.data(), raw.size());

    // ── Header ──────────────────────────────────────────────────────
    const auto signature = reader.cstr();
    if (signature != "UnityFS")
    {
        return Error{"bundle_invalid", fmt::format("Unsupported signature '{}' (only UnityFS accepted)", signature)};
    }

    UnityBundle bundle{};
    bundle.formatVersion = reader.u32be();
    if (bundle.formatVersion < 6 || bundle.formatVersion > 8)
    {
        return Error{"bundle_invalid", fmt::format("Unsupported UnityFS version {}", bundle.formatVersion)};
    }

    const auto unityMinVersion = reader.cstr();  // "5.x.x" or similar
    bundle.unityRevision = reader.cstr();        // "2022.3.22f1"
    (void)unityMinVersion;

    const std::uint64_t totalSize = reader.u64be();
    const std::uint32_t compressedInfoSize = reader.u32be();
    const std::uint32_t uncompressedInfoSize = reader.u32be();
    const std::uint32_t flags = reader.u32be();
    (void)totalSize;

    if (!reader.ok())
    {
        return Error{"bundle_invalid", "Truncated UnityFS header"};
    }

    // Per Unity source (kArchiveFlags* in BundleFile), flags encode:
    //   bits 0..5  → compression type for blocksInfo   (0x3F)
    //   bit  6     → blocksInfo + directoryInfo combined (0x40)
    //   bit  7     → blocksInfo located at END of file   (0x80)
    //   bit  8     → old web plugin compatibility        (0x100) — ignored
    //   bit  9     → block DATA needs 16-byte padding    (0x200)
    //   bit 10     → VRChat custom encryption            (0x400) — rejected
    // The pre-blocksInfo alignment is purely version-based (v7+), not
    // flag-driven. The 0x200 flag aligns the block DATA payload, i.e.
    // it fires AFTER blocksInfo, BEFORE reading the block stream.
    constexpr std::uint32_t kBlocksInfoAtEnd = 0x80;
    constexpr std::uint32_t kBlockDataNeedsPadding = 0x200;
    constexpr std::uint32_t kCustomEncryption = 0x400;
    constexpr std::uint32_t kCompressionMask = 0x3F;

    if (flags & kCustomEncryption)
    {
        return Error{"encrypted", "Bundle is marked with Unity's custom-encryption flag"};
    }

    const auto blocksInfoCompression = static_cast<Compression>(flags & kCompressionMask);

    std::size_t blocksInfoFileOffset = 0;
    if (flags & kBlocksInfoAtEnd)
    {
        blocksInfoFileOffset = raw.size() - compressedInfoSize;
    }
    else
    {
        // v7+ bundles pad the header up to a 16-byte boundary before
        // the blocksInfo payload starts (matches AssetStudio/UnityPy).
        if (bundle.formatVersion >= 7)
        {
            reader.alignTo(16);
        }
        blocksInfoFileOffset = reader.tell();
    }

    if (!reader.ok() ||
        blocksInfoFileOffset > raw.size() ||
        blocksInfoFileOffset + compressedInfoSize > raw.size())
    {
        return Error{"bundle_invalid", "BlocksInfo offset out of range"};
    }

    // ── Decompress blocksInfo ───────────────────────────────────────
    auto blocksInfoBytes = decompressBlock(
        raw.data() + blocksInfoFileOffset,
        compressedInfoSize,
        uncompressedInfoSize,
        blocksInfoCompression);
    if (blocksInfoBytes.empty())
    {
        return Error{"bundle_invalid", "Failed to decompress blocksInfo"};
    }

    ByteReader info(blocksInfoBytes.data(), blocksInfoBytes.size());
    info.skip(16);  // uncompressedDataHash (GUID, ignored)

    const std::uint32_t blockCount = info.u32be();
    if (!info.ok() || blockCount > 0x10000)
    {
        return Error{"bundle_invalid", "Unreasonable block count"};
    }

    struct BlockInfo { std::uint32_t u, c; Compression k; };
    std::vector<BlockInfo> blocks;
    blocks.reserve(blockCount);
    std::uint64_t totalUncompressed = 0;
    for (std::uint32_t i = 0; i < blockCount; ++i)
    {
        BlockInfo bi{};
        bi.u = info.u32be();
        bi.c = info.u32be();
        const std::uint16_t blockFlags = info.u16be();
        bi.k = static_cast<Compression>(blockFlags & kCompressionMask);
        blocks.push_back(bi);
        totalUncompressed += bi.u;
    }
    if (!info.ok())
    {
        return Error{"bundle_invalid", "Truncated block table"};
    }
    if (totalUncompressed > (std::uint64_t(1) << 31)) // 2 GiB
    {
        return Error{"bundle_invalid", "Decompressed data would exceed 2 GiB"};
    }

    const std::uint32_t nodeCount = info.u32be();
    if (!info.ok() || nodeCount == 0 || nodeCount > 0x10000)
    {
        return Error{"bundle_invalid", "Unreasonable node count"};
    }
    bundle.nodes.reserve(nodeCount);
    for (std::uint32_t i = 0; i < nodeCount; ++i)
    {
        UnityBundleNode node{};
        node.offset = info.i64be();
        node.size = info.i64be();
        node.flags = info.u32be();
        node.path = info.cstr();
        bundle.nodes.push_back(std::move(node));
    }
    if (!info.ok())
    {
        return Error{"bundle_invalid", "Truncated node table"};
    }

    // ── Decompress all data blocks and concatenate ──────────────────
    // File offset where block payload starts. If blocksInfo was at
    // the end, block data follows the header/padding (offset already
    // advanced). Otherwise, block data follows blocksInfo.
    std::size_t blockDataFileOffset = 0;
    if (flags & kBlocksInfoAtEnd)
    {
        blockDataFileOffset = reader.tell();
    }
    else
    {
        blockDataFileOffset = blocksInfoFileOffset + compressedInfoSize;
    }

    // kBlockDataNeedsPadding: align the block data stream to 16 bytes.
    // Unity sets this on many VRChat-era avatar bundles. Missing this
    // step makes the first LZ4 decompress fail with a garbage token.
    if (flags & kBlockDataNeedsPadding)
    {
        const std::size_t mod = blockDataFileOffset % 16;
        if (mod != 0)
        {
            blockDataFileOffset += (16 - mod);
        }
    }

    if (blockDataFileOffset > raw.size())
    {
        return Error{"bundle_invalid", "Block data offset past EOF after alignment"};
    }

    bundle.data.reserve(static_cast<std::size_t>(totalUncompressed));
    std::size_t cursor = blockDataFileOffset;
    for (const auto& bi : blocks)
    {
        if (cursor + bi.c > raw.size())
        {
            return Error{"bundle_invalid", "Block payload extends past EOF"};
        }
        auto chunk = decompressBlock(raw.data() + cursor, bi.c, bi.u, bi.k);
        if (chunk.empty() && bi.u > 0)
        {
            return Error{"bundle_invalid", fmt::format("Block decompression failed ({})", static_cast<int>(bi.k))};
        }
        bundle.data.insert(bundle.data.end(), chunk.begin(), chunk.end());
        cursor += bi.c;
    }

    if (bundle.data.size() != totalUncompressed)
    {
        return Error{"bundle_invalid", fmt::format(
            "Concatenated block size {} != expected {}", bundle.data.size(), totalUncompressed)};
    }

    // Sanity-check nodes fit within the decompressed stream.
    for (const auto& node : bundle.nodes)
    {
        if (node.offset < 0 || node.size < 0 ||
            static_cast<std::uint64_t>(node.offset + node.size) > bundle.data.size())
        {
            return Error{"bundle_invalid", fmt::format(
                "Node '{}' range [{}..{}) exceeds stream size {}",
                node.path, node.offset, node.offset + node.size, bundle.data.size())};
        }
    }

    spdlog::debug("UnityBundle: parsed {} (unity={}, v{}, {} blocks, {} nodes, {} decompressed bytes)",
        toUtf8(path.filename().wstring()),
        bundle.unityRevision,
        bundle.formatVersion,
        blocks.size(),
        bundle.nodes.size(),
        bundle.data.size());

    return bundle;
}

} // namespace vrcsm::core
