#include "VrDiagnostics.h"
#include "SteamVrConfig.h"

#include <algorithm>
#include <chrono>
#include <cctype>
#include <cwctype>
#include <fstream>
#include <set>
#include <sstream>
#include <string>
#include <system_error>
#include <unordered_map>

#include <WinSock2.h>
#include <WS2tcpip.h>
#include <Windows.h>
#include <iphlpapi.h>
#include <shellapi.h>
#include <TlHelp32.h>
#include <mmdeviceapi.h>
#include <functiondiscoverykeys_devpkey.h>
#include <wrl/client.h>
#include <dxgi.h>
#include <regex>

#include <fmt/format.h>
#include <spdlog/spdlog.h>

#pragma comment(lib, "iphlpapi.lib")
#pragma comment(lib, "dxgi.lib")

namespace vrcsm::core
{

void to_json(nlohmann::json& j, const NetworkAdapter& a)
{
    j = nlohmann::json{
        {"name", a.name},
        {"description", a.description},
        {"ipAddress", a.ipAddress},
        {"isVirtual", a.isVirtual},
        {"isUp", a.isUp},
    };
}

void to_json(nlohmann::json& j, const VrDiagResult& r)
{
    j = nlohmann::json{
        {"adapters", r.adapters},
        {"networkWarnings", r.networkWarnings},
        {"steamvrRunning", r.steamvrRunning},
        {"hmdModel", r.hmdModel},
        {"hmdDriver", r.hmdDriver},
        {"preferredRefreshRate", r.preferredRefreshRate},
        {"supersampleScale", r.supersampleScale},
        {"targetBandwidth", r.targetBandwidth},
        {"motionSmoothing", r.motionSmoothing},
        {"allowSupersampleFiltering", r.allowSupersampleFiltering},
        {"preferredCodec", r.preferredCodec},
        {"gpuName", r.gpuName},
        {"gpuVramBytes", r.gpuVramBytes},
        {"gpuDriverVersion", r.gpuDriverVersion},
        {"defaultPlaybackDevice", r.defaultPlaybackDevice},
        {"defaultRecordingDevice", r.defaultRecordingDevice},
        {"steamSpeakersFound", r.steamSpeakersFound},
        {"steamMicFound", r.steamMicFound},
        {"vrlinkErrors", r.vrlinkErrors},
        {"vrlinkBadLinkEvents", r.vrlinkBadLinkEvents},
        {"vrlinkDroppedFrames", r.vrlinkDroppedFrames},
        {"vrlinkAvgBitrateMbps", r.vrlinkAvgBitrateMbps},
        {"vrlinkMaxLatencyMs", r.vrlinkMaxLatencyMs},
    };
}

namespace {

struct GpuInfo
{
    std::string name;
    uint64_t vramBytes{0};
};

static GpuInfo DetectPrimaryGpu()
{
    GpuInfo info;
    Microsoft::WRL::ComPtr<IDXGIFactory1> factory;
    if (FAILED(CreateDXGIFactory1(__uuidof(IDXGIFactory1),
        reinterpret_cast<void**>(factory.GetAddressOf())))) return info;

    // Pick the adapter with the largest dedicated VRAM — that's almost
    // always the discrete GPU the headset is driven from.
    Microsoft::WRL::ComPtr<IDXGIAdapter1> adapter;
    for (UINT i = 0; factory->EnumAdapters1(i, adapter.ReleaseAndGetAddressOf()) != DXGI_ERROR_NOT_FOUND; ++i)
    {
        DXGI_ADAPTER_DESC1 desc{};
        if (FAILED(adapter->GetDesc1(&desc))) continue;
        if (desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) continue;
        if (desc.DedicatedVideoMemory > info.vramBytes)
        {
            info.vramBytes = desc.DedicatedVideoMemory;
            int sz = WideCharToMultiByte(CP_UTF8, 0, desc.Description, -1, nullptr, 0, nullptr, nullptr);
            if (sz > 0)
            {
                std::string utf8(sz - 1, '\0');
                WideCharToMultiByte(CP_UTF8, 0, desc.Description, -1, utf8.data(), sz, nullptr, nullptr);
                info.name = std::move(utf8);
            }
        }
    }
    return info;
}

struct VrlinkStats
{
    int droppedFrames{0};
    double avgBitrateMbps{0};
    double maxLatencyMs{0};
};

struct RestoreBackupEntry
{
    std::string fromText;
    std::string toText;
    std::filesystem::path from;
    std::filesystem::path to;
};

static VrlinkStats ScanVrlinkStats(const std::vector<std::string>& lines, int tailLines)
{
    VrlinkStats s;
    const int start = std::max(0, static_cast<int>(lines.size()) - tailLines);
    const std::regex kBitrate(R"(bitrate[^\d]{0,20}(\d+(?:\.\d+)?)\s*[Mm]bps)");
    const std::regex kLatency(R"(latency[^\d]{0,20}(\d+(?:\.\d+)?)\s*ms)");
    double bitrateSum = 0;
    int bitrateCount = 0;
    for (int i = start; i < static_cast<int>(lines.size()); ++i)
    {
        const auto& l = lines[i];
        if (l.find("Dropped frame") != std::string::npos ||
            l.find("Frame dropped") != std::string::npos)
        {
            ++s.droppedFrames;
        }
        std::smatch m;
        if (std::regex_search(l, m, kBitrate))
        {
            try
            {
                bitrateSum += std::stod(m[1].str());
                ++bitrateCount;
            }
            catch (const std::exception& ex)
            {
                spdlog::debug("VrDiag: failed to parse bitrate '{}': {}", m[1].str(), ex.what());
            }
        }
        if (std::regex_search(l, m, kLatency))
        {
            try
            {
                const double v = std::stod(m[1].str());
                if (v > s.maxLatencyMs) s.maxLatencyMs = v;
            }
            catch (const std::exception& ex)
            {
                spdlog::debug("VrDiag: failed to parse latency '{}': {}", m[1].str(), ex.what());
            }
        }
    }
    if (bitrateCount > 0) s.avgBitrateMbps = bitrateSum / bitrateCount;
    return s;
}

static std::string LowerAscii(std::string s)
{
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return s;
}

static std::string ReadTextFile(const std::filesystem::path& path)
{
    std::ifstream in(path, std::ios::binary);
    if (!in) return {};
    std::stringstream buf;
    buf << in.rdbuf();
    return buf.str();
}

static bool WriteTextFile(const std::filesystem::path& path, const std::string& content)
{
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    if (!out) return false;
    out << content;
    return static_cast<bool>(out);
}

static std::vector<std::string> SplitLines(const std::string& text)
{
    std::vector<std::string> lines;
    std::stringstream ss(text);
    std::string line;
    while (std::getline(ss, line))
    {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        lines.push_back(line);
    }
    return lines;
}

static std::string JoinLines(const std::vector<std::string>& lines)
{
    std::string out;
    for (const auto& line : lines)
    {
        out += line;
        out += '\n';
    }
    return out;
}

static std::string UnescapeVdfPath(std::string s)
{
    std::string out;
    out.reserve(s.size());
    for (std::size_t i = 0; i < s.size(); ++i)
    {
        if (s[i] == '\\' && i + 1 < s.size())
        {
            const char next = s[i + 1];
            if (next == '\\' || next == '"')
            {
                out += next;
                ++i;
                continue;
            }
        }
        out += s[i];
    }
    return out;
}

static std::optional<std::string> VdfKey(const std::string& line)
{
    static const std::regex kKey(R"vdf(^\s*"([^"]+)")vdf");
    std::smatch m;
    if (!std::regex_search(line, m, kKey)) return std::nullopt;
    return m[1].str();
}

static std::optional<std::string> VdfValue(const std::string& line, const std::string& key)
{
    const std::regex re("^\\s*\"" + key + "\"\\s*\"([^\"]*)\"");
    std::smatch m;
    if (!std::regex_search(line, m, re)) return std::nullopt;
    return m[1].str();
}

static std::optional<int> FindBlockEnd(const std::vector<std::string>& lines, int openBraceLine)
{
    int depth = 0;
    for (int i = openBraceLine; i < static_cast<int>(lines.size()); ++i)
    {
        if (lines[i].find('{') != std::string::npos) ++depth;
        if (lines[i].find('}') != std::string::npos)
        {
            --depth;
            if (depth == 0) return i;
        }
    }
    return std::nullopt;
}

static std::string BlockText(const std::vector<std::string>& lines, int start, int end)
{
    std::string out;
    for (int i = start; i <= end && i < static_cast<int>(lines.size()); ++i)
    {
        out += lines[i];
        out += '\n';
    }
    return out;
}

static void RemoveRanges(std::vector<std::string>& lines, std::vector<std::pair<int, int>> ranges)
{
    std::sort(ranges.begin(), ranges.end(), [](const auto& a, const auto& b) {
        return a.first > b.first;
    });
    for (const auto& [start, end] : ranges)
    {
        if (start < 0 || end < start || start >= static_cast<int>(lines.size())) continue;
        const auto last = std::min(end, static_cast<int>(lines.size()) - 1);
        lines.erase(lines.begin() + start, lines.begin() + last + 1);
    }
}

static std::vector<std::filesystem::path> SteamLibraryFolders(const std::filesystem::path& steamPath)
{
    std::vector<std::filesystem::path> out;
    if (!steamPath.empty()) out.push_back(steamPath);

    const auto libraryFile = steamPath / L"steamapps" / L"libraryfolders.vdf";
    const auto text = ReadTextFile(libraryFile);
    static const std::regex kPath(R"vdf("path"\s*"([^"]+)")vdf", std::regex::icase);
    for (std::sregex_iterator it(text.begin(), text.end(), kPath), end; it != end; ++it)
    {
        std::filesystem::path p = UnescapeVdfPath((*it)[1].str());
        if (p.empty()) continue;
        const auto exists = std::find(out.begin(), out.end(), p) != out.end();
        if (!exists) out.push_back(std::move(p));
    }
    return out;
}

static std::optional<std::filesystem::path> FindSteamVrManifest(const std::filesystem::path& steamPath)
{
    for (const auto& lib : SteamLibraryFolders(steamPath))
    {
        auto manifest = lib / L"steamapps" / L"appmanifest_250820.acf";
        std::error_code ec;
        if (std::filesystem::exists(manifest, ec) && !ec) return manifest;
    }
    return std::nullopt;
}

static std::optional<std::filesystem::path> FindSteamVrInstallPath(const std::filesystem::path& steamPath)
{
    for (const auto& lib : SteamLibraryFolders(steamPath))
    {
        auto install = lib / L"steamapps" / L"common" / L"SteamVR";
        std::error_code ec;
        if (std::filesystem::exists(install, ec) && !ec) return install;
    }
    return std::nullopt;
}

static bool PathFilenameEquals(const std::filesystem::path& path, std::wstring_view expected)
{
    return _wcsicmp(path.filename().native().c_str(), std::wstring(expected).c_str()) == 0;
}

static bool SamePathLexical(const std::filesystem::path& a, const std::filesystem::path& b)
{
    return !a.empty()
        && !b.empty()
        && ensureWithinBase(a, b)
        && ensureWithinBase(b, a);
}

static bool CanonicalWithinBase(const std::filesystem::path& child, const std::filesystem::path& parent)
{
    std::error_code ec;
    const auto childCanonical = std::filesystem::weakly_canonical(child, ec);
    if (ec) return false;
    const auto parentCanonical = std::filesystem::weakly_canonical(parent, ec);
    if (ec) return false;
    return ensureWithinBase(parentCanonical, childCanonical);
}

static bool IsSteamUserLocalConfigPath(const std::filesystem::path& steamPath, const std::filesystem::path& target)
{
    if (!PathFilenameEquals(target, L"localconfig.vdf")) return false;
    const auto configDir = target.parent_path();
    if (!PathFilenameEquals(configDir, L"config")) return false;
    const auto userDir = configDir.parent_path();
    const auto userId = userDir.filename().wstring();
    if (userId.empty() || !std::all_of(userId.begin(), userId.end(), [](wchar_t ch) {
            return std::iswdigit(ch) != 0;
        }))
    {
        return false;
    }
    return SamePathLexical(userDir.parent_path(), steamPath / L"userdata");
}

static std::vector<std::filesystem::path> FindLocalConfigFiles(const std::filesystem::path& steamPath)
{
    std::vector<std::filesystem::path> out;
    const auto userdata = steamPath / L"userdata";
    std::error_code ec;
    if (!std::filesystem::exists(userdata, ec) || ec) return out;

    for (const auto& entry : std::filesystem::directory_iterator(userdata, ec))
    {
        if (ec || !entry.is_directory()) continue;
        auto file = entry.path() / L"config" / L"localconfig.vdf";
        if (std::filesystem::exists(file, ec) && !ec) out.push_back(file);
    }
    return out;
}

static nlohmann::json FileSnapshot(const std::filesystem::path& path)
{
    std::error_code ec;
    nlohmann::json j{
        {"path", toUtf8(path.wstring())},
        {"exists", std::filesystem::exists(path, ec) && !ec},
    };
    if (j["exists"].get<bool>())
    {
        j["size"] = static_cast<std::uint64_t>(std::filesystem::file_size(path, ec));
        if (!ec)
        {
            if (auto t = safeLastWriteTime(path))
                j["lastWriteTime"] = isoTimestamp(*t);
        }
    }
    return j;
}

static std::string TimestampForPath()
{
    SYSTEMTIME st{};
    GetLocalTime(&st);
    return fmt::format("{:04}{:02}{:02}-{:02}{:02}{:02}",
        st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond);
}

static nlohmann::json ParseOpenVrPaths()
{
    nlohmann::json out{{"exists", false}};
    auto localAppData = tryGetEnvPath(L"LOCALAPPDATA");
    if (!localAppData) return out;

    auto path = *localAppData / L"openvr" / L"openvrpaths.vrpath";
    out["path"] = toUtf8(path.wstring());
    std::error_code ec;
    if (!std::filesystem::exists(path, ec) || ec) return out;

    out["exists"] = true;
    const auto text = ReadTextFile(path);
    try
    {
        auto doc = nlohmann::json::parse(text);
        out["runtime"] = doc.value("runtime", nlohmann::json::array());
        out["config"] = doc.value("config", nlohmann::json::array());
        out["log"] = doc.value("log", nlohmann::json::array());
    }
    catch (const std::exception& ex)
    {
        out["parseError"] = ex.what();
    }
    return out;
}

static nlohmann::json AnalyseManifest(const std::filesystem::path& manifest)
{
    nlohmann::json j = FileSnapshot(manifest);
    j["isBeta"] = false;
    j["pendingDownload"] = false;
    j["markers"] = nlohmann::json::array();
    j["fields"] = nlohmann::json::object();
    if (!j.value("exists", false)) return j;

    const auto text = ReadTextFile(manifest);
    const auto lines = SplitLines(text);
    for (const auto& line : lines)
    {
        const auto lower = LowerAscii(line);
        for (const auto* key : {"StateFlags", "buildid", "TargetBuildID", "UpdateResult",
                                "BytesToDownload", "BytesDownloaded", "BytesToStage",
                                "BytesStaged", "lastupdated"})
        {
            if (auto value = VdfValue(line, key))
                j["fields"][key] = *value;
        }
        if (lower.find("betakey") != std::string::npos)
        {
            j["isBeta"] = true;
            j["markers"].push_back(line);
        }
    }

    const auto bytesToDownload = j["fields"].value("BytesToDownload", std::string{"0"});
    const auto targetBuild = j["fields"].value("TargetBuildID", std::string{"0"});
    j["pendingDownload"] = bytesToDownload != "0" || targetBuild != "0";
    return j;
}

static nlohmann::json AnalyseLocalConfig(const std::filesystem::path& path)
{
    nlohmann::json j = FileSnapshot(path);
    j["questDeviceCount"] = 0;
    j["betaMarkers"] = 0;
    j["markers"] = nlohmann::json::array();
    if (!j.value("exists", false)) return j;

    const auto lines = SplitLines(ReadTextFile(path));
    for (int i = 0; i < static_cast<int>(lines.size()); ++i)
    {
        const auto lower = LowerAscii(lines[i]);
        if (lower.find("oculus quest") != std::string::npos ||
            lower.find("steam link") != std::string::npos ||
            lower.find("vrlink") != std::string::npos)
        {
            if (j["markers"].size() < 12)
                j["markers"].push_back(fmt::format("{}: {}", i + 1, lines[i]));
            if (lower.find("oculus quest") != std::string::npos)
                j["questDeviceCount"] = j["questDeviceCount"].get<int>() + 1;
        }
        const bool encodedSteamVrBeta =
            VdfKey(lines[i]).value_or(std::string{}) == "250820" &&
            lower.find("62657461") != std::string::npos;
        if (lower.find("250820-beta") != std::string::npos ||
            lower.find("betakey") != std::string::npos ||
            encodedSteamVrBeta)
        {
            j["betaMarkers"] = j["betaMarkers"].get<int>() + 1;
            if (j["markers"].size() < 12)
                j["markers"].push_back(fmt::format("{}: {}", i + 1, lines[i]));
        }
    }
    return j;
}

static nlohmann::json ScanSteamVrLogs(const std::filesystem::path& steamPath, int maxMatches = 80)
{
    static const std::vector<std::pair<std::string, std::string>> kPatterns = {
        {"invalid_session", "invalid session id"},
        {"wireless_not_connected", "wirelesshmdnotconnected"},
        {"wireless_hmd_215", "wireless hmd has not connected"},
        {"no_devices", "no connected devices found"},
        {"lost_master", "lost master process"},
        {"unknown_issue", "unknown issue"},
        {"unknown_reason", "unknown reason"},
        {"ready", "steamvrsystemstate_ready"},
        {"vrlink", "vrlink"},
        {"quest", "quest"},
    };

    nlohmann::json out{
        {"files", nlohmann::json::array()},
        {"matches", nlohmann::json::array()},
        {"counts", nlohmann::json::object()},
    };
    for (const auto& [key, _] : kPatterns) out["counts"][key] = 0;

    const auto logDir = steamPath / L"logs";
    const std::vector<std::filesystem::path> files = {
        logDir / L"driver_vrlink.txt",
        logDir / L"vrserver.txt",
        logDir / L"vrmonitor.txt",
        logDir / L"vrclient_vrwebhelper_pairing.txt",
    };

    for (const auto& file : files)
    {
        out["files"].push_back(FileSnapshot(file));
        std::ifstream in(file);
        if (!in) continue;

        std::vector<std::string> lines;
        std::string line;
        while (std::getline(in, line))
        {
            if (!line.empty() && line.back() == '\r') line.pop_back();
            lines.push_back(std::move(line));
        }
        const int start = std::max(0, static_cast<int>(lines.size()) - 1200);
        for (int i = start; i < static_cast<int>(lines.size()); ++i)
        {
            const auto lower = LowerAscii(lines[i]);
            std::string kind;
            for (const auto& [key, needle] : kPatterns)
            {
                if (lower.find(needle) != std::string::npos)
                {
                    out["counts"][key] = out["counts"][key].get<int>() + 1;
                    if (kind.empty()) kind = key;
                }
            }
            if (!kind.empty() && out["matches"].size() < static_cast<std::size_t>(maxMatches))
            {
                out["matches"].push_back({
                    {"file", file.filename().string()},
                    {"line", i + 1},
                    {"kind", kind},
                    {"text", lines[i]},
                });
            }
        }
    }
    return out;
}

static std::string BuildSteamLinkSummary(const nlohmann::json& manifest,
                                         const nlohmann::json& localconfigs,
                                         const nlohmann::json& logs)
{
    const int invalidSessions = logs["counts"].value("invalid_session", 0);
    const int wireless = logs["counts"].value("wireless_not_connected", 0)
        + logs["counts"].value("wireless_hmd_215", 0);
    const int lostMaster = logs["counts"].value("lost_master", 0);
    const int ready = logs["counts"].value("ready", 0);
    int questDevices = 0;
    int betaMarkers = manifest.value("isBeta", false) ? 1 : 0;
    for (const auto& cfg : localconfigs)
    {
        questDevices += cfg.value("questDeviceCount", 0);
        betaMarkers += cfg.value("betaMarkers", 0);
    }

    if (invalidSessions > 0 && wireless > 0)
    {
        return "VRLink session mismatch: Quest packets reached the PC, but SteamVR rejected the wireless HMD session.";
    }
    if (manifest.value("isBeta", false) || betaMarkers > 0)
    {
        return "SteamVR beta or user-level beta markers are present; this can keep SteamVR on a VRLink build with broken pairing state.";
    }
    if (ready > 0 && invalidSessions == 0)
    {
        return "Recent logs include SteamVR Ready and no invalid-session burst in the scanned tail.";
    }
    if (lostMaster > 0)
    {
        return "SteamVR shut down after losing its master process; check VRLink pairing and runtime process stability.";
    }
    if (questDevices > 0)
    {
        return "Steam Link / Quest pairing records are present; stale entries can be reset safely after backup.";
    }
    return "No decisive VRLink failure signature found in the scanned SteamVR logs.";
}

static int CountQuestDevices(const nlohmann::json& localconfigs)
{
    int total = 0;
    for (const auto& cfg : localconfigs)
        total += cfg.value("questDeviceCount", 0);
    return total;
}

static int CountBetaMarkers(const nlohmann::json& manifest, const nlohmann::json& localconfigs)
{
    int total = manifest.value("isBeta", false) ? 1 : 0;
    for (const auto& cfg : localconfigs)
        total += cfg.value("betaMarkers", 0);
    return total;
}

static nlohmann::json MakeIssue(const std::string& id,
                                const std::string& severity,
                                const std::string& title,
                                const std::string& detail,
                                const std::string& repairPlan)
{
    return nlohmann::json{
        {"id", id},
        {"severity", severity},
        {"title", title},
        {"detail", detail},
        {"repairPlan", repairPlan},
    };
}

static nlohmann::json BuildSteamLinkIssues(const nlohmann::json& manifest,
                                           const nlohmann::json& localconfigs,
                                           const nlohmann::json& logs,
                                           const nlohmann::json& diag,
                                           bool steamVrInstalled)
{
    nlohmann::json issues = nlohmann::json::array();
    const int invalidSessions = logs["counts"].value("invalid_session", 0);
    const int wireless = logs["counts"].value("wireless_not_connected", 0)
        + logs["counts"].value("wireless_hmd_215", 0);
    const int lostMaster = logs["counts"].value("lost_master", 0);
    const int unknown = logs["counts"].value("unknown_issue", 0)
        + logs["counts"].value("unknown_reason", 0);
    const int questDevices = CountQuestDevices(localconfigs);
    const int betaMarkers = CountBetaMarkers(manifest, localconfigs);

    if (!steamVrInstalled)
    {
        issues.push_back(MakeIssue(
            "steamvr_missing",
            "critical",
            "SteamVR is not installed or its runtime folder was not found",
            "AppID 250820 is required for Steam Link VR. Install SteamVR first, then run validation.",
            "stable-validate"));
    }
    if (manifest.value("pendingDownload", false))
    {
        issues.push_back(MakeIssue(
            "steamvr_pending_update",
            "warning",
            "SteamVR has a pending update or unfinished download",
            "Steam Link can fail while SteamVR is between manifests. Let Steam finish the update before pairing again.",
            "stable-validate"));
    }
    if (invalidSessions > 0 && wireless > 0)
    {
        issues.push_back(MakeIssue(
            "vrlink_session_mismatch",
            "critical",
            "VRLink session ID mismatch",
            fmt::format("{} invalid-session packets were found and SteamVR also reported the wireless HMD as not connected.", invalidSessions),
            "full-vrlink-reset"));
    }
    else if (invalidSessions > 0)
    {
        issues.push_back(MakeIssue(
            "vrlink_invalid_session",
            "warning",
            "VRLink invalid-session packets were found",
            fmt::format("{} invalid-session packets were found in the scanned SteamVR log tail.", invalidSessions),
            "pairing-reset"));
    }
    if (lostMaster > 0 || unknown > 0)
    {
        issues.push_back(MakeIssue(
            "steamvr_unknown_shutdown",
            "warning",
            "SteamVR shut down with an unknown master-process reason",
            "This often follows a failed VRLink handshake. Reset pairing first, then retry from the headset.",
            "full-vrlink-reset"));
    }
    if (questDevices > 0)
    {
        issues.push_back(MakeIssue(
            "quest_pairing_cache",
            "warning",
            "Quest / Steam Link pairing cache is present",
            fmt::format("{} Quest pairing marker(s) were found in Steam localconfig.vdf.", questDevices),
            "pairing-reset"));
    }
    if (betaMarkers > 0)
    {
        issues.push_back(MakeIssue(
            "steamvr_beta_marker",
            "warning",
            "SteamVR beta marker is present",
            "BetaKey, 250820-beta, or encoded beta markers can pin SteamVR to a VRLink build with broken pairing state.",
            "stable-validate"));
    }

    int activeVirtual = 0;
    int activePhysical = 0;
    for (const auto& adapter : diag.value("adapters", nlohmann::json::array()))
    {
        if (!adapter.value("isUp", false) || adapter.value("ipAddress", std::string{}).empty())
            continue;
        const auto ip = adapter.value("ipAddress", std::string{});
        const auto text = LowerAscii(adapter.value("name", std::string{}) + " " +
                                     adapter.value("description", std::string{}));
        const bool loopback = ip.rfind("127.", 0) == 0 || text.find("loopback") != std::string::npos;
        if (adapter.value("isVirtual", false) && !loopback)
            ++activeVirtual;
        else if (!loopback)
            ++activePhysical;
    }
    if (activePhysical == 0)
    {
        issues.push_back(MakeIssue(
            "no_physical_ipv4_adapter",
            "warning",
            "No active physical IPv4 adapter was detected",
            "Steam Link works best when the PC is on wired Ethernet and the headset is on the same router.",
            "manual-network-check"));
    }
    if (activeVirtual > 0)
    {
        issues.push_back(MakeIssue(
            "virtual_network_adapter",
            "info",
            "Virtual network adapters are active",
            fmt::format("{} active virtual adapter(s) were detected. They are not changed automatically; disable VPN / Hyper-V temporarily if pairing keeps failing.", activeVirtual),
            "manual-network-check"));
    }

    const int targetBandwidth = diag.value("targetBandwidth", 0);
    const double supersampleScale = diag.value("supersampleScale", 0.0);
    const std::uint64_t vram = diag.value("gpuVramBytes", static_cast<std::uint64_t>(0));
    if (targetBandwidth > 150)
    {
        issues.push_back(MakeIssue(
            "high_bandwidth",
            "info",
            "Steam Link bandwidth is high",
            fmt::format("{} Mbps may be too aggressive for shared Wi-Fi. Try 80-120 Mbps while debugging.", targetBandwidth),
            "safe-streaming"));
    }
    if (vram > 0 && vram < 8ull * 1024ull * 1024ull * 1024ull && supersampleScale > 1.0)
    {
        issues.push_back(MakeIssue(
            "overscaled_low_vram",
            "info",
            "Supersampling is high for a lower-VRAM GPU",
            "Lower supersampling to 0.8-1.0 while validating the link, then raise it after the connection is stable.",
            "safe-streaming"));
    }

    if (issues.empty())
    {
        issues.push_back(MakeIssue(
            "no_blocker_found",
            "ok",
            "No blocking Steam Link signature was found",
            "The scanned tail does not show beta, pending update, or invalid-session burst. Retry pairing and run diagnostics immediately after failure.",
            "pairing-reset"));
    }
    return issues;
}

static nlohmann::json BuildSteamLinkRepairPlans(const nlohmann::json& issues)
{
    auto hasIssue = [&](const std::string& id) {
        return std::any_of(issues.begin(), issues.end(), [&](const auto& issue) {
            return issue.value("id", std::string{}) == id;
        });
    };

    return nlohmann::json::array({
        {
            {"id", "quest-link-backup"},
            {"title", "Back up current Quest Link settings"},
            {"risk", "low"},
            {"recommended", hasIssue("quest_pairing_cache") || hasIssue("vrlink_invalid_session")},
            {"description", "Creates a restore-capable snapshot of SteamVR, VRLink, Quest pairing, and SteamVR manifest state without changing anything."},
            {"actions", {"Back up appmanifest/localconfig/SteamVR settings", "Back up config/vrlink and remoteclients.vdf", "Back up SteamVR htmlcache"}}
        },
        {
            {"id", "pairing-reset"},
            {"title", "Pairing reset"},
            {"risk", "low"},
            {"recommended", hasIssue("quest_pairing_cache") || hasIssue("vrlink_invalid_session")},
            {"description", "Clears Steam account-level Quest / Steam Link pairing records and SteamVR web cache, then lets the headset re-pair cleanly."},
            {"actions", {"Stop SteamVR/Steam", "Back up localconfig.vdf", "Remove Quest streaming device blocks", "Clear SteamVR htmlcache"}}
        },
        {
            {"id", "full-vrlink-reset"},
            {"title", "Full VRLink reset"},
            {"risk", "medium"},
            {"recommended", hasIssue("vrlink_session_mismatch") || hasIssue("steamvr_unknown_shutdown")},
            {"description", "Uses the same fix path that recovered the Quest 3 session: pairing cache, SteamVR local runtime state, VRLink config folder, stale logs, beta markers, and Steam validation."},
            {"actions", {"Stop Steam/SteamVR", "Back up appmanifest/localconfig/SteamVR settings", "Move steamvr.vrsettings and vrstats", "Move config/vrlink and remoteclients.vdf", "Archive old VRLink logs", "Open steam://validate/250820"}}
        },
        {
            {"id", "stable-validate"},
            {"title", "Stable branch validation"},
            {"risk", "low"},
            {"recommended", hasIssue("steamvr_beta_marker") || hasIssue("steamvr_pending_update") || hasIssue("steamvr_missing")},
            {"description", "Removes SteamVR beta markers only and opens Steam validation for AppID 250820."},
            {"actions", {"Back up appmanifest/localconfig", "Remove BetaKey / 250820-beta markers", "Open steam://validate/250820"}}
        },
        {
            {"id", "safe-streaming"},
            {"title", "Safe streaming parameters"},
            {"risk", "low"},
            {"recommended", hasIssue("high_bandwidth") || hasIssue("overscaled_low_vram")},
            {"description", "Writes conservative Quest-safe Steam Link settings without clearing pairing data."},
            {"actions", {"Back up steamvr.vrsettings", "Set 80 Mbps automatic bandwidth", "Set 1.0x supersampling", "Set 72 Hz", "Disable motion smoothing"}}
        }
    });
}

static nlohmann::json MakeSettingsProfile(const std::string& id,
                                          const std::string& title,
                                          int bandwidth,
                                          double scale,
                                          int refresh,
                                          bool autoBandwidth,
                                          bool motionSmoothing,
                                          bool filtering,
                                          const std::string& note,
                                          bool recommended)
{
    return nlohmann::json{
        {"id", id},
        {"title", title},
        {"recommended", recommended},
        {"bandwidth", bandwidth},
        {"supersampleScale", scale},
        {"refreshRate", refresh},
        {"note", note},
        {"updates", {
            {"driver_vrlink", {
                {"targetBandwidth", bandwidth},
                {"automaticBandwidth", autoBandwidth},
            }},
            {"steamvr", {
                {"supersampleScale", scale},
                {"supersampleManualOverride", true},
                {"preferredRefreshRate", refresh},
                {"motionSmoothing", motionSmoothing},
                {"allowSupersampleFiltering", filtering},
            }},
        }},
    };
}

static nlohmann::json BuildSuggestedSettings(const nlohmann::json& diag)
{
    const std::uint64_t vram = diag.value("gpuVramBytes", static_cast<std::uint64_t>(0));
    const bool lowVram = vram > 0 && vram < 8ull * 1024ull * 1024ull * 1024ull;
    const bool highVram = vram >= 10ull * 1024ull * 1024ull * 1024ull;

    return nlohmann::json::array({
        MakeSettingsProfile(
            "low-stability",
            "Low performance stability",
            60,
            0.8,
            72,
            true,
            false,
            true,
            "Use this when the link connects but jitters, blurs, or black-screens.",
            lowVram),
        MakeSettingsProfile(
            "balanced-stable",
            "Balanced stable",
            90,
            1.0,
            72,
            true,
            false,
            true,
            "Good default for Quest 2/3 on normal Wi-Fi 5/6 routers.",
            !lowVram),
        MakeSettingsProfile(
            "quest3-clarity",
            "Quest 3 clarity",
            highVram ? 130 : 110,
            highVram ? 1.2 : 1.1,
            90,
            true,
            false,
            true,
            "Raise clarity after the pairing/session problem is stable.",
            highVram)
    });
}

static std::string EditedManifestWithoutBetaKey(const std::string& text, int& removed)
{
    removed = 0;
    auto lines = SplitLines(text);
    std::vector<std::string> out;
    out.reserve(lines.size());
    for (const auto& line : lines)
    {
        if (LowerAscii(line).find("betakey") != std::string::npos)
        {
            ++removed;
            continue;
        }
        out.push_back(line);
    }
    return JoinLines(out);
}

static std::string EditedLocalConfig(const std::string& text, int& removedDeviceBlocks, int& removedBetaBlocks)
{
    auto lines = SplitLines(text);
    std::vector<std::pair<int, int>> ranges;
    removedDeviceBlocks = 0;
    removedBetaBlocks = 0;

    for (int i = 0; i + 1 < static_cast<int>(lines.size()); ++i)
    {
        auto key = VdfKey(lines[i]);
        if (key && *key == "250820-beta" && lines[i + 1].find('{') != std::string::npos)
        {
            if (auto end = FindBlockEnd(lines, i + 1))
            {
                ranges.push_back({i, *end});
                ++removedBetaBlocks;
            }
        }
    }

    for (int i = 0; i + 1 < static_cast<int>(lines.size()); ++i)
    {
        auto key = VdfKey(lines[i]);
        if (!key || *key != "Devices" || lines[i + 1].find('{') == std::string::npos) continue;
        auto devicesEnd = FindBlockEnd(lines, i + 1);
        if (!devicesEnd) continue;
        for (int j = i + 2; j + 1 < *devicesEnd; ++j)
        {
            if (!VdfKey(lines[j]) || lines[j + 1].find('{') == std::string::npos) continue;
            auto childEnd = FindBlockEnd(lines, j + 1);
            if (!childEnd || *childEnd > *devicesEnd) continue;
            const auto block = LowerAscii(BlockText(lines, j, *childEnd));
            if (block.find("\"devicename\"") != std::string::npos &&
                (block.find("oculus quest") != std::string::npos ||
                 block.find("steam link") != std::string::npos ||
                 block.find("vrlink") != std::string::npos))
            {
                ranges.push_back({j, *childEnd});
                ++removedDeviceBlocks;
            }
            j = *childEnd;
        }
    }

    RemoveRanges(lines, ranges);

    std::vector<std::string> out;
    out.reserve(lines.size());
    for (const auto& line : lines)
    {
        const auto lower = LowerAscii(line);
        const bool encodedSteamVrBeta =
            VdfKey(line).value_or(std::string{}) == "250820" &&
            lower.find("62657461") != std::string::npos;
        if (lower.find("250820-beta") != std::string::npos ||
            lower.find("betakey") != std::string::npos ||
            encodedSteamVrBeta)
        {
            ++removedBetaBlocks;
            continue;
        }
        out.push_back(line);
    }
    return JoinLines(out);
}

static std::vector<nlohmann::json> EnumerateMatchingProcesses(const std::set<std::wstring>& names)
{
    std::vector<nlohmann::json> out;
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return out;

    PROCESSENTRY32W pe{};
    pe.dwSize = sizeof(pe);
    if (Process32FirstW(snap, &pe))
    {
        do
        {
            std::wstring exe = pe.szExeFile;
            std::transform(exe.begin(), exe.end(), exe.begin(), [](wchar_t c) {
                return static_cast<wchar_t>(std::towlower(c));
            });
            if (names.count(exe) > 0)
            {
                out.push_back({
                    {"pid", static_cast<std::uint32_t>(pe.th32ProcessID)},
                    {"name", toUtf8(pe.szExeFile)},
                });
            }
        } while (Process32NextW(snap, &pe));
    }
    CloseHandle(snap);
    return out;
}

static void StopMatchingProcesses(const std::set<std::wstring>& names, nlohmann::json& stopped, nlohmann::json& failures)
{
    const auto matches = EnumerateMatchingProcesses(names);
    for (const auto& proc : matches)
    {
        const DWORD pid = proc.value("pid", 0u);
        HANDLE h = OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE, FALSE, pid);
        if (!h)
        {
            failures.push_back({{"pid", pid}, {"name", proc.value("name", "")}, {"error", "OpenProcess failed"}});
            continue;
        }
        if (!TerminateProcess(h, 0))
        {
            failures.push_back({{"pid", pid}, {"name", proc.value("name", "")}, {"error", "TerminateProcess failed"}});
            CloseHandle(h);
            continue;
        }
        WaitForSingleObject(h, 5000);
        CloseHandle(h);
        stopped.push_back(proc);
    }
}

static bool CopyFileToBackup(const std::filesystem::path& from,
                             const std::filesystem::path& backupDir,
                             const std::string& label,
                             nlohmann::json& backups,
                             std::error_code& ec)
{
    if (!std::filesystem::exists(from, ec) || ec)
    {
        ec.clear();
        return true;
    }
    auto dest = backupDir / fmt::format("{}-{}", label, from.filename().string());
    std::filesystem::copy_file(from, dest, std::filesystem::copy_options::overwrite_existing, ec);
    if (ec) return false;
    backups.push_back({{"from", toUtf8(from.wstring())}, {"to", toUtf8(dest.wstring())}});
    return true;
}

static bool CopyPathToBackup(const std::filesystem::path& from,
                             const std::filesystem::path& backupDir,
                             const std::string& label,
                             nlohmann::json& backups,
                             std::error_code& ec)
{
    if (!std::filesystem::exists(from, ec) || ec)
    {
        ec.clear();
        return true;
    }

    const auto dest = backupDir / fmt::format("{}-{}", label, from.filename().string());
    if (std::filesystem::is_directory(from, ec))
    {
        ec.clear();
        std::filesystem::copy(from, dest,
            std::filesystem::copy_options::recursive |
            std::filesystem::copy_options::overwrite_existing,
            ec);
    }
    else
    {
        ec.clear();
        std::filesystem::copy_file(from, dest, std::filesystem::copy_options::overwrite_existing, ec);
    }
    if (ec) return false;

    backups.push_back({{"from", toUtf8(from.wstring())}, {"to", toUtf8(dest.wstring())}});
    return true;
}

static nlohmann::json ReadJsonFileLoose(const std::filesystem::path& path)
{
    const auto text = ReadTextFile(path);
    if (text.empty()) return nlohmann::json{};
    return nlohmann::json::parse(text, nullptr, false);
}

static bool WriteBackupMetadata(const std::filesystem::path& backupDir,
                                const std::string& planId,
                                const nlohmann::json& backups,
                                const nlohmann::json& actions,
                                std::error_code& ec)
{
    nlohmann::json doc{
        {"schema", 1},
        {"kind", "steamvr-link-backup"},
        {"planId", planId},
        {"created", TimestampForPath()},
        {"backups", backups},
        {"actions", actions},
    };
    const auto path = backupDir / L"vrcsm-backup.json";
    if (!WriteTextFile(path, doc.dump(2)))
    {
        ec = std::make_error_code(std::errc::io_error);
        return false;
    }
    ec.clear();
    return true;
}

} // namespace

bool VrDiagnostics::IsSteamLinkRestoreTargetAllowed(
    const std::filesystem::path& steamPath,
    const std::optional<std::filesystem::path>& localAppData,
    const std::filesystem::path& target)
{
    if (steamPath.empty() || target.empty() || !target.is_absolute())
    {
        return false;
    }

    const std::filesystem::path exactTargets[] = {
        steamPath / L"config" / L"steamvr.vrsettings",
        steamPath / L"config" / L"steamvr.vrstats",
        steamPath / L"config" / L"vrlink",
        steamPath / L"config" / L"remoteclients.vdf",
        steamPath / L"logs" / L"driver_vrlink.txt",
        steamPath / L"logs" / L"vrserver.txt",
        steamPath / L"logs" / L"vrmonitor.txt",
        steamPath / L"logs" / L"vrclient_vrwebhelper_pairing.txt",
    };
    for (const auto& allowed : exactTargets)
    {
        if (SamePathLexical(target, allowed))
        {
            return true;
        }
    }

    if (IsSteamUserLocalConfigPath(steamPath, target))
    {
        return true;
    }

    for (const auto& library : SteamLibraryFolders(steamPath))
    {
        if (SamePathLexical(target, library / L"steamapps" / L"appmanifest_250820.acf"))
        {
            return true;
        }
    }

    if (localAppData)
    {
        return SamePathLexical(target, *localAppData / L"SteamVR" / L"htmlcache");
    }
    return false;
}

bool VrDiagnostics::IsSteamLinkBackupSourceAllowed(
    const std::filesystem::path& backupDir,
    const std::filesystem::path& source,
    bool requireCanonical)
{
    if (backupDir.empty()
        || source.empty()
        || !backupDir.is_absolute()
        || !source.is_absolute()
        || SamePathLexical(source, backupDir)
        || !ensureWithinBase(backupDir, source))
    {
        return false;
    }
    if (requireCanonical)
    {
        return CanonicalWithinBase(source, backupDir);
    }
    return true;
}

static std::string wideToUtf8(const std::wstring& w)
{
    if (w.empty()) return {};
    int sz = WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), nullptr, 0, nullptr, nullptr);
    std::string out(sz, '\0');
    WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), out.data(), sz, nullptr, nullptr);
    return out;
}

