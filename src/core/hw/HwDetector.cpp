#include "HwDetector.h"

#include "../SteamVrConfig.h"

#include <Windows.h>
#include <oleauto.h>
#include <wbemidl.h>
#include <winternl.h>

#include <wil/com.h>
#include <wil/resource.h>

#include <fmt/format.h>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <array>
#include <bit>
#include <cctype>
#include <cstddef>
#include <fstream>
#include <limits>
#include <sstream>
#include <vector>

namespace vrcsm::core::hw
{

void to_json(nlohmann::json& j, const HwReport& report)
{
    j = nlohmann::json{
        {"cpuName", report.cpuName},
        {"cpuCores", report.cpuCores},
        {"cpuThreads", report.cpuThreads},
        {"cpuClockMhz", report.cpuClockMhz},
        {"gpuName", report.gpuName},
        {"gpuVramBytes", report.gpuVramBytes},
        {"gpuDriver", report.gpuDriver},
        {"ramBytes", report.ramBytes},
        {"hmdModel", report.hmdModel},
        {"hmdManufacturer", report.hmdManufacturer},
        {"osBuild", report.osBuild},
    };
}

namespace
{

constexpr const wchar_t* kWmiNamespace = L"ROOT\\CIMV2";
constexpr std::string_view kMicrosoftBasicDisplay = "microsoft basic";

std::string ToLower(std::string_view text)
{
    std::string lowered;
    lowered.reserve(text.size());
    for (const unsigned char ch : text)
    {
        lowered.push_back(static_cast<char>(std::tolower(ch)));
    }
    return lowered;
}

bool IContains(std::string_view text, std::string_view needle)
{
    if (needle.empty())
    {
        return true;
    }
    return ToLower(text).find(ToLower(needle)) != std::string::npos;
}

std::string Trim(std::string value)
{
    const auto notSpace = [](unsigned char ch) { return !std::isspace(ch); };
    value.erase(value.begin(), std::find_if(value.begin(), value.end(), notSpace));
    value.erase(std::find_if(value.rbegin(), value.rend(), notSpace).base(), value.end());
    return value;
}

std::optional<std::string> ReadRegistryString(HKEY root, const wchar_t* subKey, const wchar_t* valueName)
{
    wil::unique_hkey key;
    HKEY rawKey = nullptr;
    if (RegOpenKeyExW(root, subKey, 0, KEY_READ, &rawKey) != ERROR_SUCCESS)
    {
        return std::nullopt;
    }
    key.reset(rawKey);

    DWORD type = 0;
    DWORD size = 0;
    if (RegQueryValueExW(key.get(), valueName, nullptr, &type, nullptr, &size) != ERROR_SUCCESS
        || (type != REG_SZ && type != REG_EXPAND_SZ)
        || size == 0)
    {
        return std::nullopt;
    }

    std::wstring buffer(size / sizeof(wchar_t), L'\0');
    if (RegQueryValueExW(key.get(), valueName, nullptr, nullptr,
                         reinterpret_cast<BYTE*>(buffer.data()), &size) != ERROR_SUCCESS)
    {
        return std::nullopt;
    }

    while (!buffer.empty() && buffer.back() == L'\0')
    {
        buffer.pop_back();
    }
    if (buffer.empty())
    {
        return std::nullopt;
    }

    return toUtf8(buffer);
}

std::vector<std::pair<std::wstring, std::string>> EnumerateRegistryStrings(HKEY root, const wchar_t* subKey)
{
    std::vector<std::pair<std::wstring, std::string>> values;

    wil::unique_hkey key;
    HKEY rawKey = nullptr;
    if (RegOpenKeyExW(root, subKey, 0, KEY_READ, &rawKey) != ERROR_SUCCESS)
    {
        return values;
    }
    key.reset(rawKey);

    DWORD index = 0;
    for (;; ++index)
    {
        DWORD nameLength = 256;
        std::wstring name(nameLength, L'\0');
        DWORD type = 0;
        DWORD dataSize = 0;

        LONG status = RegEnumValueW(key.get(), index, name.data(), &nameLength,
                                    nullptr, &type, nullptr, &dataSize);
        if (status == ERROR_NO_MORE_ITEMS)
        {
            break;
        }
        if (status == ERROR_MORE_DATA)
        {
            nameLength = 1024;
            name.assign(nameLength, L'\0');
            status = RegEnumValueW(key.get(), index, name.data(), &nameLength,
                                   nullptr, &type, nullptr, &dataSize);
        }
        if (status != ERROR_SUCCESS || (type != REG_SZ && type != REG_EXPAND_SZ) || dataSize == 0)
        {
            continue;
        }

        name.resize(nameLength);
        std::wstring data(dataSize / sizeof(wchar_t), L'\0');
        DWORD readSize = dataSize;
        if (RegQueryValueExW(key.get(), name.c_str(), nullptr, &type,
                             reinterpret_cast<BYTE*>(data.data()), &readSize) != ERROR_SUCCESS)
        {
            continue;
        }
        while (!data.empty() && data.back() == L'\0')
        {
            data.pop_back();
        }
        if (!data.empty())
        {
            values.emplace_back(name, toUtf8(data));
        }
    }

    return values;
}

std::optional<std::string> ProbeOculusModel()
{
    constexpr const wchar_t* kHmdKey = L"SOFTWARE\\Oculus VR, LLC\\Oculus\\HMD";
    constexpr const wchar_t* kUserKey = L"SOFTWARE\\Oculus VR, LLC\\Oculus\\User";

    const std::array<std::wstring_view, 9> preferredNames{
        L"Model",
        L"Headset",
        L"HMD",
        L"DeviceModel",
        L"DeviceName",
        L"CurrentHMD",
        L"ActiveHMD",
        L"ProductName",
        L"Default",
    };

    const auto choose = [&](const std::vector<std::pair<std::wstring, std::string>>& entries) -> std::optional<std::string>
    {
        for (const auto preferred : preferredNames)
        {
            for (const auto& [name, value] : entries)
            {
                if (_wcsicmp(name.c_str(), preferred.data()) == 0 && !Trim(value).empty())
                {
                    return Trim(value);
                }
            }
        }

        for (const auto& [name, value] : entries)
        {
            const auto loweredName = ToLower(toUtf8(name));
            const auto loweredValue = ToLower(value);
            if ((loweredName.find("hmd") != std::string::npos
                 || loweredName.find("headset") != std::string::npos
                 || loweredName.find("model") != std::string::npos)
                && !Trim(value).empty())
            {
                return Trim(value);
            }
            if ((loweredValue.find("quest") != std::string::npos
                 || loweredValue.find("rift") != std::string::npos
                 || loweredValue.find("oculus") != std::string::npos
                 || loweredValue.find("meta") != std::string::npos)
                && !Trim(value).empty())
            {
                return Trim(value);
            }
        }

        return std::nullopt;
    };

    if (auto fromHmd = choose(EnumerateRegistryStrings(HKEY_LOCAL_MACHINE, kHmdKey)))
    {
        return fromHmd;
    }
    return choose(EnumerateRegistryStrings(HKEY_LOCAL_MACHINE, kUserKey));
}

std::string SlurpFile(const std::filesystem::path& path)
{
    std::ifstream input(path, std::ios::binary);
    if (!input)
    {
        return {};
    }
    std::stringstream buffer;
    buffer << input.rdbuf();
    return buffer.str();
}

std::pair<std::string, std::string> ProbeSteamVrHmd()
{
    const auto path = SteamVrConfig::DetectVrSettingsPath();
    if (!path)
    {
        return {};
    }

    try
    {
        const std::string text = SlurpFile(*path);
        if (text.empty())
        {
            return {};
        }
        const auto doc = nlohmann::json::parse(text);
        const auto info = SteamVrConfig::ExtractHardwareInfo(doc);
        return {info.hmdModel, info.hmdManufacturer};
    }
    catch (const std::exception& ex)
    {
        spdlog::warn("[hw] failed to parse steamvr.vrsettings for HMD info: {}", ex.what());
        return {};
    }
}

uint64_t VariantToUInt64(const VARIANT& variant)
{
    switch (variant.vt)
    {
    case VT_UI1: return variant.bVal;
    case VT_UI2: return variant.uiVal;
    case VT_UI4: return variant.ulVal;
    case VT_UI8: return variant.ullVal;
    case VT_I2: return static_cast<uint64_t>(std::max<short>(variant.iVal, 0));
    case VT_I4: return static_cast<uint64_t>(std::max<long>(variant.lVal, 0));
    case VT_I8: return static_cast<uint64_t>(std::max<LONGLONG>(variant.llVal, 0));
    default: return 0;
    }
}

int VariantToInt(const VARIANT& variant)
{
    const auto value = VariantToUInt64(variant);
    return static_cast<int>(std::min<uint64_t>(value, static_cast<uint64_t>(std::numeric_limits<int>::max())));
}

std::string VariantToString(const VARIANT& variant)
{
    if (variant.vt == VT_BSTR && variant.bstrVal != nullptr)
    {
        return Trim(toUtf8(variant.bstrVal));
    }
    return {};
}

std::optional<VARIANT> GetWmiProperty(IWbemClassObject* object, const wchar_t* name)
{
    VARIANT value;
    VariantInit(&value);
    if (FAILED(object->Get(name, 0, &value, nullptr, nullptr)))
    {
        return std::nullopt;
    }
    return value;
}

struct WmiConnection
{
    wil::com_ptr<IWbemLocator> locator;
    wil::com_ptr<IWbemServices> services;
};

std::optional<WmiConnection> ConnectWmi()
{
    WmiConnection connection;
    HRESULT hr = CoCreateInstance(CLSID_WbemLocator, nullptr, CLSCTX_INPROC_SERVER,
                                  IID_PPV_ARGS(connection.locator.put()));
    if (FAILED(hr))
    {
        spdlog::warn("[hw] CoCreateInstance(CLSID_WbemLocator) failed: 0x{:08X}", static_cast<unsigned>(hr));
        return std::nullopt;
    }

    wil::unique_bstr ns(::SysAllocString(kWmiNamespace));
    hr = connection.locator->ConnectServer(ns.get(), nullptr, nullptr, nullptr,
                                           0, nullptr, nullptr, connection.services.put());
    if (FAILED(hr))
    {
        spdlog::warn("[hw] WMI ConnectServer failed: 0x{:08X}", static_cast<unsigned>(hr));
        return std::nullopt;
    }

    hr = CoSetProxyBlanket(connection.services.get(),
                           RPC_C_AUTHN_WINNT,
                           RPC_C_AUTHZ_NONE,
                           nullptr,
                           RPC_C_AUTHN_LEVEL_CALL,
                           RPC_C_IMP_LEVEL_IMPERSONATE,
                           nullptr,
                           EOAC_NONE);
    if (FAILED(hr))
    {
        spdlog::warn("[hw] CoSetProxyBlanket failed: 0x{:08X}", static_cast<unsigned>(hr));
        return std::nullopt;
    }

    return connection;
}

void ProbeCpuViaWmi(IWbemServices* services, HwReport& report)
{
    wil::com_ptr<IEnumWbemClassObject> enumerator;
    wil::unique_bstr language(::SysAllocString(L"WQL"));
    wil::unique_bstr query(::SysAllocString(L"SELECT Name, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed FROM Win32_Processor"));
    const HRESULT hr = services->ExecQuery(
        language.get(),
        query.get(),
        WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY,
        nullptr,
        enumerator.put());
    if (FAILED(hr) || !enumerator)
    {
        return;
    }

    ULONG returned = 0;
    wil::com_ptr<IWbemClassObject> object;
    if (FAILED(enumerator->Next(WBEM_INFINITE, 1, object.put(), &returned)) || returned == 0)
    {
        return;
    }

    if (auto value = GetWmiProperty(object.get(), L"Name"))
    {
        report.cpuName = VariantToString(*value);
        VariantClear(&*value);
    }
    if (auto value = GetWmiProperty(object.get(), L"NumberOfCores"))
    {
        report.cpuCores = VariantToInt(*value);
        VariantClear(&*value);
    }
    if (auto value = GetWmiProperty(object.get(), L"NumberOfLogicalProcessors"))
    {
        report.cpuThreads = VariantToInt(*value);
        VariantClear(&*value);
    }
    if (auto value = GetWmiProperty(object.get(), L"MaxClockSpeed"))
    {
        report.cpuClockMhz = VariantToInt(*value);
        VariantClear(&*value);
    }
}

void ProbeGpuViaWmi(IWbemServices* services, HwReport& report)
{
    wil::com_ptr<IEnumWbemClassObject> enumerator;
    wil::unique_bstr language(::SysAllocString(L"WQL"));
    wil::unique_bstr query(::SysAllocString(L"SELECT Name, AdapterRAM, DriverVersion FROM Win32_VideoController"));
    const HRESULT hr = services->ExecQuery(
        language.get(),
        query.get(),
        WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY,
        nullptr,
        enumerator.put());
    if (FAILED(hr) || !enumerator)
    {
        return;
    }

    while (true)
    {
        ULONG returned = 0;
        wil::com_ptr<IWbemClassObject> object;
        if (FAILED(enumerator->Next(WBEM_INFINITE, 1, object.put(), &returned)) || returned == 0)
        {
            break;
        }

        std::string name;
        std::uint64_t adapterRam = 0;
        std::string driverVersion;

        if (auto value = GetWmiProperty(object.get(), L"Name"))
        {
            name = VariantToString(*value);
            VariantClear(&*value);
        }
        if (auto value = GetWmiProperty(object.get(), L"AdapterRAM"))
        {
            adapterRam = VariantToUInt64(*value);
            VariantClear(&*value);
        }
        if (auto value = GetWmiProperty(object.get(), L"DriverVersion"))
        {
            driverVersion = VariantToString(*value);
            VariantClear(&*value);
        }

        if (name.empty() || IContains(name, kMicrosoftBasicDisplay))
        {
            continue;
        }

        report.gpuName = name;
        report.gpuVramBytes = adapterRam;
        report.gpuDriver = driverVersion;
        return;
    }
}

void ProbeCpuFallback(HwReport& report)
{
    DWORD bufferSize = 0;
    GetLogicalProcessorInformationEx(RelationProcessorCore, nullptr, &bufferSize);
    if (bufferSize != 0 && GetLastError() == ERROR_INSUFFICIENT_BUFFER)
    {
        std::vector<std::byte> buffer(bufferSize);
        auto* info = reinterpret_cast<PSYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX>(buffer.data());
        if (GetLogicalProcessorInformationEx(RelationProcessorCore, info, &bufferSize))
        {
            DWORD offset = 0;
            while (offset < bufferSize)
            {
                const auto* entry = reinterpret_cast<PSYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX>(
                    buffer.data() + offset);
                if (entry->Relationship == RelationProcessorCore)
                {
                    ++report.cpuCores;
                    for (WORD group = 0; group < entry->Processor.GroupCount; ++group)
                    {
                        report.cpuThreads += std::popcount(
                            static_cast<unsigned long long>(entry->Processor.GroupMask[group].Mask));
                    }
                }
                offset += entry->Size;
            }
        }
    }

    if (report.cpuThreads == 0)
    {
        SYSTEM_INFO info{};
        GetSystemInfo(&info);
        report.cpuThreads = static_cast<int>(info.dwNumberOfProcessors);
    }
    if (report.cpuCores == 0)
    {
        report.cpuCores = report.cpuThreads;
    }

    if (report.cpuName.empty())
    {
        if (auto cpuName = ReadRegistryString(HKEY_LOCAL_MACHINE,
                                              L"HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0",
                                              L"ProcessorNameString"))
        {
            report.cpuName = *cpuName;
        }
    }
}

void ProbeRam(HwReport& report)
{
    MEMORYSTATUSEX status{};
    status.dwLength = sizeof(status);
    if (GlobalMemoryStatusEx(&status))
    {
        report.ramBytes = status.ullTotalPhys;
    }
}

std::string ProbeOsBuild()
{
    using RtlGetVersionFn = LONG (WINAPI*)(PRTL_OSVERSIONINFOW);

    const HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
    if (!ntdll)
    {
        return {};
    }

    const auto rtlGetVersion = reinterpret_cast<RtlGetVersionFn>(
        GetProcAddress(ntdll, "RtlGetVersion"));
    if (!rtlGetVersion)
    {
        return {};
    }

    RTL_OSVERSIONINFOW version{};
    version.dwOSVersionInfoSize = sizeof(version);
    if (rtlGetVersion(&version) != 0)
    {
        return {};
    }

    return fmt::format("{}.{}.{}", version.dwMajorVersion, version.dwMinorVersion, version.dwBuildNumber);
}

void ProbeHmd(HwReport& report)
{
    const auto [steamModel, steamManufacturer] = ProbeSteamVrHmd();
    const auto oculusModel = ProbeOculusModel();

    report.hmdModel = steamModel;
    report.hmdManufacturer = steamManufacturer;

    if (report.hmdModel.empty() && oculusModel)
    {
        report.hmdModel = *oculusModel;
        if (report.hmdManufacturer.empty())
        {
            report.hmdManufacturer = "Meta";
        }
        return;
    }

    if (!report.hmdModel.empty() && oculusModel && IContains(report.hmdModel, *oculusModel))
    {
        if (report.hmdManufacturer.empty())
        {
            report.hmdManufacturer = "Meta";
        }
        return;
    }

    if (report.hmdModel.empty() && !steamManufacturer.empty())
    {
        report.hmdManufacturer = steamManufacturer;
    }
}

} // namespace

Result<HwReport> Detect()
{
    try
    {
        const HRESULT initResult = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        const bool needsUninit = SUCCEEDED(initResult);
        auto uninit = wil::scope_exit([&]()
        {
            if (needsUninit)
            {
                CoUninitialize();
            }
        });

        if (FAILED(initResult) && initResult != RPC_E_CHANGED_MODE)
        {
            return Error{"hw_detect_failed", fmt::format("CoInitializeEx failed: 0x{:08X}", static_cast<unsigned>(initResult)), 0};
        }

        const HRESULT securityResult = CoInitializeSecurity(
            nullptr,
            -1,
            nullptr,
            nullptr,
            RPC_C_AUTHN_LEVEL_DEFAULT,
            RPC_C_IMP_LEVEL_IMPERSONATE,
            nullptr,
            EOAC_NONE,
            nullptr);
        if (FAILED(securityResult) && securityResult != RPC_E_TOO_LATE)
        {
            spdlog::warn("[hw] CoInitializeSecurity failed: 0x{:08X}", static_cast<unsigned>(securityResult));
        }

        HwReport report;

        if (auto connection = ConnectWmi())
        {
            ProbeCpuViaWmi(connection->services.get(), report);
            ProbeGpuViaWmi(connection->services.get(), report);
        }

        if (report.cpuName.empty() || report.cpuCores == 0 || report.cpuThreads == 0)
        {
            ProbeCpuFallback(report);
        }

        ProbeRam(report);
        ProbeHmd(report);
        report.osBuild = ProbeOsBuild();

        return report;
    }
    catch (const std::exception& ex)
    {
        return Error{"hw_detect_failed", ex.what(), 0};
    }
    catch (...)
    {
        return Error{"hw_detect_failed", "Unknown hardware detection failure", 0};
    }
}

} // namespace vrcsm::core::hw
