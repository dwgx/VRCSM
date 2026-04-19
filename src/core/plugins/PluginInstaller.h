#pragma once

// PluginInstaller — accepts a .vrcsmplugin archive (zip) and installs
// it under %LocalAppData%/VRCSM/plugins/<id>/ atomically.
//
// The install flow enforces the minimum security checks the plan
// committed to:
//   1. Validate archive looks like a zip (magic bytes).
//   2. Optionally verify SHA-256 if the feed entry provides a digest.
//   3. Extract into a fresh temp dir inside PluginsRoot — never into
//      a user-writable system path — using Windows `tar.exe -xf`,
//      which is the only built-in zip reader available on every
//      supported host. tar rejects absolute paths and .. segments
//      by default, but we re-verify every extracted entry below.
//   4. Walk the extracted tree and reject any symlink/junction
//      plus any canonical path that is not a descendant of the
//      temp dir (defence in depth vs. zip-slip).
//   5. Parse manifest.json; fail if invalid or if the declared id
//      is not a safe directory name.
//   6. Compare hostMin against VRCSM_VERSION_STRING.
//   7. Atomic swap: remove-all on final dir (if any) then rename
//      temp dir into place. Register with the PluginStore.
//
// The install never touches anything outside PluginsRoot or
// PluginDataRoot. On failure every partial file under the temp dir
// is removed.

#include "PluginManifest.h"

#include "../Common.h"

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace vrcsm::core::plugins
{

struct InstallOptions
{
    std::optional<std::string> expectedSha256;  // lowercase hex; empty → no digest check
    bool overwrite{true};  // if false, fail when plugin id already installed
};

struct InstallReport
{
    std::string id;
    SemVer version;
    std::string installDir;
};

// Install from a local .vrcsmplugin file (already on disk). Used by
// the bridge for both user-picked files and files we just downloaded
// into a temp location.
Result<InstallReport> InstallFromFile(const std::filesystem::path& archive,
                                      const InstallOptions& opts);

// Install from a raw byte buffer — convenience wrapper for tests and
// for the install-from-URL path (download to memory → pass bytes).
// Writes bytes to a temp file then delegates to InstallFromFile.
Result<InstallReport> InstallFromBytes(std::vector<std::byte> bytes,
                                       const InstallOptions& opts);

// Compute SHA-256 over a file. Used by the installer and exposed so
// tests can pre-compute expected digests. Returns lowercase hex.
std::string Sha256Hex(const std::filesystem::path& file);

} // namespace vrcsm::core::plugins
