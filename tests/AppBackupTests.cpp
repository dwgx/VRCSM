#include <gtest/gtest.h>

#include <algorithm>
#include <fstream>
#include <iterator>
#include <string>

#include <Windows.h>

#include "core/AppBackup.h"
#include "core/Common.h"

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

std::string ReadAll(const std::filesystem::path& path)
{
    std::ifstream in(path, std::ios::binary);
    return std::string(
        (std::istreambuf_iterator<char>(in)),
        std::istreambuf_iterator<char>());
}

void MakeBackupDir(const std::filesystem::path& backups, const std::wstring& id)
{
    const auto dir = backups / id;
    std::filesystem::create_directories(dir);
    WriteBytes(dir / L"grey-prefs.json", "{}");
}

class ExclusiveFileLock
{
public:
    explicit ExclusiveFileLock(const std::filesystem::path& path)
        : m_handle(::CreateFileW(
              path.wstring().c_str(),
              GENERIC_READ | GENERIC_WRITE,
              0,
              nullptr,
              OPEN_EXISTING,
              FILE_ATTRIBUTE_NORMAL,
              nullptr))
    {
    }

    ~ExclusiveFileLock()
    {
        if (m_handle != INVALID_HANDLE_VALUE) ::CloseHandle(m_handle);
    }

    bool ok() const { return m_handle != INVALID_HANDLE_VALUE; }

    ExclusiveFileLock(const ExclusiveFileLock&) = delete;
    ExclusiveFileLock& operator=(const ExclusiveFileLock&) = delete;

private:
    HANDLE m_handle;
};

} // namespace

TEST(AppBackupTests, PruneKeepNRetainsNewestThree)
{
    const auto root = MakeTempTestDir(L"vrcsm-backup-prune");
    const auto backups = root / L"backups";
    std::filesystem::create_directories(backups);
    MakeBackupDir(backups, L"20260820T120001Z");
    MakeBackupDir(backups, L"20260820T120002Z");
    MakeBackupDir(backups, L"20260820T120003Z");
    MakeBackupDir(backups, L"20260820T120004Z");
    MakeBackupDir(backups, L"20260820T120005Z");

    const auto pruned = vrcsm::core::AppBackup::PruneKeepN(backups, 3);
    ASSERT_TRUE(vrcsm::core::isOk(pruned));
    EXPECT_EQ(vrcsm::core::value(pruned), 2);

    EXPECT_FALSE(std::filesystem::exists(backups / L"20260820T120001Z"));
    EXPECT_FALSE(std::filesystem::exists(backups / L"20260820T120002Z"));
    EXPECT_TRUE(std::filesystem::exists(backups / L"20260820T120003Z"));
    EXPECT_TRUE(std::filesystem::exists(backups / L"20260820T120004Z"));
    EXPECT_TRUE(std::filesystem::exists(backups / L"20260820T120005Z"));

    std::error_code ec;
    std::filesystem::remove_all(root, ec);
}

TEST(AppBackupTests, PruneKeepNNoOpWhenAtMostKeep)
{
    const auto root = MakeTempTestDir(L"vrcsm-backup-prune-noop");
    const auto backups = root / L"backups";
    std::filesystem::create_directories(backups);
    MakeBackupDir(backups, L"20260820T120001Z");
    MakeBackupDir(backups, L"20260820T120002Z");

    const auto pruned = vrcsm::core::AppBackup::PruneKeepN(backups, 3);
    ASSERT_TRUE(vrcsm::core::isOk(pruned));
    EXPECT_EQ(vrcsm::core::value(pruned), 0);
    EXPECT_TRUE(std::filesystem::exists(backups / L"20260820T120001Z"));
    EXPECT_TRUE(std::filesystem::exists(backups / L"20260820T120002Z"));

    std::error_code ec;
    std::filesystem::remove_all(root, ec);
}

