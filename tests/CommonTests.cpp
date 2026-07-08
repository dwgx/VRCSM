#include <gtest/gtest.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <fstream>
#include <iostream>
#include <map>

#include <Windows.h>
#include <sqlite3.h>
#include <wil/resource.h>

#include "core/AvatarPreview.h"
#include "core/AvatarIdHarvest.h"
#include "core/Common.h"
#include "core/Database.h"
#include "core/FriendAnalytics.h"
#include "core/DiscordRpc.h"
#include "core/ToastNotifier.h"
#include "core/VrOverlayNotifier.h"
#include "core/JunctionUtil.h"
#include "core/LogAtoms.h"
#include "core/LogEventClassifier.h"
#include "core/LogParser.h"
#include "core/Migrator.h"
#include "core/NowPlaying.h"
#include "core/OscBridge.h"
#include "core/ProcessGuard.h"
#include "core/SafeDelete.h"
#include "core/UnityBundle.h"
#include "core/VrcApi.h"
#include "core/VrDiagnostics.h"
#include "core/hw/HwTelemetry.h"
#include "core/plugins/PluginRegistry.h"
#include "core/updater/UpdateApplier.h"
#include "core/updater/UpdatePackage.h"

namespace
{

std::filesystem::path MakeTempTestDir(std::wstring_view name)
{
    auto dir = std::filesystem::temp_directory_path()
        / (std::wstring(name) + L"-" + std::to_wstring(::GetCurrentProcessId()));
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
    std::filesystem::create_directories(dir, ec);
    return dir;
}

void WriteBytes(const std::filesystem::path& path, std::string_view bytes)
{
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
}

void WriteSizedFile(const std::filesystem::path& path, std::size_t bytes)
{
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    std::string block(bytes, 'x');
    out.write(block.data(), static_cast<std::streamsize>(block.size()));
}

void WriteDownloadMetadata(
    const std::filesystem::path& path,
    const std::string& url,
    std::uintmax_t bytes)
{
    std::filesystem::path meta = path;
    meta += L".download.json";
    std::ofstream out(meta, std::ios::binary | std::ios::trunc);
    out << nlohmann::json{
        {"schema", 1},
        {"url", url},
        {"bytes", bytes},
        {"complete", true},
    }.dump();
}

bool ContainsSubstring(const std::vector<std::string>& items, std::string_view needle)
{
    return std::any_of(items.begin(), items.end(), [&](const std::string& item) {
        return item.find(needle) != std::string::npos;
    });
}

void OpenTempDatabase(const std::filesystem::path& dbPath)
{
    auto& db = vrcsm::core::Database::Instance();
    db.Close();
    auto opened = db.Open(dbPath);
    ASSERT_TRUE(vrcsm::core::isOk(opened)) << vrcsm::core::error(opened).message;
}

void ExecSql(sqlite3* db, const char* sql)
{
    char* error = nullptr;
    const int rc = sqlite3_exec(db, sql, nullptr, nullptr, &error);
    if (rc != SQLITE_OK)
    {
        const std::string message = error != nullptr ? error : "sqlite3_exec failed";
        sqlite3_free(error);
        FAIL() << message;
    }
}

std::int64_t QueryInt64(sqlite3* db, const char* sql)
{
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db, sql, -1, &stmt, nullptr) != SQLITE_OK)
    {
        ADD_FAILURE() << sqlite3_errmsg(db);
        return -1;
    }
    const auto finalize = wil::scope_exit([&]() { sqlite3_finalize(stmt); });
    if (sqlite3_step(stmt) != SQLITE_ROW)
    {
        ADD_FAILURE() << "query returned no rows";
        return -1;
    }
    return sqlite3_column_int64(stmt, 0);
}

std::string QueryText(sqlite3* db, const char* sql)
{
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db, sql, -1, &stmt, nullptr) != SQLITE_OK)
    {
        ADD_FAILURE() << sqlite3_errmsg(db);
        return {};
    }
    const auto finalize = wil::scope_exit([&]() { sqlite3_finalize(stmt); });
    if (sqlite3_step(stmt) != SQLITE_ROW)
    {
        ADD_FAILURE() << "query returned no rows";
        return {};
    }
    const auto* text = sqlite3_column_text(stmt, 0);
    return text != nullptr ? reinterpret_cast<const char*>(text) : std::string{};
}

} // namespace

TEST(CommonTests, EnsureWithinBaseAcceptsNestedChild)
{
    EXPECT_TRUE(vrcsm::core::ensureWithinBase(
        L"C:\\VRChat\\Cache",
        L"C:\\VRChat\\Cache\\avatars\\entry"));
}

TEST(CommonTests, EnsureWithinBaseRejectsPrefixSibling)
{
    EXPECT_FALSE(vrcsm::core::ensureWithinBase(
        L"C:\\VRChat\\Cache",
        L"C:\\VRChat\\CacheBackup\\avatars"));
}

TEST(CommonTests, EnsureWithinBaseNormalizesParentSegments)
{
    EXPECT_TRUE(vrcsm::core::ensureWithinBase(
        L"C:\\VRChat\\Cache",
        L"C:\\VRChat\\Cache\\avatars\\..\\worlds"));
}

TEST(CommonTests, EnsureWithinBaseIsCaseInsensitiveOnWindows)
{
    EXPECT_TRUE(vrcsm::core::ensureWithinBase(
        L"c:\\vrchat\\cache",
        L"C:\\VRChat\\Cache\\HTTPCache-WindowsPlayer"));
}

TEST(CommonTests, Aida64SensorValuesParserAcceptsCommonXmlRows)
{
    const std::string xml = R"(
<AIDA64>
  <sensor><id>TCPU</id><label>CPU Package</label><value>62 C</value></sensor>
  <sensor><id>TGPU</id><label>GPU Diode</label><value>56 C</value></sensor>
  <sensor><id>PGPU</id><label>GPU Power</label><value>40.7 W</value></sensor>
  <sensor><id>FGPU</id><label>GPU Fan</label><value>1330 RPM</value></sensor>
</AIDA64>)";

    const auto sensors = vrcsm::core::hw::ParseAida64SensorValuesForTest(xml);

    ASSERT_EQ(sensors.size(), 4u);
    EXPECT_EQ(sensors[0].sensorType, "Temperature");
    EXPECT_EQ(sensors[0].unit, "C");
    ASSERT_TRUE(sensors[2].value.has_value());
    EXPECT_NEAR(*sensors[2].value, 40.7, 0.01);
    EXPECT_EQ(sensors[2].sensorType, "Power");
    EXPECT_EQ(sensors[3].sensorType, "Fan");
    EXPECT_EQ(sensors[3].unit, "RPM");
}

TEST(CommonTests, OscBridgeRejectsInvalidIpv4Host)
{
    vrcsm::core::OscBridge bridge;
    const auto result = bridge.Send(
        "/chatbox/input",
        {vrcsm::core::OscArgument::fromString("VRCSM")},
        "not-a-valid-ipv4-host",
        9000);

    EXPECT_FALSE(result.ok);
    ASSERT_TRUE(result.error.has_value());
    EXPECT_EQ(result.error->code, "osc_invalid_host");
    EXPECT_NE(result.error->message.find("valid IPv4 address"), std::string::npos);
}

TEST(CommonTests, OscArgumentsFromJsonPreservesTaggedFloatForWholeNumbers)
{
    // The tagged form {"t":"f","v":1} must map to a FLOAT argument even though
    // the value is whole-numbered — otherwise VRChat's float params drop the
    // ',i'-tagged value it would get from a bare JSON integer.
    const auto args = vrcsm::core::OscArgumentsFromJson(
        nlohmann::json::parse(R"([{"t":"f","v":1}])"));
    ASSERT_EQ(args.size(), 1u);
    EXPECT_TRUE(std::holds_alternative<float>(args[0].value));
    EXPECT_FLOAT_EQ(std::get<float>(args[0].value), 1.0f);
}

TEST(CommonTests, OscArgumentsFromJsonHonorsAllTagsAndFallsBackStructurally)
{
    const auto args = vrcsm::core::OscArgumentsFromJson(nlohmann::json::parse(
        R"([{"t":"f","v":0.5},{"t":"i","v":7},{"t":"s","v":"hi"},{"t":"b","v":true},3,2.5,"x",false])"));
    ASSERT_EQ(args.size(), 8u);
    // Tagged
    EXPECT_TRUE(std::holds_alternative<float>(args[0].value));
    EXPECT_TRUE(std::holds_alternative<std::int32_t>(args[1].value));
    EXPECT_TRUE(std::holds_alternative<std::string>(args[2].value));
    EXPECT_TRUE(std::holds_alternative<bool>(args[3].value));
    // Bare values keep their prior structural inference (unchanged contract).
    EXPECT_TRUE(std::holds_alternative<std::int32_t>(args[4].value));
    EXPECT_TRUE(std::holds_alternative<float>(args[5].value));
    EXPECT_TRUE(std::holds_alternative<std::string>(args[6].value));
    EXPECT_TRUE(std::holds_alternative<bool>(args[7].value));
}

TEST(CommonTests, AcpiThermalZoneConvertsTenthsKelvinToCelsius)
{
    const auto value = vrcsm::core::hw::AcpiTenthsKelvinToCelsiusForTest(3002.0);

    ASSERT_TRUE(value.has_value());
    EXPECT_NEAR(*value, 27.05, 0.001);
    EXPECT_FALSE(vrcsm::core::hw::AcpiTenthsKelvinToCelsiusForTest(0.0).has_value());
    EXPECT_FALSE(vrcsm::core::hw::AcpiTenthsKelvinToCelsiusForTest(5000.0).has_value());
}

TEST(CommonTests, CpuLoadFromTicksComputesBusyFraction)
{
    using vrcsm::core::hw::CpuLoadFromTicksForTest;

    // kernel includes idle. Interval: kernel +100 (of which idle +25), user +0.
    // total = kernel(100) + user(0) = 100; busy = 100 - 25 = 75 -> 75%.
    auto threeQuarters = CpuLoadFromTicksForTest(0, 0, 0, 25, 100, 0);
    ASSERT_TRUE(threeQuarters.has_value());
    EXPECT_NEAR(*threeQuarters, 75.0, 0.001);

    // Fully idle: idle delta == kernel delta, user 0 -> 0%.
    auto idle = CpuLoadFromTicksForTest(0, 0, 0, 200, 200, 0);
    ASSERT_TRUE(idle.has_value());
    EXPECT_NEAR(*idle, 0.0, 0.001);

    // Fully busy: no idle, all in user -> 100%.
    auto busy = CpuLoadFromTicksForTest(0, 0, 0, 0, 50, 150);
    ASSERT_TRUE(busy.has_value());
    EXPECT_NEAR(*busy, 100.0, 0.001);
}

TEST(CommonTests, CpuLoadFromTicksRejectsWrapAndZeroInterval)
{
    using vrcsm::core::hw::CpuLoadFromTicksForTest;

    // Zero-length interval -> no value.
    EXPECT_FALSE(CpuLoadFromTicksForTest(10, 20, 30, 10, 20, 30).has_value());
    // Counter wrap (newer < older) -> no value, never a negative/garbage load.
    EXPECT_FALSE(CpuLoadFromTicksForTest(100, 200, 300, 50, 100, 150).has_value());
}

TEST(CommonTests, PackLuidIsStableAndDistinct)
{
    using vrcsm::core::hw::PackLuid;

    // Low/high parts occupy disjoint halves; a negative HighPart must not collide
    // with a different adapter (bit-pattern packing, not arithmetic).
    EXPECT_EQ(PackLuid(0x12345678u, 0), 0x0000000012345678ull);
    EXPECT_EQ(PackLuid(0, 1), 0x0000000100000000ull);
    EXPECT_EQ(PackLuid(0xFFFFFFFFu, -1), 0xFFFFFFFFFFFFFFFFull);
    EXPECT_NE(PackLuid(1, 0), PackLuid(0, 1));
}

