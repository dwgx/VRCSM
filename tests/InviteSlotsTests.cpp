#include <gtest/gtest.h>

#include "core/GreyPrefs.h"
#include "core/InviteSlots.h"
#include "core/VrcApi.h"
#include "core/plugins/PluginRegistry.h"

#include <filesystem>
#include <fstream>
#include <string>

using vrcsm::core::DefaultGreyPrefs;
using vrcsm::core::error;
using vrcsm::core::GreyPrefsFromJson;
using vrcsm::core::GreyPrefsToJson;
using vrcsm::core::InviteSlotHttpError;
using vrcsm::core::isOk;
using vrcsm::core::IsLiveInviteSlotType;
using vrcsm::core::LoadGreyPrefsFrom;
using vrcsm::core::MergeGreyPrefsPatch;
using vrcsm::core::NormalizeInviteSlotMessages;
using vrcsm::core::OpenApiInviteSlotAlias;
using vrcsm::core::SaveGreyPrefsTo;
using vrcsm::core::Utf8CodePointCount;
using vrcsm::core::ValidateSavedMessageUpdate;
using vrcsm::core::VrcApi;
using vrcsm::core::plugins::PluginRegistry;

namespace
{

std::filesystem::path TempDir()
{
    auto dir = std::filesystem::temp_directory_path() / "vrcsm-inviteslots-tests";
    std::error_code ec;
    std::filesystem::create_directories(dir, ec);
    return dir;
}

std::string RepeatCodePoints(const std::string& unit, std::size_t n)
{
    std::string out;
    out.reserve(unit.size() * n);
    for (std::size_t i = 0; i < n; ++i) out += unit;
    return out;
}

} // namespace

TEST(InviteSlots, RejectsUnknownTypeEmptyAndOutOfRangeSlotBeforeNetwork)
{
    std::string trimmed;
    EXPECT_FALSE(isOk(ValidateSavedMessageUpdate("message", 0, "hello", &trimmed)));
    EXPECT_EQ(error(ValidateSavedMessageUpdate("message", 0, "hello", &trimmed)).code, "invalid_params");

    EXPECT_FALSE(isOk(ValidateSavedMessageUpdate("invite", -1, "hello", &trimmed)));
    EXPECT_FALSE(isOk(ValidateSavedMessageUpdate("invite", 12, "hello", &trimmed)));
    EXPECT_FALSE(isOk(ValidateSavedMessageUpdate("invite", 0, "   ", &trimmed)));
    EXPECT_FALSE(isOk(ValidateSavedMessageUpdate("invite", 0, "", &trimmed)));

    const auto tooLong = RepeatCodePoints("a", 65);
    EXPECT_FALSE(isOk(ValidateSavedMessageUpdate("invite", 0, tooLong, &trimmed)));

    const auto maxOk = RepeatCodePoints("a", 64);
    ASSERT_TRUE(isOk(ValidateSavedMessageUpdate("invite", 0, maxOk, &trimmed)));
    EXPECT_EQ(trimmed.size(), 64u);
}

TEST(InviteSlots, UpdateSavedMessageRejectsBeforeNetwork)
{
    auto empty = VrcApi::updateSavedMessage("invite", 0, "  ");
    ASSERT_FALSE(isOk(empty));
    EXPECT_EQ(error(empty).code, "invalid_params");

    auto unknown = VrcApi::updateSavedMessage("request", 0, "hello");
    ASSERT_FALSE(isOk(unknown));
    EXPECT_EQ(error(unknown).code, "invalid_params");

    auto neg = VrcApi::updateSavedMessage("invite", -1, "hello");
    ASSERT_FALSE(isOk(neg));
    EXPECT_EQ(error(neg).code, "invalid_params");

    auto twelve = VrcApi::updateSavedMessage("invite", 12, "hello");
    ASSERT_FALSE(isOk(twelve));
    EXPECT_EQ(error(twelve).code, "invalid_params");

    auto longMsg = VrcApi::updateSavedMessage("invite", 0, RepeatCodePoints("x", 65));
    ASSERT_FALSE(isOk(longMsg));
    EXPECT_EQ(error(longMsg).code, "invalid_params");
}

TEST(InviteSlots, Maps429ToRateLimited)
{
    const auto err = InviteSlotHttpError(429);
    EXPECT_EQ(err.code, "rate_limited");
    EXPECT_EQ(err.httpStatus, 429);
}

