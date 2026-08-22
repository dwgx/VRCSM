#include <gtest/gtest.h>

#include "core/EventWatch.h"
#include "core/GreyPrefs.h"
#include "core/LocationParse.h"
#include "core/VrcApi.h"

using vrcsm::core::CanFirePendingWatchJoin;
using vrcsm::core::DefaultGreyPrefs;
using vrcsm::core::EventJoinPending;
using vrcsm::core::EventWatchEngine;
using vrcsm::core::GreyPrefsFromJson;
using vrcsm::core::GreyWatch;
using vrcsm::core::MatchWatchInstance;
using vrcsm::core::ValidateWatch;
using vrcsm::core::VrcApi;
using vrcsm::core::error;
using vrcsm::core::isLaunchableVrchatLocation;
using vrcsm::core::isOk;

namespace
{

nlohmann::json Inst(const std::string& location, int nUsers, const std::string& name = "Party")
{
    return nlohmann::json{
        {"location", location},
        {"worldId", "wrld_aaa"},
        {"instanceId", "12345"},
        {"n_users", nUsers},
        {"displayName", name},
        {"region", "us"},
        {"ownerId", "grp_club"},
        {"type", "group"},
        {"groupAccessType", "plus"},
        {"groupId", "grp_club"},
    };
}

GreyWatch BaseWatch()
{
    GreyWatch w;
    w.id = "w1";
    w.enabled = true;
    w.worldId = "wrld_aaa";
    w.notify = true;
    w.autoJoin = false;
    w.access = "any";
    return w;
}

} // namespace

TEST(EventWatchMatch, Matrix)
{
    const auto loc = "wrld_aaa:12345~group(grp_club)~groupAccessType(plus)~region(us)";
    auto inst = Inst(loc, 12, "Friday Club");

    {
        auto w = BaseWatch();
        EXPECT_TRUE(MatchWatchInstance(w, inst).has_value());
    }
    {
        auto w = BaseWatch();
        w.worldId = "wrld_other";
        EXPECT_FALSE(MatchWatchInstance(w, inst).has_value());
    }
    {
        auto w = BaseWatch();
        w.worldId.clear();
        w.groupId = "grp_club";
        EXPECT_TRUE(MatchWatchInstance(w, inst).has_value());
        w.groupId = "grp_nope";
        EXPECT_FALSE(MatchWatchInstance(w, inst).has_value());
    }
    {
        auto w = BaseWatch();
        w.region = "eu";
        EXPECT_FALSE(MatchWatchInstance(w, inst).has_value());
        w.region = "us";
        EXPECT_TRUE(MatchWatchInstance(w, inst).has_value());
    }
    {
        auto w = BaseWatch();
        w.access = "group+";
        EXPECT_TRUE(MatchWatchInstance(w, inst).has_value());
        w.access = "public";
        EXPECT_FALSE(MatchWatchInstance(w, inst).has_value());
    }
    {
        auto w = BaseWatch();
        w.minUsers = 20;
        EXPECT_FALSE(MatchWatchInstance(w, inst).has_value());
        w.minUsers = 5;
        w.maxUsers = 10;
        EXPECT_FALSE(MatchWatchInstance(w, inst).has_value());
        w.maxUsers = 20;
        EXPECT_TRUE(MatchWatchInstance(w, inst).has_value());
    }
    {
        auto w = BaseWatch();
        w.nameContains = "club";
        EXPECT_TRUE(MatchWatchInstance(w, inst).has_value());
        w.nameContains = "secret";
        EXPECT_FALSE(MatchWatchInstance(w, inst).has_value());
    }
}

TEST(EventWatchValidate, AutoJoinRequiresNotifyAndIds)
{
    GreyWatch w;
    w.notify = false;
    w.autoJoin = true;
    w.worldId = "wrld_aaa";
    auto bad = ValidateWatch(w);
    ASSERT_FALSE(isOk(bad));
    EXPECT_EQ(error(bad).code, "invalid_params");

    GreyWatch empty;
    auto missing = ValidateWatch(empty);
    ASSERT_FALSE(isOk(missing));
}