TEST(AppBackupTests, CreateCopiesWhitelistAndPrunesToKeep)
{
    const auto root = MakeTempTestDir(L"vrcsm-backup-create");
    WriteBytes(root / L"grey-prefs.json", "{\"greyEnabled\":false}");
    WriteBytes(root / L"plugin-state.json", "{\"enabled\":[]}");
    WriteBytes(root / L"vrcsm.db", "not-sqlite");
    WriteBytes(root / L"session.dat", "secret");
    std::filesystem::create_directories(root / L"thumb-cache-files");
    WriteBytes(root / L"thumb-cache-files" / L"x.bin", "nope");

    vrcsm::core::AppBackup backup(root);
    for (int i = 0; i < 4; ++i)
    {
        const auto created = backup.Create(3);
        ASSERT_TRUE(vrcsm::core::isOk(created)) << vrcsm::core::error(created).message;
        const auto& entry = vrcsm::core::value(created).entry;
        EXPECT_TRUE(vrcsm::core::AppBackup::IsBackupId(entry.id));
        EXPECT_NE(std::find(entry.files.begin(), entry.files.end(), "grey-prefs.json"),
                  entry.files.end());
        EXPECT_EQ(std::find(entry.files.begin(), entry.files.end(), "session.dat"),
                  entry.files.end());
    }

    const auto listed = backup.List();
    ASSERT_TRUE(vrcsm::core::isOk(listed));
    EXPECT_EQ(vrcsm::core::value(listed).size(), 3u);

    const auto newest = vrcsm::core::value(listed).front();
    const auto payload = backup.backupsDir() / vrcsm::core::toWide(newest.id);
    EXPECT_TRUE(std::filesystem::exists(payload / L"grey-prefs.json"));
    EXPECT_FALSE(std::filesystem::exists(payload / L"session.dat"));
    EXPECT_FALSE(std::filesystem::exists(payload / L"thumb-cache-files"));

    std::error_code ec;
    std::filesystem::remove_all(root, ec);
}

TEST(AppBackupTests, RestoreOverwritesSettingsAndRefusesMidScan)
{
    const auto root = MakeTempTestDir(L"vrcsm-backup-restore");
    WriteBytes(root / L"grey-prefs.json", "{\"v\":1}");
    WriteBytes(root / L"plugin-state.json", "{\"p\":1}");

    vrcsm::core::AppBackup backup(root);
    const auto created = backup.Create(3);
    ASSERT_TRUE(vrcsm::core::isOk(created)) << vrcsm::core::error(created).message;
    const auto id = vrcsm::core::value(created).entry.id;

    WriteBytes(root / L"grey-prefs.json", "{\"v\":2}");
    const auto restored = backup.Restore(id);
    ASSERT_TRUE(vrcsm::core::isOk(restored)) << vrcsm::core::error(restored).message;
    EXPECT_EQ(ReadAll(root / L"grey-prefs.json"), "{\"v\":1}");

    const auto refused = backup.Restore(id, {true});
    ASSERT_FALSE(vrcsm::core::isOk(refused));
    EXPECT_EQ(vrcsm::core::error(refused).code, "mid_scan");
    EXPECT_EQ(ReadAll(root / L"grey-prefs.json"), "{\"v\":1}");

    std::error_code ec;
    std::filesystem::remove_all(root, ec);
}

TEST(AppBackupTests, RestoreRefusesDestLocked)
{
    const auto root = MakeTempTestDir(L"vrcsm-backup-locked");
    WriteBytes(root / L"grey-prefs.json", "{\"v\":1}");

    vrcsm::core::AppBackup backup(root);
    const auto created = backup.Create(3);
    ASSERT_TRUE(vrcsm::core::isOk(created)) << vrcsm::core::error(created).message;
    const auto id = vrcsm::core::value(created).entry.id;

    WriteBytes(root / L"grey-prefs.json", "{\"v\":2}");
    {
        ExclusiveFileLock lock(root / L"grey-prefs.json");
        ASSERT_TRUE(lock.ok());
        const auto restored = backup.Restore(id);
        ASSERT_FALSE(vrcsm::core::isOk(restored));
        EXPECT_EQ(vrcsm::core::error(restored).code, "dest_locked");
    }
    EXPECT_EQ(ReadAll(root / L"grey-prefs.json"), "{\"v\":2}");

    std::error_code ec;
    std::filesystem::remove_all(root, ec);
}

TEST(AppBackupTests, RestoreUnknownIdIsNotFound)
{
    const auto root = MakeTempTestDir(L"vrcsm-backup-missing");
    vrcsm::core::AppBackup backup(root);
    const auto restored = backup.Restore("20260820T000000Z");
    ASSERT_FALSE(vrcsm::core::isOk(restored));
    EXPECT_EQ(vrcsm::core::error(restored).code, "not_found");

    const auto escaped = backup.Restore("..\\evil");
    ASSERT_FALSE(vrcsm::core::isOk(escaped));
    EXPECT_EQ(vrcsm::core::error(escaped).code, "invalid_params");

    std::error_code ec;
    std::filesystem::remove_all(root, ec);
}