std::vector<NetworkAdapter> VrDiagnostics::ScanAdapters()
{
    std::vector<NetworkAdapter> result;
    ULONG bufSize = 15000;
    auto buf = std::make_unique<uint8_t[]>(bufSize);
    auto* addrs = reinterpret_cast<IP_ADAPTER_ADDRESSES*>(buf.get());

    ULONG flags = GAA_FLAG_INCLUDE_PREFIX | GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST;
    ULONG ret = GetAdaptersAddresses(AF_INET, flags, nullptr, addrs, &bufSize);
    if (ret == ERROR_BUFFER_OVERFLOW)
    {
        buf = std::make_unique<uint8_t[]>(bufSize);
        addrs = reinterpret_cast<IP_ADAPTER_ADDRESSES*>(buf.get());
        ret = GetAdaptersAddresses(AF_INET, flags, nullptr, addrs, &bufSize);
    }
    if (ret != NO_ERROR) return result;

    for (auto* curr = addrs; curr; curr = curr->Next)
    {
        NetworkAdapter a;
        a.name = wideToUtf8(curr->FriendlyName);
        a.description = wideToUtf8(curr->Description);
        a.isUp = (curr->OperStatus == IfOperStatusUp);

        bool isVirtual = false;
        const auto descLower = a.description;
        if (descLower.find("Hyper-V") != std::string::npos ||
            descLower.find("TAP") != std::string::npos ||
            descLower.find("Virtual") != std::string::npos ||
            descLower.find("VPN") != std::string::npos ||
            descLower.find("Loopback") != std::string::npos)
        {
            isVirtual = true;
        }
        a.isVirtual = isVirtual;

        for (auto* ua = curr->FirstUnicastAddress; ua; ua = ua->Next)
        {
            if (ua->Address.lpSockaddr->sa_family == AF_INET)
            {
                auto* sin = reinterpret_cast<sockaddr_in*>(ua->Address.lpSockaddr);
                char ipBuf[INET_ADDRSTRLEN]{};
                inet_ntop(AF_INET, &sin->sin_addr, ipBuf, sizeof(ipBuf));
                a.ipAddress = ipBuf;
                break;
            }
        }

        result.push_back(std::move(a));
    }
    return result;
}

