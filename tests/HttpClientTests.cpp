#include <gtest/gtest.h>

#include "core/HttpClient.h"

#include <nlohmann/json.hpp>

#include <array>
#include <cstddef>
#include <cstdio>
#include <string>

using vrcsm::core::http::CrackedUrl;
using vrcsm::core::http::crackUrl;
using vrcsm::core::http::HttpResponse;

// ── crackUrl (pure) ─────────────────────────────────────────────────────
//
// crackUrl() had no unit coverage while it lived inside VrcApi.cpp's
// anonymous namespace. Now that the transport is extracted, lock its
// parsing contract: host/path/query split, port defaulting, scheme flag,
// and empty-path normalization.

TEST(HttpClientCrackUrl, ParsesHttpsHostPathQuery)
{
    const auto c = crackUrl("https://api.vrchat.cloud/api/1/users/usr_x?apiKey=abc");
    ASSERT_TRUE(c.has_value());
    EXPECT_EQ(c->host, L"api.vrchat.cloud");
    EXPECT_EQ(c->pathAndQuery, L"/api/1/users/usr_x?apiKey=abc");
    EXPECT_TRUE(c->https);
    EXPECT_EQ(c->port, 443);
}

TEST(HttpClientCrackUrl, EmptyPathNormalizedToSlash)
{
    const auto c = crackUrl("https://example.com");
    ASSERT_TRUE(c.has_value());
    EXPECT_EQ(c->host, L"example.com");
    EXPECT_EQ(c->pathAndQuery, L"/");
    EXPECT_TRUE(c->https);
}

TEST(HttpClientCrackUrl, ParsesHttpSchemeAndExplicitPort)
{
    const auto c = crackUrl("http://example.com:8080/path");
    ASSERT_TRUE(c.has_value());
    EXPECT_EQ(c->host, L"example.com");
    EXPECT_EQ(c->pathAndQuery, L"/path");
    EXPECT_FALSE(c->https);
    EXPECT_EQ(c->port, 8080);
}

TEST(HttpClientCrackUrl, RejectsGarbageInput)
{
    EXPECT_FALSE(crackUrl("not a url").has_value());
    EXPECT_FALSE(crackUrl("").has_value());
}

// ── Live network probe (opt-in) ─────────────────────────────────────────
//
// Exercises the real WinHTTP transport against the public VRChat API — the
// exact code path VrcApi's anonymous/thumbnail calls take after the
// extraction. DISABLED by default (network-dependent) and gated on
// VRCSM_LIVE_VRCAPI_TEST so normal ctest stays offline-safe:
//
//   $env:VRCSM_LIVE_VRCAPI_TEST=1
//   VRCSM_Tests.exe --gtest_also_run_disabled_tests \
//       --gtest_filter=HttpClientLive.*
//
namespace
{
bool LiveVrcApiEnabled()
{
    std::array<char, 8> buf{};
    std::size_t len = 0;
    if (getenv_s(&len, buf.data(), buf.size(), "VRCSM_LIVE_VRCAPI_TEST") != 0)
    {
        return false;
    }
    return len > 0 && buf[0] != '\0' && buf[0] != '0';
}
} // namespace

TEST(HttpClientLive, DISABLED_VrcApiConfigReturns200)
{
    if (!LiveVrcApiEnabled())
    {
        GTEST_SKIP() << "set VRCSM_LIVE_VRCAPI_TEST=1 to run live VRChat API probe";
    }
    // /api/1/config is the canonical anonymous, no-auth endpoint. A 200 with
    // a JSON body proves the extracted transport reaches api.vrchat.cloud with
    // its UA intact (the endpoint 403s a missing User-Agent).
    const auto res = vrcsm::core::http::get(L"api.vrchat.cloud", L"/api/1/config");
    ASSERT_FALSE(res.error.has_value()) << "transport error: " << *res.error;
    EXPECT_EQ(res.status, 200);
    // A well-formed JSON object body proves the extracted transport reached
    // the API with its UA intact (the endpoint 403s a missing User-Agent) and
    // drained the full response. Don't assert on a specific config field —
    // VRChat's config schema drifts; the transport contract is what we lock.
    ASSERT_FALSE(res.body.empty());
    EXPECT_EQ(res.body.front(), '{');
    EXPECT_NO_THROW((void)nlohmann::json::parse(res.body));
    std::printf("[live] VRChat /api/1/config status=%ld bytes=%zu\n",
                res.status, res.body.size());
}
