#include "PluginStore.h"

#include <spdlog/spdlog.h>

#include <fstream>
#include <system_error>

namespace vrcsm::core::plugins
{

namespace
{

nlohmann::json ReadJsonFile(const std::filesystem::path& p)
{
    std::ifstream in(p, std::ios::binary);
    if (!in) return nlohmann::json{};
    try
    {
        return nlohmann::json::parse(in, nullptr, /*allow_exceptions=*/false);
    }
    catch (...)
    {
        return nlohmann::json{};
    }
}

bool WriteJsonFileAtomic(const std::filesystem::path& p, const nlohmann::json& j)
{
    std::error_code ec;
    std::filesystem::create_directories(p.parent_path(), ec);

    const auto tmp = p.parent_path() / (p.filename().wstring() + L".tmp");
    {
        std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
        if (!out) return false;
        out << j.dump(2);
        out.flush();
        if (!out) return false;
    }
    std::filesystem::rename(tmp, p, ec);
    if (ec)
    {
        // Rename across existing file can fail on some Windows
        // builds — fall back to remove+rename.
        std::filesystem::remove(p, ec);
        std::filesystem::rename(tmp, p, ec);
    }
    return !ec;
}

} // namespace

// ── Static paths ────────────────────────────────────────────────────

std::filesystem::path PluginStore::PluginsRoot()
{
    auto root = getAppDataRoot() / L"plugins";
    std::error_code ec;
    std::filesystem::create_directories(root, ec);
    return root;
}

std::filesystem::path PluginStore::PluginDataRoot()
{
    auto root = getAppDataRoot() / L"plugin-data";
    std::error_code ec;
    std::filesystem::create_directories(root, ec);
    return root;
}

std::filesystem::path PluginStore::StateFilePath()
{
    return getAppDataRoot() / L"plugin-state.json";
}

// ── Construction ────────────────────────────────────────────────────

PluginStore::PluginStore()
{
    (void)Reload();
}

PluginStore& GetPluginStore()
{
    static PluginStore s;
    return s;
}

// ── Public API ──────────────────────────────────────────────────────

Result<std::monostate> PluginStore::Reload()
{
    std::lock_guard<std::mutex> lk(m_mutex);
    m_plugins.clear();
    MirrorBundledLocked();
    RescanLocked();
    (void)LoadState();
    return std::monostate{};
}

std::vector<InstalledPlugin> PluginStore::List() const
{
    std::lock_guard<std::mutex> lk(m_mutex);
    std::vector<InstalledPlugin> out;
    out.reserve(m_plugins.size());
    for (const auto& [id, p] : m_plugins) out.push_back(p);
    std::sort(out.begin(), out.end(),
              [](const auto& a, const auto& b){ return a.manifest.id < b.manifest.id; });
    return out;
}

std::optional<InstalledPlugin> PluginStore::Find(std::string_view id) const
{
    std::lock_guard<std::mutex> lk(m_mutex);
    const auto it = m_plugins.find(std::string(id));
    if (it == m_plugins.end()) return std::nullopt;
    return it->second;
}

Result<std::monostate> PluginStore::SetEnabled(std::string_view id, bool enabled)
{
    std::lock_guard<std::mutex> lk(m_mutex);
    const auto it = m_plugins.find(std::string(id));
    if (it == m_plugins.end())
    {
        return Error{"plugin_not_found", fmt::format("plugin {} not installed", id), 0};
    }
    it->second.enabled = enabled;
    return SaveStateLocked();
}

Result<std::monostate> PluginStore::Uninstall(std::string_view id)
{
    std::lock_guard<std::mutex> lk(m_mutex);
    const auto it = m_plugins.find(std::string(id));
    if (it == m_plugins.end())
    {
        return Error{"plugin_not_found", fmt::format("plugin {} not installed", id), 0};
    }
    if (it->second.bundled)
    {
        // Bundled plugins are mirrored from the exe dir on every run.
        // Removing the LocalAppData copy would just rehydrate on next
        // launch, so instead we refuse the uninstall and suggest
        // disabling. UI should grey out the uninstall button for
        // bundled = true.
        return Error{"plugin_bundled",
                     "bundled plugins cannot be uninstalled — disable them instead",
                     0};
    }

    std::error_code ec;
    std::filesystem::remove_all(it->second.installDir, ec);
    if (ec)
    {
        spdlog::warn("[plugins] uninstall: remove_all installDir failed: {}", ec.message());
    }
    std::filesystem::remove_all(it->second.dataDir, ec);
    if (ec)
    {
        spdlog::warn("[plugins] uninstall: remove_all dataDir failed: {}", ec.message());
    }

    m_plugins.erase(it);
    return SaveStateLocked();
}

Result<std::monostate> PluginStore::RegisterInstalled(const PluginManifest& m, bool bundled)
{
    std::lock_guard<std::mutex> lk(m_mutex);
    InstalledPlugin p;
    p.manifest = m;
    p.installDir = PluginsRoot() / toWide(m.id);
    p.dataDir = PluginDataRoot() / toWide(m.id);
    p.bundled = bundled;

    // Preserve existing enabled flag on upgrade; default new installs
    // to enabled.
    const auto existing = m_plugins.find(m.id);
    p.enabled = (existing != m_plugins.end()) ? existing->second.enabled : true;

    std::error_code ec;
    std::filesystem::create_directories(p.dataDir, ec);

    m_plugins[m.id] = p;
    return SaveStateLocked();
}

// ── State file ──────────────────────────────────────────────────────

Result<std::monostate> PluginStore::LoadState()
{
    const auto doc = ReadJsonFile(StateFilePath());
    if (!doc.is_object()) return std::monostate{};

    if (doc.contains("enabled") && doc["enabled"].is_object())
    {
        for (const auto& [k, v] : doc["enabled"].items())
        {
            if (!v.is_boolean()) continue;
            const auto it = m_plugins.find(k);
            if (it != m_plugins.end()) it->second.enabled = v.get<bool>();
        }
    }
    return std::monostate{};
}

Result<std::monostate> PluginStore::SaveStateLocked()
{
    nlohmann::json enabled = nlohmann::json::object();
    nlohmann::json installed = nlohmann::json::object();
    for (const auto& [id, p] : m_plugins)
    {
        enabled[id] = p.enabled;
        installed[id] = p.manifest.version.toString();
    }
    nlohmann::json doc;
    doc["enabled"] = enabled;
    doc["installed"] = installed;

    if (!WriteJsonFileAtomic(StateFilePath(), doc))
    {
        return Error{"state_write_failed", "could not write plugin-state.json", 0};
    }
    return std::monostate{};
}

// ── Scanning ────────────────────────────────────────────────────────

void PluginStore::RescanLocked()
{
    const auto root = PluginsRoot();
    std::error_code ec;
    if (!std::filesystem::is_directory(root, ec)) return;

    for (const auto& ent : std::filesystem::directory_iterator(root, ec))
    {
        if (ec) break;
        if (!ent.is_directory()) continue;

        const auto manifestPath = ent.path() / L"manifest.json";
        const auto doc = ReadJsonFile(manifestPath);
        if (doc.is_null())
        {
            spdlog::warn("[plugins] rescan: no readable manifest in {}",
                         toUtf8(ent.path().wstring()));
            continue;
        }

        auto parsed = ParsePluginManifest(doc);
        if (!isOk(parsed))
        {
            spdlog::warn("[plugins] rescan: manifest in {} rejected: {}",
                         toUtf8(ent.path().wstring()),
                         std::get<Error>(parsed).message);
            continue;
        }

        auto m = std::get<PluginManifest>(std::move(parsed));
        const auto dirName = toUtf8(ent.path().filename().wstring());
        if (SanitizePluginId(dirName) != m.id)
        {
            spdlog::warn("[plugins] rescan: dir '{}' does not match manifest id '{}'",
                         dirName, m.id);
            continue;
        }

        InstalledPlugin p;
        p.manifest = std::move(m);
        p.installDir = ent.path();
        p.dataDir = PluginDataRoot() / toWide(p.manifest.id);
        p.enabled = true;
        p.bundled = false;  // overwritten below if mirrored
        std::filesystem::create_directories(p.dataDir, ec);
        m_plugins[p.manifest.id] = std::move(p);
    }
}

void PluginStore::MirrorBundledLocked()
{
    // Source: <exeDir>/plugins/<id>/  — shipped with the installer.
    // Dest:   <LocalAppData>/VRCSM/plugins/<id>/
    // Replace the dest directory if the bundled version is strictly
    // newer than the installed one; otherwise leave as-is to preserve
    // any upgrade the user applied manually. For a fresh install with
    // no LocalAppData state, everything gets mirrored.
    const auto src = getExecutableDirectory() / L"plugins";
    std::error_code ec;
    if (!std::filesystem::is_directory(src, ec)) return;

    const auto dst = PluginsRoot();

    for (const auto& ent : std::filesystem::directory_iterator(src, ec))
    {
        if (ec) break;
        if (!ent.is_directory()) continue;

        const auto manifestPath = ent.path() / L"manifest.json";
        const auto doc = ReadJsonFile(manifestPath);
        if (doc.is_null()) continue;
        auto parsed = ParsePluginManifest(doc);
        if (!isOk(parsed)) continue;
        const auto& m = std::get<PluginManifest>(parsed);

        const auto dirName = SanitizePluginId(m.id);
        if (dirName != m.id) continue;  // skip malformed
        if (!m.autoInstall) continue;   // user must install manually

        const auto targetDir = dst / toWide(m.id);
        bool needCopy = true;

        if (std::filesystem::is_directory(targetDir, ec))
        {
            // Compare versions — only replace if bundled is newer.
            const auto existingDoc = ReadJsonFile(targetDir / L"manifest.json");
            auto existingParsed = ParsePluginManifest(existingDoc);
            if (isOk(existingParsed))
            {
                const auto& existing = std::get<PluginManifest>(existingParsed);
                if (!(existing.version < m.version)) needCopy = false;
            }
        }

        if (needCopy)
        {
            std::filesystem::remove_all(targetDir, ec);
            std::filesystem::create_directories(targetDir.parent_path(), ec);
            std::filesystem::copy(ent.path(), targetDir,
                std::filesystem::copy_options::recursive | std::filesystem::copy_options::overwrite_existing, ec);
            if (ec)
            {
                spdlog::warn("[plugins] mirror bundled '{}' failed: {}", m.id, ec.message());
                continue;
            }
        }

        // Mark as bundled so Uninstall() refuses.
        InstalledPlugin p;
        p.manifest = m;
        p.installDir = targetDir;
        p.dataDir = PluginDataRoot() / toWide(m.id);
        p.bundled = true;
        p.enabled = true;
        std::filesystem::create_directories(p.dataDir, ec);
        m_plugins[m.id] = std::move(p);
    }
}

} // namespace vrcsm::core::plugins
