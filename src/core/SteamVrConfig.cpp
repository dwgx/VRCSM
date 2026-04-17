#include "SteamVrConfig.h"

#include "Common.h"

#include <fstream>
#include <sstream>
#include <system_error>

#include <Windows.h>
#include <TlHelp32.h>

#include <fmt/format.h>
#include <spdlog/spdlog.h>

// ─────────────────────────────────────────────────────────────────────────
// SteamVrConfig — read/write SteamVR's steamvr.vrsettings.
//
// The file is a plain JSON object whose top-level keys are "sections"
// (e.g. "steamvr", "driver_vrlink", "GpuSpeed").  We never rewrite
// sections the caller didn't touch — merge semantics only.  Atomic
// write via .tmp / .bak / rename, identical to VrcConfig.cpp.
//
// Steam installation path comes from the registry at
//   HKCU\Software\Valve\Steam\SteamPath
// which every Steam installation writes on first run.
// ─────────────────────────────────────────────────────────────────────────

namespace vrcsm::core
{

void to_json(nlohmann::json& j, const SteamVrHardwareInfo& info)
{
    j = nlohmann::json{
        {"gpuVendor", info.gpuVendor},
        {"gpuHorsepower", info.gpuHorsepower},
        {"hmdModel", info.hmdModel},
        {"hmdManufacturer", info.hmdManufacturer},
        {"hmdDriver", info.hmdDriver},
    };
}

namespace
{

std::optional<std::string> readRegistryString(HKEY root, const wchar_t* subKey, const wchar_t* valueName)
{
    HKEY hKey = nullptr;
    if (RegOpenKeyExW(root, subKey, 0, KEY_READ, &hKey) != ERROR_SUCCESS)
    {
        return std::nullopt;
    }

    DWORD type = 0;
    DWORD size = 0;
    if (RegQueryValueExW(hKey, valueName, nullptr, &type, nullptr, &size) != ERROR_SUCCESS || type != REG_SZ || size == 0)
    {
        RegCloseKey(hKey);
        return std::nullopt;
    }

    std::wstring buffer(size / sizeof(wchar_t), L'\0');
    if (RegQueryValueExW(hKey, valueName, nullptr, nullptr, reinterpret_cast<BYTE*>(buffer.data()), &size) != ERROR_SUCCESS)
    {
        RegCloseKey(hKey);
        return std::nullopt;
    }
    RegCloseKey(hKey);

    // Trim trailing null.
    while (!buffer.empty() && buffer.back() == L'\0')
    {
        buffer.pop_back();
    }

    return toUtf8(buffer);
}

std::string slurpFile(const std::filesystem::path& path)
{
    std::ifstream in(path, std::ios::binary);
    if (!in) return {};
    std::stringstream buf;
    buf << in.rdbuf();
    return buf.str();
}

bool isProcessRunning(const wchar_t* processName)
{
    // Minimal check — snapshot all processes and look for the name.
    // We already have ProcessGuard doing similar things but this is
    // self-contained for the SteamVR module.
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return false;

    PROCESSENTRY32W pe{};
    pe.dwSize = sizeof(pe);

    if (Process32FirstW(snap, &pe))
    {
        do
        {
            if (_wcsicmp(pe.szExeFile, processName) == 0)
            {
                CloseHandle(snap);
                return true;
            }
        } while (Process32NextW(snap, &pe));
    }

    CloseHandle(snap);
    return false;
}

} // namespace

std::filesystem::path SteamVrConfig::DetectSteamPath()
{
    auto steamPath = readRegistryString(
        HKEY_CURRENT_USER,
        L"Software\\Valve\\Steam",
        L"SteamPath");

    if (!steamPath.has_value() || steamPath->empty())
    {
        return {};
    }

    // Steam stores the path with forward slashes (e.g. "d:/steam").
    // Convert to a proper filesystem path.
    std::filesystem::path result(*steamPath);
    std::error_code ec;
    if (!std::filesystem::exists(result, ec) || ec)
    {
        return {};
    }

    return result;
}

std::optional<std::filesystem::path> SteamVrConfig::DetectVrSettingsPath()
{
    auto steamPath = DetectSteamPath();
    if (steamPath.empty())
    {
        return std::nullopt;
    }

    auto vrsettings = steamPath / L"config" / L"steamvr.vrsettings";
    std::error_code ec;
    if (!std::filesystem::exists(vrsettings, ec) || ec)
    {
        return std::nullopt;
    }

    return vrsettings;
}

nlohmann::json SteamVrConfig::Read(const std::filesystem::path& path)
{
    std::error_code ec;
    if (!std::filesystem::exists(path, ec) || ec)
    {
        return nlohmann::json{
            {"error", {{"code", "not_found"}, {"message", "steamvr.vrsettings not found"}}}};
    }

    std::string content = slurpFile(path);
    if (content.empty())
    {
        return nlohmann::json{
            {"error", {{"code", "empty"}, {"message", "steamvr.vrsettings is empty"}}}};
    }

    try
    {
        auto doc = nlohmann::json::parse(content);
        auto hw = ExtractHardwareInfo(doc);

        nlohmann::json result;
        result["ok"] = true;
        result["path"] = toUtf8(path.wstring());
        result["hardware"] = hw;

        // Extract editable sections.
        if (doc.contains("driver_vrlink") && doc["driver_vrlink"].is_object())
        {
            result["driver_vrlink"] = doc["driver_vrlink"];
        }
        else
        {
            result["driver_vrlink"] = nlohmann::json::object();
        }

        if (doc.contains("steamvr") && doc["steamvr"].is_object())
        {
            result["steamvr"] = doc["steamvr"];
        }
        else
        {
            result["steamvr"] = nlohmann::json::object();
        }

        result["steamvr_running"] = IsSteamVrRunning();
        return result;
    }
    catch (const std::exception& ex)
    {
        spdlog::error("SteamVrConfig: failed to parse {}: {}", toUtf8(path.wstring()), ex.what());
        return nlohmann::json{
            {"error", {{"code", "parse_failed"}, {"message", ex.what()}}}};
    }
}

nlohmann::json SteamVrConfig::Write(
    const std::filesystem::path& path,
    const nlohmann::json& updates)
{
    if (IsSteamVrRunning())
    {
        return nlohmann::json{
            {"error", {{"code", "steamvr_running"},
                       {"message", "SteamVR is running — close it before modifying settings."}}}};
    }

    std::error_code ec;
    if (!std::filesystem::exists(path, ec) || ec)
    {
        return nlohmann::json{
            {"error", {{"code", "not_found"}, {"message", "steamvr.vrsettings not found"}}}};
    }

    // 1) Read existing content.
    nlohmann::json doc;
    try
    {
        std::string content = slurpFile(path);
        doc = nlohmann::json::parse(content);
    }
    catch (const std::exception& ex)
    {
        return nlohmann::json{
            {"error", {{"code", "parse_failed"}, {"message", ex.what()}}}};
    }

    // 2) Deep-merge updates into existing doc.
    //    Only update keys that the caller provides; preserve everything else.
    for (auto it = updates.begin(); it != updates.end(); ++it)
    {
        const auto& section = it.key();
        if (!it.value().is_object()) continue;

        if (!doc.contains(section) || !doc[section].is_object())
        {
            doc[section] = nlohmann::json::object();
        }

        for (auto kv = it.value().begin(); kv != it.value().end(); ++kv)
        {
            doc[section][kv.key()] = kv.value();
        }
    }

    // 3) Atomic write: .tmp → backup → rename.
    auto tmpFile = path;
    tmpFile += L".tmp";

    {
        std::ofstream out(tmpFile, std::ios::binary | std::ios::trunc);
        if (!out)
        {
            return nlohmann::json{
                {"error", {{"code", "open_failed"}, {"message", "Cannot open tmp file for writing"}}}};
        }
        out << doc.dump(3);
        out.flush();
        if (!out)
        {
            out.close();
            std::filesystem::remove(tmpFile, ec);
            return nlohmann::json{
                {"error", {{"code", "write_failed"}, {"message", "Stream write failed"}}}};
        }
        out.close();
    }

    // Backup existing file.
    auto backupFile = path;
    backupFile += L".bak";
    std::filesystem::copy_file(
        path, backupFile,
        std::filesystem::copy_options::overwrite_existing, ec);
    if (ec)
    {
        std::filesystem::remove(tmpFile, ec);
        return nlohmann::json{
            {"error", {{"code", "backup_failed"}, {"message", ec.message()}}}};
    }

    // Rename tmp → target.
    std::filesystem::rename(tmpFile, path, ec);
    if (ec)
    {
        std::filesystem::remove(tmpFile, ec);
        return nlohmann::json{
            {"error", {{"code", "rename_failed"}, {"message", ec.message()}}}};
    }

    spdlog::info("SteamVrConfig: wrote updated settings to {}", toUtf8(path.wstring()));
    return nlohmann::json{{"ok", true}};
}

SteamVrHardwareInfo SteamVrConfig::ExtractHardwareInfo(const nlohmann::json& doc)
{
    SteamVrHardwareInfo info;

    if (doc.contains("GpuSpeed") && doc["GpuSpeed"].is_object())
    {
        const auto& gpu = doc["GpuSpeed"];
        if (gpu.contains("gpuSpeedVendor") && gpu["gpuSpeedVendor"].is_string())
        {
            info.gpuVendor = gpu["gpuSpeedVendor"].get<std::string>();
        }
        if (gpu.contains("gpuSpeedHorsepower") && gpu["gpuSpeedHorsepower"].is_number())
        {
            info.gpuHorsepower = gpu["gpuSpeedHorsepower"].get<int>();
        }
    }

    if (doc.contains("LastKnown") && doc["LastKnown"].is_object())
    {
        const auto& hmd = doc["LastKnown"];
        if (hmd.contains("HMDModel") && hmd["HMDModel"].is_string())
        {
            info.hmdModel = hmd["HMDModel"].get<std::string>();
        }
        if (hmd.contains("HMDManufacturer") && hmd["HMDManufacturer"].is_string())
        {
            info.hmdManufacturer = hmd["HMDManufacturer"].get<std::string>();
        }
        if (hmd.contains("ActualHMDDriver") && hmd["ActualHMDDriver"].is_string())
        {
            info.hmdDriver = hmd["ActualHMDDriver"].get<std::string>();
        }
    }

    return info;
}

bool SteamVrConfig::IsSteamVrRunning()
{
    return isProcessRunning(L"vrmonitor.exe") || isProcessRunning(L"vrserver.exe");
}

} // namespace vrcsm::core