TEST(EventWatchEngine, MaxEightAndDedup)
{
    EventWatchEngine engine;
    for (int i = 0; i < 8; ++i)
    {
        GreyWatch w;
        w.worldId = "wrld_aaa";
        w.id = "w" + std::to_string(i);
        w.enabled = true;
        ASSERT_TRUE(isOk(engine.upsert(w)));
    }
    GreyWatch extra;
    extra.worldId = "wrld_aaa";
    extra.id = "w8";
    auto ninth = engine.upsert(extra);
    ASSERT_FALSE(isOk(ninth));
    EXPECT_EQ(error(ninth).code, "limit_exceeded");

    auto loc = "wrld_aaa:12345~region(us)";
    auto inst = Inst(loc, 4, "A");
    inst["type"] = "public";
    inst["groupAccessType"] = "";
    inst["groupId"] = "";
    inst["ownerId"] = "";
    inst["location"] = loc;
    GreyWatch w;
    w.id = "w0";
    w.worldId = "wrld_aaa";
    w.enabled = true;
    engine.replaceAll({w});
    auto first = engine.matchAll({inst});
    ASSERT_FALSE(first.empty());
    EXPECT_TRUE(engine.shouldNotify(first[0].dedupKey));
    engine.markNotified(first[0].dedupKey);
    EXPECT_FALSE(engine.shouldNotify(first[0].dedupKey));
    engine.retainPresent({first[0].dedupKey});
    EXPECT_FALSE(engine.shouldNotify(first[0].dedupKey));
    engine.retainPresent({});
    EXPECT_TRUE(engine.shouldNotify(first[0].dedupKey));
}

TEST(EventWatchEngine, CancelDuringJoinWindow)
{
    EventWatchEngine engine;
    const auto t0 = std::chrono::steady_clock::now();
    EventJoinPending pending;
    pending.watchId = "w1";
    pending.location = "wrld_aaa:1";
    pending.due = t0 + std::chrono::seconds{15};
    ASSERT_TRUE(engine.armJoin(pending));
    EXPECT_FALSE(engine.takeJoinDue(t0 + std::chrono::seconds{5}).has_value());
    ASSERT_TRUE(engine.cancelJoin());
    EXPECT_FALSE(engine.takeJoinDue(t0 + std::chrono::seconds{16}).has_value());
}

TEST(EventWatchApi, EmptyGroupIdRejectedBeforeNetwork)
{
    auto r = VrcApi::fetchGroupInstances("");
    ASSERT_FALSE(isOk(r));
    EXPECT_EQ(error(r).code, "invalid_params");
}

TEST(EventWatchEngine, ReplaceAllDropsInvalidAndAutoJoinWithoutNotify)
{
    EventWatchEngine engine;
    GreyWatch autoJoinNoNotify = BaseWatch();
    autoJoinNoNotify.id = "keep-coerced";
    autoJoinNoNotify.notify = false;
    autoJoinNoNotify.autoJoin = true;

    GreyWatch badAccess = BaseWatch();
    badAccess.id = "drop-access";
    badAccess.access = "secret";

    GreyWatch missingIds;
    missingIds.id = "drop-ids";
    missingIds.notify = true;
    missingIds.access = "any";

    GreyWatch ok = BaseWatch();
    ok.id = "keep-ok";
    ok.notify = true;
    ok.autoJoin = false;

    engine.replaceAll({autoJoinNoNotify, badAccess, missingIds, ok});
    const auto rows = engine.watches();
    ASSERT_EQ(rows.size(), 2u);
    EXPECT_EQ(rows[0].id, "keep-coerced");
    EXPECT_FALSE(rows[0].notify);
    EXPECT_FALSE(rows[0].autoJoin);
    EXPECT_EQ(rows[1].id, "keep-ok");
}

