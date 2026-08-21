#pragma once

#include "BundleSniff.h"

#include <atomic>
#include <filesystem>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

namespace vrcsm::core
{

// Persistent, background-built index of Cache-WindowsPlayer entries.
//
// The old `findBundleForAvatar` brute-forced through __info files with
// a 2000-file hard cap, meaning heavy VRChat users (50GB+ caches,
// 10000+ entries) would never find bundles stored deep in the cache.
//
// CacheIndex solves this by:
//   1. Scanning ALL entries on a background thread at startup.
//   2. Persisting the index to `%LocalAppData%\VRCSM\cache-index.json`
//      so subsequent launches start with a warm index.
//   3. Detecting stale entries by comparing the root directory's mtime.
//   4. Providing O(1) avatar-id → bundle-path lookups via `Lookup()`.
//   5. Remembering top-level hash dirs from the same walk so Report /
//      Bundles can list them without a second Cache-WindowsPlayer scan.
//
// Thread safety: all public methods are safe to call from any thread.
// The background scan holds a mutex only when writing to the map, so
// concurrent lookups return immediately with whatever the index has
// built so far (graceful degradation, not blocking).
class CacheIndex
{
public:
    // Public so tests can scan a temp tree without the process singleton
    // (and without writing the live `%LocalAppData%\VRCSM\cache-index.json`).
    CacheIndex() = default;

    // Singleton — one index per process, shared across all IPC handlers.
    static CacheIndex& Instance();

    // Kick off the background scan for the given Cache-WindowsPlayer
    // directory. Idempotent — calling it twice with the same path is a
    // no-op. If the path changes (shouldn't happen in practice), the
    // old scan is abandoned and a new one starts.
    void StartScan(const std::filesystem::path& cacheWindowsPlayerDir);

    // Tests only: override persist destination. An empty path disables
    // load/save so unit tests never touch the live cache-index.json.
    void SetPersistPathForTest(const std::filesystem::path& path);

    // O(1) lookup. Returns the bundle directory (the one containing
    // `__data`) for the given `avtr_*` id, or nullopt if not indexed
    // yet / not found.
    std::optional<std::filesystem::path> Lookup(const std::string& avatarId) const;

    // Top-level hash-dir rows collected during the same scan as Lookup,
    // sorted by bytes descending. Empty until a scan has produced rows
    // (or persist loaded a `bundles` array). Does not walk the disk.
    std::vector<BundleEntry> ListBundles() const;

    // When ready for `cwpDir` and the bundle list is non-empty, returns
    // that list. Otherwise nullopt — callers should fall back to
    // BundleSniff::scanCacheWindowsPlayer (first report before the
    // index finishes, or a different cache root).
    std::optional<std::vector<BundleEntry>> TryListBundlesFor(
        const std::filesystem::path& cwpDir) const;

    std::filesystem::path CacheDir() const;

    // True once the background scan has completed at least once. Useful
    // for the frontend to show "indexing..." status.
    bool IsReady() const { return m_ready.load(); }

    bool IsScanning() const { return m_scanning.load(); }

    // Number of avtr_* entries indexed so far (grows during scan).
    std::size_t EntryCount() const;

    ~CacheIndex();

    CacheIndex(const CacheIndex&) = delete;
    CacheIndex& operator=(const CacheIndex&) = delete;

private:
    void ScanWorker(std::filesystem::path cwpDir);
    void LoadPersisted();
    void SavePersisted() const;
    static std::filesystem::path PersistPath();
    std::filesystem::path EffectivePersistPathUnlocked() const;

    mutable std::mutex m_mutex;
    std::unordered_map<std::string, std::filesystem::path> m_index;
    std::vector<BundleEntry> m_bundles;
    std::filesystem::path m_cwpDir;
    std::filesystem::path m_persistOverride;
    bool m_persistOverrideSet{false};
    std::atomic<bool> m_ready{false};
    std::atomic<bool> m_scanning{false};
    std::atomic<bool> m_stopping{false};
    std::thread m_worker;
};

} // namespace vrcsm::core