TEST(InviteSlots, OpenApiAliasesAreWireOnly)
{
    EXPECT_TRUE(IsLiveInviteSlotType("invite"));
    EXPECT_TRUE(IsLiveInviteSlotType("inviteResponse"));
    EXPECT_TRUE(IsLiveInviteSlotType("requestInvite"));
    EXPECT_TRUE(IsLiveInviteSlotType("requestInviteResponse"));
    EXPECT_FALSE(IsLiveInviteSlotType("message"));
    EXPECT_FALSE(IsLiveInviteSlotType("response"));
    EXPECT_FALSE(IsLiveInviteSlotType("request"));
    EXPECT_FALSE(IsLiveInviteSlotType("requestResponse"));

    EXPECT_EQ(OpenApiInviteSlotAlias("invite"), "message");
    EXPECT_EQ(OpenApiInviteSlotAlias("inviteResponse"), "response");
    EXPECT_EQ(OpenApiInviteSlotAlias("requestInvite"), "request");
    EXPECT_EQ(OpenApiInviteSlotAlias("requestInviteResponse"), "requestResponse");
}

TEST(InviteSlots, CombiningMarksCountAsCodePoints)
{
    // U+0065 LATIN SMALL LETTER E + U+0301 COMBINING ACUTE = 2 code points
    const std::string combining = "e\xCC\x81";
    EXPECT_EQ(Utf8CodePointCount(combining), 2u);
    const std::string nfcEAcute{"\xC3\xA9"};
    EXPECT_EQ(Utf8CodePointCount(nfcEAcute), 1u);

    const std::string emoji = "\xF0\x9F\x91\x8B"; // waving hand
    EXPECT_EQ(Utf8CodePointCount(emoji), 1u);
}

TEST(InviteSlots, NormalizeCapsAtTwelveAndDerivesCanUpdate)
{
    nlohmann::json raw = nlohmann::json::array();
    for (int i = 0; i < 14; ++i)
    {
        raw.push_back({
            {"slot", i},
            {"message", "m"},
            {"remainingCooldownMinutes", i == 1 ? 12 : 0},
        });
    }
    const auto out = NormalizeInviteSlotMessages(raw);
    ASSERT_TRUE(out.is_array());
    EXPECT_EQ(out.size(), 12u);
    EXPECT_EQ(out[1]["remainingCooldownMinutes"], 12);
    EXPECT_EQ(out[1]["canBeUpdated"], false);
    EXPECT_EQ(out[0]["canBeUpdated"], true);
}

TEST(InviteSlots, SendGateRateLimitsBurst)
{
    vrcsm::core::ResetInviteSlotSendGateForTests();
    ASSERT_TRUE(isOk(vrcsm::core::ConsumeInviteSlotSendGate(std::chrono::seconds{8})));
    auto second = vrcsm::core::ConsumeInviteSlotSendGate(std::chrono::seconds{8});
    ASSERT_FALSE(isOk(second));
    EXPECT_EQ(error(second).code, "rate_limited");
    EXPECT_GT(vrcsm::core::InviteSlotSendCooldownRemainingSeconds(), 0);
    vrcsm::core::ResetInviteSlotSendGateForTests();
    EXPECT_EQ(vrcsm::core::InviteSlotSendCooldownRemainingSeconds(), 0);
}

TEST(GreyPrefs, RoundTripAndUnknownKeyRejected)
{
    const auto dir = TempDir();
    const auto path = dir / "grey-prefs.json";
    std::error_code ec;
    std::filesystem::remove(path, ec);

    auto defaults = DefaultGreyPrefs();
    EXPECT_TRUE(defaults.greyEnabled);
    EXPECT_EQ(defaults.inviteSlots["confirmBeforeSend"], true);
    EXPECT_EQ(defaults.inviteSlots["lastType"], "invite");

    ASSERT_TRUE(isOk(SaveGreyPrefsTo(path, defaults)));
    auto loaded = LoadGreyPrefsFrom(path);
    ASSERT_TRUE(isOk(loaded));
    EXPECT_TRUE(vrcsm::core::value(loaded).greyEnabled);

    auto off = defaults;
    off.greyEnabled = false;
    ASSERT_TRUE(isOk(SaveGreyPrefsTo(path, off)));
    auto loadedOff = LoadGreyPrefsFrom(path);
    ASSERT_TRUE(isOk(loadedOff));
    EXPECT_FALSE(vrcsm::core::value(loadedOff).greyEnabled);

    auto patched = MergeGreyPrefsPatch(vrcsm::core::value(loaded), nlohmann::json{
        {"greyEnabled", true},
        {"inviteSlots", {{"lastType", "requestInvite"}}},
    });
    ASSERT_TRUE(isOk(patched));
    EXPECT_TRUE(vrcsm::core::value(patched).greyEnabled);
    EXPECT_EQ(vrcsm::core::value(patched).inviteSlots["lastType"], "requestInvite");
    EXPECT_EQ(vrcsm::core::value(patched).inviteSlots["confirmBeforeSend"], true);

    auto unknown = MergeGreyPrefsPatch(defaults, nlohmann::json{{"messenger", true}});
    ASSERT_FALSE(isOk(unknown));
    EXPECT_EQ(error(unknown).code, "invalid_params");

    auto secret = MergeGreyPrefsPatch(defaults, nlohmann::json{{"authOtpMail", {{"password", "nope"}}}});
    ASSERT_FALSE(isOk(secret));
    EXPECT_EQ(error(secret).code, "invalid_params");
}