std::vector<std::string> VrDiagnostics::ParseVrlinkErrors(
    const std::filesystem::path& logPath, int tailLines)
{
    std::vector<std::string> errors;
    std::ifstream f(logPath);
    if (!f.is_open()) return errors;

    std::vector<std::string> lines;
    std::string line;
    while (std::getline(f, line))
        lines.push_back(std::move(line));

    int start = std::max(0, static_cast<int>(lines.size()) - tailLines);
    int badLinks = 0;
    for (int i = start; i < static_cast<int>(lines.size()); ++i)
    {
        const auto& l = lines[i];
        if (l.find("recoverable error") != std::string::npos ||
            l.find("HandleUnrecoverableError") != std::string::npos ||
            l.find("Timed out") != std::string::npos)
        {
            errors.push_back(l);
        }
        if (l.find("Bad link event") != std::string::npos)
            ++badLinks;
    }

    if (badLinks > 0)
        errors.push_back(fmt::format("[summary] {} bad link events in last {} lines", badLinks, tailLines));

    return errors;
}

Result<VrDiagResult> VrDiagnostics::RunDiagnostics()
{
    VrDiagResult r;

    // Network
    r.adapters = ScanAdapters();
    for (const auto& a : r.adapters)
    {
        const auto adapterText = LowerAscii(a.name + " " + a.description);
        const bool isLoopback =
            a.ipAddress.rfind("127.", 0) == 0 ||
            adapterText.find("loopback") != std::string::npos;
        if (a.isVirtual && !isLoopback && a.isUp && !a.ipAddress.empty())
        {
            r.networkWarnings.push_back(
                fmt::format("Virtual adapter '{}' ({}) is UP with IP {} — may interfere with VR streaming",
                    a.name, a.description, a.ipAddress));
        }
    }

    // SteamVR
    r.steamvrRunning = SteamVrConfig::IsSteamVrRunning();
    auto vrSettingsPath = SteamVrConfig::DetectVrSettingsPath();
    if (vrSettingsPath)
    {
        try
        {
            auto doc = SteamVrConfig::Read(*vrSettingsPath);
            if (doc.contains("hardware") && doc["hardware"].is_object())
            {
                const auto& hw = doc["hardware"];
                r.hmdModel = hw.value("hmdModel", std::string{});
                r.hmdDriver = hw.value("hmdDriver", std::string{});
            }

            if (doc.contains("steamvr"))
            {
                auto& sv = doc["steamvr"];
                r.preferredRefreshRate = sv.value("preferredRefreshRate", 0);
                r.supersampleScale = sv.value("supersampleScale", 0.0);
                r.motionSmoothing = sv.value("motionSmoothing", false);
                r.allowSupersampleFiltering = sv.value("allowSupersampleFiltering", false);
            }
            if (doc.contains("driver_vrlink"))
            {
                auto& vl = doc["driver_vrlink"];
                r.targetBandwidth = vl.value("targetBandwidth", 0);
                r.preferredCodec = vl.value("preferredCodec", std::string{});
            }
        }
        catch (const std::exception& e)
        {
            spdlog::warn("VrDiag: failed to read vrsettings: {}", e.what());
        }

        // vrlink log
        auto steamPath = SteamVrConfig::DetectSteamPath();
        if (!steamPath.empty())
        {
            auto vrlinkLog = steamPath / "logs" / "driver_vrlink.txt";
            r.vrlinkErrors = ParseVrlinkErrors(vrlinkLog);
            for (const auto& e : r.vrlinkErrors)
            {
                if (e.find("bad link events") != std::string::npos)
                {
                    try { r.vrlinkBadLinkEvents = std::stoi(e.substr(e.find(']') + 2)); }
                    catch (const std::exception& ex)
                    {
                        spdlog::debug("VrDiag: failed to parse bad link summary '{}': {}", e, ex.what());
                    }
                }
            }

            // Second pass for link-quality metrics; we re-read so we can scan
            // the same tail window without reshuffling ParseVrlinkErrors.
            std::ifstream f(vrlinkLog);
            if (f.is_open())
            {
                std::vector<std::string> lines;
                std::string line;
                while (std::getline(f, line)) lines.push_back(std::move(line));
                const auto stats = ScanVrlinkStats(lines, 400);
                r.vrlinkDroppedFrames = stats.droppedFrames;
                r.vrlinkAvgBitrateMbps = stats.avgBitrateMbps;
                r.vrlinkMaxLatencyMs = stats.maxLatencyMs;
            }
        }
    }

    // GPU — DXGI is lightweight and works without admin. Failures leave
    // the fields empty, UI renders a dash.
    {
        const auto gpu = DetectPrimaryGpu();
        r.gpuName = gpu.name;
        r.gpuVramBytes = gpu.vramBytes;
    }

    // Audio — check for Steam Streaming devices
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    Microsoft::WRL::ComPtr<IMMDeviceEnumerator> enumerator;
    if (SUCCEEDED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr,
        CLSCTX_ALL, IID_PPV_ARGS(&enumerator))))
    {
        auto checkDevices = [&](EDataFlow flow, bool& found, std::string& defaultName)
        {
            Microsoft::WRL::ComPtr<IMMDevice> defaultDev;
            if (SUCCEEDED(enumerator->GetDefaultAudioEndpoint(flow, eConsole, &defaultDev)))
            {
                Microsoft::WRL::ComPtr<IPropertyStore> props;
                if (SUCCEEDED(defaultDev->OpenPropertyStore(STGM_READ, &props)))
                {
                    PROPVARIANT pv;
                    PropVariantInit(&pv);
                    if (SUCCEEDED(props->GetValue(PKEY_Device_FriendlyName, &pv)) && pv.vt == VT_LPWSTR)
                        defaultName = wideToUtf8(pv.pwszVal);
                    PropVariantClear(&pv);
                }
            }

            Microsoft::WRL::ComPtr<IMMDeviceCollection> collection;
            if (SUCCEEDED(enumerator->EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE, &collection)))
            {
                UINT count = 0;
                collection->GetCount(&count);
                for (UINT i = 0; i < count; ++i)
                {
                    Microsoft::WRL::ComPtr<IMMDevice> dev;
                    if (FAILED(collection->Item(i, &dev))) continue;
                    Microsoft::WRL::ComPtr<IPropertyStore> props;
                    if (FAILED(dev->OpenPropertyStore(STGM_READ, &props))) continue;
                    PROPVARIANT pv;
                    PropVariantInit(&pv);
                    if (SUCCEEDED(props->GetValue(PKEY_Device_FriendlyName, &pv)) && pv.vt == VT_LPWSTR)
                    {
                        std::wstring name(pv.pwszVal);
                        if (name.find(L"Steam Streaming") != std::wstring::npos)
                            found = true;
                    }
                    PropVariantClear(&pv);
                }
            }
        };

        checkDevices(eRender, r.steamSpeakersFound, r.defaultPlaybackDevice);
        checkDevices(eCapture, r.steamMicFound, r.defaultRecordingDevice);
    }
    CoUninitialize();

    return r;
}