TEST(CommonTests, DeleteExecuteRejectsPreservedCwpRootTargets)
{
    if (vrcsm::core::ProcessGuard::IsVRChatRunning().running)
    {
        GTEST_SKIP() << "VRChat is running, so ExecutePlan correctly rejects before path validation";
    }

    const auto dir = MakeTempTestDir(L"vrcsm-delete-preserved");
    const auto cwp = dir / L"Cache-WindowsPlayer";
    std::filesystem::create_directories(cwp);
    const auto info = cwp / L"__info";
    const auto version = cwp / L"vrc-version";
    WriteBytes(info, "keep");
    WriteBytes(version, "keep");

    for (const auto& preserved : {info, version})
    {
        vrcsm::core::DeletePlan plan;
        plan.targets.push_back(vrcsm::core::toUtf8(preserved.wstring()));

        const auto result = vrcsm::core::SafeDelete::ExecutePlan(dir, plan);

        ASSERT_FALSE(vrcsm::core::isOk(result));
        EXPECT_EQ(vrcsm::core::error(result).code, "preserved_target");
    }
    EXPECT_TRUE(std::filesystem::exists(info));
    EXPECT_TRUE(std::filesystem::exists(version));

    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

TEST(CommonTests, MigratorPreflightRejectsExistingSourceOutsideVrchatBase)
{
    const auto dir = MakeTempTestDir(L"vrcsm-migrate-outside-source");
    const auto source = dir / L"existing-source";
    const auto target = dir / L"target";
    std::filesystem::create_directories(source);

    const auto result = vrcsm::core::Migrator::preflight(source, target);

    ASSERT_TRUE(vrcsm::core::isOk(result));
    EXPECT_TRUE(ContainsSubstring(
        vrcsm::core::value(result).blockers,
        "detected VRChat cache roots"));

    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

TEST(CommonTests, JunctionRepairRejectsExistingSourceOutsideVrchatBase)
{
    const auto dir = MakeTempTestDir(L"vrcsm-junction-outside-source");
    const auto source = dir / L"existing-source";
    const auto target = dir / L"target";
    std::filesystem::create_directories(source);
    std::filesystem::create_directories(target);

    const nlohmann::json params{
        {"source", vrcsm::core::toUtf8(source.wstring())},
        {"target", vrcsm::core::toUtf8(target.wstring())},
    };

    try
    {
        (void)vrcsm::core::JunctionUtil::Repair(params);
        FAIL() << "junction.repair accepted an existing source outside the VRChat base";
    }
    catch (const std::runtime_error& ex)
    {
        EXPECT_NE(std::string(ex.what()).find("detected VRChat cache roots"), std::string::npos);
    }

    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

TEST(CommonTests, AvatarPreviewCacheKeyIsStableLowerHex)
{
    const auto key1 = vrcsm::core::AvatarPreview::CacheKeyForAvatarId(
        "avtr_164034fd-61d6-410d-892f-9ecc3964817e");
    const auto key2 = vrcsm::core::AvatarPreview::CacheKeyForAvatarId(
        "avtr_164034fd-61d6-410d-892f-9ecc3964817e");

    ASSERT_EQ(key1, key2);
    ASSERT_EQ(key1.size(), 40u);
    EXPECT_TRUE(std::all_of(key1.begin(), key1.end(), [](unsigned char ch) {
        return std::isdigit(ch) || (ch >= 'a' && ch <= 'f');
    }));
}

TEST(CommonTests, AvatarPreviewCacheKeyDiffersAcrossAvatarIds)
{
    const auto key1 = vrcsm::core::AvatarPreview::CacheKeyForAvatarId(
        "avtr_164034fd-61d6-410d-892f-9ecc3964817e");
    const auto key2 = vrcsm::core::AvatarPreview::CacheKeyForAvatarId(
        "avtr_fd30481e-2c05-482d-a979-55a6e77c1ef5");

    EXPECT_NE(key1, key2);
}

TEST(CommonTests, AssetCacheKeepsVerifiedDataOverHints)
{
    const auto dir = MakeTempTestDir(L"vrcsm-asset-cache");
    const auto dbPath = dir / L"vrcsm.db";
    OpenTempDatabase(dbPath);

    vrcsm::core::Database::AssetCacheUpsert verified;
    verified.type = "world";
    verified.id = "wrld_asset_cache_test";
    verified.display_name = "Verified World";
    verified.thumbnail_url = "https://cdn.example/verified.jpg";
    verified.source = "world.details";
    verified.confidence = "verified_api";
    verified.fetched_at = "2026-06-24T00:00:00Z";

    auto upsertVerified = vrcsm::core::Database::Instance().UpsertAssetCache(verified);
    ASSERT_TRUE(vrcsm::core::isOk(upsertVerified)) << vrcsm::core::error(upsertVerified).message;

    const nlohmann::json request = {
        {"items", nlohmann::json::array({
            {
                {"type", "world"},
                {"id", "wrld_asset_cache_test"},
                {"hintName", "Bad Hint"},
                {"hintImageUrl", "https://cdn.example/hint.jpg"},
            },
        })},
    };

    auto resolved = vrcsm::core::Database::Instance().ResolveAssetCache(request);
    ASSERT_TRUE(vrcsm::core::isOk(resolved)) << vrcsm::core::error(resolved).message;
    const auto& payload = vrcsm::core::value(resolved);
    ASSERT_TRUE(payload.contains("results"));
    ASSERT_EQ(payload["results"].size(), 1u);
    EXPECT_EQ(payload["results"][0]["displayName"], "Verified World");
    EXPECT_EQ(payload["results"][0]["thumbnailUrl"], "https://cdn.example/verified.jpg");
    EXPECT_EQ(payload["results"][0]["confidence"], "verified_api");

    vrcsm::core::Database::Instance().Close();
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

TEST(CommonTests, AvatarBenchmarkUpsertPreservesFirstSeenAndRanksByParams)
{
    const auto dir = MakeTempTestDir(L"vrcsm-avatar-benchmark");
    const auto dbPath = dir / L"vrcsm.db";
    OpenTempDatabase(dbPath);

    auto& db = vrcsm::core::Database::Instance();

    vrcsm::core::Database::AvatarBenchmarkInsert light;
    light.avatar_id = "avtr_light";
    light.user_id = "usr_a";
    light.parameter_count = 8;
    light.eye_height = 1.2;
    light.seen_at = "2026-06-01T00:00:00Z";
    ASSERT_TRUE(vrcsm::core::isOk(db.RecordAvatarBenchmark(light)));

    vrcsm::core::Database::AvatarBenchmarkInsert heavy;
    heavy.avatar_id = "avtr_heavy";
    heavy.parameter_count = 80;
    heavy.seen_at = "2026-06-02T00:00:00Z";
    ASSERT_TRUE(vrcsm::core::isOk(db.RecordAvatarBenchmark(heavy)));

    // Re-measure the light avatar with a higher count and a later timestamp.
    // parameter_count must update; first_seen_at must stay at the original.
    vrcsm::core::Database::AvatarBenchmarkInsert lightAgain;
    lightAgain.avatar_id = "avtr_light";
    lightAgain.parameter_count = 12;
    lightAgain.seen_at = "2026-06-05T00:00:00Z";
    ASSERT_TRUE(vrcsm::core::isOk(db.RecordAvatarBenchmark(lightAgain)));

    auto rows = db.AvatarBenchmarks(100, 0);
    ASSERT_TRUE(vrcsm::core::isOk(rows)) << vrcsm::core::error(rows).message;
    const auto& items = vrcsm::core::value(rows);
    ASSERT_EQ(items.size(), 2u);

    // Ordered by parameter_count DESC — heavy first.
    EXPECT_EQ(items[0]["avatar_id"], "avtr_heavy");
    EXPECT_EQ(items[0]["parameter_count"], 80);

    EXPECT_EQ(items[1]["avatar_id"], "avtr_light");
    EXPECT_EQ(items[1]["parameter_count"], 12);
    EXPECT_EQ(items[1]["first_seen_at"], "2026-06-01T00:00:00Z");
    EXPECT_EQ(items[1]["last_seen_at"], "2026-06-05T00:00:00Z");
    EXPECT_EQ(items[1]["eye_height"], 1.2);
    EXPECT_EQ(items[1]["user_id"], "usr_a");

    db.Close();
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

TEST(CommonTests, UnifiedFeedMergesSourcesInTimeOrder)
{
    const auto dir = MakeTempTestDir(L"vrcsm-unified-feed");
    const auto dbPath = dir / L"vrcsm.db";
    OpenTempDatabase(dbPath);

    auto& db = vrcsm::core::Database::Instance();

    // friend_log row (oldest).
    vrcsm::core::Database::FriendLogInsert fl;
    fl.user_id = "usr_feed_a";
    fl.event_type = "online";
    fl.new_value = "active";
    fl.display_name = "Alice";
    fl.occurred_at = "2026-06-24T10:00:00Z";
    ASSERT_TRUE(vrcsm::core::isOk(db.InsertFriendLog(fl)));

    // player_event row (middle).
    vrcsm::core::Database::PlayerEventInsert pe;
    pe.kind = "joined";
    pe.user_id = "usr_feed_a";
    pe.display_name = "Alice";
    pe.world_id = "wrld_feed";
    pe.instance_id = "12345";
    pe.occurred_at = "2026-06-24T11:00:00Z";
    ASSERT_TRUE(vrcsm::core::isOk(db.RecordPlayerEvent(pe)));

    // friend_presence_events row (newest).
    vrcsm::core::Database::FriendPresenceEventInsert fpe;
    fpe.user_id = "usr_feed_a";
    fpe.display_name = "Alice";
    fpe.event_type = "location";
    fpe.world_id = "wrld_feed";
    fpe.instance_id = "12345";
    fpe.new_value = "wrld_feed:12345";
    fpe.source = "pipeline";
    fpe.occurred_at = "2026-06-24T12:00:00Z";
    ASSERT_TRUE(vrcsm::core::isOk(db.RecordFriendPresenceEvent(fpe)));

    // Full feed: newest first, all three source kinds present.
    auto feed = db.UnifiedFeed(50, 0);
    ASSERT_TRUE(vrcsm::core::isOk(feed)) << vrcsm::core::error(feed).message;
    const auto& items = vrcsm::core::value(feed);
    ASSERT_GE(items.size(), 3u);
    EXPECT_EQ(items[0]["source_kind"], "presence");
    EXPECT_EQ(items[0]["occurred_at"], "2026-06-24T12:00:00Z");
    EXPECT_EQ(items[1]["source_kind"], "player_event");
    EXPECT_EQ(items[2]["source_kind"], "friend_log");

    // Filter by source_kind narrows to one stream.
    auto presenceOnly = db.UnifiedFeed(50, 0, std::nullopt, "presence");
    ASSERT_TRUE(vrcsm::core::isOk(presenceOnly));
    const auto& presenceItems = vrcsm::core::value(presenceOnly);
    ASSERT_EQ(presenceItems.size(), 1u);
    EXPECT_EQ(presenceItems[0]["detail"], "wrld_feed:12345");

    // Time-window filter excludes the oldest friend_log row.
    auto windowed = db.UnifiedFeed(50, 0, std::nullopt, std::nullopt, "2026-06-24T10:30:00Z");
    ASSERT_TRUE(vrcsm::core::isOk(windowed));
    EXPECT_EQ(vrcsm::core::value(windowed).size(), 2u);

    db.Close();
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

// Own-algorithm: CoPresenceEgoNetwork reconstructs per-user presence intervals
// inside each (world_id, instance_id) session from raw player_events and emits an
// edge when two users overlap by >= min_overlap_sec. Center-touching edges are
// "confirmed" co-presence; non-center pairs are "co_presence" inference only.
// Timestamps are anchored to "now" so the since-window math is exercised honestly.
TEST(CommonTests, CoPresenceEgoNetworkBuildsConfirmedAndInferredEdges)
{
    const auto dir = MakeTempTestDir(L"vrcsm-copresence");
    const auto dbPath = dir / L"vrcsm.db";
    OpenTempDatabase(dbPath);
    auto& db = vrcsm::core::Database::Instance();

    // UTC ISO string `secsAgo` seconds before now (trailing Z → parsed as UTC).
    auto isoAgo = [](int secsAgo) -> std::string {
        std::time_t t = std::time(nullptr) - static_cast<std::time_t>(secsAgo);
        std::tm gt{};
        gmtime_s(&gt, &t);
        char buf[32];
        std::snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02dZ",
            gt.tm_year + 1900, gt.tm_mon + 1, gt.tm_mday, gt.tm_hour, gt.tm_min, gt.tm_sec);
        return std::string(buf);
    };
    auto ev = [&](const char* kind, const std::string& uid, const std::string& name,
                  const std::string& world, const std::string& inst, int secsAgo) {
        vrcsm::core::Database::PlayerEventInsert e;
        e.kind = kind;
        e.user_id = uid;
        e.display_name = name;
        e.world_id = world;
        e.instance_id = inst;
        e.occurred_at = isoAgo(secsAgo);
        ASSERT_TRUE(vrcsm::core::isOk(db.RecordPlayerEvent(e)));
    };

    const std::string self = "usr_self";

    // Session A in (wrld_x, inst_1) ~1h ago: self present the whole time; Alice
    // overlaps self heavily; Bob overlaps both Alice and self briefly.
    ev("joined", self,        "Me",    "wrld_x", "inst_1", 3600);
    ev("joined", "usr_alice", "Alice", "wrld_x", "inst_1", 3500);
    ev("joined", "usr_bob",   "Bob",   "wrld_x", "inst_1", 3400);
    ev("left",   "usr_bob",   "Bob",   "wrld_x", "inst_1", 3100);  // Bob ~300s
    ev("left",   "usr_alice", "Alice", "wrld_x", "inst_1", 1800);  // Alice ~1700s
    ev("left",   self,        "Me",    "wrld_x", "inst_1", 1700);

    // Session B in (wrld_x, inst_2) — DIFFERENT instance, same world: Carol joins
    // and leaves while NOBODY else is there. Must not connect to session A users.
    ev("joined", "usr_carol", "Carol", "wrld_x", "inst_2", 1000);
    ev("left",   "usr_carol", "Carol", "wrld_x", "inst_2", 100);

    // Session C in (wrld_y, inst_1) — same instance_id as A but DIFFERENT world:
    // Dave joins with a MISSING left (crash). The 4h cap must bound his interval
    // and he should still co-present with self who is briefly there.
    ev("joined", self,       "Me",   "wrld_y", "inst_1", 2000);
    ev("joined", "usr_dave", "Dave", "wrld_y", "inst_1", 1990);
    ev("left",   self,       "Me",   "wrld_y", "inst_1", 1000);
    // (no "left" for Dave)

    auto res = db.CoPresenceEgoNetwork(self, /*since_days=*/90, /*min_overlap_sec=*/60);
    ASSERT_TRUE(vrcsm::core::isOk(res)) << vrcsm::core::error(res).message;
    const auto& g = vrcsm::core::value(res);
    EXPECT_EQ(g["center"], self);

    // Collect nodes by id.
    std::set<std::string> nodeIds;
    for (const auto& n : g["nodes"]) nodeIds.insert(n["user_id"].get<std::string>());
    EXPECT_TRUE(nodeIds.count(self));
    EXPECT_TRUE(nodeIds.count("usr_alice"));
    EXPECT_TRUE(nodeIds.count("usr_bob"));
    EXPECT_TRUE(nodeIds.count("usr_dave"));
    // Carol is alone in her session → no overlap edge, but she IS a node (present).
    EXPECT_TRUE(nodeIds.count("usr_carol"));

    // Index edges by ordered pair.
    auto edgeKind = [&](const std::string& a, const std::string& b) -> std::string {
        std::string s = a, t = b;
        if (s > t) std::swap(s, t);
        for (const auto& e : g["edges"])
        {
            if (e["source"].get<std::string>() == s && e["target"].get<std::string>() == t)
                return e["kind"].get<std::string>();
        }
        return "";
    };

    // Self↔Alice and Self↔Bob and Self↔Dave: confirmed (center-touching).
    EXPECT_EQ(edgeKind(self, "usr_alice"), "confirmed");
    EXPECT_EQ(edgeKind(self, "usr_bob"), "confirmed");
    EXPECT_EQ(edgeKind(self, "usr_dave"), "confirmed");
    // Alice↔Bob overlapped ~300s in session A but neither is the center → inferred.
    EXPECT_EQ(edgeKind("usr_alice", "usr_bob"), "co_presence");
    // Carol shares nothing → no edge to anyone.
    EXPECT_EQ(edgeKind(self, "usr_carol"), "");
    EXPECT_EQ(edgeKind("usr_alice", "usr_carol"), "");

    // Dave's capped (missing-left) interval is bounded: total_seconds must not blow
    // up to the full since-window. With a 4h cap his node time stays well under 5h.
    for (const auto& n : g["nodes"])
    {
        if (n["user_id"].get<std::string>() == "usr_dave")
        {
            EXPECT_LT(n["total_seconds"].get<long long>(), 5 * 3600);
        }
    }

    // min_overlap_sec gate: raise it above Bob's ~300s overlap with self and the
    // self↔bob edge should vanish while self↔alice (~1700s) survives.
    auto strict = db.CoPresenceEgoNetwork(self, 90, 600);
    ASSERT_TRUE(vrcsm::core::isOk(strict));
    const auto& gs = vrcsm::core::value(strict);
    bool selfBob = false, selfAlice = false;
    for (const auto& e : gs["edges"])
    {
        const auto s = e["source"].get<std::string>();
        const auto t = e["target"].get<std::string>();
        if ((s == self && t == "usr_bob") || (s == "usr_bob" && t == self)) selfBob = true;
        if ((s == self && t == "usr_alice") || (s == "usr_alice" && t == self)) selfAlice = true;
    }
    EXPECT_FALSE(selfBob);
    EXPECT_TRUE(selfAlice);

    db.Close();
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

// Own-algorithm: PredictFriendOnlineWindows aggregates online/offline brackets into
// a 168-bucket hour-of-week histogram and ranks the recurring slot first. Sessions
// are built in LOCAL time anchored to "now" so the test is timezone-independent and
// the recency-decay math is exercised without hardcoding float weights.
TEST(CommonTests, PredictFriendOnlineWindowsRanksRecurringSlot)
{
    const auto dir = MakeTempTestDir(L"vrcsm-predict-online");
    const auto dbPath = dir / L"vrcsm.db";
    OpenTempDatabase(dbPath);
    auto& db = vrcsm::core::Database::Instance();

    // Build an ISO-8601 local wall-clock string (no offset → parsed as local) for a
    // given day-offset back from now and an explicit local hour.
    auto localIso = [](int daysAgo, int hour) -> std::string {
        std::time_t base = std::time(nullptr) - static_cast<std::time_t>(daysAgo) * 86400;
        std::tm lt{};
        localtime_s(&lt, &base);
        lt.tm_hour = hour;
        lt.tm_min = 0;
        lt.tm_sec = 0;
        char buf[32];
        std::snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02d",
            lt.tm_year + 1900, lt.tm_mon + 1, lt.tm_mday, lt.tm_hour, lt.tm_min, lt.tm_sec);
        return std::string(buf);
    };
    auto recordSession = [&](int daysAgo, int startHour, int endHour) {
        vrcsm::core::Database::FriendPresenceEventInsert on;
        on.user_id = "usr_pred";
        on.event_type = "online";
        on.occurred_at = localIso(daysAgo, startHour);
        ASSERT_TRUE(vrcsm::core::isOk(db.RecordFriendPresenceEvent(on)));
        vrcsm::core::Database::FriendPresenceEventInsert off;
        off.user_id = "usr_pred";
        off.event_type = "offline";
        off.occurred_at = localIso(daysAgo, endHour);
        ASSERT_TRUE(vrcsm::core::isOk(db.RecordFriendPresenceEvent(off)));
    };

    // Eight distinct days of a recurring 20:00–22:00 local session (weekly cadence
    // implied by spreading them across the last ~8 weeks, same hour each time).
    for (int w = 0; w < 8; ++w)
    {
        recordSession(7 * w + 1, 20, 22);
    }

    auto res = db.PredictFriendOnlineWindows("usr_pred", 3, 4);
    ASSERT_TRUE(vrcsm::core::isOk(res)) << vrcsm::core::error(res).message;
    const auto& out = vrcsm::core::value(res);
    EXPECT_EQ(out["status"], "ok");
    EXPECT_EQ(out["heatmap"].size(), 168u);
    ASSERT_FALSE(out["top_windows"].empty());
    // The recurring slot starts at local hour 20.
    EXPECT_EQ(out["top_windows"][0]["start_hour"], 20);
    EXPECT_GE(static_cast<int>(out["top_windows"][0]["observation_days"]), 2);

    db.Close();
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

TEST(CommonTests, PredictFriendOnlineWindowsReportsInsufficientData)
{
    const auto dir = MakeTempTestDir(L"vrcsm-predict-empty");
    const auto dbPath = dir / L"vrcsm.db";
    OpenTempDatabase(dbPath);
    auto& db = vrcsm::core::Database::Instance();

    // One short session only — well below the sufficiency gate.
    vrcsm::core::Database::FriendPresenceEventInsert on;
    on.user_id = "usr_thin";
    on.event_type = "online";
    on.occurred_at = "2026-06-24T20:00:00Z";
    ASSERT_TRUE(vrcsm::core::isOk(db.RecordFriendPresenceEvent(on)));
    vrcsm::core::Database::FriendPresenceEventInsert off;
    off.user_id = "usr_thin";
    off.event_type = "offline";
    off.occurred_at = "2026-06-24T20:30:00Z";
    ASSERT_TRUE(vrcsm::core::isOk(db.RecordFriendPresenceEvent(off)));

    auto res = db.PredictFriendOnlineWindows("usr_thin", 3, 4);
    ASSERT_TRUE(vrcsm::core::isOk(res)) << vrcsm::core::error(res).message;
    const auto& out = vrcsm::core::value(res);
    EXPECT_EQ(out["status"], "insufficient_data");
    EXPECT_TRUE(out["top_windows"].empty());

    db.Close();
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

// Track L: RecordLogEvent persists into log_events and the unified feed surfaces
// it under the 'log_event' source kind with kind in event_type and payload in
// detail. The kind filter must also narrow to just the log_event branch.
TEST(CommonTests, UnifiedFeedSurfacesLogEvents)
{
    const auto dir = MakeTempTestDir(L"vrcsm-feed-logevent");
    const auto dbPath = dir / L"vrcsm.db";
    OpenTempDatabase(dbPath);

    auto& db = vrcsm::core::Database::Instance();

    vrcsm::core::Database::LogEventInsert ve;
    ve.kind = "videoPlay";
    ve.world_id = "wrld_logevt";
    ve.instance_id = "42";
    ve.detail = "https://example.invalid/clip.mp4";
    ve.occurred_at = "2026-06-25T09:00:00Z";
    ASSERT_TRUE(vrcsm::core::isOk(db.RecordLogEvent(ve)));

    vrcsm::core::Database::LogEventInsert se;
    se.kind = "stickerSpawn";
    se.user_id = "usr_logevt";
    se.display_name = "Dave";
    se.detail = "inv_1234";
    se.occurred_at = "2026-06-25T09:05:00Z";
    ASSERT_TRUE(vrcsm::core::isOk(db.RecordLogEvent(se)));

    auto kindOnly = db.UnifiedFeed(50, 0, std::nullopt, "log_event");
    ASSERT_TRUE(vrcsm::core::isOk(kindOnly)) << vrcsm::core::error(kindOnly).message;
    const auto& items = vrcsm::core::value(kindOnly);
    ASSERT_EQ(items.size(), 2u);
    // Newest first: stickerSpawn precedes videoPlay.
    EXPECT_EQ(items[0]["source_kind"], "log_event");
    EXPECT_EQ(items[0]["event_type"], "stickerSpawn");
    EXPECT_EQ(items[0]["user_id"], "usr_logevt");
    EXPECT_EQ(items[0]["detail"], "inv_1234");
    EXPECT_EQ(items[1]["event_type"], "videoPlay");
    EXPECT_EQ(items[1]["world_id"], "wrld_logevt");
    EXPECT_EQ(items[1]["detail"], "https://example.invalid/clip.mp4");

    db.Close();
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

TEST(CommonTests, AvatarPreviewCacheKeyDiffersAcrossSourceSignatures)
{
    constexpr const char* avatarId = "avtr_164034fd-61d6-410d-892f-9ecc3964817e";
    const auto key1 = vrcsm::core::AvatarPreview::CacheKeyForAvatarSource(
        avatarId,
        "asset:https://example.invalid/a.vrca|100|10");
    const auto key2 = vrcsm::core::AvatarPreview::CacheKeyForAvatarSource(
        avatarId,
        "asset:https://example.invalid/a.vrca|101|10");
    const auto key3 = vrcsm::core::AvatarPreview::CacheKeyForAvatarSource(
        avatarId,
        "asset:https://example.invalid/a.vrca|100|11");

    EXPECT_NE(key1, key2);
    EXPECT_NE(key1, key3);
    EXPECT_EQ(key1.size(), 40u);
}

TEST(CommonTests, AvatarPreviewCachedGlbPathStaysInsidePreviewCacheDir)
{
    const auto cacheDir = vrcsm::core::AvatarPreview::PreviewCacheDir();
    const auto glbPath = vrcsm::core::AvatarPreview::CachedGlbPathForAvatarId(
        "avtr_164034fd-61d6-410d-892f-9ecc3964817e");

    EXPECT_TRUE(vrcsm::core::ensureWithinBase(cacheDir, glbPath));
    EXPECT_EQ(glbPath.extension(), L".glb");
}

TEST(CommonTests, AvatarPreviewSourceGlbPathStaysInsidePreviewCacheDir)
{
    const auto cacheDir = vrcsm::core::AvatarPreview::PreviewCacheDir();
    const auto glbPath = vrcsm::core::AvatarPreview::CachedGlbPathForSource(
        "avtr_164034fd-61d6-410d-892f-9ecc3964817e",
        "cache:C:/VRChat/Cache/__data|42|123");

    EXPECT_TRUE(vrcsm::core::ensureWithinBase(cacheDir, glbPath));
    EXPECT_EQ(glbPath.extension(), L".glb");
}

TEST(CommonTests, AvatarPreviewRetainRejectsOutsidePreviewCache)
{
    const auto dir = MakeTempTestDir(L"vrcsm-preview-retain-outside");
    const auto outsideGlb = dir / L"outside.glb";
    WriteSizedFile(outsideGlb, 32);

    vrcsm::core::AvatarPreview::RetainPreviewPath(outsideGlb);

    EXPECT_FALSE(vrcsm::core::AvatarPreview::IsPreviewPathRetained(outsideGlb));
    vrcsm::core::AvatarPreview::ReleasePreviewPath(outsideGlb);

    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

TEST(CommonTests, AvatarPreviewPreservesBundleInvalidFailureCode)
{
    const auto dir = MakeTempTestDir(L"vrcsm-avatar-preview-invalid");
    const auto bundle = dir / L"invalid.vrca";
    WriteBytes(bundle, "UnityFS");

    const auto result = vrcsm::core::AvatarPreview::Request(
        "avtr_164034fd-61d6-410d-892f-9ecc3964817e",
        dir,
        "",
        vrcsm::core::toUtf8(bundle.wstring()));

    EXPECT_FALSE(result.ok);
    EXPECT_EQ(result.code, "bundle_invalid");

    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

TEST(CommonTests, GlobalSearchMergesFavoriteAndVisitEvidence)
{
    const auto dir = MakeTempTestDir(L"vrcsm-global-search-merge");
    const auto dbPath = dir / L"vrcsm.db";
    OpenTempDatabase(dbPath);

    auto& db = vrcsm::core::Database::Instance();
    ASSERT_TRUE(vrcsm::core::isOk(db.AddFavorite({
        "world",
        "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "Library",
        "Moonlit Workshop",
        "https://thumb.local/worlds/moonlit.png",
        "2026-04-27T10:00:00Z",
        0,
    })));
    ASSERT_TRUE(vrcsm::core::isOk(db.InsertWorldVisit({
        "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:12345~hidden(usr_owner)~region(jp)",
        std::optional<std::string>{"hidden"},
        std::optional<std::string>{"usr_owner"},
        std::optional<std::string>{"jp"},
        "2026-04-27T11:12:00Z",
    })));

    auto result = db.GlobalSearch({
        {"query", "Moonlit"},
        {"includeRemote", "debounced"},
    });

    ASSERT_TRUE(vrcsm::core::isOk(result)) << vrcsm::core::error(result).message;
    const auto& payload = vrcsm::core::value(result);
    ASSERT_EQ(payload.at("mode"), "local");
    ASSERT_TRUE(payload.at("diagnostics").at("remoteSources").empty());
    ASSERT_EQ(payload.at("diagnostics").at("remoteSuppressedReason"), "disabled");
    ASSERT_FALSE(payload.at("items").empty());

    const auto& item = payload.at("items").front();
    EXPECT_EQ(item.at("type"), "world");
    EXPECT_EQ(item.at("id"), "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    EXPECT_EQ(item.at("source").at("kind"), "mixed");
    EXPECT_EQ(item.at("thumbnail").at("kind"), "local-thumb");
    EXPECT_EQ(item.at("thumbnail").at("source"), "thumb.local");
    EXPECT_TRUE(item.at("thumbnail").at("verified").get<bool>());
    EXPECT_GE(item.at("evidence").size(), 2u);

    std::vector<std::string> evidenceKinds;
    for (const auto& evidence : item.at("evidence"))
    {
        evidenceKinds.push_back(evidence.at("kind").get<std::string>());
    }
    EXPECT_TRUE(ContainsSubstring(evidenceKinds, "favorite"));
    EXPECT_TRUE(ContainsSubstring(evidenceKinds, "world_visit"));

    db.Close();
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

TEST(CommonTests, FavoritesClearBySourceKeepsLocalListsAndExposesSource)
{
    // Official favorites sync mirrors VRChat's native groups as separate lists
    // tagged source='official', then replaces that snapshot wholesale on the
    // next sync via ClearFavoritesBySource. Local lists the user curated
    // (source='local') must survive that wipe, and FavoriteLists must report
    // the origin so the UI can distinguish synced groups from local shelves.
    const auto dir = MakeTempTestDir(L"vrcsm-favorites-source");
    const auto dbPath = dir / L"vrcsm.db";
    OpenTempDatabase(dbPath);

    auto& db = vrcsm::core::Database::Instance();

    // A user-curated local favorite (default source = 'local').
    ASSERT_TRUE(vrcsm::core::isOk(db.AddFavorite({
        "avatar",
        "avtr_local-curated-0000-0000-000000000000",
        "My Shelf",
        "Local Pick",
        std::nullopt,
        "2026-04-27T09:00:00Z",
        0,
    })));

    // Two official-synced favorites in distinct VRChat groups.
    vrcsm::core::Database::FavoriteInsert official1;
    official1.type = "avatar";
    official1.target_id = "avtr_official-aaaa-0000-0000-000000000000";
    official1.list_name = "Daily Drivers";
    official1.display_name = "Synced Avatar";
    official1.added_at = "2026-04-27T10:00:00Z";
    official1.sort_order = 0;
    official1.source = "official";
    ASSERT_TRUE(vrcsm::core::isOk(db.AddFavorite(official1)));

    vrcsm::core::Database::FavoriteInsert official2;
    official2.type = "world";
    official2.target_id = "wrld_official-bbbb-0000-0000-000000000000";
    official2.list_name = "Chill Worlds";
    official2.display_name = "Synced World";
    official2.added_at = "2026-04-27T10:01:00Z";
    official2.sort_order = 0;
    official2.source = "official";
    ASSERT_TRUE(vrcsm::core::isOk(db.AddFavorite(official2)));

    // FavoriteLists exposes per-list source.
    {
        auto listsRes = db.FavoriteLists();
        ASSERT_TRUE(vrcsm::core::isOk(listsRes)) << vrcsm::core::error(listsRes).message;
        std::map<std::string, std::string> sourceByList;
        for (const auto& row : vrcsm::core::value(listsRes))
        {
            sourceByList[row.at("list_name").get<std::string>()] =
                row.value("source", std::string{});
        }
        EXPECT_EQ(sourceByList["My Shelf"], "local");
        EXPECT_EQ(sourceByList["Daily Drivers"], "official");
        EXPECT_EQ(sourceByList["Chill Worlds"], "official");
    }

    // Clearing by source wipes every official group but spares local lists.
    ASSERT_TRUE(vrcsm::core::isOk(db.ClearFavoritesBySource("official")));

    {
        auto listsRes = db.FavoriteLists();
        ASSERT_TRUE(vrcsm::core::isOk(listsRes)) << vrcsm::core::error(listsRes).message;
        std::vector<std::string> remaining;
        for (const auto& row : vrcsm::core::value(listsRes))
        {
            remaining.push_back(row.at("list_name").get<std::string>());
        }
        EXPECT_TRUE(ContainsSubstring(remaining, "My Shelf"));
        EXPECT_FALSE(ContainsSubstring(remaining, "Daily Drivers"));
        EXPECT_FALSE(ContainsSubstring(remaining, "Chill Worlds"));
    }

    db.Close();
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

TEST(CommonTests, GlobalSearchKeepsHistoricalAvatarReferenceThumbnailUnverified)
{
    const auto dir = MakeTempTestDir(L"vrcsm-global-search-avatar-reference");
    const auto dbPath = dir / L"vrcsm.db";
    OpenTempDatabase(dbPath);

    auto& db = vrcsm::core::Database::Instance();
    ASSERT_TRUE(vrcsm::core::isOk(db.RecordAvatarSeen({
        "avtr_11111111-2222-3333-4444-555555555555",
        std::optional<std::string>{"public"},
        std::optional<std::string>{"Cyber Jacket"},
        std::optional<std::string>{"Test Author"},
        std::optional<std::string>{"Alice"},
        std::optional<std::string>{"usr_alice"},
        "2026-04-27T12:20:00Z",
    })));
    ASSERT_TRUE(vrcsm::core::isOk(db.UpdateAvatarResolution({
        "avtr_11111111-2222-3333-4444-555555555555",
        std::optional<std::string>{"avtr_different-current-avatar"},
        std::optional<std::string>{"https://example.invalid/current-wearer-thumb.png"},
        std::optional<std::string>{"https://example.invalid/current-wearer-image.png"},
        std::optional<std::string>{"wearer-current-profile"},
        "resolved",
        "2026-04-27T12:30:00Z",
    })));

    auto result = db.GlobalSearch({{"query", "Cyber Jacket"}});

    ASSERT_TRUE(vrcsm::core::isOk(result)) << vrcsm::core::error(result).message;
    const auto& items = vrcsm::core::value(result).at("items");
    ASSERT_FALSE(items.empty());

    const auto& item = items.front();
    EXPECT_EQ(item.at("type"), "avatar");
    EXPECT_EQ(item.at("thumbnail").at("url"), nullptr);
    EXPECT_EQ(item.at("thumbnail").at("verified"), false);
    ASSERT_TRUE(item.at("localStatus").contains("warnings"));

    const auto warnings = item.at("localStatus").at("warnings").dump();
    EXPECT_NE(warnings.find("thumbnail-reference-only"), std::string::npos);

    db.Close();
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

TEST(CommonTests, RecentWorldVisitsIncludesLoggedPlayerCounts)
{
    const auto dir = MakeTempTestDir(L"vrcsm-world-visits-player-count");
    const auto dbPath = dir / L"vrcsm.db";
    OpenTempDatabase(dbPath);

    auto& db = vrcsm::core::Database::Instance();
    const std::string worldId = "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const std::string instanceId = worldId + ":12345~hidden(usr_owner)~region(jp)";

    ASSERT_TRUE(vrcsm::core::isOk(db.InsertWorldVisit({
        worldId,
        instanceId,
        std::optional<std::string>{"hidden"},
        std::optional<std::string>{"usr_owner"},
        std::optional<std::string>{"jp"},
        "2026-04-27T10:00:00Z",
    })));
    ASSERT_TRUE(vrcsm::core::isOk(db.MarkVisitLeft(worldId, instanceId, "2026-04-27T11:00:00Z")));

    ASSERT_TRUE(vrcsm::core::isOk(db.RecordPlayerEvent({
        "joined",
        std::optional<std::string>{"usr_alice"},
        "Alice",
        std::optional<std::string>{worldId},
        std::optional<std::string>{instanceId},
        "2026-04-27T10:05:00Z",
    })));
    ASSERT_TRUE(vrcsm::core::isOk(db.RecordPlayerEvent({
        "joined",
        std::optional<std::string>{"usr_bob"},
        "Bob",
        std::optional<std::string>{worldId},
        std::optional<std::string>{instanceId},
        "2026-04-27T10:10:00Z",
    })));
    ASSERT_TRUE(vrcsm::core::isOk(db.RecordPlayerEvent({
        "left",
        std::optional<std::string>{"usr_alice"},
        "Alice",
        std::optional<std::string>{worldId},
        std::optional<std::string>{instanceId},
        "2026-04-27T10:40:00Z",
    })));
    ASSERT_TRUE(vrcsm::core::isOk(db.RecordPlayerEvent({
        "joined",
        std::optional<std::string>{"usr_late"},
        "Late Player",
        std::optional<std::string>{worldId},
        std::optional<std::string>{instanceId},
        "2026-04-27T11:30:00Z",
    })));

    auto result = db.RecentWorldVisits(10, 0);
    ASSERT_TRUE(vrcsm::core::isOk(result)) << vrcsm::core::error(result).message;
    const auto& rows = vrcsm::core::value(result);
    ASSERT_EQ(rows.size(), 1u);
    EXPECT_EQ(rows[0].at("player_count"), 2);
    EXPECT_EQ(rows[0].at("player_event_count"), 3);
    EXPECT_EQ(rows[0].at("last_player_seen_at"), "2026-04-27T10:40:00Z");

    auto limited = db.RecentWorldVisits(0, 0);
    ASSERT_TRUE(vrcsm::core::isOk(limited)) << vrcsm::core::error(limited).message;
    EXPECT_TRUE(vrcsm::core::value(limited).empty());

    db.Close();
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

TEST(CommonTests, DatabaseOpenDedupesWorldVisitsBeforeUniqueIndex)
{
    const auto dir = MakeTempTestDir(L"vrcsm-world-visits-dedupe");
    const auto dbPath = dir / L"vrcsm.db";

    sqlite3* rawDb = nullptr;
    ASSERT_EQ(sqlite3_open_v2(
        vrcsm::core::toUtf8(dbPath.wstring()).c_str(),
        &rawDb,
        SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE,
        nullptr), SQLITE_OK);
    ASSERT_NE(rawDb, nullptr);
    {
        const auto close = wil::scope_exit([&]() { sqlite3_close_v2(rawDb); });
        ExecSql(rawDb, R"SQL(
CREATE TABLE world_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    access_type TEXT,
    owner_id TEXT,
    region TEXT,
    joined_at TEXT NOT NULL,
    left_at TEXT
);
INSERT INTO world_visits (world_id, instance_id, access_type, owner_id, region, joined_at, left_at)
VALUES
    ('wrld_old', 'wrld_old:12345', 'hidden', 'usr_owner', 'us', '2026-04-27T10:00:00Z', NULL),
    ('wrld_old', 'wrld_old:12345', 'hidden', 'usr_owner', 'us', '2026-04-27T10:00:00Z', '2026-04-27T11:00:00Z'),
    ('wrld_old', 'wrld_old:12345', 'hidden', 'usr_owner', 'us', '2026-04-27T10:00:00Z', '2026-04-27T11:30:00Z'),
    ('wrld_other', 'wrld_other:12345', 'public', NULL, 'jp', '2026-04-28T10:00:00Z', NULL);
)SQL");
    }

    auto& db = vrcsm::core::Database::Instance();
    db.Close();
    auto opened = db.Open(dbPath);
    ASSERT_TRUE(vrcsm::core::isOk(opened)) << vrcsm::core::error(opened).message;
    db.Close();

    ASSERT_EQ(sqlite3_open_v2(
        vrcsm::core::toUtf8(dbPath.wstring()).c_str(),
        &rawDb,
        SQLITE_OPEN_READONLY,
        nullptr), SQLITE_OK);
    ASSERT_NE(rawDb, nullptr);
    {
        const auto close = wil::scope_exit([&]() { sqlite3_close_v2(rawDb); });
        EXPECT_EQ(QueryInt64(rawDb, "SELECT COUNT(*) FROM world_visits;"), 2);
        EXPECT_EQ(QueryInt64(rawDb,
            "SELECT COUNT(*) FROM world_visits "
            "WHERE world_id = 'wrld_old' AND left_at IS NOT NULL;"), 1);
        EXPECT_EQ(QueryInt64(rawDb,
            "SELECT COUNT(*) FROM sqlite_master "
            "WHERE type = 'index' AND name = 'uq_world_visits';"), 1);
    }

    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

// Schema v16 owned_avatars round-trip: Open() must create the cache table,
// UpsertOwnedAvatar must persist every column, and INSERT OR REPLACE on the
// composite (account_user_id, avatar_id) key must overwrite the prior row
// rather than duplicate it.
TEST(CommonTests, DatabaseUpsertOwnedAvatarRoundTripsAndReplaces)
{
    const auto dir = MakeTempTestDir(L"vrcsm-owned-avatars-roundtrip");
    const auto dbPath = dir / L"vrcsm.db";

    auto& db = vrcsm::core::Database::Instance();
    db.Close();
    auto opened = db.Open(dbPath);
    ASSERT_TRUE(vrcsm::core::isOk(opened)) << vrcsm::core::error(opened).message;

    vrcsm::core::Database::OwnedAvatarUpsert first;
    first.account_user_id = "usr_owner";
    first.avatar_id = "avtr_123";
    first.name = "First Name";
    first.description = "first desc";
    first.image_url = "https://example.com/a.png";
    first.release_status = "private";
    first.version = 3;
    first.updated_at = "2026-04-27T10:00:00Z";
    ASSERT_TRUE(vrcsm::core::isOk(db.UpsertOwnedAvatar(first)));

    // Second account owning the same avatar_id must be a distinct row.
    vrcsm::core::Database::OwnedAvatarUpsert other = first;
    other.account_user_id = "usr_other";
    other.name = "Other Owner";
    ASSERT_TRUE(vrcsm::core::isOk(db.UpsertOwnedAvatar(other)));

    // Same composite key with new values must replace, not duplicate.
    vrcsm::core::Database::OwnedAvatarUpsert updated;
    updated.account_user_id = "usr_owner";
    updated.avatar_id = "avtr_123";
    updated.name = "Renamed";
    updated.release_status = "public";
    updated.version = 4;
    // description/image_url/updated_at left empty → bound as NULL.
    ASSERT_TRUE(vrcsm::core::isOk(db.UpsertOwnedAvatar(updated)));

    // Missing required keys must be rejected.
    vrcsm::core::Database::OwnedAvatarUpsert invalid;
    invalid.avatar_id = "avtr_999";  // no account_user_id
    EXPECT_FALSE(vrcsm::core::isOk(db.UpsertOwnedAvatar(invalid)));

    db.Close();

    sqlite3* rawDb = nullptr;
    ASSERT_EQ(sqlite3_open_v2(
        vrcsm::core::toUtf8(dbPath.wstring()).c_str(),
        &rawDb,
        SQLITE_OPEN_READONLY,
        nullptr), SQLITE_OK);
    ASSERT_NE(rawDb, nullptr);
    {
        const auto close = wil::scope_exit([&]() { sqlite3_close_v2(rawDb); });
        // Open() must have migrated the schema to at least v16.
        EXPECT_GE(QueryInt64(rawDb, "PRAGMA user_version;"), 16);
        // Two distinct rows (two accounts), the replace did not add a third.
        EXPECT_EQ(QueryInt64(rawDb, "SELECT COUNT(*) FROM owned_avatars;"), 2);
        EXPECT_EQ(QueryInt64(rawDb,
            "SELECT COUNT(*) FROM owned_avatars WHERE avatar_id = 'avtr_123';"), 2);
        // Replaced row carries the new values.
        EXPECT_EQ(QueryText(rawDb,
            "SELECT name FROM owned_avatars "
            "WHERE account_user_id = 'usr_owner' AND avatar_id = 'avtr_123';"),
            "Renamed");
        EXPECT_EQ(QueryText(rawDb,
            "SELECT release_status FROM owned_avatars "
            "WHERE account_user_id = 'usr_owner' AND avatar_id = 'avtr_123';"),
            "public");
        EXPECT_EQ(QueryInt64(rawDb,
            "SELECT version FROM owned_avatars "
            "WHERE account_user_id = 'usr_owner' AND avatar_id = 'avtr_123';"), 4);
        // Cleared optional columns became NULL on replace.
        EXPECT_EQ(QueryInt64(rawDb,
            "SELECT COUNT(*) FROM owned_avatars "
            "WHERE account_user_id = 'usr_owner' AND avatar_id = 'avtr_123' "
            "AND description IS NULL AND image_url IS NULL;"), 1);
        // The second account's row is untouched.
        EXPECT_EQ(QueryText(rawDb,
            "SELECT name FROM owned_avatars "
            "WHERE account_user_id = 'usr_other' AND avatar_id = 'avtr_123';"),
            "Other Owner");
        // The invalid upsert wrote nothing.
        EXPECT_EQ(QueryInt64(rawDb,
            "SELECT COUNT(*) FROM owned_avatars WHERE avatar_id = 'avtr_999';"), 0);
    }

    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

TEST(CommonTests, UpdatePackageValidationRejectsInstallerOutsideUpdatesDirectory)
{
    const auto dir = MakeTempTestDir(L"vrcsm-update-package-outside");
    const auto installer = dir / L"VRCSM-9.9.9.msi";
    WriteBytes(installer, "not really an msi");

    vrcsm::core::updater::PackageValidationOptions options;
    options.version = "9.9.9";
    options.expectedSize = static_cast<std::uint64_t>(std::filesystem::file_size(installer));

    const auto result = vrcsm::core::updater::ValidateDownloadedPackage(installer, options);

    ASSERT_FALSE(vrcsm::core::isOk(result));
    EXPECT_EQ(vrcsm::core::error(result).code, "update_invalid");

    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

TEST(CommonTests, UpdatePackageValidationAcceptsReleaseAssetFileName)
{
    const std::string fileName = "VRCSM_v9.9.9_x64_Installer.msi";
    const auto installer = vrcsm::core::updater::BuildUpdateTargetPath(fileName);
    std::error_code ec;
    std::filesystem::remove(installer, ec);
    WriteBytes(installer, "not really an msi");

    auto sha = vrcsm::core::updater::ComputeSha256(installer);
    ASSERT_TRUE(vrcsm::core::isOk(sha)) << vrcsm::core::error(sha).message;

    vrcsm::core::updater::PackageValidationOptions options;
    options.version = "9.9.9";
    options.expectedFileName = fileName;
    options.expectedSize = static_cast<std::uint64_t>(std::filesystem::file_size(installer));
    options.expectedSha256 = vrcsm::core::value(sha);

    const auto result = vrcsm::core::updater::ValidateDownloadedPackage(installer, options);

    EXPECT_TRUE(vrcsm::core::isOk(result)) << vrcsm::core::error(result).message;

    std::filesystem::remove(installer, ec);
}

TEST(CommonTests, UpdatePackageValidationRejectsMissingSha256)
{
    const std::string fileName = "VRCSM_v9.9.9_x64_Installer.msi";
    const auto installer = vrcsm::core::updater::BuildUpdateTargetPath(fileName);
    std::error_code ec;
    std::filesystem::remove(installer, ec);
    WriteBytes(installer, "not really an msi");

    vrcsm::core::updater::PackageValidationOptions options;
    options.version = "9.9.9";
    options.expectedFileName = fileName;
    options.expectedSize = static_cast<std::uint64_t>(std::filesystem::file_size(installer));
    // No expectedSha256 — must be rejected fail-closed.

    const auto result = vrcsm::core::updater::ValidateDownloadedPackage(installer, options);

    ASSERT_FALSE(vrcsm::core::isOk(result));
    EXPECT_EQ(vrcsm::core::error(result).code, "update_hash");

    std::filesystem::remove(installer, ec);
}

TEST(CommonTests, UpdatePackageValidationRejectsWrongSha256)
{
    const std::string fileName = "VRCSM_v9.9.9_x64_Installer.msi";
    const auto installer = vrcsm::core::updater::BuildUpdateTargetPath(fileName);
    std::error_code ec;
    std::filesystem::remove(installer, ec);
    WriteBytes(installer, "not really an msi");

    vrcsm::core::updater::PackageValidationOptions options;
    options.version = "9.9.9";
    options.expectedFileName = fileName;
    options.expectedSize = static_cast<std::uint64_t>(std::filesystem::file_size(installer));
    options.expectedSha256 =
        "0000000000000000000000000000000000000000000000000000000000000000";

    const auto result = vrcsm::core::updater::ValidateDownloadedPackage(installer, options);

    ASSERT_FALSE(vrcsm::core::isOk(result));
    EXPECT_EQ(vrcsm::core::error(result).code, "update_hash");

    std::filesystem::remove(installer, ec);
}

TEST(CommonTests, UpdatePackageValidationRejectsPathLikeReleaseAssetFileName)
{
    const std::string fileName = "VRCSM_v9.9.9_x64_Installer.msi";
    const auto installer = vrcsm::core::updater::BuildUpdateTargetPath(fileName);
    std::error_code ec;
    std::filesystem::remove(installer, ec);
    WriteBytes(installer, "not really an msi");

    vrcsm::core::updater::PackageValidationOptions options;
    options.version = "9.9.9";
    options.expectedFileName = "../VRCSM_v9.9.9_x64_Installer.msi";
    options.expectedSize = static_cast<std::uint64_t>(std::filesystem::file_size(installer));

    const auto result = vrcsm::core::updater::ValidateDownloadedPackage(installer, options);

    ASSERT_FALSE(vrcsm::core::isOk(result));
    EXPECT_EQ(vrcsm::core::error(result).code, "update_invalid");
    EXPECT_FALSE(vrcsm::core::updater::IsSafeMsiFileName(options.expectedFileName));

    std::filesystem::remove(installer, ec);
}

TEST(CommonTests, UpdatePackageValidationRejectsWrongReleaseAssetFileName)
{
    const std::string fileName = "VRCSM_v9.9.9_x64_Installer.msi";
    const auto installer = vrcsm::core::updater::BuildUpdateTargetPath(fileName);
    std::error_code ec;
    std::filesystem::remove(installer, ec);
    WriteBytes(installer, "not really an msi");

    vrcsm::core::updater::PackageValidationOptions options;
    options.version = "9.9.9";
    options.expectedFileName = "VRCSM-9.9.9.msi";
    options.expectedSize = static_cast<std::uint64_t>(std::filesystem::file_size(installer));

    const auto result = vrcsm::core::updater::ValidateDownloadedPackage(installer, options);

    ASSERT_FALSE(vrcsm::core::isOk(result));
    EXPECT_EQ(vrcsm::core::error(result).code, "update_invalid");

    std::filesystem::remove(installer, ec);
}

TEST(CommonTests, UpdateInstallCommandLineWaitsBeforeApplyingThenRelaunches)
{
    // The bootstrap must: (1) wait for our process to exit BEFORE msiexec
    // touches the locked files, (2) quote all three paths, (3) request an
    // in-place passive/norestart install, (4) relaunch AFTER the install.
    const std::wstring cmd = vrcsm::core::updater::BuildInstallCommandLine(
        L"C:\\Windows\\System32\\msiexec.exe",
        L"C:\\Users\\me\\AppData\\Local\\VRCSM\\updates\\VRCSM_v9.9.9_x64_Installer.msi",
        L"C:\\Users\\me\\AppData\\Local\\VRCSM\\VRCSM.exe");

    const auto waitPos = cmd.find(L"ping");
    const auto msiexecPos = cmd.find(L"msiexec.exe\" /i");
    const auto startPos = cmd.find(L"start \"\"");

    ASSERT_NE(waitPos, std::wstring::npos);
    ASSERT_NE(msiexecPos, std::wstring::npos);
    ASSERT_NE(startPos, std::wstring::npos);

    // Ordering: wait -> apply -> relaunch.
    EXPECT_LT(waitPos, msiexecPos);
    EXPECT_LT(msiexecPos, startPos);

    // In-place passive install, no auto-restart by msiexec (we relaunch).
    EXPECT_NE(cmd.find(L"/passive"), std::wstring::npos);
    EXPECT_NE(cmd.find(L"/norestart"), std::wstring::npos);

    // Every path is double-quoted.
    EXPECT_NE(cmd.find(L"\"C:\\Windows\\System32\\msiexec.exe\""), std::wstring::npos);
    EXPECT_NE(
        cmd.find(L"\"C:\\Users\\me\\AppData\\Local\\VRCSM\\updates\\VRCSM_v9.9.9_x64_Installer.msi\""),
        std::wstring::npos);
    EXPECT_NE(
        cmd.find(L"\"C:\\Users\\me\\AppData\\Local\\VRCSM\\VRCSM.exe\""),
        std::wstring::npos);

    // Must not begin with a quote — cmd /c would strip it and mangle the chain.
    ASSERT_FALSE(cmd.empty());
    EXPECT_NE(cmd.front(), L'"');
}

TEST(CommonTests, UpdateInstallCommandLineOmitsRelaunchWhenExeUnknown)
{
    const std::wstring cmd = vrcsm::core::updater::BuildInstallCommandLine(
        L"C:\\Windows\\System32\\msiexec.exe",
        L"C:\\Users\\me\\AppData\\Local\\VRCSM\\updates\\VRCSM_v9.9.9_x64_Installer.msi",
        L"");

    // Still installs, but no relaunch clause when the exe path is unknown.
    EXPECT_NE(cmd.find(L"msiexec.exe\" /i"), std::wstring::npos);
    EXPECT_NE(cmd.find(L"/passive"), std::wstring::npos);
    EXPECT_EQ(cmd.find(L"start \"\""), std::wstring::npos);
}

TEST(CommonTests, SteamLinkRestoreTargetAllowsOnlySteamVrRepairRoots)
{
    const std::filesystem::path steam = L"C:\\Steam";
    const std::optional<std::filesystem::path> local = std::filesystem::path(L"C:\\Users\\dwgx\\AppData\\Local");

    EXPECT_TRUE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, steam / L"config" / L"steamvr.vrsettings"));
    EXPECT_TRUE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, steam / L"config" / L"steamvr.vrstats"));
    EXPECT_TRUE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, steam / L"config" / L"vrlink"));
    EXPECT_TRUE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, steam / L"config" / L"remoteclients.vdf"));
    EXPECT_TRUE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, steam / L"steamapps" / L"appmanifest_250820.acf"));
    EXPECT_TRUE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, steam / L"userdata" / L"123" / L"config" / L"localconfig.vdf"));
    EXPECT_TRUE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, steam / L"logs" / L"driver_vrlink.txt"));
    EXPECT_TRUE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, steam / L"logs" / L"vrserver.txt"));
    EXPECT_TRUE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, steam / L"logs" / L"vrmonitor.txt"));
    EXPECT_TRUE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, steam / L"logs" / L"vrclient_vrwebhelper_pairing.txt"));
    EXPECT_TRUE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, *local / L"SteamVR" / L"htmlcache"));
}

