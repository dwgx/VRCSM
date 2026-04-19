#include "PluginManifest.h"

#include <fmt/format.h>

#include <algorithm>
#include <charconv>
#include <cctype>
#include <regex>
#include <sstream>

namespace vrcsm::core::plugins
{

namespace
{

constexpr std::string_view kFieldId = "id";
constexpr std::string_view kFieldName = "name";
constexpr std::string_view kFieldVersion = "version";
constexpr std::string_view kFieldHostMin = "hostMin";
constexpr std::string_view kFieldShape = "shape";
constexpr std::string_view kFieldEntry = "entry";

bool isIdChar(char c) noexcept
{
    return (c >= 'a' && c <= 'z')
        || (c >= '0' && c <= '9')
        || c == '.' || c == '_' || c == '-';
}

} // namespace

// ── SemVer ──────────────────────────────────────────────────────────

std::optional<SemVer> SemVer::parse(std::string_view text)
{
    if (text.empty()) return std::nullopt;

    SemVer v;
    size_t i = 0;
    auto readNum = [&](int& out) -> bool {
        const size_t start = i;
        while (i < text.size() && std::isdigit(static_cast<unsigned char>(text[i]))) ++i;
        if (i == start) return false;
        const auto [ptr, ec] = std::from_chars(text.data() + start, text.data() + i, out);
        return ec == std::errc{};
    };

    if (!readNum(v.major)) return std::nullopt;
    if (i >= text.size() || text[i] != '.') return std::nullopt;
    ++i;
    if (!readNum(v.minor)) return std::nullopt;
    if (i >= text.size() || text[i] != '.') return std::nullopt;
    ++i;
    if (!readNum(v.patch)) return std::nullopt;

    if (i < text.size() && text[i] == '-')
    {
        ++i;
        v.pre = std::string(text.substr(i));
    }
    else if (i < text.size())
    {
        // We deliberately reject build-metadata and trailing junk;
        // plugin authors get a clearer error this way than silently
        // ignoring unsupported syntax.
        return std::nullopt;
    }

    return v;
}

bool SemVer::operator<(const SemVer& o) const
{
    if (major != o.major) return major < o.major;
    if (minor != o.minor) return minor < o.minor;
    if (patch != o.patch) return patch < o.patch;
    // pre-release has LOWER precedence than release (SemVer 2.0 §11.3)
    if (pre.empty() && !o.pre.empty()) return false;
    if (!pre.empty() && o.pre.empty()) return true;
    return pre < o.pre;
}

bool SemVer::operator==(const SemVer& o) const
{
    return major == o.major && minor == o.minor && patch == o.patch && pre == o.pre;
}

std::string SemVer::toString() const
{
    std::ostringstream os;
    os << major << '.' << minor << '.' << patch;
    if (!pre.empty()) os << '-' << pre;
    return os.str();
}

// ── Id sanitisation ─────────────────────────────────────────────────

std::string SanitizePluginId(std::string_view raw)
{
    std::string out;
    out.reserve(raw.size());
    for (char c : raw)
    {
        const char lower = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        if (isIdChar(lower)) out.push_back(lower);
    }
    // Collapse consecutive dots/dashes — purely cosmetic, keeps IDs
    // tidy when an author gets creative with separators.
    std::string trimmed;
    trimmed.reserve(out.size());
    char last = 0;
    for (char c : out)
    {
        if ((c == '.' || c == '-' || c == '_') && c == last) continue;
        trimmed.push_back(c);
        last = c;
    }
    // Strip leading/trailing separators.
    const auto notSep = [](char c){ return c != '.' && c != '-' && c != '_'; };
    const auto begin = std::find_if(trimmed.begin(), trimmed.end(), notSep);
    const auto end = std::find_if(trimmed.rbegin(), trimmed.rend(), notSep).base();
    return (begin < end) ? std::string(begin, end) : std::string{};
}

// ── Helpers ─────────────────────────────────────────────────────────

bool PluginManifest::hasPermission(std::string_view token) const noexcept
{
    for (const auto& p : permissions) if (p == token) return true;
    return false;
}

// ── Parser ──────────────────────────────────────────────────────────

namespace
{

std::optional<std::string> RequireString(const nlohmann::json& doc, std::string_view key)
{
    const std::string k(key);
    if (!doc.contains(k) || !doc[k].is_string()) return std::nullopt;
    auto s = doc[k].get<std::string>();
    if (s.empty()) return std::nullopt;
    return s;
}

std::optional<SemVer> RequireSemVer(const nlohmann::json& doc, std::string_view key)
{
    const auto s = RequireString(doc, key);
    if (!s) return std::nullopt;
    return SemVer::parse(*s);
}

PluginShape ParseShape(std::string_view raw)
{
    if (raw == "panel") return PluginShape::Panel;
    if (raw == "service") return PluginShape::Service;
    if (raw == "app") return PluginShape::App;
    return PluginShape::Panel;  // caller must have validated first
}

bool IsValidShapeName(std::string_view raw)
{
    return raw == "panel" || raw == "service" || raw == "app";
}

Error BadField(std::string_view field, std::string_view reason)
{
    return Error{"manifest_invalid", fmt::format("manifest.{}: {}", field, reason), 0};
}

} // namespace

Result<PluginManifest> ParsePluginManifest(const nlohmann::json& doc)
{
    if (!doc.is_object())
    {
        return Error{"manifest_invalid", "manifest must be a JSON object", 0};
    }

    PluginManifest m;

    // id
    if (auto s = RequireString(doc, kFieldId); s)
    {
        m.id = *s;
        const auto sanitized = SanitizePluginId(m.id);
        if (sanitized != m.id)
        {
            return BadField(kFieldId, fmt::format(
                "must be lowercase [a-z0-9._-] (got '{}', sanitises to '{}')",
                m.id, sanitized));
        }
        if (m.id.size() < 3 || m.id.size() > 96)
        {
            return BadField(kFieldId, "length must be 3..96");
        }
    }
    else
    {
        return BadField(kFieldId, "missing or not a non-empty string");
    }

    // name
    if (auto s = RequireString(doc, kFieldName); s) m.name = *s;
    else return BadField(kFieldName, "missing or not a non-empty string");

    // version
    if (auto v = RequireSemVer(doc, kFieldVersion); v) m.version = *v;
    else return BadField(kFieldVersion, "missing or not a valid SemVer");

    // hostMin
    if (auto v = RequireSemVer(doc, kFieldHostMin); v) m.hostMin = *v;
    else return BadField(kFieldHostMin, "missing or not a valid SemVer");

    // shape
    if (auto s = RequireString(doc, kFieldShape); s)
    {
        if (!IsValidShapeName(*s))
        {
            return BadField(kFieldShape, "must be one of: panel, service, app");
        }
        m.shape = ParseShape(*s);
    }
    else
    {
        return BadField(kFieldShape, "missing");
    }

    // entry
    if (doc.contains("entry") && doc["entry"].is_object())
    {
        const auto& e = doc["entry"];
        if (e.contains("panel") && e["panel"].is_string()) m.entryPanel = e["panel"].get<std::string>();
        if (e.contains("service") && e["service"].is_string()) m.entryService = e["service"].get<std::string>();
    }

    if (m.hasPanel() && m.entryPanel.empty())
    {
        return BadField("entry.panel", "shape requires panel entry");
    }
    if (m.hasService() && m.entryService.empty())
    {
        return BadField("entry.service", "shape requires service entry");
    }

    // permissions (optional)
    if (doc.contains("permissions") && doc["permissions"].is_array())
    {
        for (const auto& p : doc["permissions"])
        {
            if (p.is_string()) m.permissions.push_back(p.get<std::string>());
        }
    }

    // author
    if (doc.contains("author"))
    {
        const auto& a = doc["author"];
        if (a.is_string())
        {
            m.author.name = a.get<std::string>();
        }
        else if (a.is_object())
        {
            if (a.contains("name") && a["name"].is_string()) m.author.name = a["name"].get<std::string>();
            if (a.contains("url") && a["url"].is_string()) m.author.url = a["url"].get<std::string>();
        }
    }

    // optional scalar strings
    if (doc.contains("homepage") && doc["homepage"].is_string()) m.homepage = doc["homepage"].get<std::string>();
    if (doc.contains("icon") && doc["icon"].is_string()) m.icon = doc["icon"].get<std::string>();
    if (doc.contains("description") && doc["description"].is_string()) m.description = doc["description"].get<std::string>();

    // i18n passthrough
    if (doc.contains("i18n") && doc["i18n"].is_object()) m.i18n = doc["i18n"];

    if (doc.contains("autoInstall") && doc["autoInstall"].is_boolean())
        m.autoInstall = doc["autoInstall"].get<bool>();

    return m;
}

// ── Serialisation ───────────────────────────────────────────────────

nlohmann::json ManifestToJson(const PluginManifest& m)
{
    nlohmann::json out;
    out["id"] = m.id;
    out["name"] = m.name;
    out["version"] = m.version.toString();
    out["hostMin"] = m.hostMin.toString();
    out["shape"] =
        (m.shape == PluginShape::Panel) ? "panel" :
        (m.shape == PluginShape::Service) ? "service" : "app";

    nlohmann::json entry = nlohmann::json::object();
    if (!m.entryPanel.empty()) entry["panel"] = m.entryPanel;
    if (!m.entryService.empty()) entry["service"] = m.entryService;
    if (!entry.empty()) out["entry"] = entry;

    if (!m.permissions.empty()) out["permissions"] = m.permissions;

    if (!m.author.name.empty() || !m.author.url.empty())
    {
        nlohmann::json a;
        if (!m.author.name.empty()) a["name"] = m.author.name;
        if (!m.author.url.empty()) a["url"] = m.author.url;
        out["author"] = a;
    }
    if (!m.homepage.empty()) out["homepage"] = m.homepage;
    if (!m.icon.empty()) out["icon"] = m.icon;
    if (!m.description.empty()) out["description"] = m.description;
    if (!m.i18n.is_null()) out["i18n"] = m.i18n;

    return out;
}

} // namespace vrcsm::core::plugins
