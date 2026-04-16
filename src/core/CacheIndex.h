#pragma once

#include <atomic>
#include <filesystem>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <unordered_map>

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
//
// Thread safety: all public methods are safe to call from any thread.
// The background scan holds a mutex only when writing to the map, so
// concurrent lookups return immediately with whatever the index has
// built so far (graceful degradation, not blocking).
class CacheIndex
{
public:
    // Singleton — one index per process, shared across all IPC handlers.
    static CacheIndex& Instance();

    // Kick off the background scan for the given Cache-WindowsPlayer
    // directory. Idempotent — calling it twice with the same path is a
    // no-op. If the path changes (shouldn't happen in practice), the
    // old scan is abandoned and a new one starts.
    void StartScan(const std::filesystem::path& cacheWindowsPlayerDir);

    // O(1) lookup. Returns the bundle directory (the one containing
    // `__data`) for the given `avtr_*` id, or nullopt if not indexed
    // yet / not found.
    std::optional<std::filesystem::path> Lookup(const std::string& avatarId) const;

    // True once the background scan has completed at least once. Useful
    // for the frontend to show "indexing..." status.
    bool IsReady() const { return m_ready.load(); }

    // Number of entries indexed so far (grows during scan).
    std::size_t EntryCount() const;

    ~CacheIndex();

    CacheIndex(const CacheIndex&) = delete;
    CacheIndex& operator=(const CacheIndex&) = delete;

private:
    CacheIndex() = default;

    void ScanWorker(std::filesystem::path cwpDir);
    void LoadPersisted();
    void SavePersisted() const;
    static std::filesystem::path PersistPath();

    mutable std::mutex m_mutex;
    std::unordered_map<std::string, std::filesystem::path> m_index;
    std::filesystem::path m_cwpDir;
    std::atomic<bool> m_ready{false};
    std::atomic<bool> m_scanning{false};
    std::atomic<bool> m_stopping{false};
    std::thread m_worker;
};

} // namespace vrcsm::core
