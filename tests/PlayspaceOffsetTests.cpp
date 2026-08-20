#include <gtest/gtest.h>

#include "core/PlayspaceOffset.h"

#include <cmath>
#include <fstream>
#include <Windows.h>

using vrcsm::core::error;
using vrcsm::core::isOk;
using vrcsm::core::PlayspaceClampNudge;
using vrcsm::core::PlayspaceClampSession;
using vrcsm::core::PlayspaceControllerSample;
using vrcsm::core::PlayspaceIdentity34;
using vrcsm::core::PlayspaceLocks;
using vrcsm::core::PlayspaceMatrix34;
using vrcsm::core::PlayspaceOffset;
using vrcsm::core::PlayspaceState;
using vrcsm::core::PlayspaceTranslateStanding;
using vrcsm::core::PlayspaceTranslationOf;
using vrcsm::core::PlayspaceVec3;
using vrcsm::core::IPlayspaceBackend;
using vrcsm::core::OpenVrApiDllPath;
using vrcsm::core::ResolveOpenVrRuntime;
using vrcsm::core::Result;
using vrcsm::core::value;

namespace
{

PlayspaceMatrix34 PoseWithTranslation(float x, float y, float z)
{
    auto pose = PlayspaceIdentity34();
    pose.m[0][3] = x;
    pose.m[1][3] = y;
    pose.m[2][3] = z;
    return pose;
}

class FailInitBackend final : public IPlayspaceBackend
{
public:
    Result<std::monostate> init() override
    {
        return vrcsm::core::Error{"steamvr_not_running", "stubbed VR_Init failure", 0};
    }
    void shutdown() override {}
    Result<PlayspaceMatrix34> getStandingPose() override
    {
        return vrcsm::core::Error{"steamvr_not_running", "not inited", 0};
    }
    Result<std::monostate> setStandingPose(const PlayspaceMatrix34&) override
    {
        return vrcsm::core::Error{"steamvr_not_running", "not inited", 0};
    }
    Result<std::monostate> commitLive() override
    {
        return vrcsm::core::Error{"steamvr_not_running", "not inited", 0};
    }
    std::vector<PlayspaceControllerSample> pollControllers() override { return {}; }
};

class MemoryBackend final : public IPlayspaceBackend
{
public:
    PlayspaceMatrix34 pose{PlayspaceIdentity34()};
    std::vector<PlayspaceControllerSample> controllers;
    int initCount{0};
    int commitCount{0};
    bool failCommit{false};

    Result<std::monostate> init() override
    {
        ++initCount;
        return std::monostate{};
    }
    void shutdown() override {}
    Result<PlayspaceMatrix34> getStandingPose() override { return pose; }
    Result<std::monostate> setStandingPose(const PlayspaceMatrix34& next) override
    {
        pose = next;
        return std::monostate{};
    }
    Result<std::monostate> commitLive() override
    {
        ++commitCount;
        if (failCommit) return vrcsm::core::Error{"error", "commit failed", 0};
        return std::monostate{};
    }
    std::vector<PlayspaceControllerSample> pollControllers() override { return controllers; }
    std::string runtimePath() const override { return "C:/Steam/steamapps/common/SteamVR"; }
};

} // namespace

TEST(PlayspaceMath, TranslateKnownPoseByXLeavesYWithLockY)
{
    auto pose = PoseWithTranslation(0.f, 2.f, 0.f);
    PlayspaceLocks locks;
    locks.lockY = true;
    auto delta = vrcsm::core::PlayspaceApplyLocks({1.f, 0.5f, 0.f}, locks);
    EXPECT_FLOAT_EQ(delta.y, 0.f);
    auto moved = PlayspaceTranslateStanding(pose, delta);
    const auto t = PlayspaceTranslationOf(moved);
    EXPECT_NEAR(t.x, 1.f, 1e-5f);
    EXPECT_NEAR(t.y, 2.f, 1e-5f);
    EXPECT_NEAR(t.z, 0.f, 1e-5f);
}

