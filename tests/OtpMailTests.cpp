#include <gtest/gtest.h>

#include "core/GreyPrefs.h"
#include "core/ImapClient.h"
#include "core/OtpMailParser.h"
#include "core/OtpMailStore.h"
#include "core/plugins/PluginRegistry.h"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <string>

using vrcsm::core::GreyPrefs;
using vrcsm::core::GreyPrefsFromJson;
using vrcsm::core::GreyPrefsToJson;
using vrcsm::core::ImapOtpConfig;
using vrcsm::core::ImapHostResolvesToBlocked;
using vrcsm::core::IsBlockedImapHost;
using vrcsm::core::OtpMailHeaders;
using vrcsm::core::OtpMailStore;
using vrcsm::core::ParseOtpMail;
using vrcsm::core::ParseRfc822;
using vrcsm::core::ValidateImapEndpoint;
using vrcsm::core::isOk;
using vrcsm::core::plugins::PluginRegistry;

namespace
{

std::filesystem::path FixtureDir()
{
#ifdef VRCSM_SOURCE_DIR
    return std::filesystem::path(VRCSM_SOURCE_DIR) / "tests" / "fixtures" / "otp-mail";
#else
    auto p = std::filesystem::current_path();
    for (int i = 0; i < 6; ++i)
    {
        auto cand = p / "tests" / "fixtures" / "otp-mail";
        if (std::filesystem::exists(cand))
        {
            return cand;
        }
        p = p.parent_path();
    }
    return std::filesystem::path("tests") / "fixtures" / "otp-mail";
#endif
}

std::string ReadFixture(const std::string& name)
{
    std::ifstream in(FixtureDir() / name, std::ios::binary);
    EXPECT_TRUE(static_cast<bool>(in)) << name;
    return std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
}

std::chrono::system_clock::time_point FixedNow()
{
    // Matches fixture Date: 2026-08-20T12:00:00Z
    return std::chrono::sys_days{std::chrono::year{2026} / 8 / 20}
        + std::chrono::hours{12};
}

} // namespace

TEST(OtpMailParser, ValidVrchatFixture)
{
    const auto raw = ReadFixture("valid.eml.txt");
    const auto mail = ParseRfc822(raw);
    auto parsed = ParseOtpMail(mail, FixedNow());
    ASSERT_TRUE(parsed.has_value());
    EXPECT_EQ(parsed->code, "123456");
    EXPECT_EQ(parsed->fromHost, "vrchat.com");
}

TEST(OtpMailParser, RejectsWrongDomain)
{
    const auto mail = ParseRfc822(ReadFixture("wrong-domain.eml.txt"));
    EXPECT_FALSE(ParseOtpMail(mail, FixedNow()).has_value());
}

TEST(OtpMailParser, RejectsExpired)
{
    const auto mail = ParseRfc822(ReadFixture("expired.eml.txt"));
    EXPECT_FALSE(ParseOtpMail(mail, FixedNow()).has_value());
}

TEST(OtpMailParser, StripsHtmlAndFindsCode)
{
    const auto mail = ParseRfc822(ReadFixture("html-wrapper.eml.txt"));
    auto parsed = ParseOtpMail(mail, FixedNow());
    ASSERT_TRUE(parsed.has_value());
    EXPECT_EQ(parsed->code, "654321");
}

TEST(OtpMailParser, IgnoresYearLikeSixDigits)
{
    const auto mail = ParseRfc822(ReadFixture("year-digits.eml.txt"));
    EXPECT_FALSE(ParseOtpMail(mail, FixedNow()).has_value());
}

TEST(OtpMailParser, PrefersCodeHintOverLaterNumber)
{
    const auto mail = ParseRfc822(ReadFixture("two-codes.eml.txt"));
    auto parsed = ParseOtpMail(mail, FixedNow());
    ASSERT_TRUE(parsed.has_value());
    EXPECT_EQ(parsed->code, "111222");
}

TEST(ImapSsrf, BlocksLoopbackAndMetadata)
{
    EXPECT_TRUE(IsBlockedImapHost("127.0.0.1"));
    EXPECT_TRUE(IsBlockedImapHost("169.254.169.254"));
    EXPECT_TRUE(IsBlockedImapHost("localhost"));
    EXPECT_TRUE(IsBlockedImapHost("metadata.google.internal"));
    EXPECT_TRUE(IsBlockedImapHost("10.0.0.1"));
    EXPECT_FALSE(IsBlockedImapHost("imap.gmail.com"));
}

