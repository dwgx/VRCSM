#include "../pch.h"

#include "PngMetadata.h"

#include "Common.h"

#include <array>
#include <cstring>
#include <fstream>
#include <random>
#include <string_view>
#include <system_error>

#include <fmt/format.h>
#include <spdlog/spdlog.h>

// ─────────────────────────────────────────────────────────────────────────
// PNG tEXt chunk writer.
//
// The PNG file starts with an 8-byte signature followed by a stream of
// chunks. Each chunk is:
//     length (4 B, big-endian, excludes type + CRC)
//     type   (4 B ASCII, e.g. "IHDR", "tEXt", "IDAT", "IEND")
//     data   (length bytes)
//     crc32  (4 B, computed over type + data)
//
// IHDR is always the first chunk; IEND is always the last. We insert
// our tEXt chunks immediately after IHDR which is legal per the spec
// ("ancillary chunks may appear in any order between IHDR and IEND").
//
// CRC32 uses the standard polynomial 0xEDB88320 applied over type + data.
// ─────────────────────────────────────────────────────────────────────────

namespace vrcsm::core
{

namespace
{

constexpr std::array<std::uint8_t, 8> kPngSignature = {
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a};

// One-shot lazy CRC32 table — standard PNG/zip polynomial.
const std::array<std::uint32_t, 256>& Crc32Table()
{
    static const std::array<std::uint32_t, 256> kTable = []()
    {
        std::array<std::uint32_t, 256> table{};
        for (std::uint32_t i = 0; i < 256; ++i)
        {
            std::uint32_t c = i;
            for (int k = 0; k < 8; ++k)
            {
                c = (c & 1u) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            }
            table[i] = c;
        }
        return table;
    }();
    return kTable;
}

std::uint32_t Crc32Update(std::uint32_t crc, const std::uint8_t* data, std::size_t len)
{
    const auto& table = Crc32Table();
    crc ^= 0xFFFFFFFFu;
    for (std::size_t i = 0; i < len; ++i)
    {
        crc = table[(crc ^ data[i]) & 0xFFu] ^ (crc >> 8);
    }
    return crc ^ 0xFFFFFFFFu;
}

void WriteBe32(std::vector<std::uint8_t>& out, std::uint32_t v)
{
    out.push_back(static_cast<std::uint8_t>((v >> 24) & 0xFF));
    out.push_back(static_cast<std::uint8_t>((v >> 16) & 0xFF));
    out.push_back(static_cast<std::uint8_t>((v >> 8) & 0xFF));
    out.push_back(static_cast<std::uint8_t>(v & 0xFF));
}

std::uint32_t ReadBe32(const std::uint8_t* p)
{
    return (static_cast<std::uint32_t>(p[0]) << 24) |
           (static_cast<std::uint32_t>(p[1]) << 16) |
           (static_cast<std::uint32_t>(p[2]) << 8) |
           static_cast<std::uint32_t>(p[3]);
}

// Build a single tEXt chunk as raw bytes. Returns empty on invalid input
// (keyword must be 1-79 Latin-1 bytes, no NUL).
std::vector<std::uint8_t> MakeTextChunk(const std::string& keyword, const std::string& text)
{
    if (keyword.empty() || keyword.size() > 79) return {};
    if (keyword.find('\0') != std::string::npos) return {};

    std::vector<std::uint8_t> data;
    data.reserve(keyword.size() + 1 + text.size());
    data.insert(data.end(), keyword.begin(), keyword.end());
    data.push_back(0);
    data.insert(data.end(), text.begin(), text.end());

    std::vector<std::uint8_t> typeAndData;
    typeAndData.reserve(4 + data.size());
    typeAndData.insert(typeAndData.end(), {'t', 'E', 'X', 't'});
    typeAndData.insert(typeAndData.end(), data.begin(), data.end());

    const std::uint32_t crc = Crc32Update(0, typeAndData.data(), typeAndData.size());

    std::vector<std::uint8_t> chunk;
    chunk.reserve(4 + typeAndData.size() + 4);
    WriteBe32(chunk, static_cast<std::uint32_t>(data.size()));
    chunk.insert(chunk.end(), typeAndData.begin(), typeAndData.end());
    WriteBe32(chunk, crc);
    return chunk;
}

std::vector<std::uint8_t> ReadFileBytes(const std::filesystem::path& path)
{
    std::ifstream in(path, std::ios::binary);
    if (!in) return {};
    in.seekg(0, std::ios::end);
    const auto size = in.tellg();
    if (size <= 0) return {};
    in.seekg(0, std::ios::beg);
    std::vector<std::uint8_t> bytes(static_cast<std::size_t>(size));
    in.read(reinterpret_cast<char*>(bytes.data()), size);
    return bytes;
}

bool WriteFileBytesAtomic(const std::filesystem::path& path,
                          const std::vector<std::uint8_t>& bytes)
{
    // Write to a sibling .part file and rename on top. A partial write
    // is then visible only as orphaned .part, never as a corrupted
    // original — important when the file we're rewriting is the user's
    // own screenshot.
    std::filesystem::path tmp = path;
    tmp += L".vrcsm-part";

    {
        std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
        if (!out) return false;
        out.write(reinterpret_cast<const char*>(bytes.data()),
                  static_cast<std::streamsize>(bytes.size()));
        if (!out) return false;
    }

    std::error_code ec;
    std::filesystem::rename(tmp, path, ec);
    if (ec)
    {
        spdlog::warn("PngMetadata: rename failed ({}): {}", toUtf8(path.wstring()), ec.message());
        std::filesystem::remove(tmp, ec);
        return false;
    }
    return true;
}

std::string JsonValueToString(const nlohmann::json& v)
{
    if (v.is_string()) return v.get<std::string>();
    if (v.is_number_integer()) return std::to_string(v.get<std::int64_t>());
    if (v.is_number_float()) return std::to_string(v.get<double>());
    if (v.is_boolean()) return v.get<bool>() ? "true" : "false";
    if (v.is_null()) return "";
    return v.dump();
}

} // namespace

bool InjectPngTextChunks(
    const std::filesystem::path& pngPath,
    const std::vector<std::pair<std::string, std::string>>& entries)
{
    if (entries.empty()) return true;

    const auto bytes = ReadFileBytes(pngPath);
    if (bytes.size() < kPngSignature.size() + 12) // signature + IHDR chunk
    {
        spdlog::warn("PngMetadata: {} too short", toUtf8(pngPath.wstring()));
        return false;
    }
    if (!std::equal(kPngSignature.begin(), kPngSignature.end(), bytes.begin()))
    {
        spdlog::warn("PngMetadata: {} not a PNG", toUtf8(pngPath.wstring()));
        return false;
    }

    // First chunk after signature must be IHDR. Find its end offset.
    const std::uint32_t ihdrLen = ReadBe32(bytes.data() + kPngSignature.size());
    const std::size_t ihdrEnd = kPngSignature.size() + 4 /*len*/ + 4 /*type*/ + ihdrLen + 4 /*crc*/;
    if (ihdrEnd > bytes.size() ||
        std::memcmp(bytes.data() + kPngSignature.size() + 4, "IHDR", 4) != 0)
    {
        spdlog::warn("PngMetadata: {} has no IHDR", toUtf8(pngPath.wstring()));
        return false;
    }

    // Build the composite tEXt block.
    std::vector<std::uint8_t> textBlock;
    textBlock.reserve(entries.size() * 64);
    for (const auto& [k, v] : entries)
    {
        // Cap chunk size at 64 KiB — PNG allows more, but there's no
        // reason any VRChat metadata value should exceed that and it
        // guards against runaway input.
        std::string capped = v;
        if (capped.size() > 64 * 1024) capped.resize(64 * 1024);
        const auto chunk = MakeTextChunk(k, capped);
        if (chunk.empty())
        {
            spdlog::warn("PngMetadata: skipping invalid key '{}'", k);
            continue;
        }
        textBlock.insert(textBlock.end(), chunk.begin(), chunk.end());
    }
    if (textBlock.empty()) return false;

    // Splice: [signature + IHDR] + [tEXt chunks] + [remaining PNG body]
    std::vector<std::uint8_t> out;
    out.reserve(bytes.size() + textBlock.size());
    out.insert(out.end(), bytes.begin(), bytes.begin() + ihdrEnd);
    out.insert(out.end(), textBlock.begin(), textBlock.end());
    out.insert(out.end(), bytes.begin() + ihdrEnd, bytes.end());

    return WriteFileBytesAtomic(pngPath, out);
}

bool InjectPngTextFromJson(
    const std::filesystem::path& pngPath,
    const nlohmann::json& metadata)
{
    if (!metadata.is_object()) return false;

    std::vector<std::pair<std::string, std::string>> entries;
    entries.reserve(metadata.size());
    for (const auto& item : metadata.items())
    {
        entries.emplace_back(item.key(), JsonValueToString(item.value()));
    }
    return InjectPngTextChunks(pngPath, entries);
}

std::vector<std::pair<std::string, std::string>> ReadPngTextChunks(
    const std::filesystem::path& pngPath)
{
    std::vector<std::pair<std::string, std::string>> out;
    const auto bytes = ReadFileBytes(pngPath);
    if (bytes.size() < kPngSignature.size() + 12) return out;
    if (!std::equal(kPngSignature.begin(), kPngSignature.end(), bytes.begin())) return out;

    std::size_t offset = kPngSignature.size();
    while (offset + 12 <= bytes.size())
    {
        const std::uint32_t len = ReadBe32(bytes.data() + offset);
        const char* type = reinterpret_cast<const char*>(bytes.data() + offset + 4);

        if (offset + 8 + len + 4 > bytes.size()) break;

        if (std::memcmp(type, "tEXt", 4) == 0)
        {
            const std::uint8_t* data = bytes.data() + offset + 8;
            const std::uint8_t* nul = static_cast<const std::uint8_t*>(
                std::memchr(data, 0, len));
            if (nul != nullptr)
            {
                const std::size_t keyLen = static_cast<std::size_t>(nul - data);
                const std::size_t valLen = len - keyLen - 1;
                std::string key(reinterpret_cast<const char*>(data), keyLen);
                std::string val(reinterpret_cast<const char*>(nul + 1), valLen);
                out.emplace_back(std::move(key), std::move(val));
            }
        }
        else if (std::memcmp(type, "IEND", 4) == 0)
        {
            break;
        }

        offset += 8 + len + 4;
    }
    return out;
}

} // namespace vrcsm::core
