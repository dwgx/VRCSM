#pragma once

// PluginFeed — resolves and caches the market feed served from
// `https://dwgx.github.io/VRCSM/plugins.json`. The feed is plain
// JSON with a `plugins` array of market entries:
//
//   {
//     "version": 1,
//     "generated": "2026-04-20T12:00:00Z",
//     "plugins": [{
//       "id": "dev.vrcsm.hello",
//       "name": "Hello Plugin",
//       "version": "1.0.0",
//       "hostMin": "0.8.0",
//       "shape": "panel",
//       "description": "…",
//       "homepage": "…",
//       "author": {"name": "…"},
//       "download": "https://.../hello.vrcsmplugin",
//       "sha256": "…"
//     }, …]
//   }
//
// A 5-minute cache on disk shields the remote host from chatty
// refreshes; UI passes `force=true` to bypass it.

#include "PluginManifest.h"

#include "../Common.h"

#include <chrono>
#include <filesystem>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace vrcsm::core::plugins
{

struct MarketEntry
{
    std::string id;
    std::string name;
    SemVer version;
    SemVer hostMin;
    PluginShape shape{PluginShape::Panel};
    std::string description;
    std::string homepage;
    std::string authorName;
    std::string authorUrl;
    std::string iconUrl;  // absolute URL to icon PNG
    std::string download; // absolute URL to .vrcsmplugin
    std::string sha256;   // lowercase hex
};

struct MarketFeed
{
    int version{1};
    std::string generated;  // ISO8601
    std::vector<MarketEntry> plugins;
};

class PluginFeed
{
public:
    static PluginFeed& Instance();

    // Fetch the feed, optionally bypassing the on-disk cache. Returns
    // cached data on transient network errors if the cache is younger
    // than 24h — the UI then shows a staleness badge.
    Result<MarketFeed> Fetch(bool force = false);

    // Official endpoint — overridable for tests.
    void SetFeedUrl(std::string url);
    std::string FeedUrl() const;

private:
    PluginFeed();

    Result<std::string> DownloadText(const std::string& url);
    Result<std::vector<std::byte>> DownloadBinary(const std::string& url);

    Result<MarketFeed> ParseFeed(const std::string& text);
    std::filesystem::path CacheFilePath() const;

    mutable std::mutex m_mutex;
    std::string m_feedUrl;

public:
    // Exposed so the installer can grab the bytes for a download URL
    // from the same WinHttp session. Public because it's a generic
    // utility, not just for the feed.
    Result<std::vector<std::byte>> DownloadArchive(const std::string& url);
};

} // namespace vrcsm::core::plugins
