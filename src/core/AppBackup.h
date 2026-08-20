#pragma once

#include "Common.h"

#include <cstdint>
#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace vrcsm::core
{

// App-data backup of `%LocalAppData%\VRCSM` db + settings only.
// Not a VRChat cache clone. Payload is a whitelist (sqlite snapshot,
// grey-prefs.json, plugin-state.json) copied into timestamped folders
// under `<appDataRoot>/backups/<id>/`. Oldest folders prune to keep-N.

struct AppBackupEntry
{
    std::string id;
    std::string createdAt;
    std::uint64_t bytes = 0;
    std::vector<std::string> files;
};

struct AppBackupCreateResult
{
    AppBackupEntry entry;
    int pruned = 0;
};

struct AppBackupRestoreOptions
{
    // Caller-supplied (CacheIndex::IsScanning). Core does not talk to
    // CacheIndex so unit tests can flip this without a live scan.
    bool midScan = false;
};

class AppBackup
{
public:
    static constexpr int kDefaultKeep = 3;
    static constexpr int kMaxKeep = 32;

    explicit AppBackup(std::filesystem::path appDataRoot);

    const std::filesystem::path& appDataRoot() const noexcept { return m_root; }
    std::filesystem::path backupsDir() const;

    Result<AppBackupCreateResult> Create(int keep = kDefaultKeep);
    Result<std::vector<AppBackupEntry>> List() const;
    Result<AppBackupEntry> Restore(const std::string& id,
                                   AppBackupRestoreOptions opts = {});

    // Keep the newest `keep` backup directories (lexicographic id order,
    // which matches the UTC timestamp id format). Exposed for tests.
    static Result<int> PruneKeepN(const std::filesystem::path& backupsDir, int keep);

    static bool IsBackupId(std::string_view id) noexcept;

private:
    std::filesystem::path m_root;
};

} // namespace vrcsm::core
