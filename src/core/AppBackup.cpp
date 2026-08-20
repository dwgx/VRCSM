#include "AppBackup.h"

#include <sqlite3.h>

#include <fmt/format.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cctype>
#include <fstream>
#include <iterator>
#include <system_error>

#include <Windows.h>

namespace vrcsm::core
{

namespace
{

constexpr std::array<std::wstring_view, 3> kPayloadNames{
    L"vrcsm.db",
    L"grey-prefs.json",
    L"plugin-state.json",
};

constexpr std::array<std::wstring_view, 2> kSqliteSidecars{
    L"vrcsm.db-wal",
    L"vrcsm.db-shm",
};

std::string PathUtf8(const std::filesystem::path& path)
{
    const auto u8 = path.u8string();
    return std::string(reinterpret_cast<const char*>(u8.data()), u8.size());
}

std::string FileNameUtf8(const std::filesystem::path& path)
{
    return toUtf8(path.filename().wstring());
}

bool IsReparsePoint(const std::filesystem::path& path)
{
    const DWORD attrs = ::GetFileAttributesW(path.wstring().c_str());
    if (attrs == INVALID_FILE_ATTRIBUTES) return false;
    return (attrs & FILE_ATTRIBUTE_REPARSE_POINT) != 0;
}

bool IsWriteLocked(const std::filesystem::path& path)
{
    std::error_code ec;
    if (!std::filesystem::exists(path, ec) || ec) return false;

    HANDLE handle = ::CreateFileW(
        path.wstring().c_str(),
        GENERIC_READ | GENERIC_WRITE,
        0,
        nullptr,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        nullptr);
    if (handle == INVALID_HANDLE_VALUE)
    {
        const DWORD err = ::GetLastError();
        return err == ERROR_SHARING_VIOLATION || err == ERROR_LOCK_VIOLATION;
    }
    ::CloseHandle(handle);
    return false;
}

std::uint64_t DirBytes(const std::filesystem::path& dir)
{
    std::error_code ec;
    if (!std::filesystem::exists(dir, ec) || ec) return 0;
    if (IsReparsePoint(dir)) return 0;

    std::uint64_t total = 0;
    auto opts = std::filesystem::directory_options::skip_permission_denied;
    std::filesystem::recursive_directory_iterator it(dir, opts, ec);
    if (ec) return 0;
    const std::filesystem::recursive_directory_iterator end{};
    for (; it != end; it.increment(ec))
    {
        if (ec) break;
        std::error_code fec;
        if (it->is_directory(fec) && !fec && IsReparsePoint(it->path()))
        {
            it.disable_recursion_pending();
            continue;
        }
        if (it->is_regular_file(fec) && !fec)
        {
            const auto sz = it->file_size(fec);
            if (!fec) total += static_cast<std::uint64_t>(sz);
        }
    }
    return total;
}

Result<std::monostate> CopyRegularFile(const std::filesystem::path& src,
                                       const std::filesystem::path& dest)
{
    std::error_code ec;
    std::filesystem::copy_file(
        src,
        dest,
        std::filesystem::copy_options::overwrite_existing,
        ec);
    if (ec)
    {
        return Error{
            "io_error",
            fmt::format("failed to copy {}: {}", PathUtf8(src.filename()), ec.message()),
            0};
    }
    return std::monostate{};
}

void CloseSqlite(sqlite3* db)
{
    if (db != nullptr) sqlite3_close_v2(db);
}

Result<std::monostate> SnapshotSqlite(const std::filesystem::path& srcDb,
                                      const std::filesystem::path& destDb)
{
    sqlite3* src = nullptr;
    sqlite3* dest = nullptr;
    const std::string srcUtf8 = PathUtf8(srcDb);
    const std::string destUtf8 = PathUtf8(destDb);

    int rc = sqlite3_open_v2(srcUtf8.c_str(), &src, SQLITE_OPEN_READONLY, nullptr);
    if (rc != SQLITE_OK || src == nullptr)
    {
        CloseSqlite(src);
        return CopyRegularFile(srcDb, destDb);
    }
    sqlite3_busy_timeout(src, 5000);

    rc = sqlite3_open_v2(
        destUtf8.c_str(),
        &dest,
        SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE,
        nullptr);
    if (rc != SQLITE_OK || dest == nullptr)
    {
        CloseSqlite(src);
        CloseSqlite(dest);
        return CopyRegularFile(srcDb, destDb);
    }

    sqlite3_backup* backup = sqlite3_backup_init(dest, "main", src, "main");
    if (backup == nullptr)
    {
        CloseSqlite(src);
        CloseSqlite(dest);
        return CopyRegularFile(srcDb, destDb);
    }

    rc = sqlite3_backup_step(backup, -1);
    const int finishRc = sqlite3_backup_finish(backup);
    CloseSqlite(src);
    CloseSqlite(dest);
    if (rc != SQLITE_DONE || finishRc != SQLITE_OK)
    {
        std::error_code ec;
        std::filesystem::remove(destDb, ec);
        return CopyRegularFile(srcDb, destDb);
    }
    return std::monostate{};
}

std::string MakeBackupId()
{
    const auto now = std::chrono::system_clock::now();
    const auto t = std::chrono::system_clock::to_time_t(now);
    std::tm utc{};
    gmtime_s(&utc, &t);
    return fmt::format(
        "{:04}{:02}{:02}T{:02}{:02}{:02}Z",
        utc.tm_year + 1900,
        utc.tm_mon + 1,
        utc.tm_mday,
        utc.tm_hour,
        utc.tm_min,
        utc.tm_sec);
}

std::string UniqueBackupId(const std::filesystem::path& backupsDir, std::string base)
{
    std::error_code ec;
    auto candidate = backupsDir / toWide(base);
    if (!std::filesystem::exists(candidate, ec)) return base;
    for (int n = 2; n < 100; ++n)
    {
        const std::string next = fmt::format("{}-{}", base, n);
        candidate = backupsDir / toWide(next);
        if (!std::filesystem::exists(candidate, ec)) return next;
    }
    return fmt::format("{}-{}", base, static_cast<unsigned>(::GetCurrentProcessId()));
}

AppBackupEntry ReadEntry(const std::filesystem::path& dir)
{
    AppBackupEntry entry;
    entry.id = FileNameUtf8(dir);
    entry.bytes = DirBytes(dir);

    const auto manifestPath = dir / L"manifest.json";
    std::error_code ec;
    if (std::filesystem::is_regular_file(manifestPath, ec) && !ec)
    {
        std::ifstream in(manifestPath, std::ios::binary);
        if (in)
        {
            const std::string text(
                (std::istreambuf_iterator<char>(in)),
                std::istreambuf_iterator<char>());
            const auto j = nlohmann::json::parse(text, nullptr, false);
            if (j.is_object())
            {
                entry.createdAt = j.value("createdAt", std::string{});
                if (j.contains("files") && j["files"].is_array())
                {
                    for (const auto& f : j["files"])
                    {
                        if (f.is_string()) entry.files.push_back(f.get<std::string>());
                    }
                }
            }
        }
    }

    if (entry.createdAt.empty())
    {
        if (const auto mtime = safeLastWriteTime(dir))
        {
            entry.createdAt = isoTimestamp(*mtime);
        }
        else
        {
            entry.createdAt = nowIso();
        }
    }
    if (entry.files.empty())
    {
        std::filesystem::directory_iterator it(dir, ec);
        for (; it != std::filesystem::directory_iterator{} && !ec; it.increment(ec))
        {
            std::error_code fec;
            if (it->is_regular_file(fec) && !fec)
            {
                const auto name = FileNameUtf8(it->path());
                if (name != "manifest.json") entry.files.push_back(name);
            }
        }
        std::sort(entry.files.begin(), entry.files.end());
    }
    return entry;
}

Error MakeIo(std::string_view message)
{
    return Error{"io_error", std::string(message), 0};
}

} // namespace

AppBackup::AppBackup(std::filesystem::path appDataRoot)
    : m_root(std::move(appDataRoot))
{
}

std::filesystem::path AppBackup::backupsDir() const
{
    return m_root / L"backups";
}

bool AppBackup::IsBackupId(std::string_view id) noexcept
{
    if (id.empty() || id.size() > 80) return false;
    if (id == "." || id == "..") return false;
    for (const char c : id)
    {
        if (std::isalnum(static_cast<unsigned char>(c)) == 0
            && c != '-' && c != '_' && c != '.')
        {
            return false;
        }
    }
    return true;
}

Result<int> AppBackup::PruneKeepN(const std::filesystem::path& backupsDir, int keep)
{
    if (keep < 1)
    {
        return Error{"invalid_params", "keep must be >= 1", 0};
    }

    std::error_code ec;
    if (!std::filesystem::exists(backupsDir, ec) || ec)
    {
        return 0;
    }
    if (IsReparsePoint(backupsDir))
    {
        return MakeIo("backups directory is a reparse point");
    }

    std::vector<std::filesystem::path> dirs;
    auto opts = std::filesystem::directory_options::skip_permission_denied;
    std::filesystem::directory_iterator it(backupsDir, opts, ec);
    if (ec) return MakeIo(ec.message());
    for (; it != std::filesystem::directory_iterator{} && !ec; it.increment(ec))
    {
        std::error_code fec;
        if (!it->is_directory(fec) || fec) continue;
        if (IsReparsePoint(it->path())) continue;
        if (!IsBackupId(FileNameUtf8(it->path()))) continue;
        dirs.push_back(it->path());
    }

    std::sort(dirs.begin(), dirs.end(), [](const auto& a, const auto& b) {
        return FileNameUtf8(a) > FileNameUtf8(b);
    });

    int pruned = 0;
    const std::size_t keepN = static_cast<std::size_t>(keep);
    for (std::size_t i = keepN; i < dirs.size(); ++i)
    {
        std::error_code rec;
        std::filesystem::remove_all(dirs[i], rec);
        if (rec)
        {
            return Error{
                "io_error",
                fmt::format("failed to prune {}: {}", FileNameUtf8(dirs[i]), rec.message()),
                0};
        }
        ++pruned;
    }
    return pruned;
}

Result<AppBackupCreateResult> AppBackup::Create(int keep)
{
    if (keep < 1 || keep > kMaxKeep)
    {
        return Error{
            "invalid_params",
            fmt::format("keep must be 1..{}", kMaxKeep),
            0};
    }
    if (m_root.empty())
    {
        return Error{"invalid_params", "app data root is empty", 0};
    }

    const auto destRoot = backupsDir();
    std::error_code ec;
    std::filesystem::create_directories(destRoot, ec);
    if (ec) return MakeIo(ec.message());

    const std::string id = UniqueBackupId(destRoot, MakeBackupId());
    const auto dest = destRoot / toWide(id);
    if (!ensureWithinBase(destRoot, dest))
    {
        return Error{"invalid_params", "backup id escapes backups directory", 0};
    }

    std::filesystem::create_directories(dest, ec);
    if (ec) return MakeIo(ec.message());

    auto rollback = [&]() {
        std::error_code rec;
        std::filesystem::remove_all(dest, rec);
    };

    std::vector<std::string> copied;
    for (const auto name : kPayloadNames)
    {
        const auto src = m_root / name;
        std::error_code existsEc;
        if (!std::filesystem::is_regular_file(src, existsEc) || existsEc) continue;

        const auto destFile = dest / name;
        Result<std::monostate> copiedOk{std::monostate{}};
        if (name == L"vrcsm.db")
        {
            copiedOk = SnapshotSqlite(src, destFile);
        }
        else
        {
            copiedOk = CopyRegularFile(src, destFile);
        }
        if (!isOk(copiedOk))
        {
            rollback();
            return error(copiedOk);
        }
        copied.push_back(toUtf8(std::wstring(name)));
    }

    const std::string createdAt = nowIso();
    const nlohmann::json manifest{
        {"schema", 1},
        {"id", id},
        {"createdAt", createdAt},
        {"files", copied},
    };
    {
        std::ofstream out(dest / L"manifest.json", std::ios::binary | std::ios::trunc);
        if (!out)
        {
            rollback();
            return MakeIo("failed to write backup manifest");
        }
        out << manifest.dump(2);
        if (!out)
        {
            rollback();
            return MakeIo("failed to write backup manifest");
        }
    }

    auto pruned = PruneKeepN(destRoot, keep);
    if (!isOk(pruned))
    {
        return error(pruned);
    }

    AppBackupCreateResult result;
    result.entry.id = id;
    result.entry.createdAt = createdAt;
    result.entry.files = std::move(copied);
    result.entry.bytes = DirBytes(dest);
    result.pruned = value(pruned);
    return result;
}

Result<std::vector<AppBackupEntry>> AppBackup::List() const
{
    std::vector<AppBackupEntry> entries;
    const auto dir = backupsDir();
    std::error_code ec;
    if (!std::filesystem::exists(dir, ec) || ec) return entries;
    if (IsReparsePoint(dir)) return entries;

    auto opts = std::filesystem::directory_options::skip_permission_denied;
    std::filesystem::directory_iterator it(dir, opts, ec);
    if (ec) return MakeIo(ec.message());
    for (; it != std::filesystem::directory_iterator{} && !ec; it.increment(ec))
    {
        std::error_code fec;
        if (!it->is_directory(fec) || fec) continue;
        if (IsReparsePoint(it->path())) continue;
        if (!IsBackupId(FileNameUtf8(it->path()))) continue;
        entries.push_back(ReadEntry(it->path()));
    }
    std::sort(entries.begin(), entries.end(), [](const auto& a, const auto& b) {
        return a.id > b.id;
    });
    return entries;
}

Result<AppBackupEntry> AppBackup::Restore(const std::string& id, AppBackupRestoreOptions opts)
{
    if (opts.midScan)
    {
        return Error{
            "mid_scan",
            "Restore refused while a cache index scan is running",
            0};
    }
    if (!IsBackupId(id))
    {
        return Error{"invalid_params", "invalid backup id", 0};
    }

    const auto destRoot = backupsDir();
    const auto srcDir = destRoot / utf8Path(id);
    if (!ensureWithinBase(destRoot, srcDir))
    {
        return Error{"invalid_params", "backup id escapes backups directory", 0};
    }

    std::error_code ec;
    if (!std::filesystem::is_directory(srcDir, ec) || ec)
    {
        return Error{"not_found", fmt::format("backup '{}' not found", id), 0};
    }
    if (IsReparsePoint(srcDir))
    {
        return Error{"not_found", fmt::format("backup '{}' not found", id), 0};
    }

    for (const auto name : kPayloadNames)
    {
        const auto dest = m_root / name;
        if (IsWriteLocked(dest))
        {
            return Error{
                "dest_locked",
                fmt::format("{} is locked", toUtf8(std::wstring(name))),
                0};
        }
    }
    for (const auto name : kSqliteSidecars)
    {
        const auto dest = m_root / name;
        if (IsWriteLocked(dest))
        {
            return Error{
                "dest_locked",
                fmt::format("{} is locked", toUtf8(std::wstring(name))),
                0};
        }
    }

    std::vector<std::string> restored;
    for (const auto name : kPayloadNames)
    {
        const auto src = srcDir / name;
        std::error_code existsEc;
        if (!std::filesystem::is_regular_file(src, existsEc) || existsEc) continue;

        const auto dest = m_root / name;
        if (name == L"vrcsm.db")
        {
            for (const auto side : kSqliteSidecars)
            {
                std::error_code rec;
                std::filesystem::remove(m_root / side, rec);
                if (rec && rec != std::errc::no_such_file_or_directory)
                {
                    return Error{"dest_locked", rec.message(), 0};
                }
            }
        }

        auto copied = CopyRegularFile(src, dest);
        if (!isOk(copied))
        {
            const auto& err = error(copied);
            if (IsWriteLocked(dest))
            {
                return Error{"dest_locked", err.message, 0};
            }
            return err;
        }
        restored.push_back(toUtf8(std::wstring(name)));
    }

    auto entry = ReadEntry(srcDir);
    entry.files = std::move(restored);
    return entry;
}

} // namespace vrcsm::core
