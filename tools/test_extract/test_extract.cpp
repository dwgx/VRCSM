#include "core/UnityPreview.h"
#include "core/Common.h"

#include <chrono>
#include <cstdio>
#include <filesystem>
#include <string>

int main(int argc, char** argv)
{
    if (argc < 3)
    {
        std::fprintf(stderr, "usage: test_extract <bundle_in> <glb_out>\n");
        return 2;
    }

    std::filesystem::path bundle(argv[1]);
    std::filesystem::path glb(argv[2]);

    const auto start = std::chrono::steady_clock::now();
    auto outcome = vrcsm::core::extractBundleToGlb(bundle, glb);
    const auto elapsedMs =
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - start).count();

    if (!vrcsm::core::isOk(outcome))
    {
        const auto& err = vrcsm::core::error(outcome);
        std::fprintf(stderr,
            "FAIL (%lld ms) code=%s msg=%s\n",
            static_cast<long long>(elapsedMs),
            err.code.c_str(),
            err.message.c_str());
        return 1;
    }

    const auto& s = vrcsm::core::value(outcome);
    std::printf(
        "OK  (%lld ms) meshes=%d/%d verts=%d tris=%d unity=%s\n",
        static_cast<long long>(elapsedMs),
        s.keptMeshes,
        s.totalMeshes,
        s.totalVertices,
        s.totalTriangles,
        s.unityRevision.c_str());

    std::error_code ec;
    const auto glbSize = std::filesystem::file_size(glb, ec);
    std::printf("glb path=%s size=%lld bytes\n",
        glb.string().c_str(),
        static_cast<long long>(ec ? 0 : glbSize));
    return 0;
}
