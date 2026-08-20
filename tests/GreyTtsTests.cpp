#include <gtest/gtest.h>

#include <chrono>
#include <filesystem>
#include <fstream>

#include "core/Common.h"
#include "core/GreyPrefs.h"
#include "core/SapiVoice.h"
#include "core/ToastNotifier.h"
#include "core/plugins/PluginRegistry.h"

using namespace std::chrono_literals;

TEST(GreyTtsTests, SapiSpeakFlagsPurgeBeforeSpeakAndAsync)
{
    const unsigned flags = vrcsm::core::SapiSpeakFlags();
    EXPECT_NE(flags & vrcsm::core::kSapiSpeakAsync, 0u);
    EXPECT_NE(flags & vrcsm::core::kSapiSpeakPurgeBeforeSpeak, 0u);
    EXPECT_NE(flags & vrcsm::core::kSapiSpeakIsNotXml, 0u);
}

TEST(GreyTtsTests, EmptyTextIsANoOp)
{
    EXPECT_FALSE(vrcsm::core::SapiShouldSpeak(""));
    EXPECT_FALSE(vrcsm::core::SapiShouldSpeak("   "));
    EXPECT_TRUE(vrcsm::core::SapiShouldSpeak("Nova is now online"));
}

TEST(GreyTtsTests, RateAndVolumeClamp)
{
    EXPECT_EQ(vrcsm::core::ClampSapiRate(99), 5);
    EXPECT_EQ(vrcsm::core::ClampSapiRate(-99), -5);
    EXPECT_EQ(vrcsm::core::ClampSapiRate(0), 0);
    EXPECT_EQ(vrcsm::core::ClampSapiVolume(-1), 0);
    EXPECT_EQ(vrcsm::core::ClampSapiVolume(250), 100);
    EXPECT_EQ(vrcsm::core::ClampSapiVolume(80), 80);
}

TEST(GreyTtsTests, PhraseUsesDisplayNameNeverUserId)
{
    const nlohmann::json content = {
        {"userId", "usr_abc"},
        {"user", {{"displayName", "Nova"}}},
    };
    const auto toast = vrcsm::core::FormatPipelineToast("friend-online", content);
    ASSERT_TRUE(toast.has_value());
    const std::string phrase = vrcsm::core::FormatTtsPhrase(*toast);
    EXPECT_EQ(phrase, "Nova is now online");
    EXPECT_EQ(phrase.find("usr_"), std::string::npos);
    EXPECT_EQ(phrase.find("usr_abc"), std::string::npos);
}

TEST(GreyTtsTests, RequestInviteFormatsLikeInvite)
{
    const nlohmann::json invite = {
        {"id", "not_1"},
        {"type", "requestInvite"},
        {"senderUsername", "Pix"},
        {"senderUserId", "usr_pix"},
    };
    const auto toast = vrcsm::core::FormatPipelineToast("notification", invite);
    ASSERT_TRUE(toast.has_value());
    EXPECT_EQ(toast->kind, vrcsm::core::ToastKind::Invite);
    const std::string phrase = vrcsm::core::FormatTtsPhrase(*toast);
    EXPECT_EQ(phrase, "Invite from Pix");
    EXPECT_EQ(phrase.find("usr_"), std::string::npos);
}

TEST(GreyTtsTests, FriendsScopeSkipsInvite)
{
    EXPECT_TRUE(vrcsm::core::ShouldSpeakKind(vrcsm::core::ToastKind::FriendOnline,
                                             vrcsm::core::TtsScope::Friends));
    EXPECT_FALSE(vrcsm::core::ShouldSpeakKind(vrcsm::core::ToastKind::Invite,
                                              vrcsm::core::TtsScope::Friends));
    EXPECT_TRUE(vrcsm::core::ShouldSpeakKind(vrcsm::core::ToastKind::Invite,
                                             vrcsm::core::TtsScope::All));
}

TEST(GreyTtsTests, ChatboxEchoSkippedWhenDisabledAndRateLimited)
{
    const auto now = std::chrono::steady_clock::now();
    EXPECT_FALSE(vrcsm::core::ChatboxEchoDue(false, {}, now));
    EXPECT_TRUE(vrcsm::core::ChatboxEchoDue(true, {}, now));
    EXPECT_FALSE(vrcsm::core::ChatboxEchoDue(true, now - 1s, now));
    EXPECT_TRUE(vrcsm::core::ChatboxEchoDue(true, now - 11s, now));
}

TEST(GreyTtsTests, Utf8TruncateDoesNotSplitCodepoint)
{
    // U+1F680 🚀 is four UTF-8 bytes. A naive byte slice(0, 3) would split it.
    const std::string rocket = "\xF0\x9F\x9A\x80 extra";
    const auto one = vrcsm::core::Utf8TruncateCodepoints(rocket, 1);
    EXPECT_EQ(one, "\xF0\x9F\x9A\x80");
    EXPECT_EQ(vrcsm::core::Utf8TruncateCodepoints("hello", 144), "hello");
}

