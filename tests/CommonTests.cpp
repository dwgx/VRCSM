#include <gtest/gtest.h>

#include <algorithm>
#include <cctype>

#include "core/AvatarPreview.h"
#include "core/Common.h"
#include "core/VrDiagnostics.h"

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