TEST(CommonTests, SteamLinkRestoreTargetRejectsOutsideAndPrefixSiblings)
{
    const std::filesystem::path steam = L"C:\\Steam";
    const std::optional<std::filesystem::path> local = std::filesystem::path(L"C:\\Users\\dwgx\\AppData\\Local");

    EXPECT_FALSE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, L"C:\\SteamBackup\\config\\steamvr.vrsettings"));
    EXPECT_FALSE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, steam / L"config" / L"random.txt"));
    EXPECT_FALSE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, steam / L"steamapps" / L"common" / L"SteamVR" / L"bin" / L"win64" / L"vrserver.exe"));
    EXPECT_FALSE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, steam / L"userdata" / L"123" / L"config" / L"config.vdf"));
    EXPECT_FALSE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, steam / L"userdata" / L"abc" / L"config" / L"localconfig.vdf"));
    EXPECT_FALSE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, steam / L"logs" / L"content_log.txt"));
    EXPECT_FALSE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, L"C:\\Users\\dwgx\\AppData\\Local\\SteamVRBackup\\htmlcache"));
    EXPECT_FALSE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, *local / L"SteamVR" / L"htmlcache" / L"UserPrefs.json"));
    EXPECT_FALSE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, L"C:\\Users\\dwgx\\Desktop\\localconfig.vdf"));
    EXPECT_FALSE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, L"..\\Steam\\config\\steamvr.vrsettings"));
}