TEST(ImapSsrf, RejectsSchemeAndPopPort)
{
    auto scheme = ValidateImapEndpoint("http://imap.gmail.com", 993, "imaps");
    EXPECT_FALSE(isOk(scheme));
    EXPECT_EQ(vrcsm::core::error(scheme).code, "invalid_params");

    auto pop = ValidateImapEndpoint("imap.gmail.com", 995, "imaps");
    EXPECT_FALSE(isOk(pop));

    auto none = ValidateImapEndpoint("imap.gmail.com", 993, "none");
    EXPECT_FALSE(isOk(none));

    auto loop = ValidateImapEndpoint("127.0.0.1", 993, "imaps");
    ASSERT_FALSE(isOk(loop));
    EXPECT_EQ(vrcsm::core::error(loop).code, "imap_host_blocked");

    auto ok = ValidateImapEndpoint("imap.gmail.com", 993, "imaps");
    EXPECT_TRUE(isOk(ok));
}

TEST(ImapSsrf, ValidateBlocksLoopbackLinkLocalAndV6)
{
    auto loop = ValidateImapEndpoint("127.0.0.1", 993, "imaps");
    ASSERT_FALSE(isOk(loop));
    EXPECT_EQ(vrcsm::core::error(loop).code, "imap_host_blocked");

    auto local = ValidateImapEndpoint("localhost", 993, "imaps");
    ASSERT_FALSE(isOk(local));
    EXPECT_EQ(vrcsm::core::error(local).code, "imap_host_blocked");

    auto meta = ValidateImapEndpoint("169.254.169.254", 993, "imaps");
    ASSERT_FALSE(isOk(meta));
    EXPECT_EQ(vrcsm::core::error(meta).code, "imap_host_blocked");

    auto v6 = ValidateImapEndpoint("::1", 993, "imaps");
    ASSERT_FALSE(isOk(v6));
    EXPECT_EQ(vrcsm::core::error(v6).code, "imap_host_blocked");

    auto scheme = ValidateImapEndpoint("imaps://imap.gmail.com", 993, "imaps");
    ASSERT_FALSE(isOk(scheme));
    EXPECT_EQ(vrcsm::core::error(scheme).code, "invalid_params");
}

TEST(ImapSsrf, ConnectPresentationRailMatchesHostLiteralRail)
{
    // connectPlain inet_ntops each sockaddr and uses IsBlockedImapHost.
    // A private address after DNS rebinding must not be connected.
    EXPECT_TRUE(IsBlockedImapHost("127.0.0.1"));
    EXPECT_TRUE(IsBlockedImapHost("10.0.0.1"));
    EXPECT_TRUE(IsBlockedImapHost("192.168.1.1"));
    EXPECT_TRUE(IsBlockedImapHost("169.254.169.254"));
    EXPECT_TRUE(IsBlockedImapHost("::1"));
    EXPECT_FALSE(IsBlockedImapHost("8.8.8.8"));
}

TEST(ImapSsrf, DnsFailureIsFailClosed)
{
    EXPECT_TRUE(ImapHostResolvesToBlocked("127.0.0.1"));
    EXPECT_TRUE(ImapHostResolvesToBlocked("localhost"));
    EXPECT_TRUE(ImapHostResolvesToBlocked("::1"));
    EXPECT_TRUE(ImapHostResolvesToBlocked("169.254.169.254"));

    // Overlong label: getaddrinfo fails locally (no DNS / no IMAP connect).
    const std::string tooLong(300, 'x');
    EXPECT_TRUE(ImapHostResolvesToBlocked(tooLong));
    // Literal/port rail only — DNS is connectPlain's single lookup.
    auto unresolved = ValidateImapEndpoint(tooLong, 993, "imaps");
    ASSERT_TRUE(isOk(unresolved));

    // Numeric public literal: getaddrinfo is local, no IMAP connect.
    auto pub = ValidateImapEndpoint("8.8.8.8", 993, "imaps");
    EXPECT_TRUE(isOk(pub));
}

