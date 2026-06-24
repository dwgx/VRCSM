#include <gtest/gtest.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <fstream>

#include <Windows.h>
#include <sqlite3.h>
#include <wil/resource.h>

#include "core/AvatarPreview.h"
#include "core/Common.h"
#include "core/Database.h"
#include "core/JunctionUtil.h"
#include "core/LogAtoms.h"
#include "core/LogEventClassifier.h"
#include "core/LogParser.h"
#include "core/Migrator.h"
#include "core/ProcessGuard.h"
#include "core/SafeDelete.h"
#include "core/UnityBundle.h"
#include "core/VrcApi.h"
#include "core/VrDiagnostics.h"
#include "core/hw/HwTelemetry.h"
#include "core/plugins/PluginRegistry.h"
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

    vrcsm::core::updater::PackageValidationOptions options;
    options.version = "9.9.9";
    options.expectedFileName = fileName;
    options.expectedSize = static_cast<std::uint64_t>(std::filesystem::file_size(installer));

    const auto result = vrcsm::core::updater::ValidateDownloadedPackage(installer, options);

    EXPECT_TRUE(vrcsm::core::isOk(result)) << vrcsm::core::error(result).message;

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
