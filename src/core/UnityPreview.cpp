#include "UnityPreview.h"

#include "UnityBundle.h"
#include "UnityMesh.h"
#include "UnitySerialized.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <fstream>
#include <iterator>
#include <numeric>
#include <regex>
#include <set>
#include <string_view>
#include <system_error>
#include <unordered_map>

#include <fmt/format.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

namespace vrcsm::core
{

namespace
{

// ─── Filter heuristics constants (mirror extract_to_glb.py) ──────────

const std::array<std::string_view, 14> kHardExcludeKeywords = {
    "bloom", "particle", "trail", "laser", "beam",
    "speaker", "audio", "trumpet", "horn", "megaphone",
    "gun", "rifle", "sword", "weapon",
};

const std::array<std::string_view, 10> kSoftExcludeKeywords = {
    "bag", "backpack", "prop", "fx", "effect",
    "vfx", "aura", "halo", "glow",
    // 9 items; trailing slot kept for balanced tuples
    "",
};

constexpr int kMaxMeshesPerPreview = 12;

// ─── Per-mesh metrics used by the filter ─────────────────────────────

struct MeshMetrics
{
    const UnityMesh* mesh{nullptr};
    std::string name;
    std::uint32_t vc{0};
    std::uint32_t triangleCount{0};
    std::uint32_t boneCount{0};
    double volume{0};
    std::array<float, 3> bboxMin{{ 0, 0, 0 }};
    std::array<float, 3> bboxMax{{ 0, 0, 0 }};
    std::array<float, 3> centroid{{ 0, 0, 0 }};
    std::array<float, 3> extents{{ 0, 0, 0 }};
    bool isSkinned{false};
    int keywordPenalty{0};
};

int keywordPenaltyFor(const std::string& name)
{
    std::string lower;
    lower.reserve(name.size());
    for (char c : name)
    {
        lower.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }
    int penalty = 0;
    for (auto tok : kHardExcludeKeywords)
    {
        if (!tok.empty() && lower.find(tok) != std::string::npos) penalty += 10;
    }
    for (auto tok : kSoftExcludeKeywords)
    {
        if (!tok.empty() && lower.find(tok) != std::string::npos) penalty += 4;
    }
    return penalty;
}

MeshMetrics computeMetrics(const UnityMesh& mesh)
{
    MeshMetrics m{};
    m.mesh = &mesh;
    m.name = mesh.name;
    m.vc = static_cast<std::uint32_t>(mesh.vertices.size());
    m.boneCount = mesh.boneCount;
    m.isSkinned = (mesh.boneCount > 4);
    m.keywordPenalty = keywordPenaltyFor(mesh.name);

    std::uint32_t triangles = 0;
    for (const auto& sm : mesh.submeshes)
    {
        if (sm.topology == 0)   // Triangles
        {
            triangles += sm.indexCount / 3;
        }
    }
    m.triangleCount = triangles;

    if (mesh.vertices.empty())
    {
        return m;
    }

    float mnx = mesh.vertices[0].px, mny = mesh.vertices[0].py, mnz = mesh.vertices[0].pz;
    float mxx = mnx, mxy = mny, mxz = mnz;
    for (const auto& v : mesh.vertices)
    {
        mnx = std::min(mnx, v.px); mny = std::min(mny, v.py); mnz = std::min(mnz, v.pz);
        mxx = std::max(mxx, v.px); mxy = std::max(mxy, v.py); mxz = std::max(mxz, v.pz);
    }
    m.bboxMin = { mnx, mny, mnz };
    m.bboxMax = { mxx, mxy, mxz };
    m.extents = { mxx - mnx, mxy - mny, mxz - mnz };
    m.centroid = { (mxx + mnx) * 0.5f, (mxy + mny) * 0.5f, (mxz + mnz) * 0.5f };

    const double ex = std::max(double(m.extents[0]), 1e-6);
    const double ey = std::max(double(m.extents[1]), 1e-6);
    const double ez = std::max(double(m.extents[2]), 1e-6);
    m.volume = ex * ey * ez;
    return m;
}

double median(std::vector<double> v)
{
    if (v.empty()) return 0.0;
    std::sort(v.begin(), v.end());
    const std::size_t n = v.size();
    return (n % 2 == 1) ? v[n / 2] : 0.5 * (v[n / 2 - 1] + v[n / 2]);
}

double vecDistance(const std::array<float, 3>& a, const std::array<float, 3>& b)
{
    const double dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
    return std::sqrt(dx * dx + dy * dy + dz * dz);
}

// ─── Adaptive filter (port of extract_to_glb.py::_filter_adaptive) ───

std::vector<MeshMetrics> filterAdaptive(std::vector<MeshMetrics> metrics)
{
    if (metrics.size() <= 1) return metrics;

    // Stage 1: prefer skinned
    std::vector<MeshMetrics> skinned;
    for (const auto& m : metrics) if (m.isSkinned) skinned.push_back(m);
    std::vector<MeshMetrics> pool = (skinned.size() >= 2) ? std::move(skinned) : metrics;

    // Stage 2: volume outlier
    std::vector<double> vols;
    vols.reserve(pool.size());
    for (const auto& m : pool) vols.push_back(m.volume);
    const double vmed = median(vols);
    const double lo = vmed * 0.001;
    const double hi = vmed * 50.0;
    std::vector<MeshMetrics> kept;
    for (const auto& m : pool)
    {
        if (m.volume >= lo && m.volume <= hi) kept.push_back(m);
    }
    if (kept.empty()) kept = pool;

    // Stage 3: spatial centroid outlier
    if (kept.size() > 2)
    {
        std::array<double, 3> sum{0, 0, 0};
        for (const auto& m : kept)
        {
            sum[0] += m.centroid[0]; sum[1] += m.centroid[1]; sum[2] += m.centroid[2];
        }
        const double inv = 1.0 / static_cast<double>(kept.size());
        const std::array<float, 3> center = {
            static_cast<float>(sum[0] * inv),
            static_cast<float>(sum[1] * inv),
            static_cast<float>(sum[2] * inv)};

        std::vector<double> dists;
        dists.reserve(kept.size());
        double dsum = 0;
        for (const auto& m : kept)
        {
            const double d = vecDistance(m.centroid, center);
            dists.push_back(d); dsum += d;
        }
        const double dmean = dsum / static_cast<double>(dists.size());
        double var = 0;
        for (double d : dists) var += (d - dmean) * (d - dmean);
        const double sigma = std::sqrt(var / static_cast<double>(dists.size()));
        if (sigma > 1e-6)
        {
            std::vector<MeshMetrics> spatial;
            for (std::size_t i = 0; i < kept.size(); ++i)
            {
                const double z = (dists[i] - dmean) / sigma;
                if (z < 3.0) spatial.push_back(kept[i]);
            }
            if (!spatial.empty()) kept = std::move(spatial);
        }
    }

    // Stage 4: LOD dedup — strip `_?LOD\d+$` from name, keep highest vc per group
    std::unordered_map<std::string, MeshMetrics> dedup;
    static const std::regex lodRe(R"(_?LOD\d+$)", std::regex::icase);
    for (const auto& m : kept)
    {
        std::string base = std::regex_replace(m.name, lodRe, "");
        auto it = dedup.find(base);
        if (it == dedup.end() || it->second.vc < m.vc)
        {
            dedup[base] = m;
        }
    }
    std::vector<MeshMetrics> deduped;
    deduped.reserve(dedup.size());
    for (auto& kv : dedup) deduped.push_back(std::move(kv.second));

    // Stage 5: anchor body cluster + keyword prop rejection
    std::vector<MeshMetrics> anchorCandidates;
    for (const auto& m : deduped)
    {
        if (m.isSkinned && m.keywordPenalty == 0) anchorCandidates.push_back(m);
    }
    if (anchorCandidates.empty())
    {
        for (const auto& m : deduped)
        {
            if (m.isSkinned && m.keywordPenalty < 10) anchorCandidates.push_back(m);
        }
    }
    if (anchorCandidates.empty())
    {
        anchorCandidates = deduped;
    }

    // Pick top 3 anchors by (vc desc, volume desc)
    std::sort(anchorCandidates.begin(), anchorCandidates.end(),
              [](const MeshMetrics& a, const MeshMetrics& b) {
                  if (a.vc != b.vc) return a.vc > b.vc;
                  return a.volume > b.volume;
              });
    const std::size_t anchorCount = std::min<std::size_t>(3, anchorCandidates.size());
    std::vector<MeshMetrics> anchors(anchorCandidates.begin(),
                                     anchorCandidates.begin() + anchorCount);

    // Since we don't parse GameObject bindings yet, we use mesh name
    // alone for grouping. This is noisier than the Python script but
    // good enough to keep weapons/props out of the preview most of
    // the time.
    std::set<std::string> anchorNames;
    for (const auto& a : anchors) anchorNames.insert(a.name);

    std::array<float, 3> bodyMin = anchors.empty()
        ? std::array<float, 3>{0, 0, 0}
        : anchors.front().bboxMin;
    std::array<float, 3> bodyMax = anchors.empty()
        ? std::array<float, 3>{0, 0, 0}
        : anchors.front().bboxMax;
    for (const auto& a : anchors)
    {
        for (int i = 0; i < 3; ++i)
        {
            bodyMin[i] = std::min(bodyMin[i], a.bboxMin[i]);
            bodyMax[i] = std::max(bodyMax[i], a.bboxMax[i]);
        }
    }
    const std::array<float, 3> bodyCenter = {
        (bodyMin[0] + bodyMax[0]) * 0.5f,
        (bodyMin[1] + bodyMax[1]) * 0.5f,
        (bodyMin[2] + bodyMax[2]) * 0.5f};
    const double bodyDiag = vecDistance(bodyMin, bodyMax);

    auto aabbOverlapRatio = [&](const MeshMetrics& m) -> double
    {
        double ox0 = std::max(m.bboxMin[0], bodyMin[0]);
        double oy0 = std::max(m.bboxMin[1], bodyMin[1]);
        double oz0 = std::max(m.bboxMin[2], bodyMin[2]);
        double ox1 = std::min(m.bboxMax[0], bodyMax[0]);
        double oy1 = std::min(m.bboxMax[1], bodyMax[1]);
        double oz1 = std::min(m.bboxMax[2], bodyMax[2]);
        double ex = std::max(ox1 - ox0, 0.0);
        double ey = std::max(oy1 - oy0, 0.0);
        double ez = std::max(oz1 - oz0, 0.0);
        double ov = ex * ey * ez;
        if (ov <= 0.0) return 0.0;
        return ov / std::max(m.volume, 1e-6);
    };

    std::vector<MeshMetrics> clustered;
    for (const auto& m : deduped)
    {
        if (anchorNames.count(m.name))
        {
            clustered.push_back(m);
            continue;
        }
        const double overlap = aabbOverlapRatio(m);
        const double dist = vecDistance(m.centroid, bodyCenter);

        if (m.keywordPenalty >= 10)
        {
            // Hard keyword: only keep if deeply embedded in body AABB.
            if (!m.isSkinned) continue;
            if (overlap < 0.92 || dist > std::max(0.22, bodyDiag * 0.28)) continue;
        }
        if (m.keywordPenalty >= 4
            && overlap < 0.25
            && dist > std::max(0.45, bodyDiag * 0.45))
        {
            continue;
        }
        if (overlap < 0.03 && dist > std::max(0.85, bodyDiag * 0.60))
        {
            continue;
        }
        clustered.push_back(m);
    }
    if (clustered.empty()) clustered = anchors;

    // Stage 6: prefer clean (no keyword) set when we have enough
    std::vector<MeshMetrics> clean;
    for (const auto& m : clustered)
    {
        if (m.keywordPenalty == 0) clean.push_back(m);
    }
    if (clean.size() >= std::max<std::size_t>(4, anchors.size() + 1))
    {
        clustered = std::move(clean);
    }

    // Final sort: anchors first, then no-keyword, then skinned, then high-vc
    std::sort(clustered.begin(), clustered.end(),
              [&](const MeshMetrics& a, const MeshMetrics& b) {
                  const bool aAnchor = anchorNames.count(a.name) > 0;
                  const bool bAnchor = anchorNames.count(b.name) > 0;
                  if (aAnchor != bAnchor) return aAnchor > bAnchor;
                  const bool aClean = (a.keywordPenalty == 0);
                  const bool bClean = (b.keywordPenalty == 0);
                  if (aClean != bClean) return aClean > bClean;
                  if (a.isSkinned != b.isSkinned) return a.isSkinned > b.isSkinned;
                  if (a.vc != b.vc) return a.vc > b.vc;
                  return a.volume > b.volume;
              });
    if (clustered.size() > kMaxMeshesPerPreview)
    {
        clustered.resize(kMaxMeshesPerPreview);
    }
    return clustered;
}

// ─── Minimal GLB writer ──────────────────────────────────────────────

constexpr std::uint32_t kGlbMagic = 0x46546C67;      // "glTF"
constexpr std::uint32_t kGlbVersion = 2;
constexpr std::uint32_t kChunkJson = 0x4E4F534A;     // "JSON"
constexpr std::uint32_t kChunkBin = 0x004E4942;      // "BIN\0"

// Append `value` to `dst` in little-endian. Assumes little-endian host
// (Windows x64 — which VRCSM is always built for).
template <typename T>
void appendLe(std::vector<std::uint8_t>& dst, T value)
{
    static_assert(std::is_trivially_copyable_v<T>);
    const auto p = reinterpret_cast<const std::uint8_t*>(&value);
    dst.insert(dst.end(), p, p + sizeof(T));
}

void padTo4(std::vector<std::uint8_t>& buf, std::uint8_t filler)
{
    while (buf.size() % 4 != 0) buf.push_back(filler);
}

bool writeGlb(const std::vector<MeshMetrics>& picks,
              const std::filesystem::path& glbPath,
              PreviewExtractSummary& summary)
{
    using nlohmann::json;

    // Flatten all meshes into one interleaved BIN buffer with per-mesh
    // bufferViews + accessors. glTF allows multiple bufferViews into
    // a single buffer, so we pack everything sequentially.
    std::vector<std::uint8_t> bin;
    bin.reserve(1 << 20);

    json root = {
        {"asset", {{"version", "2.0"}, {"generator", "VRCSM native"}}},
        {"scene", 0},
        {"scenes", json::array()},
        {"nodes", json::array()},
        {"meshes", json::array()},
        {"bufferViews", json::array()},
        {"accessors", json::array()},
        {"buffers", json::array()},
    };

    json& nodes = root["nodes"];
    json& meshes = root["meshes"];
    json& bufferViews = root["bufferViews"];
    json& accessors = root["accessors"];

    json sceneNodes = json::array();

    for (std::size_t mi = 0; mi < picks.size(); ++mi)
    {
        const UnityMesh& m = *picks[mi].mesh;

        // Per-mesh attribute buffers (positions / normals / uv0).
        const bool hasNormals = std::any_of(m.vertices.begin(), m.vertices.end(),
            [](const MeshVertex& v) {
                return v.nx != 0.0f || v.ny != 0.0f || v.nz != 0.0f;
            });
        const bool hasUv = std::any_of(m.vertices.begin(), m.vertices.end(),
            [](const MeshVertex& v) {
                return v.u != 0.0f || v.v != 0.0f;
            });

        // Write positions
        const std::size_t posOffset = bin.size();
        std::array<float, 3> pmn{ m.vertices[0].px, m.vertices[0].py, m.vertices[0].pz };
        std::array<float, 3> pmx = pmn;
        for (const auto& v : m.vertices)
        {
            appendLe<float>(bin, v.px);
            appendLe<float>(bin, v.py);
            appendLe<float>(bin, v.pz);
            pmn[0] = std::min(pmn[0], v.px); pmn[1] = std::min(pmn[1], v.py); pmn[2] = std::min(pmn[2], v.pz);
            pmx[0] = std::max(pmx[0], v.px); pmx[1] = std::max(pmx[1], v.py); pmx[2] = std::max(pmx[2], v.pz);
        }
        const std::size_t posSize = bin.size() - posOffset;
        padTo4(bin, 0);

        const int posView = static_cast<int>(bufferViews.size());
        bufferViews.push_back({
            {"buffer", 0},
            {"byteOffset", posOffset},
            {"byteLength", posSize},
            {"target", 34962},
        });
        const int posAccessor = static_cast<int>(accessors.size());
        accessors.push_back({
            {"bufferView", posView},
            {"componentType", 5126},            // FLOAT
            {"count", m.vertices.size()},
            {"type", "VEC3"},
            {"min", {pmn[0], pmn[1], pmn[2]}},
            {"max", {pmx[0], pmx[1], pmx[2]}},
        });

        int nrmAccessor = -1;
        if (hasNormals)
        {
            const std::size_t off = bin.size();
            for (const auto& v : m.vertices)
            {
                // Normalize to unit length; fall back to +Y if degenerate.
                float nx = v.nx, ny = v.ny, nz = v.nz;
                float len = std::sqrt(nx*nx + ny*ny + nz*nz);
                if (len < 1e-8f) { nx = 0; ny = 1; nz = 0; }
                else { nx /= len; ny /= len; nz /= len; }
                appendLe<float>(bin, nx);
                appendLe<float>(bin, ny);
                appendLe<float>(bin, nz);
            }
            const std::size_t sz = bin.size() - off;
            padTo4(bin, 0);
            const int view = static_cast<int>(bufferViews.size());
            bufferViews.push_back({
                {"buffer", 0},
                {"byteOffset", off},
                {"byteLength", sz},
                {"target", 34962},
            });
            nrmAccessor = static_cast<int>(accessors.size());
            accessors.push_back({
                {"bufferView", view},
                {"componentType", 5126},
                {"count", m.vertices.size()},
                {"type", "VEC3"},
            });
        }

        int uvAccessor = -1;
        if (hasUv)
        {
            const std::size_t off = bin.size();
            for (const auto& v : m.vertices)
            {
                appendLe<float>(bin, v.u);
                // glTF convention is Y-down; Unity is Y-up for UV. Flip.
                appendLe<float>(bin, 1.0f - v.v);
            }
            const std::size_t sz = bin.size() - off;
            padTo4(bin, 0);
            const int view = static_cast<int>(bufferViews.size());
            bufferViews.push_back({
                {"buffer", 0},
                {"byteOffset", off},
                {"byteLength", sz},
                {"target", 34962},
            });
            uvAccessor = static_cast<int>(accessors.size());
            accessors.push_back({
                {"bufferView", view},
                {"componentType", 5126},
                {"count", m.vertices.size()},
                {"type", "VEC2"},
            });
        }

        // Per-submesh index bufferViews + primitives
        json primitives = json::array();
        for (const auto& sm : m.submeshes)
        {
            if (sm.indexCount == 0) continue;
            if (sm.topology != 0) continue;   // Skip non-triangle submeshes (lines / points)
            // GLB: emit indices as u32 for simplicity (component 5125)
            const std::size_t off = bin.size();
            const std::uint32_t start = sm.firstByte;
            const std::uint32_t end = start + sm.indexCount;
            if (end > m.indices.size()) continue;
            for (std::uint32_t i = start; i < end; ++i)
            {
                // Unity stores per-submesh indices relative to 0 (firstVertex/baseVertex
                // are already applied by the writer). We write raw.
                appendLe<std::uint32_t>(bin, m.indices[i]);
            }
            const std::size_t sz = bin.size() - off;
            padTo4(bin, 0);
            const int view = static_cast<int>(bufferViews.size());
            bufferViews.push_back({
                {"buffer", 0},
                {"byteOffset", off},
                {"byteLength", sz},
                {"target", 34963},
            });
            const int idxAccessor = static_cast<int>(accessors.size());
            accessors.push_back({
                {"bufferView", view},
                {"componentType", 5125},         // UNSIGNED_INT
                {"count", sm.indexCount},
                {"type", "SCALAR"},
            });

            json prim = {
                {"attributes", {{"POSITION", posAccessor}}},
                {"indices", idxAccessor},
                {"mode", 4},                     // TRIANGLES
            };
            if (nrmAccessor >= 0) prim["attributes"]["NORMAL"] = nrmAccessor;
            if (uvAccessor >= 0)  prim["attributes"]["TEXCOORD_0"] = uvAccessor;
            primitives.push_back(prim);
        }

        if (primitives.empty()) continue;

        json meshJson = {
            {"name", m.name.empty() ? fmt::format("Mesh_{}", mi) : m.name},
            {"primitives", primitives},
        };
        meshes.push_back(meshJson);

        const int nodeIndex = static_cast<int>(nodes.size());
        nodes.push_back({{"mesh", meshes.size() - 1}, {"name", meshJson["name"]}});
        sceneNodes.push_back(nodeIndex);

        summary.totalVertices += static_cast<int>(m.vertices.size());
    }

    if (meshes.empty())
    {
        return false;
    }

    root["scenes"].push_back({{"nodes", sceneNodes}});
    root["buffers"].push_back({{"byteLength", bin.size()}});

    // Serialize JSON and pad to 4 bytes with spaces.
    std::string jsonStr = root.dump();
    while (jsonStr.size() % 4 != 0) jsonStr.push_back(' ');

    // Pad BIN chunk to 4 bytes with 0x00.
    while (bin.size() % 4 != 0) bin.push_back(0);

    const std::uint32_t jsonLen = static_cast<std::uint32_t>(jsonStr.size());
    const std::uint32_t binLen = static_cast<std::uint32_t>(bin.size());
    const std::uint32_t totalLen = 12 + 8 + jsonLen + 8 + binLen;

    std::error_code ec;
    std::filesystem::create_directories(glbPath.parent_path(), ec);
    if (ec)
    {
        spdlog::error("UnityPreview: cannot create GLB parent '{}': {}", glbPath.parent_path().string(), ec.message());
        return false;
    }

    std::filesystem::path partPath = glbPath;
    partPath += L".part";
    std::filesystem::remove(partPath, ec);
    ec.clear();

    std::ofstream out(partPath, std::ios::binary | std::ios::trunc);
    if (!out)
    {
        spdlog::error("UnityPreview: cannot open '{}' for writing", partPath.string());
        return false;
    }

    auto writeU32 = [&](std::uint32_t v)
    {
        out.write(reinterpret_cast<const char*>(&v), 4);
    };

    writeU32(kGlbMagic);
    writeU32(kGlbVersion);
    writeU32(totalLen);
    writeU32(jsonLen);
    writeU32(kChunkJson);
    out.write(jsonStr.data(), jsonStr.size());
    writeU32(binLen);
    writeU32(kChunkBin);
    out.write(reinterpret_cast<const char*>(bin.data()), bin.size());
    out.flush();
    if (!out)
    {
        spdlog::error("UnityPreview: failed while writing '{}'", partPath.string());
        out.close();
        std::filesystem::remove(partPath, ec);
        return false;
    }
    out.close();

    std::filesystem::remove(glbPath, ec);
    ec.clear();
    std::filesystem::rename(partPath, glbPath, ec);
    if (ec)
    {
        spdlog::error("UnityPreview: failed to publish GLB '{}' -> '{}': {}",
            partPath.string(), glbPath.string(), ec.message());
        std::filesystem::remove(partPath, ec);
        return false;
    }

    summary.keptMeshes = static_cast<int>(meshes.size());
    return true;
}

// ─── Stream-data resolver (for Mesh.m_StreamData.path) ───────────────
// Resolves an `archive:/CAB-xxx/CAB-xxx.resS`-style path back to a
// node view inside the bundle.
std::pair<const std::uint8_t*, std::size_t>
resolveBundleStream(const UnityBundle& bundle, const std::string& rawPath)
{
    if (rawPath.empty()) return { nullptr, 0 };
    std::string p = rawPath;
    const std::string kArchivePrefix = "archive:/";
    if (p.rfind(kArchivePrefix, 0) == 0)
    {
        p = p.substr(kArchivePrefix.size());
    }
    // Strip directory prefix if present
    const auto slash = p.find_last_of('/');
    const std::string basename = (slash == std::string::npos) ? p : p.substr(slash + 1);

    for (const auto& node : bundle.nodes)
    {
        std::string nodeBase = node.path;
        const auto ns = nodeBase.find_last_of('/');
        if (ns != std::string::npos) nodeBase = nodeBase.substr(ns + 1);
        if (nodeBase == basename || node.path == p || node.path == rawPath)
        {
            return bundle.view(node);
        }
    }
    return { nullptr, 0 };
}

} // namespace

Result<PreviewExtractSummary> extractBundleToGlb(
    const std::filesystem::path& bundlePath,
    const std::filesystem::path& glbPath)
{
    PreviewExtractSummary summary{};

    auto bundleResult = parseUnityBundle(bundlePath);
    if (!isOk(bundleResult))
    {
        return error(bundleResult);
    }
    const UnityBundle& bundle = value(bundleResult);
    summary.unityRevision = bundle.unityRevision;

    // Parse every node that looks like a SerializedFile; collect meshes.
    std::vector<UnityMesh> meshes;
    meshes.reserve(16);

    StreamDataResolver resolver = [&](const std::string& p) {
        return resolveBundleStream(bundle, p);
    };

    for (const auto& node : bundle.nodes)
    {
        // SerializedFile header is at least ~20 bytes; anything smaller is
        // a pure resource stream (.resS / .resource) reachable via resolver.
        if (node.size < 20) continue;
        auto view = bundle.view(node);
        auto sfResult = parseSerializedFile(view.first, view.second);
        if (!isOk(sfResult))
        {
            continue;
        }
        const SerializedFile& sf = value(sfResult);

        auto meshObjs = sf.objectsOfClass(UnityClass::kMesh);
        for (const auto* obj : meshObjs)
        {
            auto payload = sf.objectPayload(*obj);
            auto meshResult = parseUnityMesh(
                payload.first, payload.second,
                sf.unityRevision.empty() ? bundle.unityRevision : sf.unityRevision,
                !sf.bigEndian,
                resolver);
            if (!isOk(meshResult))
            {
                spdlog::debug("UnityPreview: skipped mesh pathID={} size={} — {}: {}",
                    obj->pathID, obj->byteSize, error(meshResult).code, error(meshResult).message);
                continue;
            }
            meshes.push_back(std::move(std::get<UnityMesh>(meshResult)));
        }
    }

    summary.totalMeshes = static_cast<int>(meshes.size());

    if (meshes.empty())
    {
        return Error{"no_meshes",
                     fmt::format("No parseable Mesh objects in bundle '{}'",
                                 bundlePath.string())};
    }

    // Build metrics, apply filter
    std::vector<MeshMetrics> metrics;
    metrics.reserve(meshes.size());
    for (const auto& m : meshes) metrics.push_back(computeMetrics(m));
    auto picks = filterAdaptive(std::move(metrics));

    if (picks.empty())
    {
        return Error{"no_meshes",
                     fmt::format("Filter dropped all meshes from '{}'",
                                 bundlePath.string())};
    }

    for (const auto& pm : picks)
    {
        summary.totalTriangles += pm.triangleCount;
    }

    if (!writeGlb(picks, glbPath, summary))
    {
        return Error{"preview_failed",
                     fmt::format("Failed to write GLB to '{}'", glbPath.string())};
    }

    return summary;
}

} // namespace vrcsm::core
