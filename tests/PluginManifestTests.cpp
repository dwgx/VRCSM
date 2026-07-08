#include <gtest/gtest.h>

#include "core/plugins/PluginFeed.h"
#include "core/plugins/PluginManifest.h"

using vrcsm::core::plugins::ParsePluginManifest;
using vrcsm::core::plugins::PluginFeed;
using vrcsm::core::plugins::PluginShape;
using vrcsm::core::plugins::MarketFeed;
using vrcsm::core::plugins::SanitizePluginId;
using vrcsm::core::plugins::SemVer;
using vrcsm::core::isOk;

namespace
{

nlohmann::json MinimalValid()
{
    return nlohmann::json{
        {"id", "dev.vrcsm.example"},
        {"name", "Example"},
        {"version", "1.0.0"},
        {"hostMin", "0.8.0"},
        {"shape", "panel"},
        {"entry", nlohmann::json{{"panel", "index.html"}}},
    };
}

} // namespace

TEST(SemVerTests, ParsesPlainTriple)
{
    auto v = SemVer::parse("1.2.3");
    ASSERT_TRUE(v.has_value());
    EXPECT_EQ(v->major, 1);
    EXPECT_EQ(v->minor, 2);
    EXPECT_EQ(v->patch, 3);
    EXPECT_TRUE(v->pre.empty());
}

TEST(SemVerTests, RejectsNonNumeric)
{
    EXPECT_FALSE(SemVer::parse("1.x.0").has_value());
    EXPECT_FALSE(SemVer::parse("abc").has_value());
    EXPECT_FALSE(SemVer::parse("").has_value());
}

TEST(SemVerTests, PrereleaseSortsBeforeRelease)
{
    auto pre = SemVer::parse("1.0.0-rc.1");
    auto release = SemVer::parse("1.0.0");
    ASSERT_TRUE(pre && release);
    EXPECT_TRUE(*pre < *release);
    EXPECT_FALSE(*release < *pre);
}

TEST(PluginManifestTests, AcceptsMinimalPanel)
{
    const auto doc = MinimalValid();
    auto r = ParsePluginManifest(doc);
    ASSERT_TRUE(isOk(r)) << "minimal valid manifest must parse";
    const auto& m = std::get<vrcsm::core::plugins::PluginManifest>(r);
    EXPECT_EQ(m.id, "dev.vrcsm.example");
    EXPECT_EQ(m.shape, PluginShape::Panel);
    EXPECT_EQ(m.entryPanel, "index.html");
}

TEST(PluginManifestTests, RejectsMissingId)
{
    auto doc = MinimalValid();
    doc.erase("id");
    EXPECT_FALSE(isOk(ParsePluginManifest(doc)));
}

TEST(PluginManifestTests, RejectsBadSemVer)
{
    auto doc = MinimalValid();
    doc["version"] = "not-a-version";
    EXPECT_FALSE(isOk(ParsePluginManifest(doc)));
}

TEST(PluginManifestTests, RejectsUnknownShape)
{
    auto doc = MinimalValid();
    doc["shape"] = "webview";
    EXPECT_FALSE(isOk(ParsePluginManifest(doc)));
}

TEST(PluginManifestTests, PanelRequiresPanelEntry)
{
    auto doc = MinimalValid();
    doc["entry"] = nlohmann::json::object();
    EXPECT_FALSE(isOk(ParsePluginManifest(doc)));
}

TEST(PluginManifestTests, ServiceRequiresServiceEntry)
{
    auto doc = MinimalValid();
    doc["shape"] = "service";
    doc["entry"] = nlohmann::json{{"service", "bin/svc.exe"}};
    auto r = ParsePluginManifest(doc);
    ASSERT_TRUE(isOk(r));
    EXPECT_EQ(std::get<vrcsm::core::plugins::PluginManifest>(r).shape,
              PluginShape::Service);
}

TEST(PluginManifestTests, ServiceRejectsMissingServiceEntry)
{
    auto doc = MinimalValid();
    doc["shape"] = "service";
    // Only a panel entry — but shape is service, so this must fail.
    EXPECT_FALSE(isOk(ParsePluginManifest(doc)));
}

TEST(PluginManifestTests, AppRequiresBothEntries)
{
    auto doc = MinimalValid();
    doc["shape"] = "app";
    doc["entry"] = nlohmann::json{{"panel", "index.html"}};
    EXPECT_FALSE(isOk(ParsePluginManifest(doc)));

    doc["entry"] = nlohmann::json{{"panel", "index.html"}, {"service", "bin/svc.exe"}};
    EXPECT_TRUE(isOk(ParsePluginManifest(doc)));
}

