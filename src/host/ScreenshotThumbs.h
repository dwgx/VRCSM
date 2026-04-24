#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace vrcsm::host::ScreenshotThumbs
{

// Root cache directory. Created lazily on first use.
// `%LocalAppData%\VRCSM\screenshot-thumbs\`
std::filesystem::path CacheDir();

// Deterministic cache filename for (source file, max-edge size). Changes
// when the source file's mtime/size changes, so stale thumbnails are
// never served. Does NOT create the file — call GenerateIfMissing to
// actually produce bytes on disk.
std::string CacheFileName(const std::filesystem::path& source, int maxEdge);

// Ensure a cached JPEG thumbnail exists for the source at `<=maxEdge>` px
// on its longest side. Returns the absolute cache path on success.
// Blocks on disk I/O + WIC decode/encode. Safe to call from worker
// threads (internally calls CoInitializeEx on first entry per thread).
// Returns empty path on failure — caller should fall back to placeholder.
std::filesystem::path GenerateIfMissing(
    const std::filesystem::path& source,
    int maxEdge);

// Enqueue a batch of sources for background thumbnail generation. Uses
// a small internal thread pool (2-4 workers). Non-blocking; deduplicates
// queued entries so calling this twice for the same list is harmless.
// Sources that already have a valid cached thumbnail are skipped without
// spawning work.
void EnqueueBatch(const std::vector<std::filesystem::path>& sources, int maxEdge);

} // namespace vrcsm::host::ScreenshotThumbs