Result<nlohmann::json> VrDiagnostics::DiagnoseSteamLink()
{
    const auto steamPath = SteamVrConfig::DetectSteamPath();
    if (steamPath.empty())
    {
        return Error{"steam_not_found", "Steam install path was not found in the current user's registry.", 404};
    }

    const auto manifestPath = FindSteamVrManifest(steamPath);
    const auto installPath = FindSteamVrInstallPath(steamPath);
    const auto localconfigs = FindLocalConfigFiles(steamPath);

    nlohmann::json localconfigReports = nlohmann::json::array();
    for (const auto& file : localconfigs)
        localconfigReports.push_back(AnalyseLocalConfig(file));

    nlohmann::json manifest = manifestPath
        ? AnalyseManifest(*manifestPath)
        : nlohmann::json{{"exists", false}, {"isBeta", false}, {"pendingDownload", false}};

    const auto logs = ScanSteamVrLogs(steamPath);

    nlohmann::json diag = nlohmann::json::object();
    if (auto diagResult = RunDiagnostics(); std::holds_alternative<VrDiagResult>(diagResult))
    {
        to_json(diag, std::get<VrDiagResult>(diagResult));
    }
    else
    {
        const auto& err = std::get<Error>(diagResult);
        diag = nlohmann::json{{"error", {{"code", err.code}, {"message", err.message}}}};
    }

    nlohmann::json processNames = nlohmann::json::array();
    for (const auto& p : EnumerateMatchingProcesses({
        L"steam.exe",
        L"vrserver.exe",
        L"vrmonitor.exe",
        L"vrcompositor.exe",
        L"vrwebhelper.exe",
        L"vrstartup.exe",
        L"vrdashboard.exe",
    }))
    {
        processNames.push_back(p);
    }

    nlohmann::json result{
        {"ok", true},
        {"steamPath", toUtf8(steamPath.wstring())},
        {"steamVrInstalled", installPath.has_value()},
        {"steamVrInstallPath", installPath ? toUtf8(installPath->wstring()) : ""},
        {"manifest", manifest},
        {"openvr", ParseOpenVrPaths()},
        {"localconfigs", localconfigReports},
        {"logs", logs},
        {"diagnostics", diag},
        {"processes", processNames},
    };

    result["summary"] = BuildSteamLinkSummary(manifest, localconfigReports, logs);
    result["issues"] = BuildSteamLinkIssues(manifest, localconfigReports, logs, diag, installPath.has_value());
    result["repairPlans"] = BuildSteamLinkRepairPlans(result["issues"]);
    result["suggestedSettings"] = BuildSuggestedSettings(diag);

    nlohmann::json recommendations = nlohmann::json::array();
    if (logs["counts"].value("invalid_session", 0) > 0)
        recommendations.push_back("Reset Steam Link / Quest pairing cache and re-pair from the headset.");
    if (manifest.value("isBeta", false))
        recommendations.push_back("Remove SteamVR BetaKey and validate AppID 250820 to return to the stable branch.");
    int betaMarkers = 0;
    int questDevices = 0;
    for (const auto& cfg : localconfigReports)
    {
        betaMarkers += cfg.value("betaMarkers", 0);
        questDevices += cfg.value("questDeviceCount", 0);
    }
    if (betaMarkers > 0)
        recommendations.push_back("Remove user-level 250820-beta / BetaKey markers from Steam localconfig.vdf.");
    if (questDevices > 0)
        recommendations.push_back("Back up localconfig.vdf, then remove stale Oculus Quest / Steam Link streaming devices.");
    if (manifest.value("pendingDownload", false))
        recommendations.push_back("Let Steam finish SteamVR update/validation before retrying Steam Link.");
    if (recommendations.empty())
        recommendations.push_back("Retry from the headset first; if it fails, run dry-run repair and compare the new log tail.");
    result["recommendations"] = recommendations;

    return result;
}