TEST(EventWatchPrefs, IntervalClampAndWatchSanitize)
{
    auto low = GreyPrefsFromJson(nlohmann::json{{"eventWatch", {{"intervalSec", 1}}}});
    EXPECT_EQ(low.eventWatch.intervalSec, 30);

    auto high = GreyPrefsFromJson(nlohmann::json{{"eventWatch", {{"intervalSec", 999}}}});
    EXPECT_EQ(high.eventWatch.intervalSec, 300);

    auto mid = GreyPrefsFromJson(nlohmann::json{{"eventWatch", {{"intervalSec", 120}}}});
    EXPECT_EQ(mid.eventWatch.intervalSec, 120);

    auto joinLow = GreyPrefsFromJson(nlohmann::json{{"eventWatch", {{"joinDelaySec", 0}, {"joinCooldownSec", 1}}}});
    EXPECT_EQ(joinLow.eventWatch.joinDelaySec, vrcsm::core::kEventWatchJoinDelayMinSec);
    EXPECT_EQ(joinLow.eventWatch.joinCooldownSec, vrcsm::core::kEventWatchJoinCooldownMinSec);

    auto joinHigh = GreyPrefsFromJson(nlohmann::json{{"eventWatch", {{"joinDelaySec", 999}, {"joinCooldownSec", 99999}}}});
    EXPECT_EQ(joinHigh.eventWatch.joinDelaySec, vrcsm::core::kEventWatchJoinDelayMaxSec);
    EXPECT_EQ(joinHigh.eventWatch.joinCooldownSec, vrcsm::core::kEventWatchJoinCooldownMaxSec);

    const auto prefs = GreyPrefsFromJson(nlohmann::json{
        {"eventWatch", {
            {"intervalSec", 30},
            {"watches", nlohmann::json::array({
                {
                    {"id", "a"},
                    {"worldId", "wrld_aaa"},
                    {"notify", false},
                    {"autoJoin", true},
                    {"access", "any"},
                },
                {
                    {"id", "b"},
                    {"worldId", "wrld_aaa"},
                    {"access", "secret"},
                },
            })},
        }},
    });
    ASSERT_EQ(prefs.eventWatch.watches.size(), 1u);
    EXPECT_EQ(prefs.eventWatch.watches[0].id, "a");
    EXPECT_FALSE(prefs.eventWatch.watches[0].autoJoin);
}

TEST(EventWatchLocation, LaunchableRejectsUnsafe)
{
    EXPECT_FALSE(isLaunchableVrchatLocation(""));
    EXPECT_FALSE(isLaunchableVrchatLocation("http://example.com"));
    EXPECT_FALSE(isLaunchableVrchatLocation("wrld_aaa:\x01secret"));
    EXPECT_FALSE(isLaunchableVrchatLocation("wrld_aaa:\x7F"));
    EXPECT_FALSE(isLaunchableVrchatLocation("usr_abc"));
    EXPECT_FALSE(isLaunchableVrchatLocation("offline"));
    EXPECT_TRUE(isLaunchableVrchatLocation("wrld_aaa:12345~region(us)"));
}

TEST(EventWatchJoin, FireRecheckRejectsWhenUnconfirmedOrWatchGone)
{
    EventWatchEngine engine;
    auto w = BaseWatch();
    w.autoJoin = true;
    ASSERT_TRUE(isOk(engine.upsert(w)));

    EventJoinPending due;
    due.watchId = "w1";
    due.location = "wrld_aaa:12345~region(us)";

    auto prefs = DefaultGreyPrefs();
    EXPECT_FALSE(CanFirePendingWatchJoin(prefs, due, engine));
    prefs.eventWatch.autoJoinConfirmed = true;
    EXPECT_TRUE(CanFirePendingWatchJoin(prefs, due, engine));
    prefs.greyEnabled = false;
    EXPECT_FALSE(CanFirePendingWatchJoin(prefs, due, engine));
    prefs.greyEnabled = true;
    due.location.clear();
    EXPECT_FALSE(CanFirePendingWatchJoin(prefs, due, engine));
    due.location = "wrld_aaa:12345~region(us)";
    ASSERT_TRUE(isOk(engine.remove("w1")));
    EXPECT_FALSE(CanFirePendingWatchJoin(prefs, due, engine));
}