TEST(PlayspaceMath, Multiply4x4YawThenTranslateKeepsY)
{
    PlayspaceMatrix34 pose{};
    // Ry(90°): X maps to -Z
    pose.m[0][2] = 1.f;
    pose.m[1][1] = 1.f;
    pose.m[2][0] = -1.f;
    pose.m[1][3] = 3.f;
    auto moved = PlayspaceTranslateStanding(pose, {1.f, 0.f, 0.f});
    const auto t = PlayspaceTranslationOf(moved);
    EXPECT_NEAR(t.x, 0.f, 1e-5f);
    EXPECT_NEAR(t.y, 3.f, 1e-5f);
    EXPECT_NEAR(t.z, -1.f, 1e-5f);
}

TEST(PlayspaceMath, NudgeOverQuarterMeterRejected)
{
    auto ok = PlayspaceClampNudge({0.25f, 0.f, 0.f});
    ASSERT_TRUE(isOk(ok));
    auto bad = PlayspaceClampNudge({0.26f, 0.f, 0.f});
    ASSERT_FALSE(isOk(bad));
    EXPECT_EQ(error(bad).code, "invalid_params");
}

TEST(PlayspaceMath, SessionClampFiveMetersRejected)
{
    auto ok = PlayspaceClampSession({0.f, 0.f, 4.9f}, {0.f, 0.f, 0.05f});
    ASSERT_TRUE(isOk(ok));
    auto bad = PlayspaceClampSession({0.f, 0.f, 4.9f}, {0.f, 0.f, 0.2f});
    ASSERT_FALSE(isOk(bad));
    EXPECT_EQ(error(bad).code, "offset_limit");
}

TEST(PlayspaceOffset, StubbedInitFailureIsSteamVrNotRunning)
{
    PlayspaceOffset offset(std::make_unique<FailInitBackend>());
    auto first = offset.start(false);
    ASSERT_TRUE(isOk(first));
    EXPECT_EQ(value(first).state, PlayspaceState::SteamVrNotRunning);
    EXPECT_EQ(std::string(vrcsm::core::PlayspaceStateToString(value(first).state)), "steamvr_not_running");

    auto again = offset.start(false);
    ASSERT_TRUE(isOk(again));
    EXPECT_EQ(value(again).state, PlayspaceState::SteamVrNotRunning);

    auto nudged = offset.nudge(0.1f, 0.f, 0.f);
    ASSERT_FALSE(isOk(nudged));
    EXPECT_EQ(error(nudged).code, "steamvr_not_running");
}

TEST(PlayspaceOffset, NudgeAndResetOnMemoryBackend)
{
    auto backend = std::make_unique<MemoryBackend>();
    backend->pose = PoseWithTranslation(0.f, 1.5f, 0.f);
    auto* raw = backend.get();
    PlayspaceOffset offset(std::move(backend));

    auto started = offset.start(false);
    ASSERT_TRUE(isOk(started));
    EXPECT_EQ(value(started).state, PlayspaceState::Ready);
    EXPECT_EQ(raw->initCount, 1);

    auto moved = offset.nudge(0.2f, 0.2f, 0.f);
    ASSERT_TRUE(isOk(moved));
    EXPECT_NEAR(value(moved).x, 0.2f, 1e-5f);
    EXPECT_NEAR(value(moved).y, 0.f, 1e-5f) << "default lockY must drop vertical nudge";
    const auto world = PlayspaceTranslationOf(raw->pose);
    EXPECT_NEAR(world.y, 1.5f, 1e-5f);

    auto reset = offset.reset();
    ASSERT_TRUE(isOk(reset));
    EXPECT_NEAR(value(reset).x, 0.f, 1e-5f);
    EXPECT_NEAR(value(reset).y, 0.f, 1e-5f);
    EXPECT_NEAR(value(reset).z, 0.f, 1e-5f);
    const auto after = PlayspaceTranslationOf(raw->pose);
    EXPECT_NEAR(after.x, 0.f, 1e-5f);
    EXPECT_NEAR(after.y, 0.f, 1e-5f);
    EXPECT_NEAR(after.z, 0.f, 1e-5f);
}

TEST(PlayspaceOffset, NudgeOverLimitRejectedWithoutMoving)
{
    PlayspaceOffset offset(std::make_unique<MemoryBackend>());
    ASSERT_TRUE(isOk(offset.start(false)));
    auto bad = offset.nudge(0.3f, 0.f, 0.f);
    ASSERT_FALSE(isOk(bad));
    EXPECT_EQ(error(bad).code, "invalid_params");
    EXPECT_NEAR(offset.status().offset.x, 0.f, 1e-5f);
}