Result<nlohmann::json> VrDiagnostics::RepairSteamLink(const nlohmann::json& params)
{
    const std::string planId = params.value("planId", std::string{"full-vrlink-reset"});
    const bool dryRun = params.value("dryRun", true);
    bool clearRuntimeConfig = planId == "full-vrlink-reset";
    bool clearHtmlCache = planId == "pairing-reset" || planId == "full-vrlink-reset";
    bool clearPairing = planId == "pairing-reset" || planId == "full-vrlink-reset";
    bool removeBeta = planId == "stable-validate" || planId == "full-vrlink-reset";
    bool stopSteam = planId == "pairing-reset" || planId == "full-vrlink-reset";
    bool launchValidate = planId == "stable-validate" || planId == "full-vrlink-reset";
    bool clearVrlinkConfig = planId == "full-vrlink-reset";
    bool clearRemoteClients = planId == "full-vrlink-reset";
    bool archiveLogs = planId == "full-vrlink-reset";
    bool applySafeStreamingSettings = planId == "safe-streaming";
    bool backupOnly = planId == "quest-link-backup";

    clearRuntimeConfig = params.value("clearRuntimeConfig", clearRuntimeConfig);
    clearHtmlCache = params.value("clearHtmlCache", clearHtmlCache);
    clearPairing = params.value("clearPairing", clearPairing);
    removeBeta = params.value("removeBeta", removeBeta);
    stopSteam = params.value("stopSteam", stopSteam);
    launchValidate = params.value("launchValidate", launchValidate);
    clearVrlinkConfig = params.value("clearVrlinkConfig", clearVrlinkConfig);
    clearRemoteClients = params.value("clearRemoteClients", clearRemoteClients);
    archiveLogs = params.value("archiveLogs", archiveLogs);
    applySafeStreamingSettings = params.value("applySafeStreamingSettings", applySafeStreamingSettings);
    backupOnly = params.value("backupOnly", backupOnly);

    if (backupOnly)
    {
        clearRuntimeConfig = false;
        clearPairing = false;
        removeBeta = false;
        stopSteam = false;
        launchValidate = false;
        clearVrlinkConfig = false;
        clearRemoteClients = false;
        archiveLogs = false;
        applySafeStreamingSettings = false;
        clearHtmlCache = false;
    }

    const auto steamPath = SteamVrConfig::DetectSteamPath();
    if (steamPath.empty())
        return Error{"steam_not_found", "Steam install path was not found in the current user's registry.", 404};

    const auto manifestPath = FindSteamVrManifest(steamPath);
    const auto localconfigs = FindLocalConfigFiles(steamPath);
    const auto timestamp = TimestampForPath();
    const auto backupDir = steamPath / L"config" / toWide(fmt::format("vrcsm-vrlink-reset-{}", timestamp));

    nlohmann::json actions = nlohmann::json::array();
    nlohmann::json backups = nlohmann::json::array();
    nlohmann::json stopped = nlohmann::json::array();
    nlohmann::json failures = nlohmann::json::array();

    const std::set<std::wstring> processNames = stopSteam
        ? std::set<std::wstring>{L"steam.exe", L"vrserver.exe", L"vrmonitor.exe", L"vrcompositor.exe", L"vrwebhelper.exe", L"vrstartup.exe", L"vrdashboard.exe"}
        : std::set<std::wstring>{L"vrserver.exe", L"vrmonitor.exe", L"vrcompositor.exe", L"vrwebhelper.exe", L"vrstartup.exe", L"vrdashboard.exe"};

    for (const auto& proc : EnumerateMatchingProcesses(processNames))
    {
        actions.push_back(fmt::format("Stop process {} ({})", proc.value("name", ""), proc.value("pid", 0u)));
    }

    const auto vrsettings = steamPath / L"config" / L"steamvr.vrsettings";
    const auto vrstats = steamPath / L"config" / L"steamvr.vrstats";
    const auto vrlinkConfig = steamPath / L"config" / L"vrlink";
    const auto remoteClients = steamPath / L"config" / L"remoteclients.vdf";
    const std::vector<std::filesystem::path> steamVrLogs = {
        steamPath / L"logs" / L"driver_vrlink.txt",
        steamPath / L"logs" / L"vrserver.txt",
        steamPath / L"logs" / L"vrmonitor.txt",
        steamPath / L"logs" / L"vrclient_vrwebhelper_pairing.txt",
    };
    if (clearRuntimeConfig)
    {
        actions.push_back(fmt::format("Move {} into backup", toUtf8(vrsettings.wstring())));
        actions.push_back(fmt::format("Move {} into backup", toUtf8(vrstats.wstring())));
    }
    if (backupOnly)
    {
        if (manifestPath)
            actions.push_back(fmt::format("Back up {}", toUtf8(manifestPath->wstring())));
        for (const auto& cfg : localconfigs)
            actions.push_back(fmt::format("Back up {}", toUtf8(cfg.wstring())));
        actions.push_back(fmt::format("Back up {}", toUtf8(vrsettings.wstring())));
        actions.push_back(fmt::format("Back up {}", toUtf8(vrstats.wstring())));
        actions.push_back(fmt::format("Back up {}", toUtf8(vrlinkConfig.wstring())));
        actions.push_back(fmt::format("Back up {}", toUtf8(remoteClients.wstring())));
        if (auto localAppData = tryGetEnvPath(L"LOCALAPPDATA"))
            actions.push_back(fmt::format("Back up {}", toUtf8((*localAppData / L"SteamVR" / L"htmlcache").wstring())));
    }
    if (clearVrlinkConfig)
        actions.push_back(fmt::format("Move {} into backup", toUtf8(vrlinkConfig.wstring())));
    if (clearRemoteClients)
        actions.push_back(fmt::format("Move {} into backup", toUtf8(remoteClients.wstring())));
    if (archiveLogs)
    {
        for (const auto& log : steamVrLogs)
            actions.push_back(fmt::format("Archive old SteamVR log {}", toUtf8(log.wstring())));
    }
    if (applySafeStreamingSettings)
    {
        actions.push_back("Apply safe Quest streaming settings: 80 Mbps auto bandwidth, 1.0x supersampling, 72 Hz, motion smoothing off");
    }
    if (clearHtmlCache)
    {
        if (auto localAppData = tryGetEnvPath(L"LOCALAPPDATA"))
            actions.push_back(fmt::format("Back up and remove {}", toUtf8((*localAppData / L"SteamVR" / L"htmlcache").wstring())));
    }
    if (removeBeta)
    {
        if (manifestPath)
            actions.push_back(fmt::format("Remove BetaKey lines from {}", toUtf8(manifestPath->wstring())));
        for (const auto& cfg : localconfigs)
            actions.push_back(fmt::format("Remove 250820-beta / BetaKey markers from {}", toUtf8(cfg.wstring())));
    }
    if (clearPairing)
    {
        for (const auto& cfg : localconfigs)
            actions.push_back(fmt::format("Remove Quest / Steam Link streaming device blocks from {}", toUtf8(cfg.wstring())));
    }
    if (launchValidate)
        actions.push_back("Open steam://validate/250820 after repair");

    if (dryRun)
    {
        return nlohmann::json{
            {"ok", true},
            {"dryRun", true},
            {"planId", planId},
            {"backupDir", toUtf8(backupDir.wstring())},
            {"actions", actions},
        };
    }

    StopMatchingProcesses(processNames, stopped, failures);

    std::error_code ec;
    std::filesystem::create_directories(backupDir, ec);
    if (ec)
        return Error{"backup_failed", fmt::format("Failed to create backup directory: {}", ec.message()), 500};

    if (manifestPath && !CopyFileToBackup(*manifestPath, backupDir, "appmanifest", backups, ec))
        return Error{"backup_failed", fmt::format("Failed to back up appmanifest: {}", ec.message()), 500};

    for (std::size_t i = 0; i < localconfigs.size(); ++i)
    {
        if (!CopyFileToBackup(localconfigs[i], backupDir, fmt::format("localconfig{}", i + 1), backups, ec))
            return Error{"backup_failed", fmt::format("Failed to back up localconfig.vdf: {}", ec.message()), 500};
    }

    if ((clearRuntimeConfig || applySafeStreamingSettings) && !CopyFileToBackup(vrsettings, backupDir, "steamvrsettings", backups, ec))
        return Error{"backup_failed", fmt::format("Failed to back up steamvr.vrsettings: {}", ec.message()), 500};
    if (clearRuntimeConfig && !CopyFileToBackup(vrstats, backupDir, "steamvrstats", backups, ec))
        return Error{"backup_failed", fmt::format("Failed to back up steamvr.vrstats: {}", ec.message()), 500};
    if (backupOnly)
    {
        if (!CopyFileToBackup(vrsettings, backupDir, "steamvrsettings", backups, ec))
            return Error{"backup_failed", fmt::format("Failed to back up steamvr.vrsettings: {}", ec.message()), 500};
        if (!CopyFileToBackup(vrstats, backupDir, "steamvrstats", backups, ec))
            return Error{"backup_failed", fmt::format("Failed to back up steamvr.vrstats: {}", ec.message()), 500};
        if (!CopyPathToBackup(vrlinkConfig, backupDir, "vrlink-config", backups, ec))
            return Error{"backup_failed", fmt::format("Failed to back up config/vrlink: {}", ec.message()), 500};
        if (!CopyFileToBackup(remoteClients, backupDir, "remoteclients", backups, ec))
            return Error{"backup_failed", fmt::format("Failed to back up remoteclients.vdf: {}", ec.message()), 500};
        if (auto localAppData = tryGetEnvPath(L"LOCALAPPDATA"))
        {
            if (!CopyPathToBackup(*localAppData / L"SteamVR" / L"htmlcache", backupDir, "htmlcache", backups, ec))
                return Error{"backup_failed", fmt::format("Failed to back up SteamVR htmlcache: {}", ec.message()), 500};
        }
    }

    auto movePathToBackup = [&](const std::filesystem::path& path, const std::string& label) -> Result<std::monostate> {
        std::error_code localEc;
        if (!std::filesystem::exists(path, localEc) || localEc)
        {
            localEc.clear();
            return std::monostate{};
        }
        const auto dest = backupDir / fmt::format("{}-{}", label, path.filename().string());
        std::filesystem::rename(path, dest, localEc);
        if (localEc)
        {
            const bool isDir = std::filesystem::is_directory(path, localEc);
            localEc.clear();
            if (isDir)
            {
                std::filesystem::copy(path, dest,
                    std::filesystem::copy_options::recursive |
                    std::filesystem::copy_options::overwrite_existing,
                    localEc);
                if (localEc)
                    return Error{"move_failed", fmt::format("Failed to copy {} into backup: {}", toUtf8(path.wstring()), localEc.message()), 500};
                std::filesystem::remove_all(path, localEc);
            }
            else
            {
                std::filesystem::copy_file(path, dest, std::filesystem::copy_options::overwrite_existing, localEc);
                if (localEc)
                    return Error{"move_failed", fmt::format("Failed to copy {} into backup: {}", toUtf8(path.wstring()), localEc.message()), 500};
                std::filesystem::remove(path, localEc);
            }
            if (localEc)
                return Error{"move_failed", fmt::format("Failed to remove {} after backup copy: {}", toUtf8(path.wstring()), localEc.message()), 500};
        }
        backups.push_back({{"from", toUtf8(path.wstring())}, {"to", toUtf8(dest.wstring())}, {"moved", true}});
        return std::monostate{};
    };

    if (clearRuntimeConfig)
    {
        if (auto r = movePathToBackup(vrsettings, "steamvr"); std::holds_alternative<Error>(r)) return std::get<Error>(r);
        if (auto r = movePathToBackup(vrstats, "steamvr"); std::holds_alternative<Error>(r)) return std::get<Error>(r);
    }
    if (clearVrlinkConfig)
    {
        if (auto r = movePathToBackup(vrlinkConfig, "vrlink-config"); std::holds_alternative<Error>(r)) return std::get<Error>(r);
    }
    if (clearRemoteClients)
    {
        if (auto r = movePathToBackup(remoteClients, "remoteclients"); std::holds_alternative<Error>(r)) return std::get<Error>(r);
    }
    if (archiveLogs)
    {
        for (const auto& log : steamVrLogs)
        {
            if (auto r = movePathToBackup(log, "log"); std::holds_alternative<Error>(r)) return std::get<Error>(r);
        }
    }

    if (clearHtmlCache)
    {
        if (auto localAppData = tryGetEnvPath(L"LOCALAPPDATA"))
        {
            const auto htmlcache = *localAppData / L"SteamVR" / L"htmlcache";
            if (std::filesystem::exists(htmlcache, ec) && !ec)
            {
                const auto dest = backupDir / L"htmlcache";
                std::filesystem::copy(htmlcache, dest,
                    std::filesystem::copy_options::recursive |
                    std::filesystem::copy_options::overwrite_existing,
                    ec);
                if (ec)
                    return Error{"backup_failed", fmt::format("Failed to back up SteamVR htmlcache: {}", ec.message()), 500};
                const auto removed = std::filesystem::remove_all(htmlcache, ec);
                if (ec)
                    return Error{"remove_failed", fmt::format("Failed to remove SteamVR htmlcache after backup: {}", ec.message()), 500};
                backups.push_back({{"from", toUtf8(htmlcache.wstring())}, {"to", toUtf8(dest.wstring())}, {"removedEntries", removed}});
            }
        }
    }

    int manifestBetaLines = 0;
    if (removeBeta && manifestPath)
    {
        const auto edited = EditedManifestWithoutBetaKey(ReadTextFile(*manifestPath), manifestBetaLines);
        if (manifestBetaLines > 0 && !WriteTextFile(*manifestPath, edited))
            return Error{"write_failed", "Failed to write edited appmanifest_250820.acf", 500};
    }

    int removedDevices = 0;
    int removedBetaBlocks = 0;
    bool settingsApplied = false;
    if (clearPairing || removeBeta)
    {
        for (const auto& cfg : localconfigs)
        {
            int deviceBlocks = 0;
            int betaBlocks = 0;
            auto edited = EditedLocalConfig(ReadTextFile(cfg), deviceBlocks, betaBlocks);
            removedDevices += deviceBlocks;
            removedBetaBlocks += betaBlocks;
            if ((deviceBlocks > 0 || betaBlocks > 0) && !WriteTextFile(cfg, edited))
                return Error{"write_failed", fmt::format("Failed to write edited {}", toUtf8(cfg.wstring())), 500};
        }
    }

    if (applySafeStreamingSettings)
    {
        const auto vrsettingsPath = SteamVrConfig::DetectVrSettingsPath();
        if (!vrsettingsPath)
        {
            return Error{"steamvr_settings_missing", "steamvr.vrsettings was not found; start SteamVR once, close it, then apply safe streaming settings.", 404};
        }
        const nlohmann::json updates{
            {"driver_vrlink", {
                {"targetBandwidth", 80},
                {"automaticBandwidth", true},
            }},
            {"steamvr", {
                {"supersampleScale", 1.0},
                {"supersampleManualOverride", true},
                {"preferredRefreshRate", 72},
                {"motionSmoothing", false},
                {"allowSupersampleFiltering", true},
            }},
        };
        const auto writeResult = SteamVrConfig::Write(*vrsettingsPath, updates);
        if (writeResult.is_object() && writeResult.contains("error"))
        {
            const auto& err = writeResult["error"];
            return Error{
                "write_failed",
                err.value("message", "Failed to apply safe SteamVR streaming settings."),
                500,
            };
        }
        settingsApplied = true;
    }

    if (launchValidate)
    {
        ShellExecuteW(nullptr, L"open", L"steam://validate/250820", nullptr, nullptr, SW_SHOWNORMAL);
    }

    if (!WriteBackupMetadata(backupDir, planId, backups, actions, ec))
    {
        failures.push_back({{"error", fmt::format("Failed to write restore metadata: {}", ec.message())}});
    }

    return nlohmann::json{
        {"ok", failures.empty()},
        {"dryRun", false},
        {"planId", planId},
        {"backupDir", toUtf8(backupDir.wstring())},
        {"actions", actions},
        {"backups", backups},
        {"stopped", stopped},
        {"failures", failures},
        {"settingsApplied", settingsApplied},
        {"manifestBetaLinesRemoved", manifestBetaLines},
        {"localconfigDeviceBlocksRemoved", removedDevices},
        {"localconfigBetaBlocksRemoved", removedBetaBlocks},
    };
}

