#include <gtest/gtest.h>

#include <cctype>

#include "core/AvatarPreview.h"
#include "core/Common.h"

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

TEST(CommonTests, AvatarPreviewCachedGlbPathStaysInsidePreviewCacheDir)
{
    const auto cacheDir = vrcsm::core::AvatarPreview::PreviewCacheDir();
    const auto glbPath = vrcsm::core::AvatarPreview::CachedGlbPathForAvatarId(
        "avtr_164034fd-61d6-410d-892f-9ecc3964817e");

    EXPECT_TRUE(vrcsm::core::ensureWithinBase(cacheDir, glbPath));
    EXPECT_EQ(glbPath.extension(), L".glb");
}
