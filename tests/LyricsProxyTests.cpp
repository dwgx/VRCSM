#include <gtest/gtest.h>

#include "core/LyricsProxy.h"

using vrcsm::core::IsBlockedProxyHost;

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