Result<nlohmann::json> VrDiagnostics::ListSteamLinkBackups()
{
    const auto steamPath = SteamVrConfig::DetectSteamPath();
    if (steamPath.empty())
        return Error{"steam_not_found", "Steam install path was not found in the current user's registry.", 404};

    const auto configDir = steamPath / L"config";
    nlohmann::json items = nlohmann::json::array();
    std::error_code ec;
    if (!std::filesystem::is_directory(configDir, ec) || ec)
    {
        return nlohmann::json{{"ok", true}, {"steamPath", toUtf8(steamPath.wstring())}, {"items", items}};
    }

    for (const auto& ent : std::filesystem::directory_iterator(configDir, ec))
    {
        if (ec || !ent.is_directory()) continue;
        const auto name = ent.path().filename().string();
        if (name.rfind("vrcsm-vrlink-reset-", 0) != 0) continue;

        const auto metaPath = ent.path() / L"vrcsm-backup.json";
        const auto meta = ReadJsonFileLoose(metaPath);
        nlohmann::json item{
            {"name", name},
            {"path", toUtf8(ent.path().wstring())},
            {"hasMetadata", meta.is_object()},
            {"restorable", meta.is_object() && meta.value("kind", std::string{}) == "steamvr-link-backup"},
            {"backupCount", meta.is_object() && meta.contains("backups") && meta["backups"].is_array() ? meta["backups"].size() : 0},
        };
        if (meta.is_object())
        {
            item["planId"] = meta.value("planId", std::string{});
            item["created"] = meta.value("created", std::string{});
        }
        if (auto t = safeLastWriteTime(ent.path()))
            item["lastWriteTime"] = isoTimestamp(*t);
        items.push_back(std::move(item));
    }

    std::sort(items.begin(), items.end(), [](const auto& a, const auto& b) {
        return a.value("name", std::string{}) > b.value("name", std::string{});
    });

    return nlohmann::json{{"ok", true}, {"steamPath", toUtf8(steamPath.wstring())}, {"items", items}};
}

