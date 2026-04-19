#include "PluginInstaller.h"

#include "PluginStore.h"

#include <spdlog/spdlog.h>

#include <Windows.h>
#include <wincrypt.h>

#include <array>
#include <fstream>
#include <random>
#include <system_error>

#pragma comment(lib, "Advapi32.lib")

namespace vrcsm::core::plugins
{

namespace
{

// Host version known at compile time — set from CMakeLists.txt via
// VRCSM_VERSION_STRING. Fall back to "0.0.0" so the unit test binary
// (which does not receive the define) can still link.
#ifndef VRCSM_VERSION_STRING
#define VRCSM_VERSION_STRING "0.0.0"
#endif

const SemVer& HostVersion()
{
    static const SemVer v = [] {
        auto parsed = SemVer::parse(VRCSM_VERSION_STRING);
        return parsed.value_or(SemVer{});
    }();
    return v;
}

bool LooksLikeZip(const std::filesystem::path& p)
{
    std::ifstream in(p, std::ios::binary);
    if (!in) return false;
    char magic[4]{};
    in.read(magic, 4);
    if (in.gcount() != 4) return false;
    // Zip local file header: PK\003\004
    return magic[0] == 'P' && magic[1] == 'K' && magic[2] == 3 && magic[3] == 4;
}

std::filesystem::path MakeStagingDir()
{
    std::random_device rd;
    std::mt19937_64 gen(rd());
    const auto stamp = fmt::format("staging-{:016x}", gen());
    const auto staging = PluginStore::PluginsRoot() / toWide(stamp);
    std::error_code ec;
    std::filesystem::create_directories(staging, ec);
    return staging;
}

Error Bad(std::string_view code, std::string_view message)
{
    return Error{std::string(code), std::string(message), 0};
}

bool RunTarExtract(const std::filesystem::path& archive, const std::filesystem::path& dest)
{
    // Windows 10 1803+ ships tar.exe in System32. It handles .zip
    // transparently. The -P flag is NOT passed, so tar strips any
    // leading / or drive letter AND refuses entries with "../" — we
    // still re-verify below but this is the first line of defence.
    std::wstring cmd = L"tar.exe -x -f \"";
    cmd += archive.wstring();
    cmd += L"\" -C \"";
    cmd += dest.wstring();
    cmd += L"\"";

    STARTUPINFOW si{};
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;
    PROCESS_INFORMATION pi{};

    std::wstring cmdCopy = cmd;
    if (!CreateProcessW(nullptr, cmdCopy.data(), nullptr, nullptr, FALSE,
                        CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi))
    {
        spdlog::warn("[plugins] tar CreateProcess failed: {}", GetLastError());
        return false;
    }
    WaitForSingleObject(pi.hProcess, 120000);  // 2 min cap for extraction
    DWORD exitCode = 1;
    GetExitCodeProcess(pi.hProcess, &exitCode);
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    return exitCode == 0;
}

// Verify that every file or directory under root is
//   (a) NOT a symbolic link or reparse point / junction, and
//   (b) canonically resolves to a path under root.
// Defence in depth — tar.exe already refuses "../" but we re-verify
// because a future archive format change must not silently widen the
// attack surface.
std::optional<Error> VerifyNoEscape(const std::filesystem::path& root)
{
    std::error_code ec;
    const auto canonicalRoot = std::filesystem::weakly_canonical(root, ec);
    if (ec) return Bad("install_io", fmt::format("canonicalise root failed: {}", ec.message()));

    for (const auto& entry : std::filesystem::recursive_directory_iterator(root,
             std::filesystem::directory_options::skip_permission_denied, ec))
    {
        if (ec) return Bad("install_io", fmt::format("walk failed: {}", ec.message()));

        if (entry.is_symlink(ec))
        {
            return Bad("install_symlink",
                       fmt::format("archive contains symlink which is not allowed: {}",
                                   toUtf8(entry.path().wstring())));
        }

        const auto canonical = std::filesystem::weakly_canonical(entry.path(), ec);
        if (ec) return Bad("install_io", fmt::format("canonicalise entry failed: {}", ec.message()));

        // Prefix check: canonical must have canonicalRoot as an ancestor.
        auto r = canonical.begin();
        auto s = canonicalRoot.begin();
        bool ok = true;
        for (; s != canonicalRoot.end(); ++s, ++r)
        {
            if (r == canonical.end() || *r != *s) { ok = false; break; }
        }
        if (!ok)
        {
            return Bad("install_escape",
                       fmt::format("archive entry escapes plugin dir: {}",
                                   toUtf8(canonical.wstring())));
        }
    }
    return std::nullopt;
}

// Strip the single-top-level-directory wrapper that some archivers add
// (e.g. "hello-1.0.0/manifest.json" → "manifest.json"). If there is
// exactly one subdirectory in root and no loose files, move its
// contents up one level.
void FlattenSingleTopDir(const std::filesystem::path& root)
{
    std::error_code ec;
    std::vector<std::filesystem::directory_entry> entries;
    for (const auto& e : std::filesystem::directory_iterator(root, ec)) entries.push_back(e);
    if (entries.size() != 1 || !entries[0].is_directory()) return;

    const auto wrap = entries[0].path();
    // Check manifest.json does not already sit at root — if the single
    // subdir happens to legitimately be an asset folder, don't flatten.
    if (std::filesystem::exists(root / L"manifest.json", ec)) return;
    if (!std::filesystem::exists(wrap / L"manifest.json", ec)) return;

    for (const auto& child : std::filesystem::directory_iterator(wrap, ec))
    {
        const auto dest = root / child.path().filename();
        std::filesystem::rename(child.path(), dest, ec);
    }
    std::filesystem::remove_all(wrap, ec);
}

void WipeDirSafe(const std::filesystem::path& p)
{
    std::error_code ec;
    std::filesystem::remove_all(p, ec);
}

} // namespace

// ── Sha256 ──────────────────────────────────────────────────────────

std::string Sha256Hex(const std::filesystem::path& file)
{
    HCRYPTPROV prov = 0;
    HCRYPTHASH hash = 0;
    if (!CryptAcquireContextW(&prov, nullptr, nullptr, PROV_RSA_AES, CRYPT_VERIFYCONTEXT))
    {
        return {};
    }
    if (!CryptCreateHash(prov, CALG_SHA_256, 0, 0, &hash))
    {
        CryptReleaseContext(prov, 0);
        return {};
    }

    std::ifstream in(file, std::ios::binary);
    if (!in)
    {
        CryptDestroyHash(hash);
        CryptReleaseContext(prov, 0);
        return {};
    }

    std::array<char, 64 * 1024> buf{};
    while (in)
    {
        in.read(buf.data(), buf.size());
        const auto got = static_cast<DWORD>(in.gcount());
        if (got == 0) break;
        if (!CryptHashData(hash, reinterpret_cast<const BYTE*>(buf.data()), got, 0))
        {
            CryptDestroyHash(hash);
            CryptReleaseContext(prov, 0);
            return {};
        }
    }

    BYTE digest[32]{};
    DWORD digestSize = sizeof(digest);
    if (!CryptGetHashParam(hash, HP_HASHVAL, digest, &digestSize, 0))
    {
        CryptDestroyHash(hash);
        CryptReleaseContext(prov, 0);
        return {};
    }
    CryptDestroyHash(hash);
    CryptReleaseContext(prov, 0);

    std::string out;
    out.reserve(64);
    static const char* kHex = "0123456789abcdef";
    for (BYTE b : digest)
    {
        out.push_back(kHex[(b >> 4) & 0xF]);
        out.push_back(kHex[b & 0xF]);
    }
    return out;
}

// ── InstallFromBytes ────────────────────────────────────────────────

Result<InstallReport> InstallFromBytes(std::vector<std::byte> bytes, const InstallOptions& opts)
{
    if (bytes.size() < 4)
    {
        return Bad("install_invalid", "archive payload is empty");
    }

    std::random_device rd;
    std::mt19937_64 gen(rd());
    const auto tmpPath = getWritableTempDirectory() /
                         fmt::format("vrcsm-plugin-{:016x}.zip", gen());
    {
        std::ofstream out(tmpPath, std::ios::binary | std::ios::trunc);
        if (!out) return Bad("install_io", "could not write payload to temp");
        out.write(reinterpret_cast<const char*>(bytes.data()),
                  static_cast<std::streamsize>(bytes.size()));
        out.flush();
        if (!out) return Bad("install_io", "write payload failed");
    }

    auto r = InstallFromFile(tmpPath, opts);
    std::error_code ec;
    std::filesystem::remove(tmpPath, ec);
    return r;
}

// ── InstallFromFile ─────────────────────────────────────────────────

Result<InstallReport> InstallFromFile(const std::filesystem::path& archive,
                                      const InstallOptions& opts)
{
    std::error_code ec;
    if (!std::filesystem::is_regular_file(archive, ec))
    {
        return Bad("install_invalid", "archive path does not exist");
    }

    if (!LooksLikeZip(archive))
    {
        return Bad("install_invalid", "archive is not a valid zip");
    }

    if (opts.expectedSha256.has_value() && !opts.expectedSha256->empty())
    {
        const auto got = Sha256Hex(archive);
        if (got.empty())
        {
            return Bad("install_io", "SHA-256 computation failed");
        }
        if (got != *opts.expectedSha256)
        {
            return Bad("install_checksum",
                       fmt::format("SHA-256 mismatch: expected {} got {}",
                                   *opts.expectedSha256, got));
        }
    }

    // 1. Extract into a staging dir under PluginsRoot.
    const auto staging = MakeStagingDir();
    if (!RunTarExtract(archive, staging))
    {
        WipeDirSafe(staging);
        return Bad("install_extract", "tar extraction failed");
    }

    // 2. Flatten single-dir wrapper if present.
    FlattenSingleTopDir(staging);

    // 3. Verify no zip-slip.
    if (auto err = VerifyNoEscape(staging))
    {
        WipeDirSafe(staging);
        return *err;
    }

    // 4. Parse manifest.
    const auto manifestPath = staging / L"manifest.json";
    if (!std::filesystem::is_regular_file(manifestPath, ec))
    {
        WipeDirSafe(staging);
        return Bad("install_no_manifest", "archive has no manifest.json at root");
    }
    nlohmann::json doc;
    {
        std::ifstream in(manifestPath, std::ios::binary);
        if (!in) { WipeDirSafe(staging); return Bad("install_io", "could not read manifest"); }
        try { doc = nlohmann::json::parse(in); }
        catch (...) { WipeDirSafe(staging); return Bad("manifest_invalid", "manifest.json parse failed"); }
    }

    auto parsed = ParsePluginManifest(doc);
    if (!isOk(parsed))
    {
        WipeDirSafe(staging);
        return std::get<Error>(std::move(parsed));
    }
    const auto manifest = std::get<PluginManifest>(std::move(parsed));

    // 5. Host version gate.
    if (HostVersion() < manifest.hostMin)
    {
        WipeDirSafe(staging);
        return Bad("install_host_mismatch",
                   fmt::format("plugin requires VRCSM >= {} (host is {})",
                               manifest.hostMin.toString(),
                               HostVersion().toString()));
    }

    // 6. Bail if already installed and overwrite=false.
    if (auto existing = GetPluginStore().Find(manifest.id); existing && !opts.overwrite)
    {
        WipeDirSafe(staging);
        return Bad("install_exists",
                   fmt::format("plugin {} already installed — pass overwrite=true to replace",
                               manifest.id));
    }

    // 7. Atomic swap.
    const auto finalDir = PluginStore::PluginsRoot() / toWide(manifest.id);
    if (std::filesystem::exists(finalDir, ec))
    {
        std::filesystem::remove_all(finalDir, ec);
    }
    std::filesystem::rename(staging, finalDir, ec);
    if (ec)
    {
        // Fallback: copy + remove
        std::filesystem::copy(staging, finalDir,
            std::filesystem::copy_options::recursive | std::filesystem::copy_options::overwrite_existing, ec);
        if (ec)
        {
            WipeDirSafe(staging);
            return Bad("install_io", fmt::format("final swap failed: {}", ec.message()));
        }
        WipeDirSafe(staging);
    }

    if (auto reg = GetPluginStore().RegisterInstalled(manifest, /*bundled=*/false); !isOk(reg))
    {
        return std::get<Error>(std::move(reg));
    }

    InstallReport report;
    report.id = manifest.id;
    report.version = manifest.version;
    report.installDir = toUtf8(finalDir.wstring());
    return report;
}

} // namespace vrcsm::core::plugins