TEST(GreyTtsTests, PickVoicePrefersIdThenLangPrefix)
{
    const std::vector<vrcsm::core::SapiVoiceInfo> voices = {
        {"zira", "Zira", "en-US"},
        {"huihui", "Huihui", "zh-CN"},
    };
    EXPECT_EQ(vrcsm::core::PickVoiceIdForLang(voices, "zh", ""), "huihui");
    EXPECT_EQ(vrcsm::core::PickVoiceIdForLang(voices, "en-GB", ""), "zira");
    EXPECT_EQ(vrcsm::core::PickVoiceIdForLang(voices, "ja", ""), "");
    EXPECT_EQ(vrcsm::core::PickVoiceIdForLang(voices, "zh", "zira"), "zira");
}

TEST(GreyTtsTests, GreyPrefsCorruptFileYieldsDefaults)
{
    const auto dir = vrcsm::core::getWritableTempDirectory() / L"vrcsm-grey-tts-test";
    std::error_code ec;
    std::filesystem::create_directories(dir, ec);
    const auto path = dir / L"grey-prefs.json";
    {
        std::ofstream out(path, std::ios::binary | std::ios::trunc);
        out << "{not-json";
    }
    const auto loaded = vrcsm::core::LoadGreyPrefsFrom(path);
    ASSERT_TRUE(vrcsm::core::isOk(loaded));
    const auto prefs = vrcsm::core::value(loaded);
    EXPECT_FALSE(prefs.greyEnabled);
    EXPECT_EQ(prefs.oscTts.engine, "sapi");
    EXPECT_TRUE(prefs.oscTts.voiceId.empty());
    EXPECT_EQ(prefs.oscTts.rate, 0);
    EXPECT_EQ(prefs.oscTts.volume, 80);
    EXPECT_FALSE(prefs.oscTts.chatbox);
    std::filesystem::remove_all(dir, ec);
}

TEST(GreyTtsTests, GreyPrefsUnknownKeyAndSecretsRejected)
{
    auto cur = vrcsm::core::DefaultGreyPrefs();
    auto badKey = vrcsm::core::MergeGreyPrefsPatch(cur, nlohmann::json{{"nope", true}});
    ASSERT_FALSE(vrcsm::core::isOk(badKey));
    EXPECT_EQ(vrcsm::core::error(badKey).code, "invalid_params");

    auto secret = vrcsm::core::MergeGreyPrefsPatch(
        cur, nlohmann::json{{"authOtpMail", {{"password", "x"}}}});
    ASSERT_FALSE(vrcsm::core::isOk(secret));
    EXPECT_EQ(vrcsm::core::error(secret).code, "invalid_params");

    auto ok = vrcsm::core::MergeGreyPrefsPatch(
        cur, nlohmann::json{{"oscTts", {{"chatbox", true}, {"rate", 99}}}});
    ASSERT_TRUE(vrcsm::core::isOk(ok));
    EXPECT_TRUE(vrcsm::core::value(ok).oscTts.chatbox);
    EXPECT_EQ(vrcsm::core::value(ok).oscTts.rate, 5);
}

TEST(GreyTtsTests, PluginCannotSpeakOrSetGreyPrefs)
{
    using vrcsm::core::plugins::PluginRegistry;
    auto read = PluginRegistry::CanPermissionsInvoke({"ipc:grey:read"}, "tts.status");
    EXPECT_TRUE(read.allowed);
    auto voices = PluginRegistry::CanPermissionsInvoke({"ipc:grey:read"}, "tts.voices");
    EXPECT_TRUE(voices.allowed);
    auto speak = PluginRegistry::CanPermissionsInvoke({"ipc:grey:read"}, "tts.speak");
    EXPECT_FALSE(speak.allowed);
    auto setVoice = PluginRegistry::CanPermissionsInvoke({"ipc:grey:read"}, "tts.setVoice");
    EXPECT_FALSE(setVoice.allowed);
    auto setPrefs = PluginRegistry::CanPermissionsInvoke({"ipc:grey:read"}, "grey.prefs.set");
    EXPECT_FALSE(setPrefs.allowed);
    auto api = PluginRegistry::CanPermissionsInvoke({"ipc:vrc:api"}, "tts.speak");
    EXPECT_FALSE(api.allowed);
}

TEST(GreyTtsTests, GreyPrefsRoundTripOscTts)
{
    const auto dir = vrcsm::core::getWritableTempDirectory() / L"vrcsm-grey-tts-roundtrip";
    std::error_code ec;
    std::filesystem::create_directories(dir, ec);
    const auto path = dir / L"grey-prefs.json";
    auto prefs = vrcsm::core::DefaultGreyPrefs();
    prefs.oscTts.voiceId = "token-zira";
    prefs.oscTts.rate = 2;
    prefs.oscTts.volume = 50;
    prefs.oscTts.chatbox = true;
    const auto saved = vrcsm::core::SaveGreyPrefsTo(path, prefs);
    ASSERT_TRUE(vrcsm::core::isOk(saved));
    const auto loaded = vrcsm::core::LoadGreyPrefsFrom(path);
    ASSERT_TRUE(vrcsm::core::isOk(loaded));
    EXPECT_EQ(vrcsm::core::value(loaded).oscTts.voiceId, "token-zira");
    EXPECT_EQ(vrcsm::core::value(loaded).oscTts.rate, 2);
    EXPECT_EQ(vrcsm::core::value(loaded).oscTts.volume, 50);
    EXPECT_TRUE(vrcsm::core::value(loaded).oscTts.chatbox);
    std::filesystem::remove_all(dir, ec);
}