TEST(GreyPrefs, AssistAndWatchSecondsAreClampedAndCancelWindowIsFixed)
{
    auto prefs = GreyPrefsFromJson(nlohmann::json{
        {"inviteAssist", {{"cooldownSec", 1}, {"cancelWindowSec", 0}}},
    });
    EXPECT_EQ(prefs.inviteAssist.cooldownSec, vrcsm::core::kInviteAssistCooldownMinSec);
    EXPECT_EQ(prefs.inviteAssist.cancelWindowSec, vrcsm::core::kInviteAssistCancelWindowSec);

    auto high = GreyPrefsFromJson(nlohmann::json{
        {"inviteAssist", {{"cooldownSec", 99999}, {"cancelWindowSec", 30}}},
    });
    EXPECT_EQ(high.inviteAssist.cooldownSec, vrcsm::core::kInviteAssistCooldownMaxSec);
    EXPECT_EQ(high.inviteAssist.cancelWindowSec, vrcsm::core::kInviteAssistCancelWindowSec);
}

TEST(GreyPrefs, MergePatchClampsAssistAndWatchSeconds)
{
    auto defaults = DefaultGreyPrefs();
    auto patched = MergeGreyPrefsPatch(defaults, nlohmann::json{
        {"inviteAssist", {{"cooldownSec", 1}, {"cancelWindowSec", 0}}},
        {"eventWatch", {{"joinDelaySec", 0}, {"joinCooldownSec", 3}}},
    });
    ASSERT_TRUE(isOk(patched));
    const auto& p = vrcsm::core::value(patched);
    EXPECT_EQ(p.inviteAssist.cooldownSec, vrcsm::core::kInviteAssistCooldownMinSec);
    EXPECT_EQ(p.inviteAssist.cancelWindowSec, vrcsm::core::kInviteAssistCancelWindowSec);
    EXPECT_EQ(p.eventWatch.joinDelaySec, vrcsm::core::kEventWatchJoinDelayMinSec);
    EXPECT_EQ(p.eventWatch.joinCooldownSec, vrcsm::core::kEventWatchJoinCooldownMinSec);
}

TEST(GreyPrefs, EnablingMasterStampsTosAcceptedAt)
{
    auto defaults = DefaultGreyPrefs();
    defaults.greyEnabled = false;
    EXPECT_FALSE(defaults.masterTosAcceptedAt.has_value());
    auto on = MergeGreyPrefsPatch(defaults, nlohmann::json{{"greyEnabled", true}});
    ASSERT_TRUE(isOk(on));
    EXPECT_TRUE(vrcsm::core::value(on).greyEnabled);
    ASSERT_TRUE(vrcsm::core::value(on).masterTosAcceptedAt.has_value());
    EXPECT_FALSE(vrcsm::core::value(on).masterTosAcceptedAt->empty());

    auto keep = MergeGreyPrefsPatch(vrcsm::core::value(on), nlohmann::json{{"inviteSlots", {{"confirmBeforeSend", false}}}});
    ASSERT_TRUE(isOk(keep));
    EXPECT_EQ(*vrcsm::core::value(keep).masterTosAcceptedAt, *vrcsm::core::value(on).masterTosAcceptedAt);
}

TEST(GreyPrefs, CorruptFileYieldsDefaults)
{
    const auto dir = TempDir();
    const auto path = dir / "grey-prefs-corrupt.json";
    {
        std::ofstream out(path, std::ios::binary | std::ios::trunc);
        out << "{not json";
    }
    auto loaded = LoadGreyPrefsFrom(path);
    ASSERT_TRUE(isOk(loaded));
    EXPECT_TRUE(vrcsm::core::value(loaded).greyEnabled);
    EXPECT_EQ(GreyPrefsToJson(vrcsm::core::value(loaded))["schema"], 1);
}

TEST(InviteSlots, PluginsCannotSendSlotMail)
{
    EXPECT_TRUE(PluginRegistry::CanPermissionsInvoke({"ipc:grey:read"}, "inviteSlots.list").allowed);
    EXPECT_TRUE(PluginRegistry::CanPermissionsInvoke({"ipc:grey:read"}, "grey.prefs.get").allowed);
    EXPECT_FALSE(PluginRegistry::CanPermissionsInvoke({"ipc:grey:read"}, "inviteSlots.update").allowed);
    EXPECT_FALSE(PluginRegistry::CanPermissionsInvoke({"ipc:grey:read"}, "inviteSlots.sendInvite").allowed);
    EXPECT_FALSE(PluginRegistry::CanPermissionsInvoke({"ipc:vrc:api"}, "inviteSlots.update").allowed);
    EXPECT_FALSE(PluginRegistry::CanPermissionsInvoke({"ipc:vrc:api"}, "inviteSlots.sendInvite").allowed);
    EXPECT_FALSE(PluginRegistry::CanPermissionsInvoke({}, "inviteSlots.list").allowed);
}