TEST(CommonTests, SteamLinkBackupSourceAllowsOnlyChildren)
{
    const std::filesystem::path backup = L"C:\\Steam\\config\\vrcsm-vrlink-reset-20260428-010203";

    EXPECT_TRUE(vrcsm::core::VrDiagnostics::IsSteamLinkBackupSourceAllowed(
        backup, backup / L"steamvr-steamvr.vrsettings", false));
    EXPECT_TRUE(vrcsm::core::VrDiagnostics::IsSteamLinkBackupSourceAllowed(
        backup, backup / L"htmlcache", false));
    EXPECT_FALSE(vrcsm::core::VrDiagnostics::IsSteamLinkBackupSourceAllowed(
        backup, backup, false));
    EXPECT_FALSE(vrcsm::core::VrDiagnostics::IsSteamLinkBackupSourceAllowed(
        backup, L"C:\\Steam\\config\\other-backup\\steamvr.vrsettings", false));
    EXPECT_FALSE(vrcsm::core::VrDiagnostics::IsSteamLinkBackupSourceAllowed(
        backup, L"..\\vrcsm-vrlink-reset-20260428-010203\\steamvr.vrsettings", false));
}

TEST(CommonTests, SteamLinkBackupMetadataHelpersRejectEscapes)
{
    const std::filesystem::path steam = L"C:\\Steam";
    const std::optional<std::filesystem::path> local = std::filesystem::path(L"C:\\Users\\dwgx\\AppData\\Local");
    const auto backup = steam / L"config" / L"vrcsm-vrlink-reset-20260428-010203";

    EXPECT_FALSE(vrcsm::core::VrDiagnostics::IsSteamLinkBackupSourceAllowed(
        backup, L"C:\\Users\\dwgx\\Desktop\\localconfig.vdf", false));
    EXPECT_FALSE(vrcsm::core::VrDiagnostics::IsSteamLinkBackupSourceAllowed(
        backup, steam / L"config" / L"vrcsm-vrlink-reset-20260428-010203-evil" / L"steamvr.vrsettings", false));
    EXPECT_FALSE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, steam / L"steamapps" / L"appmanifest_250820.acf.bak"));
    EXPECT_FALSE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, steam / L"config" / L"vrlink" / L"..\\..\\userdata\\123\\config\\config.vdf"));
    EXPECT_FALSE(vrcsm::core::VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
        steam, local, *local / L"SteamVR" / L"..\\SteamVRBackup\\htmlcache"));
}

TEST(CommonTests, PluginPermissionSplitDoesNotLetIpcShellTouchFilesystem)
{
    using vrcsm::core::plugins::PluginRegistry;

    EXPECT_TRUE(PluginRegistry::CanPermissionsInvoke({"ipc:shell"}, "shell.pickFolder").allowed);
    EXPECT_TRUE(PluginRegistry::CanPermissionsInvoke({"ipc:shell"}, "shell.openUrl").allowed);
    EXPECT_FALSE(PluginRegistry::CanPermissionsInvoke({"ipc:shell"}, "fs.listDir").allowed);
    EXPECT_FALSE(PluginRegistry::CanPermissionsInvoke({"ipc:shell"}, "fs.writePlan").allowed);

    EXPECT_TRUE(PluginRegistry::CanPermissionsInvoke({"ipc:fs:listDir"}, "fs.listDir").allowed);
    EXPECT_FALSE(PluginRegistry::CanPermissionsInvoke({"ipc:fs:listDir"}, "fs.writePlan").allowed);
    EXPECT_TRUE(PluginRegistry::CanPermissionsInvoke({"ipc:fs:writePlan"}, "fs.writePlan").allowed);
    EXPECT_FALSE(PluginRegistry::CanPermissionsInvoke({"ipc:fs:writePlan"}, "fs.listDir").allowed);
}