TEST(OtpMailStore, DpapiRoundTripAndNoPasswordInPrefs)
{
    const auto dir = std::filesystem::temp_directory_path() / "vrcsm-otp-store-test";
    std::error_code ec;
    std::filesystem::create_directories(dir, ec);
    const auto blob = dir / "imap-otp.dat";
    const auto prefsPath = dir / "grey-prefs.json";
    OtpMailStore::Instance().SetPathForTests(blob);
    vrcsm::core::GreyPrefsStore::Instance().SetPathForTests(prefsPath);

    ImapOtpConfig cfg;
    cfg.host = "imap.gmail.com";
    cfg.port = 993;
    cfg.tls = "imaps";
    cfg.username = "user@example.com";
    cfg.password = "app-password-not-vrc";
    ASSERT_TRUE(isOk(OtpMailStore::Instance().Save(cfg)));

    auto loaded = OtpMailStore::Instance().Load();
    ASSERT_TRUE(isOk(loaded));
    EXPECT_EQ(vrcsm::core::value(loaded).password, "app-password-not-vrc");
    EXPECT_EQ(vrcsm::core::value(loaded).host, "imap.gmail.com");

    GreyPrefs prefs;
    prefs.authOtpMail.host = cfg.host;
    prefs.authOtpMail.username = cfg.username;
    auto json = GreyPrefsToJson(prefs);
    EXPECT_FALSE(json["authOtpMail"].contains("password"));
    EXPECT_EQ(json["authOtpMail"]["submitOnce"], false);

    ASSERT_TRUE(isOk(OtpMailStore::Instance().Clear()));
    OtpMailStore::Instance().SetPathForTests({});
    vrcsm::core::GreyPrefsStore::Instance().SetPathForTests({});
    std::filesystem::remove_all(dir, ec);
}

TEST(OtpMailPrefs, SubmitOnceDoesNotSurviveLoad)
{
    nlohmann::json doc{
        {"schema", 1},
        {"greyEnabled", false},
        {"authOtpMail", {{"enabled", false}, {"submitOnce", true}}},
    };
    auto prefs = GreyPrefsFromJson(doc);
    EXPECT_FALSE(prefs.authOtpMail.submitOnce);
}

TEST(OtpMailPrefs, RejectsVrcPasswordKeyInPatch)
{
    const auto dir = std::filesystem::temp_directory_path() / "vrcsm-otp-patch-test";
    std::error_code ec;
    std::filesystem::create_directories(dir, ec);
    vrcsm::core::GreyPrefsStore::Instance().SetPathForTests(dir / "grey-prefs.json");
    auto bad = vrcsm::core::GreyPrefsStore::Instance().MergePatch(nlohmann::json{{"vrcPassword", "nope"}});
    ASSERT_FALSE(isOk(bad));
    EXPECT_EQ(vrcsm::core::error(bad).code, "invalid_params");
    vrcsm::core::GreyPrefsStore::Instance().SetPathForTests({});
    std::filesystem::remove_all(dir, ec);
}

TEST(GreyPluginSandbox, WritesAreNotGrantedByApiOrGreyRead)
{
    EXPECT_TRUE(PluginRegistry::CanPermissionsInvoke({"ipc:grey:read"}, "grey.prefs.get").allowed);
    EXPECT_TRUE(PluginRegistry::CanPermissionsInvoke({"ipc:grey:read"}, "eventWatch.list").allowed);
    EXPECT_FALSE(PluginRegistry::CanPermissionsInvoke({"ipc:grey:read"}, "grey.prefs.set").allowed);
    EXPECT_FALSE(PluginRegistry::CanPermissionsInvoke({"ipc:vrc:api"}, "otpMail.start").allowed);
    EXPECT_FALSE(PluginRegistry::CanPermissionsInvoke({"ipc:vrc:api"}, "inviteAssist.setEnabled").allowed);
    EXPECT_FALSE(PluginRegistry::CanPermissionsInvoke({"ipc:grey:read"}, "eventWatch.joinNow").allowed);
    EXPECT_FALSE(PluginRegistry::CanPermissionsInvoke({}, "otpMail.poll").allowed);
}
