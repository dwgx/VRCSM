#include <gtest/gtest.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <fstream>

#include <Windows.h>

#include "core/AvatarPreview.h"
#include "core/Common.h"
#include "core/Database.h"
#include "core/JunctionUtil.h"
#include "core/Migrator.h"
#include "core/ProcessGuard.h"
#include "core/SafeDelete.h"
#include "core/UnityBundle.h"
#include "core/VrcApi.h"
#include "core/VrDiagnostics.h"
#include "core/plugins/PluginRegistry.h"

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
