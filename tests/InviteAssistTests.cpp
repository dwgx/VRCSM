#include <gtest/gtest.h>

#include "core/GreyRateLimit.h"
#include "core/InviteAssist.h"
#include "core/LocationParse.h"

using vrcsm::core::AssistSkipReason;
using vrcsm::core::EvaluateInviteAssist;
using vrcsm::core::GreyRateLimit;
using vrcsm::core::InviteAssistContext;
using vrcsm::core::InviteAssistEngine;
using vrcsm::core::AssistPending;
using vrcsm::core::isInWorld;
using vrcsm::core::parseLocation;

namespace
{

nlohmann::json Request(const std::string& sender = "usr_friend")
{
    return nlohmann::json{
        {"type", "requestInvite"},
        {"senderUserId", sender},
        {"senderUsername", "Friend"},
        {"id", "noti_1"},
    };
}

InviteAssistContext GoodCtx()
{
    InviteAssistContext ctx;
    ctx.greyEnabled = true;
    ctx.enabled = true;
    ctx.confirmed = true;
    ctx.inWorld = true;
    ctx.vrcRunning = true;
    ctx.isFriend = true;
    ctx.friendsStale = false;
    ctx.inAllowlist = true;
    ctx.cooldownRemaining = std::chrono::seconds{0};
    ctx.globalRemaining = 3;
    return ctx;
}

} // namespace

TEST(GreyRateLimit, ThreePerTenMinutes)
{
    GreyRateLimit bucket(3, std::chrono::seconds{600});
    const auto t0 = std::chrono::steady_clock::now();
    EXPECT_TRUE(bucket.tryConsume(t0));
    EXPECT_TRUE(bucket.tryConsume(t0 + std::chrono::seconds{1}));
    EXPECT_TRUE(bucket.tryConsume(t0 + std::chrono::seconds{2}));
    EXPECT_FALSE(bucket.tryConsume(t0 + std::chrono::seconds{3}));
    EXPECT_EQ(bucket.remaining(t0 + std::chrono::seconds{3}), 0);
    EXPECT_TRUE(bucket.tryConsume(t0 + std::chrono::seconds{601}));
}

TEST(LocationParse, WorldVsPrivate)
{
    EXPECT_TRUE(isInWorld("wrld_aaa:12345~region(us)"));
    EXPECT_FALSE(isInWorld("private"));
    EXPECT_FALSE(isInWorld("offline"));
    EXPECT_FALSE(isInWorld("traveling"));
    EXPECT_EQ(vrcsm::core::locationKindName(parseLocation("offline").kind), std::string("offline"));
}

TEST(InviteAssistEval, Table)
{
    {
        auto d = EvaluateInviteAssist("notification", nlohmann::json{{"type", "invite"}}, GoodCtx());
        EXPECT_FALSE(d.accept);
        EXPECT_EQ(d.skip, AssistSkipReason::WrongType);
    }
    {
        auto ctx = GoodCtx();
        ctx.inAllowlist = false;
        auto d = EvaluateInviteAssist("notification", Request(), ctx);
        EXPECT_FALSE(d.accept);
        EXPECT_STREQ(d.reason, "not_allowlisted");
    }
    {
        auto ctx = GoodCtx();
        ctx.inWorld = false;
        auto d = EvaluateInviteAssist("notification", Request(), ctx);
        EXPECT_STREQ(d.reason, "not_in_world");
    }
    {
        auto ctx = GoodCtx();
        ctx.vrcRunning = false;
        auto d = EvaluateInviteAssist("notification", Request(), ctx);
        EXPECT_STREQ(d.reason, "vrc_not_running");
    }
    {
        auto ctx = GoodCtx();
        ctx.cooldownRemaining = std::chrono::seconds{10};
        auto d = EvaluateInviteAssist("notification", Request(), ctx);
        EXPECT_STREQ(d.reason, "cooldown");
    }
    {
        auto ctx = GoodCtx();
        ctx.enabled = false;
        auto d = EvaluateInviteAssist("notification", Request(), ctx);
        EXPECT_STREQ(d.reason, "disabled");
    }
    {
        auto d = EvaluateInviteAssist("notification", Request(), GoodCtx());
        EXPECT_TRUE(d.accept);
    }
    {
        auto d = EvaluateInviteAssist("notification-v2", Request(), GoodCtx());
        EXPECT_TRUE(d.accept);
    }
}

TEST(InviteAssistEngine, CooldownAndCancelWindow)
{
    InviteAssistEngine engine;
    const auto t0 = std::chrono::steady_clock::now();
    auto ctx = GoodCtx();
    auto d = engine.consider("notification", Request(), ctx, t0);
    ASSERT_TRUE(d.accept);

    AssistPending pending;
    pending.senderUserId = "usr_friend";
    pending.displayName = "Friend";
    pending.due = t0 + std::chrono::seconds{5};
    ASSERT_TRUE(engine.armPending(pending, std::chrono::seconds{5}));

    EXPECT_FALSE(engine.takeDue(t0 + std::chrono::seconds{4}).has_value());
    ASSERT_TRUE(engine.cancelPending());
    EXPECT_FALSE(engine.takeDue(t0 + std::chrono::seconds{6}).has_value());

    pending.due = t0 + std::chrono::seconds{5};
    ASSERT_TRUE(engine.armPending(pending, std::chrono::seconds{5}));
    auto due = engine.takeDue(t0 + std::chrono::seconds{5});
    ASSERT_TRUE(due.has_value());
    engine.markAccepted(due->senderUserId, t0 + std::chrono::seconds{5});

    auto second = engine.consider("notification", Request(), ctx, t0 + std::chrono::seconds{10});
    EXPECT_FALSE(second.accept);
    EXPECT_EQ(second.skip, AssistSkipReason::Cooldown);
}

TEST(InviteAssistEngine, GlobalThreePerWindow)
{
    InviteAssistEngine engine;
    auto ctx = GoodCtx();
    const auto t0 = std::chrono::steady_clock::now();
    for (int i = 0; i < 3; ++i)
    {
        const auto id = "usr_" + std::to_string(i);
        auto d = engine.consider("notification", Request(id), ctx, t0);
        ASSERT_TRUE(d.accept) << id;
        AssistPending pending;
        pending.senderUserId = id;
        pending.due = t0;
        ASSERT_TRUE(engine.armPending(pending, std::chrono::seconds{0}));
        auto due = engine.takeDue(t0);
        ASSERT_TRUE(due);
        engine.markAccepted(id, t0);
    }
    auto fourth = engine.consider("notification", Request("usr_x"), ctx, t0);
    EXPECT_FALSE(fourth.accept);
    EXPECT_EQ(fourth.skip, AssistSkipReason::GlobalLimit);
}