TEST(PlayspaceOffset, SessionLimitSetsOffsetLimitHit)
{
    PlayspaceOffset offset(std::make_unique<MemoryBackend>());
    ASSERT_TRUE(isOk(offset.start(false)));
    ASSERT_TRUE(isOk(offset.setLocks(std::nullopt, true, std::nullopt)));
    for (int i = 0; i < 24; ++i)
    {
        auto step = offset.nudge(0.25f, 0.f, 0.f);
        if (!isOk(step))
        {
            EXPECT_EQ(error(step).code, "offset_limit");
            EXPECT_TRUE(offset.status().offsetLimitHit);
            EXPECT_LE(std::hypot(offset.status().offset.x, offset.status().offset.z), 5.0f + 1e-4f);
            return;
        }
    }
    FAIL() << "expected offset_limit before 24 * 0.25 m";
}

TEST(PlayspaceOffset, TickGripStickIntegratesXz)
{
    auto backend = std::make_unique<MemoryBackend>();
    auto* raw = backend.get();
    PlayspaceOffset offset(std::move(backend));
    ASSERT_TRUE(isOk(offset.start(false)));
    raw->controllers = {PlayspaceControllerSample{true, 1.f, 0.f}};
    auto ticked = offset.tick(1.f);
    ASSERT_TRUE(isOk(ticked));
    EXPECT_EQ(value(ticked).state, PlayspaceState::Active);
    EXPECT_TRUE(value(ticked).gripHeld);
    EXPECT_NEAR(value(ticked).offset.x, 1.5f, 1e-4f);
    EXPECT_NEAR(value(ticked).offset.y, 0.f, 1e-4f);
}

TEST(PlayspaceOffset, DualGripTapResets)
{
    auto backend = std::make_unique<MemoryBackend>();
    auto* raw = backend.get();
    PlayspaceOffset offset(std::move(backend));
    ASSERT_TRUE(isOk(offset.start(false)));
    ASSERT_TRUE(isOk(offset.nudge(0.2f, 0.f, 0.f)));
    raw->controllers = {
        PlayspaceControllerSample{true, 0.f, 0.f},
        PlayspaceControllerSample{false, 0.f, 0.f},
    };
    ASSERT_TRUE(isOk(offset.tick(0.01f)));
    raw->controllers = {
        PlayspaceControllerSample{true, 0.f, 0.f},
        PlayspaceControllerSample{true, 0.f, 0.f},
    };
    auto ticked = offset.tick(0.01f);
    ASSERT_TRUE(isOk(ticked));
    EXPECT_NEAR(value(ticked).offset.x, 0.f, 1e-5f);
}

TEST(PlayspaceOffset, SetLocksAndJsonStatus)
{
    PlayspaceOffset offset(std::make_unique<MemoryBackend>());
    ASSERT_TRUE(isOk(offset.start(false)));
    auto locks = offset.setLocks(true, false, true);
    ASSERT_TRUE(isOk(locks));
    EXPECT_TRUE(value(locks).lockX);
    EXPECT_FALSE(value(locks).lockY);
    EXPECT_TRUE(value(locks).lockZ);
    const auto j = offset.statusJson();
    EXPECT_EQ(j.at("state").get<std::string>(), "ready");
    EXPECT_TRUE(j.at("locks").at("lockX").get<bool>());
    EXPECT_FALSE(j.at("locks").at("lockY").get<bool>());
}

TEST(PlayspacePaths, ReadsRuntimeZeroFromVrpath)
{
    auto dir = std::filesystem::temp_directory_path() /
               (L"vrcsm-playspace-" + std::to_wstring(::GetCurrentProcessId()));
    std::error_code ec;
    std::filesystem::create_directories(dir, ec);
    auto vrpath = dir / L"openvrpaths.vrpath";
    {
        std::ofstream out(vrpath, std::ios::binary);
        out << R"({"runtime":["C:\\\\Steam\\\\steamapps\\\\common\\\\SteamVR"]})";
    }
    auto runtime = ResolveOpenVrRuntime(vrpath);
    ASSERT_TRUE(runtime.has_value());
    EXPECT_TRUE(runtime->wstring().find(L"SteamVR") != std::wstring::npos);
    auto dll = OpenVrApiDllPath(*runtime);
    EXPECT_TRUE(dll.wstring().find(L"openvr_api.dll") != std::wstring::npos);
    std::filesystem::remove_all(dir, ec);
}