TEST(CommonTests, TruncatedUnityFsMagicOnlyBundleIsNotTrusted)
{
    const auto dir = MakeTempTestDir(L"vrcsm-truncated-unityfs");
    const auto path = dir / L"bad.vrca";
    const std::string url = "https://assets.vrchat.com/test/bad.vrca";

    WriteBytes(path, "UnityFS\0");
    const auto bytes = std::filesystem::file_size(path);
    WriteDownloadMetadata(path, url, bytes);

    EXPECT_FALSE(vrcsm::core::isOk(vrcsm::core::validateUnityBundleStructure(path)));
    EXPECT_FALSE(vrcsm::core::VrcApi::isTrustedBundleFile(url, path));

    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

// ── Wave 2 / Section B: multipart + base64 plumbing (B1) ───────────────

TEST(CommonTests, BuildMultipartFormDataFramesFieldsAndFile)
{
    using vrcsm::core::VrcApi;
    std::vector<VrcApi::MultipartField> fields;
    fields.push_back({"tag", "icon"});
    VrcApi::MultipartFile file{"file", "image.png", "image/png", std::string("\x89PNG\r\n", 6)};

    const auto out = VrcApi::buildMultipartFormData("BOUND123", fields, file);

    // Content-Type carries the boundary verbatim.
    EXPECT_EQ(out.contentType, "multipart/form-data; boundary=BOUND123");

    // Field part framing.
    EXPECT_NE(out.body.find("--BOUND123\r\n"), std::string::npos);
    EXPECT_NE(out.body.find("Content-Disposition: form-data; name=\"tag\"\r\n\r\nicon\r\n"),
              std::string::npos);

    // File part framing with filename + content type.
    EXPECT_NE(out.body.find(
        "Content-Disposition: form-data; name=\"file\"; filename=\"image.png\"\r\n"
        "Content-Type: image/png\r\n\r\n"), std::string::npos);

    // Raw file bytes are embedded verbatim (binary-safe).
    EXPECT_NE(out.body.find(std::string("\x89PNG\r\n", 6)), std::string::npos);

    // Closing boundary terminator.
    EXPECT_NE(out.body.find("--BOUND123--\r\n"), std::string::npos);
    EXPECT_TRUE(out.body.size() > std::string("--BOUND123--\r\n").size() + 6);
}

TEST(CommonTests, DecodeBase64RoundTripsAndRejectsGarbage)
{
    using vrcsm::core::VrcApi;
    // "Hello, VRCSM" base64-encoded.
    const auto decoded = VrcApi::decodeBase64("SGVsbG8sIFZSQ1NN");
    ASSERT_TRUE(decoded.has_value());
    EXPECT_EQ(*decoded, "Hello, VRCSM");

    // Padding + whitespace tolerated.
    const auto withPad = VrcApi::decodeBase64("YWI=\n");
    ASSERT_TRUE(withPad.has_value());
    EXPECT_EQ(*withPad, "ab");

    // Non-base64 characters are rejected.
    EXPECT_FALSE(VrcApi::decodeBase64("not base64!@#$%").has_value());
}


TEST(CommonTests, AvatarPreviewLruSkipsPartFilesAndRetainedGlbs)
{
    const auto dir = vrcsm::core::AvatarPreview::PreviewCacheDir()
        / (L"test-lru-" + std::to_wstring(::GetCurrentProcessId()));
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
    std::filesystem::create_directories(dir, ec);
    const auto oldGlb = dir / L"old.glb";
    const auto oldSidecar = dir / L"old.glb.json";
    const auto retainedGlb = dir / L"retained.glb";
    const auto part = dir / L"download.glb.part";

    WriteSizedFile(oldGlb, 128);
    WriteSizedFile(oldSidecar, 16);
    WriteSizedFile(retainedGlb, 128);
    WriteSizedFile(part, 256);

    const auto oldTime = std::filesystem::file_time_type::clock::now() - std::chrono::hours(24);
    std::filesystem::last_write_time(oldGlb, oldTime, ec);
    ec.clear();
    std::filesystem::last_write_time(retainedGlb, oldTime + std::chrono::hours(1), ec);

    vrcsm::core::AvatarPreview::RetainPreviewPath(retainedGlb);
    EXPECT_TRUE(vrcsm::core::AvatarPreview::IsPreviewPathRetained(retainedGlb));

    vrcsm::core::AvatarPreview::TrimPreviewCacheDirectoryForTests(
        dir,
        128,
        L".glb",
        true);

    EXPECT_FALSE(std::filesystem::exists(oldGlb));
    EXPECT_FALSE(std::filesystem::exists(oldSidecar));
    EXPECT_TRUE(std::filesystem::exists(retainedGlb));
    EXPECT_TRUE(std::filesystem::exists(part));

    vrcsm::core::AvatarPreview::ReleasePreviewPath(retainedGlb);
    std::filesystem::remove_all(dir, ec);
}

TEST(CommonTests, LogAtomsParsePrefixAndWorldInstanceParameters)
{
    const auto parsed = vrcsm::core::ParseVrchatLogLine(
        "2026.06.23 22:11:45 Warning    -  [Behaviour] Joining "
        "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:12345~hidden(usr_11111111-2222-3333-4444-555555555555)~region(JP)~canRequestInvite");

    ASSERT_TRUE(parsed.has_prefix);
    ASSERT_TRUE(parsed.iso_time.has_value());
    EXPECT_EQ(*parsed.iso_time, "2026.06.23 22:11:45");
    EXPECT_EQ(parsed.level, "warn");

    const auto atom = vrcsm::core::ParseVrchatLogAtom(parsed.body);
    ASSERT_TRUE(atom.has_value());
    EXPECT_EQ(atom->kind, vrcsm::core::LogAtomKind::WorldInstance);
    EXPECT_EQ(atom->getOr("world_id"), "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    EXPECT_EQ(
        atom->getOr("instance_id"),
        "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:12345~hidden(usr_11111111-2222-3333-4444-555555555555)~region(JP)~canRequestInvite");
    EXPECT_EQ(atom->getOr("instance_number"), "12345");
    EXPECT_EQ(atom->getOr("access_type"), "hidden");
    EXPECT_EQ(atom->getOr("owner_id"), "usr_11111111-2222-3333-4444-555555555555");
    EXPECT_EQ(atom->getOr("region"), "jp");
    EXPECT_EQ(atom->getOr("can_request_invite"), "true");
}

TEST(CommonTests, LogEventClassifierUsesSharedWorldInstanceParsing)
{
    vrcsm::core::LogTailLine line;
    line.iso_time = "2026.06.23 22:12:00";
    line.line =
        "[Behaviour] Joining "
        "wrld_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee:4242~group(grp_11111111-2222-3333-4444-555555555555)~region(us)";

    auto event = vrcsm::core::ClassifyStreamLine(line);
    ASSERT_TRUE(event.is_object());
    EXPECT_EQ(event["kind"].get<std::string>(), "worldSwitch");
    const auto& data = event["data"];
    EXPECT_EQ(data["world_id"].get<std::string>(), "wrld_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee");
    EXPECT_EQ(data["access_type"].get<std::string>(), "group");
    EXPECT_EQ(data["owner_id"].get<std::string>(), "grp_11111111-2222-3333-4444-555555555555");
    EXPECT_EQ(data["region"].get<std::string>(), "us");
}

TEST(CommonTests, LogAtomsParseVideoPlaybackResolveUrl)
{
    const auto atom = vrcsm::core::ParseVrchatLogAtom(
        "[Video Playback] Attempting to resolve URL 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'");
    ASSERT_TRUE(atom.has_value());
    EXPECT_EQ(atom->kind, vrcsm::core::LogAtomKind::VideoPlay);
    EXPECT_EQ(atom->getOr("url"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
}

TEST(CommonTests, LogEventClassifierEmitsVideoPlay)
{
    vrcsm::core::LogTailLine line;
    line.iso_time = "2026.06.23 22:30:00";
    line.line = "[Video Playback] Resolving URL 'https://example.com/clip.mp4'";

    auto event = vrcsm::core::ClassifyStreamLine(line);
    ASSERT_TRUE(event.is_object());
    EXPECT_EQ(event["kind"].get<std::string>(), "videoPlay");
    EXPECT_EQ(event["data"]["url"].get<std::string>(), "https://example.com/clip.mp4");
}

TEST(CommonTests, LogAtomsParsePortalSpawn)
{
    const auto atom = vrcsm::core::ParseVrchatLogAtom(
        "[Behaviour] Instantiated a (Clone [800004] Portals/PortalInternalDynamic)");
    ASSERT_TRUE(atom.has_value());
    EXPECT_EQ(atom->kind, vrcsm::core::LogAtomKind::PortalSpawn);
}

TEST(CommonTests, LogAtomsParseVoteKickInitiationAndSuccess)
{
    const auto init = vrcsm::core::ParseVrchatLogAtom(
        "[ModerationManager] A vote kick has been initiated against \xD7\x91\xD7\x95\xD7\xA8\xD7\xA7\xD7\xA1 849d, do you agree?");
    ASSERT_TRUE(init.has_value());
    EXPECT_EQ(init->kind, vrcsm::core::LogAtomKind::VoteKick);
    EXPECT_EQ(init->getOr("phase"), "initiated");
    EXPECT_EQ(init->getOr("target"), "\xD7\x91\xD7\x95\xD7\xA8\xD7\xA7\xD7\xA1 849d");

    const auto ok = vrcsm::core::ParseVrchatLogAtom(
        "[ModerationManager] Vote to kick CoolUser 849d succeeded");
    ASSERT_TRUE(ok.has_value());
    EXPECT_EQ(ok->kind, vrcsm::core::LogAtomKind::VoteKick);
    EXPECT_EQ(ok->getOr("phase"), "succeeded");
    EXPECT_EQ(ok->getOr("target"), "CoolUser 849d");

    const auto self = vrcsm::core::ParseVrchatLogAtom(
        "[Behaviour] Received executive message: You have been kicked from the instance by majority vote");
    ASSERT_TRUE(self.has_value());
    EXPECT_EQ(self->kind, vrcsm::core::LogAtomKind::VoteKick);
    EXPECT_EQ(self->getOr("phase"), "self");
    EXPECT_EQ(self->getOr("message"), "You have been kicked from the instance by majority vote");
}

TEST(CommonTests, LogAtomsParseFailedToJoinWithReason)
{
    const auto atom = vrcsm::core::ParseVrchatLogAtom(
        "[Behaviour] Failed to join instance 'wrld_1234:5678' due to 'That instance is full'");
    ASSERT_TRUE(atom.has_value());
    EXPECT_EQ(atom->kind, vrcsm::core::LogAtomKind::JoinBlocked);
    EXPECT_EQ(atom->getOr("reason_kind"), "failed");
    EXPECT_EQ(atom->getOr("location"), "wrld_1234:5678");
    EXPECT_EQ(atom->getOr("reason"), "That instance is full");
}

// Real log lines drop the closing quote on the reason and localize it. Sampled
// verbatim (UTF-8) from output_log_2026-06-29: offline-test-mode rejection with
// an instance tag and a Chinese reason and NO trailing quote.
TEST(CommonTests, LogAtomsParseFailedToJoinRealUnclosedLocalizedReason)
{
    const auto atom = vrcsm::core::ParseVrchatLogAtom(
        "[Behaviour] Failed to join instance "
        "'wrld_4432ea9b-729c-46e3-8eaf-846aa0a37fdd:00635~private(usr_def3682f-6851-4289-82a8-24a44abf9a7f)~region(jp)'"
        " due to '\xE6\x82\xA8\xE6\xAD\xA3\xE5\xA4\x84\xE4\xBA\x8E\xE7\xA6\xBB\xE7\xBA\xBF");
    ASSERT_TRUE(atom.has_value());
    EXPECT_EQ(atom->kind, vrcsm::core::LogAtomKind::JoinBlocked);
    EXPECT_EQ(atom->getOr("reason_kind"), "failed");
    EXPECT_EQ(
        atom->getOr("location"),
        "wrld_4432ea9b-729c-46e3-8eaf-846aa0a37fdd:00635~private(usr_def3682f-6851-4289-82a8-24a44abf9a7f)~region(jp)");
    // Reason is captured despite the missing closing quote.
    EXPECT_EQ(atom->getOr("reason"), "\xE6\x82\xA8\xE6\xAD\xA3\xE5\xA4\x84\xE4\xBA\x8E\xE7\xA6\xBB\xE7\xBA\xBF");
}

TEST(CommonTests, LogEventClassifierEmitsStickerSpawnFlippedOrder)
{
    vrcsm::core::LogTailLine line;
    line.iso_time = "2026.06.23 22:40:00";
    line.line =
        "[StickersManager] User usr_032383a7-748c-4fb2-94e4-bcb928e5de6b (Natsumi-sama) "
        "spawned sticker inv_8b380ee4-9a8a-484e-a0c3-b01290b92c6a";

    auto event = vrcsm::core::ClassifyStreamLine(line);
    ASSERT_TRUE(event.is_object());
    EXPECT_EQ(event["kind"].get<std::string>(), "stickerSpawn");
    const auto& data = event["data"];
    EXPECT_EQ(data["user_id"].get<std::string>(), "usr_032383a7-748c-4fb2-94e4-bcb928e5de6b");
    EXPECT_EQ(data["display_name"].get<std::string>(), "Natsumi-sama");
    EXPECT_EQ(data["inventory_id"].get<std::string>(), "inv_8b380ee4-9a8a-484e-a0c3-b01290b92c6a");
}

// A4 standalone classifier: the VERIFIED VRCX-master pedestal line shape
// ([Network Processing] RPC invoked SwitchAvatar on AvatarPedestal for <name>)
// classifies to avatarPedestalChange and captures the trailing display name.
TEST(CommonTests, LogEventClassifierEmitsAvatarPedestalChange)
{
    vrcsm::core::LogTailLine line;
    line.iso_time = "2026.06.23 22:55:03";
    line.line =
        "[Network Processing] RPC invoked SwitchAvatar on AvatarPedestal for Mona";

    auto event = vrcsm::core::ClassifyStreamLine(line);
    ASSERT_TRUE(event.is_object());
    EXPECT_EQ(event["kind"].get<std::string>(), "avatarPedestal");
    const auto& data = event["data"];
    EXPECT_EQ(data["display_name"].get<std::string>(), "Mona");
}

TEST(CommonTests, LogParserBuildsAtomicReportFromPrefixedVrchatLog)
{
    const auto dir = MakeTempTestDir(L"vrcsm-log-atoms");
    const auto path = dir / L"output_log_2026-06-23_22-10-00.txt";
    WriteBytes(path,
        "2026.06.23 22:10:00 Log        -  User Authenticated: Local User (usr_00000000-0000-0000-0000-000000000000)\n"
        "2026.06.23 22:10:01 Log        -  [Behaviour] Destination set: wrld_cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee:7777~friends(usr_99999999-2222-3333-4444-555555555555)~region(eu)\n"
        "2026.06.23 22:10:02 Log        -  [Behaviour] Joining wrld_cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee:7777~friends(usr_99999999-2222-3333-4444-555555555555)~region(eu)\n"
        "2026.06.23 22:10:03 Log        -  [Behaviour] Joining or Creating Room: Test World\n"
        "2026.06.23 22:10:04 Log        -  [Behaviour] OnPlayerJoined Alice_f76f94e9_542d\n"
        "2026.06.23 22:10:05 Log        -  [Behaviour] OnPlayerJoined Bob (usr_aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb)\n"
        "2026.06.23 22:10:06 Log        -  [Behaviour] Switching Bob to avatar Cool Avatar\n"
        "2026.06.23 22:10:07 Log        -  [AssetBundleDownloadManager] [101] Unpacking Avatar (Cool Avatar by Avatar Author)\n"
        "2026.06.23 22:10:08 Log        -  Loading Avatar Data:avtr_11111111-2222-3333-4444-555555555555\n"
        "2026.06.23 22:10:09 Log        -  [VRC Camera] Took screenshot to: C:\\Users\\dwgx\\Pictures\\VRChat\\shot.png\n");

    const auto report = vrcsm::core::LogParser::parse(dir);
    ASSERT_EQ(report.log_count, 1u);
    ASSERT_TRUE(report.local_user_id.has_value());
    EXPECT_EQ(*report.local_user_id, "usr_00000000-0000-0000-0000-000000000000");

    ASSERT_EQ(report.world_switches.size(), 1u);
    EXPECT_EQ(report.world_switches[0].access_type, "friends");
    ASSERT_TRUE(report.world_switches[0].owner_id.has_value());
    EXPECT_EQ(*report.world_switches[0].owner_id, "usr_99999999-2222-3333-4444-555555555555");
    ASSERT_TRUE(report.world_switches[0].region.has_value());
    EXPECT_EQ(*report.world_switches[0].region, "eu");
    EXPECT_EQ(report.world_names.at("wrld_cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee"), "Test World");

    ASSERT_EQ(report.player_events.size(), 2u);
    EXPECT_EQ(report.player_events[0].display_name, "Alice");
    EXPECT_EQ(report.player_events[1].user_id.value_or(""), "usr_aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb");

    ASSERT_EQ(report.avatar_switches.size(), 1u);
    EXPECT_EQ(report.avatar_switches[0].actor, "Bob");
    ASSERT_TRUE(report.avatar_switches[0].actor_user_id.has_value());
    EXPECT_EQ(*report.avatar_switches[0].actor_user_id, "usr_aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb");
    ASSERT_TRUE(report.avatar_switches[0].author_name.has_value());
    EXPECT_EQ(*report.avatar_switches[0].author_name, "Avatar Author");

    ASSERT_EQ(report.screenshots.size(), 1u);
    EXPECT_EQ(report.screenshots[0].path, "C:\\Users\\dwgx\\Pictures\\VRChat\\shot.png");

    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

// Regression: a single local "Switching <me> to avatar <Name>" must bind that
// name to exactly the NEXT "Loading Avatar Data:avtr_xxx" — not to every
// subsequent load. Before the fix, the pending local name was never cleared
// after binding, so a string of avatar-data loads (fallback/impostor/re-load)
// all inherited one name, producing many distinct ids that all rendered as the
// same avatar (the "5 different avatars all called Runa" bug).
TEST(CommonTests, LogParserDoesNotLeakLocalAvatarNameAcrossLoads)
{
    const auto dir = MakeTempTestDir(L"vrcsm-avatar-name-leak");
    const auto path = dir / L"output_log_2026-06-29_23-49-59.txt";
    WriteBytes(path,
        "2026.06.29 23:50:00 Log        -  User Authenticated: dwgx (usr_00000000-0000-0000-0000-000000000000)\n"
        "2026.06.29 23:50:01 Log        -  [Behaviour] Switching dwgx to avatar Runa\n"
        "2026.06.29 23:50:02 Log        -  Loading Avatar Data:avtr_aaaaaaaa-1111-2222-3333-444444444444\n"
        "2026.06.29 23:50:03 Log        -  Loading Avatar Data:avtr_bbbbbbbb-1111-2222-3333-444444444444\n"
        "2026.06.29 23:50:04 Log        -  [Behaviour] Switching dwgx to avatar Mittens\n"
        "2026.06.29 23:50:05 Log        -  Loading Avatar Data:avtr_cccccccc-1111-2222-3333-444444444444\n");

    const auto report = vrcsm::core::LogParser::parse(dir);

    // The first switch binds only to the first load.
    ASSERT_TRUE(report.avatar_names.count("avtr_aaaaaaaa-1111-2222-3333-444444444444"));
    EXPECT_EQ(report.avatar_names.at("avtr_aaaaaaaa-1111-2222-3333-444444444444").name, "Runa");

    // The second load must NOT inherit "Runa" — there was no switch for it.
    EXPECT_EQ(report.avatar_names.count("avtr_bbbbbbbb-1111-2222-3333-444444444444"), 0u);

    // A later switch binds its own name to the following load.
    ASSERT_TRUE(report.avatar_names.count("avtr_cccccccc-1111-2222-3333-444444444444"));
    EXPECT_EQ(report.avatar_names.at("avtr_cccccccc-1111-2222-3333-444444444444").name, "Mittens");

    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

// Regression: a single log can re-authenticate under a different account when
// the user signs out and back in mid-session. The local identity must follow
// the latest `User Authenticated`, otherwise the second account's own avatar
// switches stop matching `local_user_name` and their names never bind to an
// id — the "names vanished after switching accounts" bug. Found on real logs
// where account A=Mitaka loaded fine but account B=dwgx's avatars came back
// nameless (or stamped with A's leftover pending name).
TEST(CommonTests, LogParserTracksLocalUserAcrossReauth)
{
    const auto dir = MakeTempTestDir(L"vrcsm-reauth-name");
    const auto path = dir / L"output_log_2026-06-29_23-49-59.txt";
    WriteBytes(path,
        "2026.06.29 23:50:00 Log        -  User Authenticated: Mitaka (usr_aaaaaaaa-0000-0000-0000-000000000000)\n"
        "2026.06.29 23:50:01 Log        -  [Behaviour] Switching Mitaka to avatar Runa\n"
        "2026.06.29 23:50:02 Log        -  Loading Avatar Data:avtr_aaaaaaaa-1111-2222-3333-444444444444\n"
        "2026.06.29 23:52:00 Log        -  User Authenticated: dwgx (usr_bbbbbbbb-0000-0000-0000-000000000000)\n"
        "2026.06.29 23:52:01 Log        -  [Behaviour] Switching dwgx to avatar BigCat\n"
        "2026.06.29 23:52:02 Log        -  Loading Avatar Data:avtr_bbbbbbbb-1111-2222-3333-444444444444\n");

    const auto report = vrcsm::core::LogParser::parse(dir);

    // Latest auth wins — local identity is the second account.
    ASSERT_TRUE(report.local_user_name.has_value());
    EXPECT_EQ(*report.local_user_name, "dwgx");

    // Account A's switch bound correctly while it was the local user.
    ASSERT_TRUE(report.avatar_names.count("avtr_aaaaaaaa-1111-2222-3333-444444444444"));
    EXPECT_EQ(report.avatar_names.at("avtr_aaaaaaaa-1111-2222-3333-444444444444").name, "Runa");

    // Account B's switch must also bind — not be dropped for failing to match a
    // frozen first-account identity, and not inherit A's "Runa".
    ASSERT_TRUE(report.avatar_names.count("avtr_bbbbbbbb-1111-2222-3333-444444444444"));
    EXPECT_EQ(report.avatar_names.at("avtr_bbbbbbbb-1111-2222-3333-444444444444").name, "BigCat");

    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

// Track L: the batch parser must populate the five log-event streams from the
// same line formats the live classifier recognizes, so the Logs page shows
// historical video/portal/moderation/sticker events from disk.
TEST(CommonTests, LogParserPopulatesTrackLEventStreams)
{
    const auto dir = MakeTempTestDir(L"vrcsm-log-trackl");
    const auto path = dir / L"output_log_2026-06-23_22-20-00.txt";
    WriteBytes(path,
        "2026.06.23 22:20:00 Log        -  User Authenticated: Local User (usr_00000000-0000-0000-0000-000000000000)\n"
        "2026.06.23 22:20:01 Log        -  [Behaviour] Joining wrld_dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee:5555~public~region(us)\n"
        "2026.06.23 22:20:02 Log        -  [Video Playback] Attempting to resolve URL 'https://example.invalid/clip.mp4'\n"
        "2026.06.23 22:20:03 Log        -  [Behaviour] Instantiated a (Clone [0] Portals/PortalInternalDynamic)\n"
        "2026.06.23 22:20:04 Log        -  [ModerationManager] A vote kick has been initiated against Carol, do you agree?\n"
        "2026.06.23 22:20:05 Log        -  [Behaviour] Failed to join instance 'wrld_dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee:5555' due to 'instance is full'\n"
        "2026.06.23 22:20:06 Log        -  [StickersManager] User usr_aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb (Dave) spawned sticker inv_12345678-1111-2222-3333-444444444444\n");

    const auto report = vrcsm::core::LogParser::parse(dir);
    ASSERT_EQ(report.log_count, 1u);

    ASSERT_EQ(report.video_plays.size(), 1u);
    EXPECT_EQ(report.video_plays[0].url, "https://example.invalid/clip.mp4");
    ASSERT_TRUE(report.video_plays[0].world_id.has_value());
    EXPECT_EQ(*report.video_plays[0].world_id, "wrld_dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee");

    ASSERT_EQ(report.portal_spawns.size(), 1u);

    ASSERT_EQ(report.vote_kicks.size(), 1u);
    ASSERT_TRUE(report.vote_kicks[0].target.has_value());
    EXPECT_EQ(*report.vote_kicks[0].target, "Carol");

    ASSERT_EQ(report.join_blocked.size(), 1u);
    ASSERT_TRUE(report.join_blocked[0].reason.has_value());
    EXPECT_EQ(*report.join_blocked[0].reason, "instance is full");

    ASSERT_EQ(report.sticker_spawns.size(), 1u);
    EXPECT_EQ(report.sticker_spawns[0].user_id, "usr_aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb");
    EXPECT_EQ(report.sticker_spawns[0].display_name, "Dave");
    EXPECT_EQ(report.sticker_spawns[0].inventory_id, "inv_12345678-1111-2222-3333-444444444444");

    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

// Opt-in integration probe: classify every line of the real VRChat logs on this
// machine and print a per-kind tally. Disabled unless VRCSM_REAL_LOG_DIR is set,
// so CI stays hermetic. Run with:
//   VRCSM_REAL_LOG_DIR="<...>/LocalLow/VRChat/VRChat" VRCSM_Tests --gtest_filter=*RealLog*
TEST(CommonTests, RealLogClassificationTally)
{
    const char* dir = std::getenv("VRCSM_REAL_LOG_DIR");
    if (!dir)
    {
        GTEST_SKIP() << "VRCSM_REAL_LOG_DIR not set";
    }

    std::map<std::string, int> tally;
    int totalLines = 0;
    int classified = 0;
    for (const auto& entry : std::filesystem::directory_iterator(dir))
    {
        const auto name = entry.path().filename().string();
        if (name.rfind("output_log_", 0) != 0) continue;
        std::ifstream in(entry.path(), std::ios::binary);
        std::string raw;
        while (std::getline(in, raw))
        {
            ++totalLines;
            vrcsm::core::LogTailLine line;
            line.line = raw;
            const auto ev = vrcsm::core::ClassifyStreamLine(line);
            if (ev.is_object())
            {
                ++classified;
                tally[ev.value("kind", std::string{"?"})] += 1;
            }
        }
    }

    std::cout << "[real-log] scanned " << totalLines << " lines, classified "
              << classified << "\n";
    for (const auto& [kind, count] : tally)
    {
        std::cout << "[real-log]   " << kind << " = " << count << "\n";
    }
    SUCCEED();
}

// ── Wave 2 Section A: golden atom + classifier + batch coverage ──────────

TEST(CommonTests, LogAtomsParseNotification)
{
    const auto atom = vrcsm::core::ParseVrchatLogAtom(
        "[API] Received Notification: <Notification from username:Alice, "
        "sender user id:usr_aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb to of type: friendRequest, "
        "id: not_12345678-1111-2222-3333-444444444444, created at: 2026, type:friendRequest, "
        "details: {}> received at 2026");
    ASSERT_TRUE(atom.has_value());
    EXPECT_EQ(atom->kind, vrcsm::core::LogAtomKind::Notification);
    EXPECT_EQ(atom->getOr("sender_name"), "Alice");
    EXPECT_EQ(atom->getOr("sender_id"), "usr_aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb");
    EXPECT_EQ(atom->getOr("type"), "friendRequest");
    EXPECT_EQ(atom->getOr("notification_id"), "not_12345678-1111-2222-3333-444444444444");
}

TEST(CommonTests, LogAtomsParseVideoErrorBothShapes)
{
    const auto legacy = vrcsm::core::ParseVrchatLogAtom(
        "[Video Playback] ERROR: Failed to load video, error code 5");
    ASSERT_TRUE(legacy.has_value());
    EXPECT_EQ(legacy->kind, vrcsm::core::LogAtomKind::VideoError);
    EXPECT_EQ(legacy->getOr("error_message"), "Failed to load video, error code 5");

    const auto avpro = vrcsm::core::ParseVrchatLogAtom(
        "[AVProVideo] Error: Media loading failed");
    ASSERT_TRUE(avpro.has_value());
    EXPECT_EQ(avpro->kind, vrcsm::core::LogAtomKind::VideoError);
    EXPECT_EQ(avpro->getOr("error_message"), "Media loading failed");
}

TEST(CommonTests, LogAtomsParseAttributedVideoUsharpAndSdk2)
{
    const auto usharp = vrcsm::core::ParseVrchatLogAtom(
        "[USharpVideo] Started video load for URL: https://example.com/a.mp4, requested by Bob");
    ASSERT_TRUE(usharp.has_value());
    EXPECT_EQ(usharp->kind, vrcsm::core::LogAtomKind::AttributedVideoPlay);
    EXPECT_EQ(usharp->getOr("url"), "https://example.com/a.mp4");
    EXPECT_EQ(usharp->getOr("requester"), "Bob");

    const auto sdk2 = vrcsm::core::ParseVrchatLogAtom("User Carol added URL https://example.com/b.mp4");
    ASSERT_TRUE(sdk2.has_value());
    EXPECT_EQ(sdk2->kind, vrcsm::core::LogAtomKind::AttributedVideoPlay);
    EXPECT_EQ(sdk2->getOr("requester"), "Carol");
    EXPECT_EQ(sdk2->getOr("url"), "https://example.com/b.mp4");

    const auto sync = vrcsm::core::ParseVrchatLogAtom(
        "[USharpVideo] Syncing video to https://example.com/c.mp4");
    ASSERT_TRUE(sync.has_value());
    EXPECT_EQ(sync->kind, vrcsm::core::LogAtomKind::VideoSync);
    EXPECT_EQ(sync->getOr("url"), "https://example.com/c.mp4");
}

TEST(CommonTests, LogAtomsParseAppQuitBothNames)
{
    const auto legacy = vrcsm::core::ParseVrchatLogAtom("VRCApplication: OnApplicationQuit at 1234.5");
    ASSERT_TRUE(legacy.has_value());
    EXPECT_EQ(legacy->kind, vrcsm::core::LogAtomKind::AppQuit);
    EXPECT_EQ(legacy->getOr("uptime_seconds"), "1234.5");

    const auto modern = vrcsm::core::ParseVrchatLogAtom("VRCApplication: HandleApplicationQuit at 999");
    ASSERT_TRUE(modern.has_value());
    EXPECT_EQ(modern->kind, vrcsm::core::LogAtomKind::AppQuit);
    EXPECT_EQ(modern->getOr("uptime_seconds"), "999");
}

TEST(CommonTests, LogAtomsParseSessionModeAndDiagnostics)
{
    const auto hmd = vrcsm::core::ParseVrchatLogAtom("STEAMVR HMD Model: Valve Index");
    ASSERT_TRUE(hmd.has_value());
    EXPECT_EQ(hmd->kind, vrcsm::core::LogAtomKind::SessionMode);
    EXPECT_EQ(hmd->getOr("mode"), "vr");
    EXPECT_EQ(hmd->getOr("hmd_model"), "Valve Index");

    const auto desktop = vrcsm::core::ParseVrchatLogAtom("VR Disabled");
    ASSERT_TRUE(desktop.has_value());
    EXPECT_EQ(desktop->kind, vrcsm::core::LogAtomKind::SessionMode);
    EXPECT_EQ(desktop->getOr("mode"), "desktop");

    const auto osc = vrcsm::core::ParseVrchatLogAtom("Could not Start OSC: port in use");
    ASSERT_TRUE(osc.has_value());
    EXPECT_EQ(osc->kind, vrcsm::core::LogAtomKind::OscFail);
    EXPECT_EQ(osc->getOr("reason"), "port in use");

    const auto reset = vrcsm::core::ParseVrchatLogAtom(
        "[ModerationManager] This instance will be reset in 60 minutes due to its age.");
    ASSERT_TRUE(reset.has_value());
    EXPECT_EQ(reset->kind, vrcsm::core::LogAtomKind::InstanceReset);
    EXPECT_EQ(reset->getOr("minutes"), "60");
}

TEST(CommonTests, LogEventClassifierEmitsSectionAKinds)
{
    auto classify = [](const std::string& raw) {
        vrcsm::core::LogTailLine line;
        line.iso_time = "2026.06.23 22:50:00";
        line.line = raw;
        return vrcsm::core::ClassifyStreamLine(line);
    };

    auto notif = classify(
        "[API] Received Notification: <Notification from username:Eve, "
        "sender user id:usr_eeeeeeee-1111-2222-3333-444444444444 to of type: invite, "
        "id: not_eeeeeeee-1111-2222-3333-444444444444, type:invite> received at 2026");
    ASSERT_TRUE(notif.is_object());
    EXPECT_EQ(notif["kind"].get<std::string>(), "notification");
    EXPECT_EQ(notif["data"]["sender_name"].get<std::string>(), "Eve");

    auto quit = classify("VRCApplication: HandleApplicationQuit at 42");
    ASSERT_TRUE(quit.is_object());
    EXPECT_EQ(quit["kind"].get<std::string>(), "vrcQuit");

    auto sync = classify("[USharpVideo] Syncing video to https://example.com/x.mp4");
    ASSERT_TRUE(sync.is_object());
    EXPECT_EQ(sync["kind"].get<std::string>(), "videoSync");
}

// A8 stateful dedupe + A9 cross-line enrichment exercised through the batch parser.
TEST(CommonTests, LogParserPopulatesSectionAStreamsWithStatefulDedupe)
{
    const auto dir = MakeTempTestDir(L"vrcsm-log-sectiona");
    const auto path = dir / L"output_log_2026-06-23_22-55-00.txt";
    WriteBytes(path,
        "2026.06.23 22:55:00 Log        -  User Authenticated: Local User (usr_00000000-0000-0000-0000-000000000000)\n"
        "2026.06.23 22:55:01 Log        -  [Behaviour] Joining wrld_dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee:5555~public~region(us)\n"
        "2026.06.23 22:55:02 Log        -  [Behaviour] OnPlayerJoined Mona (usr_aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb)\n"
        "2026.06.23 22:55:03 Log        -  [Network Processing] RPC invoked SwitchAvatar on AvatarPedestal for Mona\n"
        "2026.06.23 22:55:04 Log        -  [Always] uSpeak: SetInputDevice 0 (3 total) 'Microphone A'\n"
        "2026.06.23 22:55:05 Log        -  [Always] uSpeak: SetInputDevice 0 (3 total) 'Microphone A'\n"
        "2026.06.23 22:55:06 Log        -  [Always] uSpeak: SetInputDevice 0 (3 total) 'Microphone B'\n"
        "2026.06.23 22:55:07 Log        -  Maximum number (384) of shader global keywords exceeded\n"
        "2026.06.23 22:55:08 Log        -  Maximum number (384) of shader global keywords exceeded\n"
        "2026.06.23 22:55:09 Log        -  [Video Playback] ERROR: load failed\n");

    const auto report = vrcsm::core::LogParser::parse(dir);
    ASSERT_EQ(report.log_count, 1u);

    // A9: pedestal event backfilled with the joined player's user id.
    ASSERT_EQ(report.avatar_pedestals.size(), 1u);
    EXPECT_EQ(report.avatar_pedestals[0].display_name, "Mona");
    ASSERT_TRUE(report.avatar_pedestals[0].user_id.has_value());
    EXPECT_EQ(*report.avatar_pedestals[0].user_id, "usr_aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb");

    // A8: audio-device emits only on change (A, then B — the duplicate A is dropped).
    ASSERT_EQ(report.audio_devices.size(), 2u);
    EXPECT_EQ(report.audio_devices[0].device_name, "Microphone A");
    EXPECT_EQ(report.audio_devices[1].device_name, "Microphone B");

    // A8: shader-keyword deduped to a single event within the world context.
    ASSERT_EQ(report.shader_keywords.size(), 1u);

    ASSERT_EQ(report.video_errors.size(), 1u);
    EXPECT_EQ(report.video_errors[0].error_message, "load failed");

    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

// A10: read-only avatar-id harvest from an Amplitude-style analytics cache.
TEST(CommonTests, AvatarIdHarvestExtractsUniqueIdsFromCacheFile)
{
    const auto dir = MakeTempTestDir(L"vrcsm-harvest");
    const auto cache = dir / L"amplitude.cache";
    WriteBytes(cache,
        "{\"event\":\"x\",\"avatar\":\"avtr_11111111-2222-3333-4444-555555555555\"}\n"
        "{\"event\":\"y\",\"avatar\":\"avtr_11111111-2222-3333-4444-555555555555\"}\n"
        "{\"event\":\"z\",\"avatar\":\"avtr_aaaaaaaa-2222-3333-4444-555555555555\"}\n");

    const auto ids = vrcsm::core::AvatarIdHarvest::HarvestFromFile(cache);
    ASSERT_EQ(ids.size(), 2u);
    EXPECT_EQ(ids[0], "avtr_11111111-2222-3333-4444-555555555555");
    EXPECT_EQ(ids[1], "avtr_aaaaaaaa-2222-3333-4444-555555555555");

    // Missing file returns empty without throwing.
    const auto none = vrcsm::core::AvatarIdHarvest::HarvestFromFile(dir / L"nope.cache");
    EXPECT_TRUE(none.empty());

    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

// ── DiscordRpc framing / payload (pure logic, no live pipe) ──────────────

TEST(CommonTests, DiscordRpcEncodeFrameWritesLittleEndianHeader)
{
    const std::string body = R"({"v":1,"client_id":"123"})";
    const std::string frame = vrcsm::core::EncodeFrame(/*opcode=*/0, body);

    ASSERT_EQ(frame.size(), 8u + body.size());

    const auto* bytes = reinterpret_cast<const std::uint8_t*>(frame.data());
    // opcode 0 (HANDSHAKE), little-endian.
    EXPECT_EQ(bytes[0], 0u);
    EXPECT_EQ(bytes[1], 0u);
    EXPECT_EQ(bytes[2], 0u);
    EXPECT_EQ(bytes[3], 0u);
    // length == body.size(), little-endian.
    const std::uint32_t len = static_cast<std::uint32_t>(body.size());
    EXPECT_EQ(bytes[4], static_cast<std::uint8_t>(len & 0xff));
    EXPECT_EQ(bytes[5], static_cast<std::uint8_t>((len >> 8) & 0xff));
    EXPECT_EQ(bytes[6], static_cast<std::uint8_t>((len >> 16) & 0xff));
    EXPECT_EQ(bytes[7], static_cast<std::uint8_t>((len >> 24) & 0xff));
    // Body copied verbatim after the header.
    EXPECT_EQ(frame.substr(8), body);
}

TEST(CommonTests, DiscordRpcDecodeFrameHeaderRoundTripsEncode)
{
    const std::string body = "payload-bytes";
    const std::string frame = vrcsm::core::EncodeFrame(/*opcode=*/1, body);

    std::uint32_t op = 99;
    std::uint32_t len = 0;
    ASSERT_TRUE(vrcsm::core::DecodeFrameHeader(frame.substr(0, 8), op, len));
    EXPECT_EQ(op, 1u);
    EXPECT_EQ(len, body.size());

    // Short header is rejected.
    EXPECT_FALSE(vrcsm::core::DecodeFrameHeader(std::string(4, '\0'), op, len));
}

TEST(CommonTests, DiscordRpcBuildHandshakePayloadShape)
{
    const auto hs = vrcsm::core::BuildHandshakePayload("123456789012345678");
    EXPECT_EQ(hs.value("v", 0), 1);
    EXPECT_EQ(hs.value("client_id", std::string{}), "123456789012345678");
}

TEST(CommonTests, DiscordRpcBuildSetActivityWrapsActivity)
{
    nlohmann::json activity{
        {"state", "In The Great Pug"},
        {"details", "wrld_abc:42"},
    };
    const auto frame = vrcsm::core::BuildSetActivityPayload(
        /*pid=*/4321, activity, /*nonce=*/"nonce-1");

    EXPECT_EQ(frame.value("cmd", std::string{}), "SET_ACTIVITY");
    EXPECT_EQ(frame.value("nonce", std::string{}), "nonce-1");
    ASSERT_TRUE(frame.contains("args"));
    EXPECT_EQ(frame["args"].value("pid", 0), 4321);
    ASSERT_TRUE(frame["args"].contains("activity"));
    EXPECT_EQ(frame["args"]["activity"].value("state", std::string{}), "In The Great Pug");
}

TEST(CommonTests, DiscordRpcBuildSetActivityEmptyClearsToNull)
{
    // An empty object means "clear the panel" — args.activity must be null,
    // never an empty object (Discord rejects {}).
    const auto frame = vrcsm::core::BuildSetActivityPayload(
        /*pid=*/1, nlohmann::json::object(), /*nonce=*/"n");
    ASSERT_TRUE(frame["args"].contains("activity"));
    EXPECT_TRUE(frame["args"]["activity"].is_null());

    // A non-object (e.g. null passed straight through) also clears.
    const auto frame2 = vrcsm::core::BuildSetActivityPayload(
        /*pid=*/1, nlohmann::json(nullptr), /*nonce=*/"n");
    EXPECT_TRUE(frame2["args"]["activity"].is_null());
}

TEST(CommonTests, DiscordRpcPlaceholderClientIdIsEmptyByDesign)
{
    // No real snowflake may be baked in — the integration stays
    // flag-gated-dark until a published VRCSM app id exists.
    EXPECT_STREQ(vrcsm::core::kDiscordPlaceholderClientId, "");
}

// ── ToastNotifier message formatting (pure logic, no Action Center) ──────

TEST(CommonTests, ToastFormatFriendOnlineUsesDisplayNameAndLaunchArg)
{
    const nlohmann::json content = {
        {"userId", "usr_abc"},
        {"user", {{"displayName", "Nova"}}},
    };
    const auto toast = vrcsm::core::FormatPipelineToast("friend-online", content);
    ASSERT_TRUE(toast.has_value());
    EXPECT_EQ(toast->kind, vrcsm::core::ToastKind::FriendOnline);
    EXPECT_EQ(toast->title, "Nova");
    EXPECT_EQ(toast->body, "is now online");
    ASSERT_TRUE(toast->launchArg.has_value());
    EXPECT_EQ(*toast->launchArg, "vrcsm://user/usr_abc");
}

TEST(CommonTests, ToastFormatFriendOnlineDropsNamelessEvent)
{
    // No displayName ⇒ no signal ⇒ no toast (rather than an empty heading).
    const nlohmann::json content = {{"userId", "usr_abc"}};
    EXPECT_FALSE(vrcsm::core::FormatPipelineToast("friend-online", content).has_value());
}

TEST(CommonTests, ToastFormatInviteAndFriendRequestFromNotification)
{
    const nlohmann::json invite = {
        {"id", "not_1"},
        {"type", "invite"},
        {"senderUsername", "Pix"},
        {"senderUserId", "usr_pix"},
    };
    const auto inviteToast = vrcsm::core::FormatPipelineToast("notification", invite);
    ASSERT_TRUE(inviteToast.has_value());
    EXPECT_EQ(inviteToast->kind, vrcsm::core::ToastKind::Invite);
    EXPECT_EQ(inviteToast->body, "Invite from Pix");
    ASSERT_TRUE(inviteToast->launchArg.has_value());
    EXPECT_EQ(*inviteToast->launchArg, "vrcsm://user/usr_pix");

    const nlohmann::json fr = {
        {"id", "not_2"},
        {"type", "friendRequest"},
        {"senderUsername", "Pix"},
    };
    // notification-v2 carries the same shape and must format identically.
    const auto frToast = vrcsm::core::FormatPipelineToast("notification-v2", fr);
    ASSERT_TRUE(frToast.has_value());
    EXPECT_EQ(frToast->kind, vrcsm::core::ToastKind::FriendRequest);
    EXPECT_EQ(frToast->body, "Friend request from Pix");
}

TEST(CommonTests, ToastFormatRejectsNonToastWorthyAndMalformed)
{
    // A notification type we do not toast on.
    const nlohmann::json msg = {{"id", "n"}, {"type", "message"}};
    EXPECT_FALSE(vrcsm::core::FormatPipelineToast("notification", msg).has_value());

    // Unrelated pipeline type.
    EXPECT_FALSE(vrcsm::core::FormatPipelineToast("friend-location",
                                                  nlohmann::json::object())
                     .has_value());

    // Non-object content is treated as untrusted garbage, not crashed on.
    EXPECT_FALSE(vrcsm::core::FormatPipelineToast("friend-online",
                                                  nlohmann::json("oops"))
                     .has_value());
}

TEST(CommonTests, ToastBuildXmlEscapesAndCarriesLaunch)
{
    vrcsm::core::ToastContent c;
    c.kind = vrcsm::core::ToastKind::FriendOnline;
    c.title = "A & B <tag>";
    c.body = "online";
    c.launchArg = "vrcsm://user/usr_x";
    const std::string xml = vrcsm::core::BuildToastXml(c);

    // Heading text is XML-escaped (no raw & or < leaks into the document).
    EXPECT_NE(xml.find("A &amp; B &lt;tag&gt;"), std::string::npos);
    EXPECT_EQ(xml.find("A & B <tag>"), std::string::npos);
    // launch attribute present + foreground activation.
    EXPECT_NE(xml.find(R"(launch="vrcsm://user/usr_x")"), std::string::npos);
    EXPECT_NE(xml.find(R"(activationType="foreground")"), std::string::npos);
    EXPECT_NE(xml.find(R"(template="ToastText02")"), std::string::npos);

    // Without a launch arg, no launch attribute is emitted.
    c.launchArg = std::nullopt;
    const std::string xml2 = vrcsm::core::BuildToastXml(c);
    EXPECT_EQ(xml2.find("launch="), std::string::npos);
}

// ── VR overlay notifier ─────────────────────────────────────────────────

TEST(CommonTests, VrOverlayFormatMirrorsToastEventsAndGating)
{
    // Same events as the desktop toast surface in VR with the same title/body.
    const nlohmann::json online = {
        {"userId", "usr_abc"},
        {"user", {{"displayName", "Nova"}}},
    };
    const auto n = vrcsm::core::FormatOverlayNotification("friend-online", online);
    ASSERT_TRUE(n.has_value());
    EXPECT_EQ(n->title, "Nova");
    EXPECT_EQ(n->body, "is now online");

    const nlohmann::json invite = {
        {"id", "not_1"},
        {"type", "invite"},
        {"senderUsername", "Pix"},
        {"senderUserId", "usr_pix"},
    };
    const auto inv = vrcsm::core::FormatOverlayNotification("notification", invite);
    ASSERT_TRUE(inv.has_value());
    EXPECT_EQ(inv->body, "Invite from Pix");

    // Non-notable events are dropped, exactly like the toast formatter — the
    // two channels never drift apart.
    const nlohmann::json msg = {{"id", "n"}, {"type", "message"}};
    EXPECT_FALSE(vrcsm::core::FormatOverlayNotification("notification", msg).has_value());
    EXPECT_FALSE(vrcsm::core::FormatOverlayNotification("friend-location",
                                                        nlohmann::json::object())
                     .has_value());
    // Untrusted non-object content is rejected, not crashed on.
    EXPECT_FALSE(vrcsm::core::FormatOverlayNotification("friend-online",
                                                        nlohmann::json("oops"))
                     .has_value());
}

TEST(CommonTests, VrOverlayBuildsXsOverlayPopupSchema)
{
    vrcsm::core::OverlayNotification n;
    n.title = "Nova";
    n.body = "is now online";
    const nlohmann::json payload = vrcsm::core::BuildXsOverlayJson(n);

    // Documented XSOverlay Notifications API shape: a popup (messageType 1)
    // carrying our title/content, default chime, and VRCSM source tag.
    EXPECT_EQ(payload.at("messageType").get<int>(), 1);
    EXPECT_EQ(payload.at("title").get<std::string>(), "Nova");
    EXPECT_EQ(payload.at("content").get<std::string>(), "is now online");
    EXPECT_EQ(payload.at("audioPath").get<std::string>(), "default");
    EXPECT_EQ(payload.at("sourceApp").get<std::string>(), "VRCSM");
    EXPECT_GT(payload.at("timeout").get<double>(), 0.0);
}

// ── SafeDelete::ExecutePlan happy path (Audit TOP-5 #2) ──────────────────
// Builds a hex-style Cache-WindowsPlayer tree, plans a delete via the real
// Plan() enumeration, and asserts the deletable entries are removed, the
// preserved root markers (__info, vrc-version) survive, and the returned
// count matches remove_all semantics (children + each entry directory).
TEST(CommonTests, DeleteExecuteRemovesEntriesAndKeepsPreservedRootMarkers)
{
    if (vrcsm::core::ProcessGuard::IsVRChatRunning().running)
    {
        GTEST_SKIP() << "VRChat is running, so ExecutePlan rejects before deleting";
    }

    const auto dir = MakeTempTestDir(L"vrcsm-delete-happy");
    const auto cwp = dir / L"Cache-WindowsPlayer";
    std::filesystem::create_directories(cwp);

    // Preserved root markers that a bulk delete must never touch.
    WriteBytes(cwp / L"__info", "keep");
    WriteBytes(cwp / L"vrc-version", "keep");

    // Two hex-named cache entries, each carrying __info + __data.
    const auto entry1 = cwp / L"a1b2c3d4";
    const auto entry2 = cwp / L"deadbeef";
    std::filesystem::create_directories(entry1);
    std::filesystem::create_directories(entry2);
    WriteBytes(entry1 / L"__info", "x");
    WriteBytes(entry1 / L"__data", "yy");
    WriteBytes(entry2 / L"__info", "x");
    WriteBytes(entry2 / L"__data", "yy");

    // The real planner enumerates the category root and drops the preserved
    // markers, leaving only the two entry directories as targets.
    const auto plan = vrcsm::core::SafeDelete::Plan(
        dir, "cache_windows_player", std::nullopt);
    ASSERT_EQ(plan.targets.size(), 2u);
    for (const auto& t : plan.targets)
    {
        EXPECT_EQ(t.find("__info"), std::string::npos) << t;
        EXPECT_EQ(t.find("vrc-version"), std::string::npos) << t;
    }

    const auto result = vrcsm::core::SafeDelete::ExecutePlan(dir, plan);
    ASSERT_TRUE(vrcsm::core::isOk(result)) << vrcsm::core::error(result).message;
    // Each entry: 2 files + the directory itself = 3; two entries = 6.
    EXPECT_EQ(vrcsm::core::value(result), 6u);

    EXPECT_FALSE(std::filesystem::exists(entry1));
    EXPECT_FALSE(std::filesystem::exists(entry2));
    EXPECT_TRUE(std::filesystem::exists(cwp / L"__info"));
    EXPECT_TRUE(std::filesystem::exists(cwp / L"vrc-version"));

    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

// ── Migrator::execute real junction happy path (Audit #4) ────────────────
// Exercises the irreversible copy → verify → swap → junction → verify →
// backup-cleanup path against a controlled temp tree. execute() takes a plan
// directly, so we bypass preflight's cache-root gate (which is pinned to the
// machine's real VRChat base and must never be touched) while still driving
// the genuine junction machinery. Junctions (IO_REPARSE_TAG_MOUNT_POINT) need
// no admin rights on NTFS, but if the temp volume can't create one we skip
// rather than fail flakily.
TEST(CommonTests, MigratorExecuteEstablishesJunctionAndCleansBackup)
{
    if (vrcsm::core::ProcessGuard::IsVRChatRunning().running)
    {
        GTEST_SKIP() << "VRChat is running, so execute() aborts before copying";
    }

    const auto dir = MakeTempTestDir(L"vrcsm-migrate-exec");
    const auto source = dir / L"source";
    const auto target = dir / L"target"; // execute() creates this
    std::filesystem::create_directories(source / L"sub");
    WriteBytes(source / L"a.txt", "hello");
    WriteBytes(source / L"sub" / L"b.txt", "world");

    vrcsm::core::MigratePlan plan;
    plan.source = vrcsm::core::toUtf8(source.wstring());
    plan.target = vrcsm::core::toUtf8(target.wstring());
    // blockers intentionally empty: we are testing execute(), not preflight.

    const auto result = vrcsm::core::Migrator::execute(plan, nullptr);
    if (!vrcsm::core::isOk(result))
    {
        const auto& err = vrcsm::core::error(result);
        if (err.code.rfind("junction", 0) == 0)
        {
            GTEST_SKIP() << "junction creation unsupported in this env: " << err.message;
        }
        FAIL() << "execute failed: " << err.code << " / " << err.message;
    }

    const auto& summary = vrcsm::core::value(result);
    EXPECT_TRUE(summary.ok);

    // Source is now a junction that resolves to the copied target data.
    EXPECT_TRUE(vrcsm::core::JunctionUtil::isReparsePoint(source));
    {
        std::ifstream a(source / L"a.txt", std::ios::binary);
        std::string contents((std::istreambuf_iterator<char>(a)),
                             std::istreambuf_iterator<char>());
        EXPECT_EQ(contents, "hello");
    }
    {
        std::ifstream b(target / L"sub" / L"b.txt", std::ios::binary);
        std::string contents((std::istreambuf_iterator<char>(b)),
                             std::istreambuf_iterator<char>());
        EXPECT_EQ(contents, "world");
    }

    // Backup sidecar dropped on the clean-finish path.
    const std::filesystem::path backup = source.wstring() + L".vrcsm-bak";
    EXPECT_FALSE(std::filesystem::exists(backup));

    // Unlink the junction before removing the tree so cleanup can't follow it.
    (void)vrcsm::core::JunctionUtil::removeJunction(source);
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

// ── Migrator::execute rollback guard: stale backup blocks the swap ───────
// A leftover <source>.vrcsm-bak from a prior failed run must stop execute()
// before it renames the source away, so the user's cache is left byte-for-byte
// intact rather than half-migrated. This is the deterministic rollback-safety
// branch (the rename→junction-failure→restore path can't be forced without
// privilege/filesystem injection, so it isn't asserted here).
TEST(CommonTests, MigratorExecuteRefusesWhenStaleBackupExists)
{
    if (vrcsm::core::ProcessGuard::IsVRChatRunning().running)
    {
        GTEST_SKIP() << "VRChat is running, so execute() aborts before the backup check";
    }

    const auto dir = MakeTempTestDir(L"vrcsm-migrate-backup-guard");
    const auto source = dir / L"source";
    const auto target = dir / L"target";
    std::filesystem::create_directories(source);
    WriteBytes(source / L"a.txt", "keep");

    // Plant a stale backup exactly where execute() would rename the source.
    const std::filesystem::path backup = source.wstring() + L".vrcsm-bak";
    WriteBytes(backup, "stale");

    vrcsm::core::MigratePlan plan;
    plan.source = vrcsm::core::toUtf8(source.wstring());
    plan.target = vrcsm::core::toUtf8(target.wstring());

    const auto result = vrcsm::core::Migrator::execute(plan, nullptr);
    ASSERT_FALSE(vrcsm::core::isOk(result));
    EXPECT_EQ(vrcsm::core::error(result).code, "backup_exists");

    // Source untouched: still a real directory with its original file, never
    // turned into a junction.
    EXPECT_FALSE(vrcsm::core::JunctionUtil::isReparsePoint(source));
    EXPECT_TRUE(std::filesystem::exists(source / L"a.txt"));

    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}

// ── UdonVMException classification golden line (Audit #10) ────────────────
TEST(CommonTests, LogAtomsClassifyUdonVmException)
{
    const auto atom = vrcsm::core::ParseVrchatLogAtom(
        "VRC.Udon.VM.UdonVMException: An exception occurred during Udon VM execution!");
    ASSERT_TRUE(atom.has_value());
    EXPECT_EQ(atom->kind, vrcsm::core::LogAtomKind::UdonException);
    EXPECT_EQ(atom->getOr("message"),
              "An exception occurred during Udon VM execution!");
}


// ── SafeDelete unlinks a nested junction without recursing (Audit #12) ────
// A junction planted inside a deletable Cache-WindowsPlayer entry must be
// unlinked (its link entry dropped) rather than followed — otherwise the
// walk would delete data living outside the cache root. Exercises the
// reparse branch in removeTreeNoFollow (SafeDelete.cpp:116-122).
TEST(CommonTests, SafeDeleteUnlinksNestedJunctionWithoutRecursing)
{
    if (vrcsm::core::ProcessGuard::IsVRChatRunning().running)
    {
        GTEST_SKIP() << "VRChat is running; ExecutePlan short-circuits before the walk";
    }

    const auto dir = MakeTempTestDir(L"vrcsm-delete-junction");
    const auto cwp = dir / L"Cache-WindowsPlayer";
    const auto entry = cwp / L"deadbeefdeadbeef";   // a normal deletable cache entry
    std::filesystem::create_directories(entry);
    WriteBytes(entry / L"__data", "payload");

    // Data that lives OUTSIDE the cache root and must survive the delete.
    const auto outside = dir / L"outside-precious";
    std::filesystem::create_directories(outside);
    WriteBytes(outside / L"keep.txt", "must-not-be-deleted");

    // Plant a junction inside the deletable entry pointing at the outside dir.
    const auto link = entry / L"link-to-outside";
    const auto created = vrcsm::core::JunctionUtil::createJunction(link, outside);
    if (!vrcsm::core::isOk(created))
    {
        std::error_code cleanupEc;
        std::filesystem::remove_all(dir, cleanupEc);
        GTEST_SKIP() << "Junction creation unsupported here: "
                     << vrcsm::core::error(created).message;
    }
    ASSERT_TRUE(vrcsm::core::JunctionUtil::isReparsePoint(link));

    vrcsm::core::DeletePlan plan;
    plan.targets.push_back(vrcsm::core::toUtf8(entry.wstring()));
    const auto result = vrcsm::core::SafeDelete::ExecutePlan(dir, plan);
    ASSERT_TRUE(vrcsm::core::isOk(result)) << vrcsm::core::error(result).message;

    // The entry (and its junction link entry) are gone …
    EXPECT_FALSE(std::filesystem::exists(entry));
    // … but the data the junction pointed at was never followed/deleted.
    EXPECT_TRUE(std::filesystem::exists(outside / L"keep.txt"));

    vrcsm::core::Database::Instance().Close();
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}


// ── ClearHistory / ClearTables allowlist behavior (Audit #13) ─────────────
// ClearHistory wipes only the history tables it owns and leaves rebuildable
// caches (avatar_benchmark) untouched. ClearTables clears exactly the
// allowlisted names it is handed, and an unknown table name is a HARD error
// (Database_Analytics.cpp:530-534) rather than a silent skip.
TEST(CommonTests, ClearHistoryAndClearTablesRespectAllowlist)
{
    const auto dir = MakeTempTestDir(L"vrcsm-clear-history");
    const auto dbPath = dir / L"vrcsm.db";
    OpenTempDatabase(dbPath);
    auto& db = vrcsm::core::Database::Instance();

    // Seed a history row (avatar_history) and a rebuildable-cache row
    // (avatar_benchmark) that ClearHistory must NOT touch.
    vrcsm::core::Database::AvatarSeenInsert seen;
    seen.avatar_id = "avtr_clear-history-0000-0000-000000000000";
    seen.avatar_name = "Seen Avatar";
    seen.first_seen_at = "2026-05-01T12:00:00Z";
    ASSERT_TRUE(vrcsm::core::isOk(db.RecordAvatarSeen(seen)));

    vrcsm::core::Database::AvatarBenchmarkInsert bench;
    bench.avatar_id = "avtr_bench-0000-0000-0000-000000000000";
    bench.parameter_count = 128;
    bench.seen_at = "2026-05-01T12:00:00Z";
    ASSERT_TRUE(vrcsm::core::isOk(db.RecordAvatarBenchmark(bench)));

    // ClearHistory clears avatar_history but preserves the benchmark cache.
    ASSERT_TRUE(vrcsm::core::isOk(db.ClearHistory()));

    // Unknown table name must hard-error, never silently skip.
    {
        auto bad = db.ClearTables({"avatar_benchmark", "not_a_real_table"});
        ASSERT_FALSE(vrcsm::core::isOk(bad));
        EXPECT_EQ(vrcsm::core::error(bad).code, "db_invalid_argument");
    }

    // Because the whole request is validated before any DELETE, the failed
    // call above must NOT have cleared avatar_benchmark. Clear it explicitly.
    ASSERT_TRUE(vrcsm::core::isOk(db.ClearTables({"avatar_benchmark"})));

    db.Close();

    sqlite3* rawDb = nullptr;
    ASSERT_EQ(sqlite3_open_v2(
        vrcsm::core::toUtf8(dbPath.wstring()).c_str(),
        &rawDb, SQLITE_OPEN_READONLY, nullptr), SQLITE_OK);
    {
        const auto close = wil::scope_exit([&]() { sqlite3_close_v2(rawDb); });
        // History cleared by ClearHistory.
        EXPECT_EQ(QueryInt64(rawDb, "SELECT COUNT(*) FROM avatar_history;"), 0);
        // Benchmark survived ClearHistory AND the failed ClearTables call, and
        // was only removed by the final explicit (valid) ClearTables call.
        EXPECT_EQ(QueryInt64(rawDb, "SELECT COUNT(*) FROM avatar_benchmark;"), 0);
    }

    std::error_code clearEc;
    std::filesystem::remove_all(dir, clearEc);
}


// ── v18 source backfill touches only legacy rows, idempotently (Audit #14) ─
// A pre-v18 local_favorites table lacks the `source` column. On re-open the
// v18 migration (Database.cpp:826-861) adds the column (default 'local') and
// backfills source='official' for exactly the legacy "VRChat Official
// Favorites" list, leaving the user's own lists as 'local'. A second re-open
// must be a no-op (the column-probe short-circuits the whole block).
TEST(CommonTests, DatabaseV18SourceBackfillTouchesOnlyLegacyOfficialRows)
{
    const auto dir = MakeTempTestDir(L"vrcsm-v18-backfill");
    const auto dbPath = dir / L"vrcsm.db";

    // Hand-build a pre-v18 database: local_favorites WITHOUT the source column,
    // one legacy official row + one local row, user_version pinned below 18.
    {
        sqlite3* rawDb = nullptr;
        ASSERT_EQ(sqlite3_open_v2(
            vrcsm::core::toUtf8(dbPath.wstring()).c_str(),
            &rawDb, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nullptr), SQLITE_OK);
        const auto close = wil::scope_exit([&]() { sqlite3_close_v2(rawDb); });

        ExecSql(rawDb,
            "CREATE TABLE local_favorites ("
            "  type TEXT NOT NULL, target_id TEXT NOT NULL, list_name TEXT NOT NULL,"
            "  display_name TEXT, thumbnail_url TEXT, added_at TEXT NOT NULL,"
            "  sort_order INTEGER DEFAULT 0,"
            "  PRIMARY KEY (type, target_id, list_name));");
        ExecSql(rawDb,
            "INSERT INTO local_favorites (type, target_id, list_name, added_at) VALUES "
            "('avatar', 'avtr_legacy-0000-0000-0000-000000000000',"
            "  'VRChat Official Favorites', '2026-01-01T00:00:00Z'),"
            "('avatar', 'avtr_mine-0000-0000-0000-000000000000',"
            "  'My Library', '2026-01-01T00:00:00Z');");
        ExecSql(rawDb, "PRAGMA user_version = 17;");
    }

    auto& db = vrcsm::core::Database::Instance();

    // First re-open runs the v18 backfill.
    db.Close();
    {
        auto opened = db.Open(dbPath);
        ASSERT_TRUE(vrcsm::core::isOk(opened)) << vrcsm::core::error(opened).message;
    }
    db.Close();

    const auto officialCountSql =
        "SELECT COUNT(*) FROM local_favorites WHERE source = 'official';";
    const auto legacySourceSql =
        "SELECT source FROM local_favorites "
        "WHERE list_name = 'VRChat Official Favorites';";
    const auto mineSourceSql =
        "SELECT source FROM local_favorites WHERE list_name = 'My Library';";

    {
        sqlite3* rawDb = nullptr;
        ASSERT_EQ(sqlite3_open_v2(
            vrcsm::core::toUtf8(dbPath.wstring()).c_str(),
            &rawDb, SQLITE_OPEN_READONLY, nullptr), SQLITE_OK);
        const auto close = wil::scope_exit([&]() { sqlite3_close_v2(rawDb); });
        EXPECT_GE(QueryInt64(rawDb, "PRAGMA user_version;"), 18);
        // Only the legacy official list was backfilled.
        EXPECT_EQ(QueryInt64(rawDb, officialCountSql), 1);
        EXPECT_EQ(QueryText(rawDb, legacySourceSql), "official");
        EXPECT_EQ(QueryText(rawDb, mineSourceSql), "local");
    }

    // Second re-open must be idempotent: the column already exists so the whole
    // backfill block is skipped and counts are unchanged.
    {
        auto opened = db.Open(dbPath);
        ASSERT_TRUE(vrcsm::core::isOk(opened)) << vrcsm::core::error(opened).message;
    }
    db.Close();

    {
        sqlite3* rawDb = nullptr;
        ASSERT_EQ(sqlite3_open_v2(
            vrcsm::core::toUtf8(dbPath.wstring()).c_str(),
            &rawDb, SQLITE_OPEN_READONLY, nullptr), SQLITE_OK);
        const auto close = wil::scope_exit([&]() { sqlite3_close_v2(rawDb); });
        EXPECT_EQ(QueryInt64(rawDb, officialCountSql), 1);
        EXPECT_EQ(QueryText(rawDb, legacySourceSql), "official");
        EXPECT_EQ(QueryText(rawDb, mineSourceSql), "local");
    }

    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}


// ── Post-split TU round-trips: Recordings / Rules / Embeddings (Audit #16) ─
// Smoke the bindings that moved when Database was split into per-domain TUs.
// The Rules leg doubles as the A4 regression: UpdateRule must bind values via
// sqlite3_bind_text, so a name containing a single quote round-trips verbatim
// instead of breaking (or injecting into) the SQL.
TEST(CommonTests, PostSplitTranslationUnitsRoundTrip)
{
    const auto dir = MakeTempTestDir(L"vrcsm-tu-roundtrip");
    const auto dbPath = dir / L"vrcsm.db";
    OpenTempDatabase(dbPath);
    auto& db = vrcsm::core::Database::Instance();

    // ── Recordings TU ──
    {
        vrcsm::core::Database::EventRecordingInsert rec;
        rec.name = "Weekly Meetup";
        rec.world_id = "wrld_meetup-0000-0000-0000-000000000000";
        auto started = db.StartRecording(rec);
        ASSERT_TRUE(vrcsm::core::isOk(started)) << vrcsm::core::error(started).message;
        const auto recId = vrcsm::core::value(started).at("id").get<std::int64_t>();

        ASSERT_TRUE(vrcsm::core::isOk(
            db.AddAttendee(recId, "usr_attendee-0000", "Attendee One")));
        ASSERT_TRUE(vrcsm::core::isOk(db.StopRecording(recId)));

        auto listed = db.ListRecordings(10);
        ASSERT_TRUE(vrcsm::core::isOk(listed)) << vrcsm::core::error(listed).message;
        const auto& recordings = vrcsm::core::value(listed).at("recordings");
        ASSERT_EQ(recordings.size(), 1u);
        EXPECT_EQ(recordings[0].at("name").get<std::string>(), "Weekly Meetup");

        auto attendees = db.RecordingAttendees(recId);
        ASSERT_TRUE(vrcsm::core::isOk(attendees)) << vrcsm::core::error(attendees).message;
        EXPECT_EQ(vrcsm::core::value(attendees).at("attendees").size(), 1u);
    }

    // ── Rules TU (+ A4 injection regression) ──
    {
        vrcsm::core::Database::RuleInsert rule;
        rule.name = "Original Rule";
        rule.dsl_yaml = "when: join\nthen: noop";
        rule.cooldown_seconds = 5;
        auto inserted = db.InsertRule(rule);
        ASSERT_TRUE(vrcsm::core::isOk(inserted)) << vrcsm::core::error(inserted).message;
        const auto ruleId = vrcsm::core::value(inserted).at("id").get<std::int64_t>();

        // A single quote in the new name must survive verbatim through the
        // parameterized UpdateRule (pre-fix this broke/injected the SQL).
        const std::string trickyName = "Ksana's rule -- ' OR '1'='1";
        auto updated = db.UpdateRule(ruleId, nlohmann::json{
            {"name", trickyName},
            {"description", "desc with ' quote"},
        });
        ASSERT_TRUE(vrcsm::core::isOk(updated)) << vrcsm::core::error(updated).message;
        EXPECT_EQ(vrcsm::core::value(updated).at("name").get<std::string>(), trickyName);

        auto fetched = db.GetRule(ruleId);
        ASSERT_TRUE(vrcsm::core::isOk(fetched)) << vrcsm::core::error(fetched).message;
        EXPECT_EQ(vrcsm::core::value(fetched).at("name").get<std::string>(), trickyName);
        EXPECT_EQ(vrcsm::core::value(fetched).at("description").get<std::string>(),
                  "desc with ' quote");
        // Other rows untouched by the injection-shaped payload.
        auto all = db.ListRules();
        ASSERT_TRUE(vrcsm::core::isOk(all)) << vrcsm::core::error(all).message;
        EXPECT_EQ(vrcsm::core::value(all).at("rules").size(), 1u);
    }

    // ── Embeddings TU ──
    {
        vrcsm::core::Database::AvatarEmbeddingInsert emb;
        emb.avatar_id = "avtr_embed-0000-0000-0000-000000000000";
        emb.model_version = "clip-vit-b32-test";
        emb.embedding.assign(512, 0.0f);
        emb.embedding[0] = 1.0f;
        ASSERT_TRUE(vrcsm::core::isOk(db.UpsertAvatarEmbedding(emb)))
            << "embedding upsert failed";

        auto matches = db.SearchAvatarEmbeddings(emb.embedding, 1);
        ASSERT_TRUE(vrcsm::core::isOk(matches)) << vrcsm::core::error(matches).message;
        ASSERT_EQ(vrcsm::core::value(matches).size(), 1u);
        EXPECT_EQ(vrcsm::core::value(matches)[0].avatar_id, emb.avatar_id);

        ASSERT_TRUE(vrcsm::core::isOk(db.DeleteAvatarEmbedding(emb.avatar_id)));
    }

    db.Close();
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
}


// ─────────────────────────────────────────────────────────────────
// FriendAnalytics free-function tests — the payoff of the extraction.
// These build input row vectors entirely in-memory (NO SQLite) and
// assert the JSON output on small hand-built scenarios, proving the
// algorithms are testable without a Database.
// ─────────────────────────────────────────────────────────────────

// PAYOFF: a known online/offline history collapses to the expected
// predicted window. Uses NAIVE-LOCAL timestamps (no 'Z'/offset) so
// parsePresenceInstant→mktime and the compute's localtime_s round-trip
// to the SAME wall-clock, making day_of_week/hour host-TZ independent.
TEST(CommonTests, AnalyticsPredictKnownHistoryYieldsExpectedWindow)
{
    using namespace vrcsm::core::analytics;

    // Eight consecutive Mondays in Jan-Feb 2026 (all standard time, no DST
    // transition), each an online 20:00 → offline 22:00 session. That is
    // 8 distinct observation days (>=7 gate), 8*120=960 online minutes
    // (>=120 gate), and buckets for local hour 20 and 21 each observed on
    // 8 distinct days (>= the 2-day per-bucket gate).
    const char* mondays[] = {
        "2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26",
        "2026-02-02", "2026-02-09", "2026-02-16", "2026-02-23",
    };
    std::vector<PredictPresenceRow> rows;
    for (const char* d : mondays)
    {
        rows.push_back(PredictPresenceRow{"online", std::string(d) + "T20:00:00"});
        rows.push_back(PredictPresenceRow{"offline", std::string(d) + "T22:00:00"});
    }

    // `now` injected in the same naive-local frame, just after the last event.
    const std::time_t now = parsePresenceInstant("2026-02-24T00:00:00").value();
    const auto out = predictFriendOnlineWindows(rows, "usr_friend", 3, 4, now, -300);

    EXPECT_EQ(out["user_id"], "usr_friend");
    EXPECT_EQ(out["status"], "ok");
    EXPECT_EQ(out["observation_days"].get<int>(), 8);
    EXPECT_EQ(out["timezone_offset_minutes"].get<int>(), -300); // passed through
    EXPECT_DOUBLE_EQ(out["total_online_minutes"].get<double>(), 960.0);
    ASSERT_EQ(out["heatmap"].size(), 168u); // full week grid once status==ok

    // Exactly one merged window: local Monday (wday=1) 20:00–22:00.
    ASSERT_GE(out["top_windows"].size(), 1u);
    const auto& w = out["top_windows"][0];
    EXPECT_EQ(w["day_of_week"].get<int>(), 1);  // Monday
    EXPECT_EQ(w["start_hour"].get<int>(), 20);
    EXPECT_EQ(w["end_hour"].get<int>(), 22);    // exclusive: merged hours 20+21
    EXPECT_EQ(w["observation_days"].get<int>(), 8);
    EXPECT_DOUBLE_EQ(w["score"].get<double>(), 1.0); // top window normalized to itself
    EXPECT_EQ(w["label_key"], "predictor.window");
}

// A friend below BOTH sufficiency gates stays insufficient_data even with
// a couple of sessions (only 2 distinct days here, gate is 7).
TEST(CommonTests, AnalyticsPredictBelowDayGateIsInsufficient)
{
    using namespace vrcsm::core::analytics;
    std::vector<PredictPresenceRow> rows{
        {"online", "2026-01-05T20:00:00"},
        {"offline", "2026-01-05T22:00:00"},
        {"online", "2026-01-12T20:00:00"},
        {"offline", "2026-01-12T22:00:00"},
    };
    const std::time_t now = parsePresenceInstant("2026-01-13T00:00:00").value();
    const auto out = predictFriendOnlineWindows(rows, "usr_x", 3, 4, now, 0);
    EXPECT_EQ(out["status"], "insufficient_data");
    EXPECT_EQ(out["observation_days"].get<int>(), 2);
    EXPECT_EQ(out["top_windows"].size(), 0u);
}

// Two NON-center users overlapping in one instance yield a single
// "co_presence" (inferred, not confirmed) edge with exact overlap seconds.
TEST(CommonTests, AnalyticsCoPresenceNonCenterEdgeIsInferred)
{
    using namespace vrcsm::core::analytics;
    // B and C overlap 10:15–10:45 = 1800s in wrld_1/i1. Center usr_a is absent.
    std::vector<PresenceEventRow> rows{
        {"usr_b", "Bob",   "wrld_1", "i1", "joined", "2026-03-01T10:00:00Z"},
        {"usr_c", "Cara",  "wrld_1", "i1", "joined", "2026-03-01T10:15:00Z"},
        {"usr_b", "Bob",   "wrld_1", "i1", "left",   "2026-03-01T10:45:00Z"},
        {"usr_c", "Cara",  "wrld_1", "i1", "left",   "2026-03-01T11:00:00Z"},
    };
    const std::time_t now = parsePresenceInstant("2026-03-02T00:00:00Z").value();
    const auto out = coPresenceEgoNetwork(rows, "usr_a", 90, 60, now);

    ASSERT_EQ(out["nodes"].size(), 2u);
    ASSERT_EQ(out["edges"].size(), 1u);
    const auto& e = out["edges"][0];
    EXPECT_EQ(e["source"], "usr_b"); // deterministic ordering (usr_b < usr_c)
    EXPECT_EQ(e["target"], "usr_c");
    EXPECT_EQ(e["kind"], "co_presence"); // neither endpoint is the center
    EXPECT_EQ(e["overlap_count"].get<int>(), 1);
    EXPECT_EQ(e["overlap_seconds"].get<std::int64_t>(), 1800);
}

// Users in DIFFERENT instances never form an edge even though their
// wall-clock times overlap — the session boundary is (world, instance).
TEST(CommonTests, AnalyticsCoPresenceSeparateInstancesNoEdge)
{
    using namespace vrcsm::core::analytics;
    std::vector<PresenceEventRow> rows{
        {"usr_a", "Alice", "wrld_1", "i1", "joined", "2026-03-01T10:00:00Z"},
        {"usr_a", "Alice", "wrld_1", "i1", "left",   "2026-03-01T11:00:00Z"},
        {"usr_b", "Bob",   "wrld_1", "i2", "joined", "2026-03-01T10:00:00Z"},
        {"usr_b", "Bob",   "wrld_1", "i2", "left",   "2026-03-01T11:00:00Z"},
    };
    const std::time_t now = parsePresenceInstant("2026-03-02T00:00:00Z").value();
    const auto out = coPresenceEgoNetwork(rows, "usr_a", 90, 60, now);
    EXPECT_EQ(out["edges"].size(), 0u); // same time, different instance → no overlap
}

// A missing "left" (crash/lost log) caps the open session at 4h but the
// overlap against the other user's real interval stays exact.
TEST(CommonTests, AnalyticsCoPresenceMissingLeftCapsOpenSession)
{
    using namespace vrcsm::core::analytics;
    // usr_a joins 10:00 and NEVER leaves → capped to [10:00,14:00].
    // usr_b joins 10:30 leaves 11:00 → [10:30,11:00]. Overlap = 1800s.
    std::vector<PresenceEventRow> rows{
        {"usr_a", "Alice", "wrld_1", "i1", "joined", "2026-03-01T10:00:00Z"},
        {"usr_b", "Bob",   "wrld_1", "i1", "joined", "2026-03-01T10:30:00Z"},
        {"usr_b", "Bob",   "wrld_1", "i1", "left",   "2026-03-01T11:00:00Z"},
    };
    const std::time_t now = parsePresenceInstant("2026-03-02T00:00:00Z").value();
    const auto out = coPresenceEgoNetwork(rows, "usr_a", 90, 60, now);
    ASSERT_EQ(out["edges"].size(), 1u);
    const auto& e = out["edges"][0];
    EXPECT_EQ(e["kind"], "confirmed"); // touches center usr_a
    EXPECT_EQ(e["overlap_seconds"].get<std::int64_t>(), 1800);
}

// globalSearch ranks a text-matching favorite above a non-matching one and
// paginates deterministically via limit/offset + nextOffset.
TEST(CommonTests, AnalyticsGlobalSearchRanksAndPaginates)
{
    using namespace vrcsm::core::analytics;
    GlobalSearchInput input;
    input.favorites.push_back(FavoriteRow{
        "world", "wrld_alpha", "My Worlds", "Alpha World",
        std::nullopt, std::optional<std::string>{"2026-01-01T00:00:00Z"}, "", ""});
    input.favorites.push_back(FavoriteRow{
        "world", "wrld_beta", "My Worlds", "Beta World",
        std::nullopt, std::optional<std::string>{"2026-01-02T00:00:00Z"}, "", ""});

    const std::string raw = "Alpha";
    const std::string norm = normalizeSearchQuery(raw); // "alpha"
    nlohmann::json request = nlohmann::json::object();

    // Page 1: limit 1 → the alpha match ranks first, nextOffset points to 1.
    const auto page1 = globalSearch(input, request, raw, norm, 1, 0);
    ASSERT_EQ(page1["items"].size(), 1u);
    EXPECT_EQ(page1["items"][0]["id"], "wrld_alpha");
    EXPECT_EQ(page1["nextOffset"].get<int>(), 1);

    // Page 2: offset 1 → the remaining (non-matching) candidate, end of list.
    const auto page2 = globalSearch(input, request, raw, norm, 1, 1);
    ASSERT_EQ(page2["items"].size(), 1u);
    EXPECT_EQ(page2["items"][0]["id"], "wrld_beta");
    EXPECT_TRUE(page2["nextOffset"].is_null());
}

// parsePresenceInstant '+HH:MM' offset path resolves to the same absolute
// UTC instant as the equivalent 'Z' timestamp, independent of host TZ.
TEST(CommonTests, AnalyticsParsePresenceInstantOffsetIsTimezoneStable)
{
    using namespace vrcsm::core::analytics;
    const auto withOffset = parsePresenceInstant("2026-01-01T12:00:00+02:00");
    const auto asUtc = parsePresenceInstant("2026-01-01T10:00:00Z");
    ASSERT_TRUE(withOffset.has_value());
    ASSERT_TRUE(asUtc.has_value());
    EXPECT_EQ(*withOffset, *asUtc); // +02:00 12:00 == 10:00Z
}

// ReadNowPlaying() must never surface an Error for the ordinary "no media
// session" case — CI has no player running, so it should return active=false
// with empty strings and zeroed numeric fields. When a session IS present
// (developer machine with music playing) the snapshot must still be
// well-formed: a non-empty status string. Either way, no Error and no throw.
TEST(CommonTests, NowPlayingReadsCleanlyWithOrWithoutSession)
{
    const auto result = vrcsm::core::ReadNowPlaying();

    ASSERT_TRUE(vrcsm::core::isOk(result))
        << "ReadNowPlaying returned an error: " << vrcsm::core::error(result).message;

    const auto& snap = vrcsm::core::value(result);
    if (!snap.active)
    {
        // The hermetic CI path: no session → everything empty / zero.
        EXPECT_TRUE(snap.title.empty());
        EXPECT_TRUE(snap.artist.empty());
        EXPECT_TRUE(snap.album.empty());
        EXPECT_TRUE(snap.status.empty());
        EXPECT_TRUE(snap.appId.empty());
        EXPECT_TRUE(snap.appName.empty());
        EXPECT_EQ(snap.positionMs, 0);
        EXPECT_EQ(snap.durationMs, 0);
        EXPECT_EQ(snap.positionAtMs, 0);
        EXPECT_FALSE(snap.hasThumbnail);
    }
    else
    {
        // A live session (local dev run) — status is one of the mapped strings
        // and the position sample time was stamped.
        EXPECT_TRUE(snap.status == "playing" || snap.status == "paused" ||
                    snap.status == "stopped");
        EXPECT_GT(snap.positionAtMs, 0);
    }
}