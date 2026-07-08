#include <gtest/gtest.h>

#include "core/LyricsProxy.h"

#include <array>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <string>

using vrcsm::core::IsBlockedProxyHost;
using vrcsm::core::LyricsFetch;

// The SSRF rail is a minimal safety net (NOT a domain allowlist): it refuses
// loopback / link-local / private-range literal hosts and allows every other
// host. These tests exercise IsBlockedProxyHost() without touching the network.

TEST(LyricsProxySsrf, BlocksLocalhostAndLoopback)
{
    EXPECT_TRUE(IsBlockedProxyHost("localhost"));
    EXPECT_TRUE(IsBlockedProxyHost("LOCALHOST"));
    EXPECT_TRUE(IsBlockedProxyHost("127.0.0.1"));
    EXPECT_TRUE(IsBlockedProxyHost("127.1.2.3"));
    EXPECT_TRUE(IsBlockedProxyHost("::1"));
    EXPECT_TRUE(IsBlockedProxyHost("[::1]"));
}

TEST(LyricsProxySsrf, BlocksPrivateRangeLiterals)
{
    EXPECT_TRUE(IsBlockedProxyHost("10.0.0.1"));
    EXPECT_TRUE(IsBlockedProxyHost("10.255.255.255"));
    EXPECT_TRUE(IsBlockedProxyHost("192.168.1.1"));
    EXPECT_TRUE(IsBlockedProxyHost("172.16.0.1"));
    EXPECT_TRUE(IsBlockedProxyHost("172.31.255.255"));
    EXPECT_TRUE(IsBlockedProxyHost("169.254.1.1"));
    EXPECT_TRUE(IsBlockedProxyHost("0.0.0.0"));
}

TEST(LyricsProxySsrf, AllowsPublicHostsAndPublicIps)
{
    EXPECT_FALSE(IsBlockedProxyHost("lrclib.net"));
    EXPECT_FALSE(IsBlockedProxyHost("music.163.com"));
    EXPECT_FALSE(IsBlockedProxyHost("example.com"));
    // 172.x outside 16-31 is a public range and must be allowed.
    EXPECT_FALSE(IsBlockedProxyHost("172.15.0.1"));
    EXPECT_FALSE(IsBlockedProxyHost("172.32.0.1"));
    // 8.8.8.8 is a public resolver, not private.
    EXPECT_FALSE(IsBlockedProxyHost("8.8.8.8"));
    // 192.169.x is not the 192.168/16 private block.
    EXPECT_FALSE(IsBlockedProxyHost("192.169.0.1"));
}

TEST(LyricsProxySsrf, BlocksEmptyHostAndMappedLoopback)
{
    EXPECT_TRUE(IsBlockedProxyHost(""));
    // IPv4-mapped IPv6 loopback re-checks the embedded IPv4 tail.
    EXPECT_TRUE(IsBlockedProxyHost("::ffff:127.0.0.1"));
    // IPv6 link-local prefix.
    EXPECT_TRUE(IsBlockedProxyHost("fe80::1"));
}

// ── Live network probe (opt-in) ─────────────────────────────────────────
//
// These exercise the real WinHTTP transport against the public NetEase
// endpoints — the exact code path the app's `lyrics.fetch` IPC uses. They
// are DISABLED by default (network-dependent, would make ctest flaky) and
// only run when VRCSM_LIVE_LYRICS_TEST is set in the environment. Use them
// to confirm the end-to-end NetEase reachability from this machine without
// launching the WebView2 GUI:
//
//   $env:VRCSM_LIVE_LYRICS_TEST=1
//   VRCSM_Tests.exe --gtest_also_run_disabled_tests \
//       --gtest_filter=LyricsProxyLive.*
//
namespace
{
bool LiveLyricsEnabled()
{
    // getenv_s avoids the CRT C4996 deprecation on the plain getenv under /W4.
    std::array<char, 8> buf{};
    std::size_t len = 0;
    if (getenv_s(&len, buf.data(), buf.size(), "VRCSM_LIVE_LYRICS_TEST") != 0)
    {
        return false;
    }
    return len > 0 && buf[0] != '\0' && buf[0] != '0';
}
} // namespace

TEST(LyricsProxyLive, DISABLED_NeteaseSearchReturnsSongs)
{
    if (!LiveLyricsEnabled())
    {
        GTEST_SKIP() << "set VRCSM_LIVE_LYRICS_TEST=1 to run live NetEase probe";
    }
    // Search for a well-known Chinese track (周杰伦 - 晴天).
    const std::string url =
        "https://music.163.com/api/search/get?s=%E6%99%B4%E5%A4%A9%20%E5%91%A8%E6%9D%B0%E4%BC%A6"
        "&type=1&limit=5";
    const auto res = LyricsFetch(url, "https://music.163.com");
    ASSERT_TRUE(res.error.empty()) << "transport error: " << res.error;
    EXPECT_GE(res.status, 200);
    EXPECT_LT(res.status, 300);
    // The search payload must carry a songs array with our track id space.
    EXPECT_NE(res.body.find("\"songs\""), std::string::npos)
        << "NetEase search body (first 400 chars): " << res.body.substr(0, 400);
    EXPECT_NE(res.body.find("\"id\""), std::string::npos);
}

TEST(LyricsProxyLive, DISABLED_NeteaseLyricReturnsChineseLrc)
{
    if (!LiveLyricsEnabled())
    {
        GTEST_SKIP() << "set VRCSM_LIVE_LYRICS_TEST=1 to run live NetEase probe";
    }
    // 周杰伦 - 晴天, NetEase song id 186016. Fetch the lyric endpoint with the
    // same lv/kv/tv params the web chain (fromNetease) uses.
    const std::string url =
        "https://music.163.com/api/song/lyric?id=186016&lv=1&kv=1&tv=-1";
    const auto res = LyricsFetch(url, "https://music.163.com");
    ASSERT_TRUE(res.error.empty()) << "transport error: " << res.error;
    EXPECT_GE(res.status, 200);
    EXPECT_LT(res.status, 300);
    // Must carry the lrc.lyric field and at least one LRC timestamp tag.
    EXPECT_NE(res.body.find("\"lrc\""), std::string::npos)
        << "NetEase lyric body (first 400 chars): " << res.body.substr(0, 400);
    EXPECT_NE(res.body.find("["), std::string::npos);
    // NetEase returns raw UTF-8 (not \u-escaped) Chinese lyric text. Confirm
    // multi-byte UTF-8 (high-bit bytes) survived the transport intact — the
    // in-app path relies on this: parseLrc runs on the JSON.parse'd string.
    bool hasMultibyteUtf8 = false;
    for (unsigned char ch : res.body)
    {
        if (ch >= 0x80)
        {
            hasMultibyteUtf8 = true;
            break;
        }
    }
    EXPECT_TRUE(hasMultibyteUtf8) << "expected raw UTF-8 CJK lyric content in body";
    // Informational: emit a snippet so a human can eyeball the payload.
    std::printf("[live] NetEase lyric body (first 300 chars):\n%s\n",
                res.body.substr(0, 300).c_str());
}
