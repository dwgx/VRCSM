#include "CacheIndex.h"

#include "Common.h"

#include <fstream>

#include <Windows.h>
#include <KnownFolders.h>
#include <ShlObj.h>

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

namespace vrcsm::core
{

CacheIndex& CacheIndex::Instance()
{
    static CacheIndex instance;
    return instance;
}

CacheIndex::~CacheIndex()
{
    m_stopping = true;
    if (m_worker.joinable())
    {
        m_worker.join();
    }
}

void CacheIndex::StartScan(const std::filesystem::path& cacheWindowsPlayerDir)
{
    std::lock_guard<std::mutex> lock(m_mutex);

    if (m_cwpDir == cacheWindowsPlayerDir && (m_scanning || m_ready))
    {
        return; // already scanning or done for this path
    }

    // If a previous scan thread is running, wait for it.
    m_stopping = true;
    if (m_worker.joinable())
    {
        // Release the lock briefly to let the worker finish.
        m_mutex.unlock();
        m_worker.join();
        m_mutex.lock();
    }

    m_cwpDir = cacheWindowsPlayerDir;
    m_stopping = false;
    m_scanning = true;
    m_ready = false;
    m_index.clear();

    // Load persisted index first for instant warm lookups.
    LoadPersisted();

    m_worker = std::thread([this, dir = cacheWindowsPlayerDir]()
    {
        ScanWorker(dir);
    });
}

std::optional<std::filesystem::path> CacheIndex::Lookup(const std::string& avatarId) const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (const auto it = m_index.find(avatarId); it != m_index.end())
    {
        return it->second;
    }
    return std::nullopt;
}

std::size_t CacheIndex::EntryCount() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_index.size();
}

std::filesystem::path CacheIndex::PersistPath()
{
    return getAppDataRoot() / L"cache-index.json";
}

void CacheIndex::LoadPersisted()
{
    const auto path = PersistPath();
    if (path.empty()) return;

    std::ifstream in(path, std::ios::binary);
    if (!in) return;

    try
    {
        const auto doc = nlohmann::json::parse(in);
        if (!doc.is_object()) return;

        const auto cwpIt = doc.find("cwpDir");
        if (cwpIt == doc.end() || !cwpIt->is_string()) return;

        // Only use persisted data if it's for the same cache directory.
        const std::string persistedDir = cwpIt->get<std::string>();
        if (persistedDir != toUtf8(m_cwpDir.wstring())) return;

        const auto entriesIt = doc.find("entries");
        if (entriesIt == doc.end() || !entriesIt->is_object()) return;

        for (auto it = entriesIt->begin(); it != entriesIt->end(); ++it)
        {
            if (it.value().is_string())
            {
                m_index[it.key()] = utf8Path(it.value().get<std::string>());
            }
        }

        spdlog::info("CacheIndex: loaded {} persisted entries", m_index.size());
    }
    catch (const std::exception& ex)
    {
        spdlog::warn("CacheIndex: failed to parse persisted index: {}", ex.what());
    }
}

void CacheIndex::SavePersisted() const
{
    const auto path = PersistPath();
    if (path.empty()) return;

    std::error_code ec;
    std::filesystem::create_directories(path.parent_path(), ec);

    nlohmann::json doc;
    doc["cwpDir"] = toUtf8(m_cwpDir.wstring());

    nlohmann::json entries = nlohmann::json::object();
    for (const auto& [avatarId, bundlePath] : m_index)
    {
        entries[avatarId] = toUtf8(bundlePath.wstring());
    }
    doc["entries"] = std::move(entries);

    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    if (!out)
    {
        spdlog::warn("CacheIndex: failed to write persisted index");
        return;
    }
    out << doc.dump();
    spdlog::info("CacheIndex: persisted {} entries", m_index.size());
}

void CacheIndex::ScanWorker(std::filesystem::path cwpDir)
{
    spdlog::info("CacheIndex: starting full scan of {}", toUtf8(cwpDir.wstring()));

    std::error_code ec;
    if (!std::filesystem::exists(cwpDir, ec) || ec)
    {
        spdlog::warn("CacheIndex: cache directory does not exist");
        m_scanning = false;
        m_ready = true;
        return;
    }

    std::size_t scanned = 0;
    std::size_t found = 0;

    // Two-level walk: Cache-WindowsPlayer/<topHash>/<versionHash>/__info
    for (const auto& topEntry : std::filesystem::directory_iterator(cwpDir, ec))
    {
        if (m_stopping) break;
        if (ec) break;
        if (!topEntry.is_directory(ec) || ec) continue;

        for (const auto& versionEntry : std::filesystem::directory_iterator(topEntry.path(), ec))
        {
            if (m_stopping) break;
            if (ec) break;
            if (!versionEntry.is_directory(ec) || ec) continue;

            const auto infoPath = versionEntry.path() / L"__info";
            std::error_code checkEc;
            if (!std::filesystem::exists(infoPath, checkEc) || checkEc) continue;

            ++scanned;

            // Read __info and extract any avtr_* IDs mentioned.
            std::error_code sizeEc;
            const auto size = std::filesystem::file_size(infoPath, sizeEc);
            if (sizeEc || size == 0 || size > 16 * 1024) continue;

            std::ifstream in(infoPath, std::ios::binary);
            if (!in) continue;

            std::string contents(static_cast<std::size_t>(size), '\0');
            in.read(contents.data(), static_cast<std::streamsize>(size));
            contents.resize(static_cast<std::size_t>(in.gcount()));

            // Find all avtr_* ids in the __info text.
            std::string_view view(contents);
            std::size_t pos = 0;
            while ((pos = view.find("avtr_", pos)) != std::string_view::npos)
            {
                // Extract the full UUID: avtr_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
                // That's 41 characters: "avtr_" (5) + UUID (36)
                if (pos + 41 <= view.size())
                {
                    std::string avatarId(view.substr(pos, 41));

                    // Validate it looks like a UUID.
                    bool valid = true;
                    for (std::size_t i = 5; i < 41 && valid; ++i)
                    {
                        const char c = avatarId[i];
                        if (i == 13 || i == 18 || i == 23 || i == 28)
                        {
                            valid = (c == '-');
                        }
                        else
                        {
                            valid = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
                        }
                    }

                    if (valid)
                    {
                        std::lock_guard<std::mutex> lock(m_mutex);
                        if (m_index.find(avatarId) == m_index.end())
                        {
                            m_index[avatarId] = versionEntry.path();
                            ++found;
                        }
                    }
                }
                pos += 5; // skip past "avtr_" to find next
            }
        }
    }

    if (!m_stopping)
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        SavePersisted();
    }

    m_scanning = false;
    m_ready = true;

    spdlog::info("CacheIndex: scan complete — {} __info files scanned, {} avatar IDs indexed",
        scanned, found);
}

} // namespace vrcsm::core
