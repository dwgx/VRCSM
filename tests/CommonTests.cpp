#include <gtest/gtest.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <fstream>

#include <Windows.h>

#include "core/AvatarPreview.h"
#include "core/Common.h"
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
    const auto dir = MakeTempTestDir(L"vrcsm-preview-lru");
    const auto oldGlb = dir / L"old.glb";
    const auto oldSidecar = dir / L"old.glb.json";
    const auto retainedGlb = dir / L"retained.glb";
    const auto part = dir / L"download.glb.part";

    WriteSizedFile(oldGlb, 128);
    WriteSizedFile(oldSidecar, 16);
    WriteSizedFile(retainedGlb, 128);
    WriteSizedFile(part, 256);

    const auto oldTime = std::filesystem::file_time_type::clock::now() - std::chrono::hours(24);
    std::error_code ec;
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