Result<nlohmann::json> VrDiagnostics::RestoreSteamLinkBackup(const nlohmann::json& params)
{
    const auto steamPath = SteamVrConfig::DetectSteamPath();
    if (steamPath.empty())
        return Error{"steam_not_found", "Steam install path was not found in the current user's registry.", 404};

    const auto backupDirText = params.value("backupDir", std::string{});
    if (backupDirText.empty())
        return Error{"invalid_params", "steamvr.link.restore requires backupDir", 400};

    const bool dryRun = params.value("dryRun", true);
    const bool stopSteam = params.value("stopSteam", true);
    const std::filesystem::path backupDir = toWide(backupDirText);
    const auto allowedRoot = steamPath / L"config";
    if (!backupDir.is_absolute()
        || !ensureWithinBase(allowedRoot, backupDir)
        || backupDir.filename().string().rfind("vrcsm-vrlink-reset-", 0) != 0)
    {
        return Error{"invalid_backup", "Backup directory is outside the detected Steam config directory.", 400};
    }

    const auto metaPath = backupDir / L"vrcsm-backup.json";
    const auto meta = ReadJsonFileLoose(metaPath);
    if (!meta.is_object() || meta.value("kind", std::string{}) != "steamvr-link-backup")
        return Error{"backup_metadata_missing", "This backup has no vrcsm-backup.json metadata and cannot be restored safely.", 400};
    if (!meta.contains("backups") || !meta["backups"].is_array())
        return Error{"backup_metadata_invalid", "Backup metadata does not contain a backups array.", 400};

    nlohmann::json actions = nlohmann::json::array();
    nlohmann::json stopped = nlohmann::json::array();
    nlohmann::json failures = nlohmann::json::array();
    nlohmann::json currentBackups = nlohmann::json::array();
    std::vector<RestoreBackupEntry> restoreEntries;
    const auto localAppData = tryGetEnvPath(L"LOCALAPPDATA");

    for (const auto& entry : meta["backups"])
    {
        const auto fromText = entry.value("from", std::string{});
        const auto toText = entry.value("to", std::string{});
        if (fromText.empty() || toText.empty())
        {
            return Error{
                "backup_metadata_invalid",
                "Backup metadata contains an entry without both from and to paths.",
                400,
            };
        }

        RestoreBackupEntry restoreEntry{
            fromText,
            toText,
            toWide(fromText),
            toWide(toText),
        };
        if (!IsSteamLinkBackupSourceAllowed(backupDir, restoreEntry.to, !dryRun))
        {
            return Error{
                "backup_metadata_invalid",
                fmt::format("Backup source is outside the selected backup directory: {}", toText),
                400,
            };
        }
        if (!IsSteamLinkRestoreTargetAllowed(steamPath, localAppData, restoreEntry.from))
        {
            return Error{
                "backup_metadata_invalid",
                fmt::format("Restore target is outside the allowed SteamVR paths: {}", fromText),
                400,
            };
        }
        restoreEntries.push_back(std::move(restoreEntry));
    }

    if (stopSteam)
    {
        for (const auto& proc : EnumerateMatchingProcesses({
            L"steam.exe",
            L"vrserver.exe",
            L"vrmonitor.exe",
            L"vrcompositor.exe",
            L"vrwebhelper.exe",
            L"vrstartup.exe",
            L"vrdashboard.exe",
        }))
        {
            actions.push_back(fmt::format("Stop process {} ({})", proc.value("name", ""), proc.value("pid", 0u)));
        }
    }

    for (const auto& entry : restoreEntries)
    {
        actions.push_back(fmt::format("Restore {} from {}", entry.fromText, entry.toText));
    }

    if (dryRun)
    {
        return nlohmann::json{
            {"ok", true},
            {"dryRun", true},
            {"backupDir", toUtf8(backupDir.wstring())},
            {"planId", meta.value("planId", std::string{})},
            {"actions", actions},
        };
    }

    if (stopSteam)
    {
        StopMatchingProcesses({
            L"steam.exe",
            L"vrserver.exe",
            L"vrmonitor.exe",
            L"vrcompositor.exe",
            L"vrwebhelper.exe",
            L"vrstartup.exe",
            L"vrdashboard.exe",
        }, stopped, failures);
    }

    std::error_code ec;
    const auto currentDir = backupDir / toWide(fmt::format("restore-current-{}", TimestampForPath()));
    std::filesystem::create_directories(currentDir, ec);
    if (ec)
        return Error{"backup_failed", fmt::format("Failed to create pre-restore backup directory: {}", ec.message()), 500};

    int restored = 0;
    int index = 0;
    for (const auto& entry : restoreEntries)
    {
        const std::filesystem::path& from = entry.from;
        const std::filesystem::path& to = entry.to;
        if (!std::filesystem::exists(to, ec) || ec)
        {
            failures.push_back({{"error", fmt::format("Backup source missing: {}", entry.toText)}});
            ec.clear();
            continue;
        }

        if (!CopyPathToBackup(from, currentDir, fmt::format("current{}", ++index), currentBackups, ec))
        {
            failures.push_back({{"error", fmt::format("Failed to back up current {}: {}", entry.fromText, ec.message())}});
            ec.clear();
            continue;
        }

        std::filesystem::create_directories(from.parent_path(), ec);
        if (ec)
        {
            failures.push_back({{"error", fmt::format("Failed to create parent for {}: {}", entry.fromText, ec.message())}});
            ec.clear();
            continue;
        }
        std::filesystem::remove_all(from, ec);
        if (ec)
        {
            failures.push_back({{"error", fmt::format("Failed to remove current {}: {}", entry.fromText, ec.message())}});
            ec.clear();
            continue;
        }

        if (std::filesystem::is_directory(to, ec))
        {
            ec.clear();
            std::filesystem::copy(to, from,
                std::filesystem::copy_options::recursive |
                std::filesystem::copy_options::overwrite_existing,
                ec);
        }
        else
        {
            ec.clear();
            std::filesystem::copy_file(to, from, std::filesystem::copy_options::overwrite_existing, ec);
        }
        if (ec)
        {
            failures.push_back({{"error", fmt::format("Failed to restore {}: {}", entry.fromText, ec.message())}});
            ec.clear();
            continue;
        }
        ++restored;
    }

    return nlohmann::json{
        {"ok", failures.empty()},
        {"dryRun", false},
        {"backupDir", toUtf8(backupDir.wstring())},
        {"currentBackupDir", toUtf8(currentDir.wstring())},
        {"planId", meta.value("planId", std::string{})},
        {"actions", actions},
        {"currentBackups", currentBackups},
        {"stopped", stopped},
        {"failures", failures},
        {"restored", restored},
    };
}