TEST(PluginManifestTests, PermissionsArrayParsed)
{
    auto doc = MinimalValid();
    doc["permissions"] = nlohmann::json::array({"ipc:vrc:cache", "ipc:vrc:scan"});
    auto r = ParsePluginManifest(doc);
    ASSERT_TRUE(isOk(r));
    const auto& m = std::get<vrcsm::core::plugins::PluginManifest>(r);
    ASSERT_EQ(m.permissions.size(), 2u);
    EXPECT_TRUE(m.hasPermission("ipc:vrc:cache"));
    EXPECT_FALSE(m.hasPermission("ipc:evil"));
}

TEST(PluginManifestTests, IconFieldIsOptional)
{
    auto doc = MinimalValid();
    doc.erase("icon");
    EXPECT_TRUE(isOk(ParsePluginManifest(doc)));
}

TEST(SanitizeTests, LowercasesAsciiAndDropsIllegalChars)
{
    EXPECT_EQ(SanitizePluginId("dev.vrcsm.Hello"), "dev.vrcsm.hello");
    // Slashes are dropped, consecutive dots are collapsed, and leading
    // separators are stripped — all three defences are relevant to the
    // directory-name contract enforced by PluginStore.
    EXPECT_EQ(SanitizePluginId("../evil/id"), "evilid");
    EXPECT_EQ(SanitizePluginId(".."), "");
    EXPECT_EQ(SanitizePluginId(""), "");
}

TEST(SanitizeTests, KeepsDotsDashesUnderscores)
{
    EXPECT_EQ(SanitizePluginId("a.b-c_d"), "a.b-c_d");
}

// ── Market feed permission surfacing ───────────────────────────────────
//
// Regression guard for the IPC contract-drift finding: the pre-install
// consent dialog was showing "none" because the feed entry carried no
// permissions. The feed parser must read the optional per-entry
// `permissions` array so the host can emit it to the market UI.

TEST(PluginFeedTests, ParsesEntryPermissions)
{
    const std::string text = R"({
        "version": 1,
        "generated": "2026-04-20T12:00:00Z",
        "plugins": [{
            "id": "dev.vrcsm.example",
            "name": "Example",
            "version": "1.0.0",
            "hostMin": "0.8.0",
            "shape": "panel",
            "download": "https://example.test/example.vrcsmplugin",
            "permissions": ["ipc:shell:openUrl", "ipc:fs:listDir"]
        }]
    })";
    auto r = PluginFeed::ParseFeed(text);
    ASSERT_TRUE(isOk(r));
    const auto& feed = std::get<MarketFeed>(r);
    ASSERT_EQ(feed.plugins.size(), 1u);
    ASSERT_EQ(feed.plugins[0].permissions.size(), 2u);
    EXPECT_EQ(feed.plugins[0].permissions[0], "ipc:shell:openUrl");
    EXPECT_EQ(feed.plugins[0].permissions[1], "ipc:fs:listDir");
}

TEST(PluginFeedTests, MissingPermissionsIsEmptyNotError)
{
    const std::string text = R"({
        "version": 1,
        "plugins": [{
            "id": "dev.vrcsm.example",
            "name": "Example",
            "version": "1.0.0",
            "hostMin": "0.8.0",
            "shape": "panel",
            "download": "https://example.test/example.vrcsmplugin"
        }]
    })";
    auto r = PluginFeed::ParseFeed(text);
    ASSERT_TRUE(isOk(r));
    const auto& feed = std::get<MarketFeed>(r);
    ASSERT_EQ(feed.plugins.size(), 1u);
    EXPECT_TRUE(feed.plugins[0].permissions.empty());
}

TEST(PluginFeedTests, IgnoresNonStringPermissionEntries)
{
    const std::string text = R"({
        "version": 1,
        "plugins": [{
            "id": "dev.vrcsm.example",
            "name": "Example",
            "version": "1.0.0",
            "hostMin": "0.8.0",
            "shape": "panel",
            "permissions": ["ipc:vrc:cache", 42, null, {"x": 1}]
        }]
    })";
    auto r = PluginFeed::ParseFeed(text);
    ASSERT_TRUE(isOk(r));
    const auto& feed = std::get<MarketFeed>(r);
    ASSERT_EQ(feed.plugins.size(), 1u);
    ASSERT_EQ(feed.plugins[0].permissions.size(), 1u);
    EXPECT_EQ(feed.plugins[0].permissions[0], "ipc:vrc:cache");
}