Result<nlohmann::json> VrDiagnostics::SwitchAudioDevice(
    const std::string& deviceId, const std::string& role)
{
    // Use PolicyConfig COM to switch default audio device
    // role: "playback" or "recording"
    // deviceId: WASAPI endpoint ID like {0.0.0.00000000}.{guid}

    struct IPolicyConfig : IUnknown
    {
        virtual HRESULT STDMETHODCALLTYPE GetMixFormat() = 0;
        virtual HRESULT STDMETHODCALLTYPE GetDeviceFormat() = 0;
        virtual HRESULT STDMETHODCALLTYPE ResetDeviceFormat() = 0;
        virtual HRESULT STDMETHODCALLTYPE SetDeviceFormat() = 0;
        virtual HRESULT STDMETHODCALLTYPE GetProcessingPeriod() = 0;
        virtual HRESULT STDMETHODCALLTYPE SetProcessingPeriod() = 0;
        virtual HRESULT STDMETHODCALLTYPE GetShareMode() = 0;
        virtual HRESULT STDMETHODCALLTYPE SetShareMode() = 0;
        virtual HRESULT STDMETHODCALLTYPE GetPropertyValue() = 0;
        virtual HRESULT STDMETHODCALLTYPE SetPropertyValue() = 0;
        virtual HRESULT STDMETHODCALLTYPE SetDefaultEndpoint(LPCWSTR deviceId, int role) = 0;
        virtual HRESULT STDMETHODCALLTYPE SetEndpointVisibility() = 0;
    };

    static const GUID CLSID_PolicyConfigClient = {
        0x870AF99C, 0x171D, 0x4F9E, {0xAF, 0x0D, 0xE6, 0x3D, 0xF4, 0x0C, 0x2B, 0xC9}};
    static const GUID IID_IPolicyConfig = {
        0xF8679F50, 0x850A, 0x41CF, {0x9C, 0x72, 0x43, 0x0F, 0x29, 0x02, 0x90, 0xC8}};

    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    IPolicyConfig* pConfig = nullptr;
    HRESULT hr = CoCreateInstance(CLSID_PolicyConfigClient, nullptr, CLSCTX_ALL,
        IID_IPolicyConfig, reinterpret_cast<void**>(&pConfig));
    if (FAILED(hr) || !pConfig)
    {
        CoUninitialize();
        return Error{"com_error", "Failed to create PolicyConfig", 500};
    }

    std::wstring wideId(deviceId.begin(), deviceId.end());
    // 0=eConsole, 1=eMultimedia, 2=eCommunications
    for (int r = 0; r < 3; ++r)
        pConfig->SetDefaultEndpoint(wideId.c_str(), r);

    pConfig->Release();
    CoUninitialize();

    return nlohmann::json{{"ok", true}, {"deviceId", deviceId}, {"role", role}};
}

} // namespace vrcsm::core
