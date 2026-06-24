#include "HwTelemetry.h"

#include <Windows.h>
#include <oleauto.h>
#include <wbemidl.h>

#include <wil/com.h>
#include <wil/resource.h>

#include <fmt/format.h>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <charconv>
#include <functional>
#include <limits>
#include <regex>
#include <span>
#include <string_view>
#include <utility>

namespace vrcsm::core::hw
{

void to_json(nlohmann::json& j, const TelemetrySourceStatus& status)
{
    j = nlohmann::json{
        {"name", status.name},
        {"available", status.available},
        {"message", status.message},
    };
}

void to_json(nlohmann::json& j, const MotherboardInfo& info)
{
    j = nlohmann::json{
        {"manufacturer", info.manufacturer},
        {"product", info.product},
        {"version", info.version},
        {"serial_number", info.serialNumber},
    };
}

void to_json(nlohmann::json& j, const RamModuleInfo& module)
{
    j = nlohmann::json{
        {"bank_label", module.bankLabel},
        {"device_locator", module.deviceLocator},
        {"manufacturer", module.manufacturer},
        {"part_number", module.partNumber},
        {"serial_number", module.serialNumber},
        {"capacity_bytes", module.capacityBytes},
        {"speed_mhz", module.speedMhz},
        {"configured_clock_mhz", module.configuredClockMhz},
        {"memory_type", module.memoryType},
        {"smbios_memory_type", module.smbiosMemoryType},
        {"form_factor", module.formFactor},
        {"memory_type_label", module.memoryTypeLabel},
        {"form_factor_label", module.formFactorLabel},
    };
}

void to_json(nlohmann::json& j, const SensorReading& reading)
{
    j = nlohmann::json{
        {"id", reading.id},
        {"name", reading.name},
        {"sensor_type", reading.sensorType},
        {"source", reading.source},
        {"unit", reading.unit},
    };
    if (reading.value.has_value())
    {
        j["value"] = *reading.value;
    }
    else
    {
        j["value"] = nullptr;
    }
}

void to_json(nlohmann::json& j, const CpuTelemetry& cpu)
{
    j = nlohmann::json::object();
    j["temperature_c"] = cpu.temperatureC.has_value() ? nlohmann::json(*cpu.temperatureC) : nlohmann::json(nullptr);
    j["load_pct"] = cpu.loadPct.has_value() ? nlohmann::json(*cpu.loadPct) : nlohmann::json(nullptr);
    j["power_watts"] = cpu.powerWatts.has_value() ? nlohmann::json(*cpu.powerWatts) : nlohmann::json(nullptr);
}

void to_json(nlohmann::json& j, const GpuTelemetry& gpu)
{
    j = nlohmann::json{
        {"name", gpu.name},
        {"memory_used_bytes", gpu.memoryUsedBytes},
        {"memory_total_bytes", gpu.memoryTotalBytes},
        {"primary_source", gpu.primarySource},
    };
    j["temperature_c"] = gpu.temperatureC.has_value() ? nlohmann::json(*gpu.temperatureC) : nlohmann::json(nullptr);
    j["load_pct"] = gpu.loadPct.has_value() ? nlohmann::json(*gpu.loadPct) : nlohmann::json(nullptr);
    j["fan_speed_pct"] = gpu.fanSpeedPct.has_value() ? nlohmann::json(*gpu.fanSpeedPct) : nlohmann::json(nullptr);
    j["power_watts"] = gpu.powerWatts.has_value() ? nlohmann::json(*gpu.powerWatts) : nlohmann::json(nullptr);
}

void to_json(nlohmann::json& j, const MemoryTelemetry& memory)
{
    j = nlohmann::json{
        {"total_bytes", memory.totalBytes},
        {"available_bytes", memory.availableBytes},
        {"used_bytes", memory.usedBytes},
    };
    j["used_pct"] = memory.usedPct.has_value() ? nlohmann::json(*memory.usedPct) : nlohmann::json(nullptr);
}

void to_json(nlohmann::json& j, const TelemetrySnapshot& snapshot)
{
    j = nlohmann::json{
        {"generated_at", snapshot.generatedAt},
        {"motherboard", snapshot.motherboard},
        {"memory", snapshot.memory},
        {"ram_modules", snapshot.ramModules},
        {"cpu", snapshot.cpu},
        {"gpu", snapshot.gpu},
        {"gpu_adapters", snapshot.gpuAdapters},
        {"fans", snapshot.fans},
        {"power", snapshot.power},
        {"sensors", snapshot.sensors},
        {"sources", snapshot.sources},
    };
}

namespace
{

constexpr const wchar_t* kCimV2Namespace = L"ROOT\\CIMV2";
constexpr const wchar_t* kLibreHardwareMonitorNamespace = L"ROOT\\LibreHardwareMonitor";
constexpr const wchar_t* kOpenHardwareMonitorNamespace = L"ROOT\\OpenHardwareMonitor";
constexpr long kWmiQueryTimeoutMs = 2500;
constexpr DWORD kRawSmbiosProvider = 0x52534D42; // 'RSMB'
constexpr const wchar_t* kAida64SensorValuesMap = L"AIDA64_SensorValues";

struct SmbiosHeader
{
    std::uint8_t type{0};
    std::uint8_t length{0};
    std::uint16_t handle{0};
};

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
    return ToLower(text).find(ToLower(needle)) != std::string::npos;
}

std::string Trim(std::string value)
{
    const auto notSpace = [](unsigned char ch) { return !std::isspace(ch); };
    value.erase(value.begin(), std::find_if(value.begin(), value.end(), notSpace));
    value.erase(std::find_if(value.rbegin(), value.rend(), notSpace).base(), value.end());
    return value;
}

std::string CleanHardwareString(std::string value)
{
    value = Trim(std::move(value));
    const auto lowered = ToLower(value);
    static constexpr std::array<std::string_view, 9> kPlaceholders{
        "",
        "unknown",
        "none",
        "not specified",
        "not available",
        "to be filled by o.e.m.",
        "to be filled by oem",
        "system product name",
        "default string",
    };
    for (const auto placeholder : kPlaceholders)
    {
        if (lowered == placeholder)
        {
            return {};
        }
    }
    return value;
}

std::string DecodeXmlEntities(std::string value)
{
    const std::array<std::pair<std::string_view, std::string_view>, 5> entities{{
        {"&amp;", "&"},
        {"&lt;", "<"},
        {"&gt;", ">"},
        {"&quot;", "\""},
        {"&apos;", "'"},
    }};
    for (const auto& [from, to] : entities)
    {
        std::size_t pos = 0;
        while ((pos = value.find(from, pos)) != std::string::npos)
        {
            value.replace(pos, from.size(), to);
            pos += to.size();
        }
    }
    return value;
}

std::optional<double> ParseLooseDouble(std::string value)
{
    value = Trim(std::move(value));
    std::replace(value.begin(), value.end(), ',', '.');
    std::string numeric;
    numeric.reserve(value.size());
    bool seenDigit = false;
    for (char ch : value)
    {
        const unsigned char uch = static_cast<unsigned char>(ch);
        if (std::isdigit(uch) || ch == '.' || ch == '-' || ch == '+')
        {
            numeric.push_back(ch);
            if (std::isdigit(uch))
            {
                seenDigit = true;
            }
        }
        else if (seenDigit)
        {
            break;
        }
    }
    if (!seenDigit)
    {
        return std::nullopt;
    }
    double parsed = 0.0;
    const auto result = std::from_chars(numeric.data(), numeric.data() + numeric.size(), parsed);
    if (result.ec != std::errc{})
    {
        return std::nullopt;
    }
    return parsed;
}

std::string CleanSmbiosString(std::string value)
{
    value.erase(std::remove(value.begin(), value.end(), '\0'), value.end());
    return CleanHardwareString(std::move(value));
}

std::vector<std::string> ParseSmbiosStrings(const std::uint8_t* stringsBegin, const std::uint8_t* tableEnd)
{
    std::vector<std::string> strings;
    const auto* cursor = stringsBegin;
    while (cursor < tableEnd && *cursor != 0)
    {
        const auto* start = cursor;
        while (cursor < tableEnd && *cursor != 0)
        {
            ++cursor;
        }
        strings.push_back(CleanSmbiosString(std::string(reinterpret_cast<const char*>(start),
                                                        reinterpret_cast<const char*>(cursor))));
        if (cursor < tableEnd)
        {
            ++cursor;
        }
    }
    return strings;
}

std::string SmbiosString(const std::vector<std::string>& strings, std::uint8_t index)
{
    if (index == 0 || index > strings.size())
    {
        return {};
    }
    return strings[index - 1];
}

std::uint16_t ReadLe16(const std::uint8_t* data)
{
    return static_cast<std::uint16_t>(data[0] | (static_cast<std::uint16_t>(data[1]) << 8));
}

std::uint32_t ReadLe32(const std::uint8_t* data)
{
    return static_cast<std::uint32_t>(data[0])
        | (static_cast<std::uint32_t>(data[1]) << 8)
        | (static_cast<std::uint32_t>(data[2]) << 16)
        | (static_cast<std::uint32_t>(data[3]) << 24);
}

std::uint64_t ReadLe64(const std::uint8_t* data)
{
    return static_cast<std::uint64_t>(ReadLe32(data))
        | (static_cast<std::uint64_t>(ReadLe32(data + 4)) << 32);
}

std::uint64_t VariantToUInt64(const VARIANT& variant)
{
    switch (variant.vt)
    {
    case VT_UI1: return variant.bVal;
    case VT_UI2: return variant.uiVal;
    case VT_UI4: return variant.ulVal;
    case VT_UI8: return variant.ullVal;
    case VT_I1: return static_cast<std::uint64_t>(std::max<signed char>(variant.cVal, 0));
    case VT_I2: return static_cast<std::uint64_t>(std::max<short>(variant.iVal, 0));
    case VT_I4: return static_cast<std::uint64_t>(std::max<long>(variant.lVal, 0));
    case VT_I8: return static_cast<std::uint64_t>(std::max<LONGLONG>(variant.llVal, 0));
    case VT_R4: return variant.fltVal > 0.0f ? static_cast<std::uint64_t>(variant.fltVal) : 0;
    case VT_R8: return variant.dblVal > 0.0 ? static_cast<std::uint64_t>(variant.dblVal) : 0;
    default: return 0;
    }
}

int VariantToInt(const VARIANT& variant)
{
    const auto value = VariantToUInt64(variant);
    return static_cast<int>(std::min<std::uint64_t>(value, static_cast<std::uint64_t>(std::numeric_limits<int>::max())));
}

std::optional<double> VariantToDouble(const VARIANT& variant)
{
    switch (variant.vt)
    {
    case VT_R4: return static_cast<double>(variant.fltVal);
    case VT_R8: return variant.dblVal;
    case VT_UI1:
    case VT_UI2:
    case VT_UI4:
    case VT_UI8:
    case VT_I1:
    case VT_I2:
    case VT_I4:
    case VT_I8:
        return static_cast<double>(VariantToUInt64(variant));
    default:
        return std::nullopt;
    }
}

std::string VariantToString(const VARIANT& variant)
{
    if (variant.vt == VT_BSTR && variant.bstrVal != nullptr)
    {
        return CleanHardwareString(toUtf8(variant.bstrVal));
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

std::string ReadWmiString(IWbemClassObject* object, const wchar_t* name)
{
    if (auto value = GetWmiProperty(object, name))
    {
        auto text = VariantToString(*value);
        VariantClear(&*value);
        return text;
    }
    return {};
}

int ReadWmiInt(IWbemClassObject* object, const wchar_t* name)
{
    if (auto value = GetWmiProperty(object, name))
    {
        const auto number = VariantToInt(*value);
        VariantClear(&*value);
        return number;
    }
    return 0;
}

std::uint64_t ReadWmiUInt64(IWbemClassObject* object, const wchar_t* name)
{
    if (auto value = GetWmiProperty(object, name))
    {
        const auto number = VariantToUInt64(*value);
        VariantClear(&*value);
        return number;
    }
    return 0;
}

std::optional<double> ReadWmiDouble(IWbemClassObject* object, const wchar_t* name)
{
    if (auto value = GetWmiProperty(object, name))
    {
        const auto number = VariantToDouble(*value);
        VariantClear(&*value);
        return number;
    }
    return std::nullopt;
}

struct WmiConnection
{
    wil::com_ptr<IWbemLocator> locator;
    wil::com_ptr<IWbemServices> services;
};

std::optional<WmiConnection> ConnectWmi(const wchar_t* namespaceName, std::string& errorMessage)
{
    WmiConnection connection;
    HRESULT hr = CoCreateInstance(CLSID_WbemLocator, nullptr, CLSCTX_INPROC_SERVER,
                                  IID_PPV_ARGS(connection.locator.put()));
    if (FAILED(hr))
    {
        errorMessage = fmt::format("CoCreateInstance(CLSID_WbemLocator) failed: 0x{:08X}", static_cast<unsigned>(hr));
        return std::nullopt;
    }

    wil::unique_bstr ns(::SysAllocString(namespaceName));
    hr = connection.locator->ConnectServer(ns.get(), nullptr, nullptr, nullptr,
                                           0, nullptr, nullptr, connection.services.put());
    if (FAILED(hr))
    {
        errorMessage = fmt::format("ConnectServer failed: 0x{:08X}", static_cast<unsigned>(hr));
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
        errorMessage = fmt::format("CoSetProxyBlanket failed: 0x{:08X}", static_cast<unsigned>(hr));
        return std::nullopt;
    }

    return connection;
}

bool ForEachWmiObject(IWbemServices* services, const wchar_t* queryText,
                      const std::function<void(IWbemClassObject*)>& visitor,
                      std::string& errorMessage,
                      long timeoutMs = kWmiQueryTimeoutMs)
{
    wil::com_ptr<IEnumWbemClassObject> enumerator;
    wil::unique_bstr language(::SysAllocString(L"WQL"));
    wil::unique_bstr query(::SysAllocString(queryText));
    const HRESULT hr = services->ExecQuery(
        language.get(),
        query.get(),
        WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY,
        nullptr,
        enumerator.put());
    if (FAILED(hr) || !enumerator)
    {
        errorMessage = fmt::format("ExecQuery failed: 0x{:08X}", static_cast<unsigned>(hr));
        return false;
    }

    while (true)
    {
        ULONG returned = 0;
        wil::com_ptr<IWbemClassObject> object;
        const HRESULT nextHr = enumerator->Next(timeoutMs, 1, object.put(), &returned);
        if (nextHr == WBEM_S_TIMEDOUT)
        {
            errorMessage = fmt::format("Enumerator::Next timed out after {}ms", timeoutMs);
            return false;
        }
        if (FAILED(nextHr))
        {
            errorMessage = fmt::format("Enumerator::Next failed: 0x{:08X}", static_cast<unsigned>(nextHr));
            return false;
        }
        if (returned == 0)
        {
            break;
        }
        visitor(object.get());
    }

    return true;
}

std::string MemoryTypeLabel(int smbiosType, int legacyType)
{
    switch (smbiosType != 0 ? smbiosType : legacyType)
    {
    case 20: return "DDR";
    case 21: return "DDR2";
    case 24: return "DDR3";
    case 26: return "DDR4";
    case 27: return "LPDDR";
    case 28: return "LPDDR2";
    case 29: return "LPDDR3";
    case 30: return "LPDDR4";
    case 34: return "DDR5";
    case 35: return "LPDDR5";
    default: return {};
    }
}

std::string FormFactorLabel(int formFactor)
{
    switch (formFactor)
    {
    case 8: return "DIMM";
    case 12: return "SODIMM";
    case 15: return "FB-DIMM";
    case 16: return "LRDIMM";
    default: return {};
    }
}

void ProbeMotherboard(IWbemServices* services, TelemetrySnapshot& snapshot)
{
    std::string queryError;
    (void)ForEachWmiObject(
        services,
        L"SELECT Manufacturer, Product, Version, SerialNumber FROM Win32_BaseBoard",
        [&](IWbemClassObject* object)
        {
            if (!snapshot.motherboard.manufacturer.empty() || !snapshot.motherboard.product.empty())
            {
                return;
            }
            snapshot.motherboard.manufacturer = ReadWmiString(object, L"Manufacturer");
            snapshot.motherboard.product = ReadWmiString(object, L"Product");
            snapshot.motherboard.version = ReadWmiString(object, L"Version");
            snapshot.motherboard.serialNumber = ReadWmiString(object, L"SerialNumber");
        },
        queryError);
}

void ProbeRamModules(IWbemServices* services, TelemetrySnapshot& snapshot)
{
    std::string queryError;
    (void)ForEachWmiObject(
        services,
        L"SELECT BankLabel, DeviceLocator, Manufacturer, PartNumber, SerialNumber, Capacity, Speed, ConfiguredClockSpeed, MemoryType, SMBIOSMemoryType, FormFactor FROM Win32_PhysicalMemory",
        [&](IWbemClassObject* object)
        {
            RamModuleInfo module;
            module.bankLabel = ReadWmiString(object, L"BankLabel");
            module.deviceLocator = ReadWmiString(object, L"DeviceLocator");
            module.manufacturer = ReadWmiString(object, L"Manufacturer");
            module.partNumber = ReadWmiString(object, L"PartNumber");
            module.serialNumber = ReadWmiString(object, L"SerialNumber");
            module.capacityBytes = ReadWmiUInt64(object, L"Capacity");
            module.speedMhz = ReadWmiInt(object, L"Speed");
            module.configuredClockMhz = ReadWmiInt(object, L"ConfiguredClockSpeed");
            module.memoryType = ReadWmiInt(object, L"MemoryType");
            module.smbiosMemoryType = ReadWmiInt(object, L"SMBIOSMemoryType");
            module.formFactor = ReadWmiInt(object, L"FormFactor");
            module.memoryTypeLabel = MemoryTypeLabel(module.smbiosMemoryType, module.memoryType);
            module.formFactorLabel = FormFactorLabel(module.formFactor);
            if (module.capacityBytes != 0 || !module.partNumber.empty() || !module.deviceLocator.empty())
            {
                snapshot.ramModules.push_back(std::move(module));
            }
        },
        queryError);
}

std::uint64_t SmbiosMemoryCapacityBytes(const std::uint8_t* formatted, std::uint8_t length)
{
    if (length < 0x0E)
    {
        return 0;
    }
    const auto size = ReadLe16(formatted + 0x0C);
    if (size == 0 || size == 0xFFFF)
    {
        return 0;
    }
    if (size == 0x7FFF && length >= 0x20)
    {
        return static_cast<std::uint64_t>(ReadLe32(formatted + 0x1C)) * 1024ULL * 1024ULL;
    }
    const bool kilobytes = (size & 0x8000) != 0;
    const auto value = static_cast<std::uint64_t>(size & 0x7FFF);
    return kilobytes ? value * 1024ULL : value * 1024ULL * 1024ULL;
}

void ApplySmbiosBaseboard(const std::uint8_t* formatted, std::uint8_t length,
                          const std::vector<std::string>& strings,
                          TelemetrySnapshot& snapshot)
{
    if (length < 0x08)
    {
        return;
    }
    if (snapshot.motherboard.manufacturer.empty())
    {
        snapshot.motherboard.manufacturer = SmbiosString(strings, formatted[0x04]);
    }
    if (snapshot.motherboard.product.empty())
    {
        snapshot.motherboard.product = SmbiosString(strings, formatted[0x05]);
    }
    if (snapshot.motherboard.version.empty())
    {
        snapshot.motherboard.version = SmbiosString(strings, formatted[0x06]);
    }
    if (snapshot.motherboard.serialNumber.empty())
    {
        snapshot.motherboard.serialNumber = SmbiosString(strings, formatted[0x07]);
    }
}

void ApplySmbiosMemoryDevice(const std::uint8_t* formatted, std::uint8_t length,
                             const std::vector<std::string>& strings,
                             TelemetrySnapshot& snapshot)
{
    const auto capacityBytes = SmbiosMemoryCapacityBytes(formatted, length);
    if (capacityBytes == 0)
    {
        return;
    }

    RamModuleInfo module;
    module.capacityBytes = capacityBytes;
    if (length >= 0x11)
    {
        module.formFactor = formatted[0x0E];
        module.deviceLocator = SmbiosString(strings, formatted[0x10]);
    }
    if (length >= 0x12)
    {
        module.bankLabel = SmbiosString(strings, formatted[0x11]);
    }
    if (length >= 0x16)
    {
        module.memoryType = formatted[0x12];
        module.speedMhz = ReadLe16(formatted + 0x15);
    }
    if (length >= 0x1B)
    {
        module.manufacturer = SmbiosString(strings, formatted[0x17]);
        module.serialNumber = SmbiosString(strings, formatted[0x18]);
        module.partNumber = SmbiosString(strings, formatted[0x1A]);
    }
    if (length >= 0x5C)
    {
        module.configuredClockMhz = ReadLe16(formatted + 0x20);
        module.smbiosMemoryType = formatted[0x54];
    }
    module.memoryTypeLabel = MemoryTypeLabel(module.smbiosMemoryType, module.memoryType);
    module.formFactorLabel = FormFactorLabel(module.formFactor);

    const auto sameModule = [&](const RamModuleInfo& existing)
    {
        return existing.capacityBytes == module.capacityBytes
            && (!module.deviceLocator.empty() && existing.deviceLocator == module.deviceLocator);
    };
    if (std::none_of(snapshot.ramModules.begin(), snapshot.ramModules.end(), sameModule))
    {
        snapshot.ramModules.push_back(std::move(module));
    }
}

void ProbeSmbios(TelemetrySnapshot& snapshot)
{
    const UINT required = GetSystemFirmwareTable(kRawSmbiosProvider, 0, nullptr, 0);
    if (required == 0)
    {
        snapshot.sources.push_back(TelemetrySourceStatus{"smbios", false, "GetSystemFirmwareTable(RSMB) returned no data"});
        return;
    }

    std::vector<std::uint8_t> buffer(required);
    const UINT written = GetSystemFirmwareTable(kRawSmbiosProvider, 0, buffer.data(), required);
    if (written == 0 || written > buffer.size())
    {
        snapshot.sources.push_back(TelemetrySourceStatus{"smbios", false, "GetSystemFirmwareTable(RSMB) failed"});
        return;
    }
    buffer.resize(written);

    if (buffer.size() < 8)
    {
        snapshot.sources.push_back(TelemetrySourceStatus{"smbios", false, "Raw SMBIOS payload too small"});
        return;
    }

    const auto tableLength = ReadLe32(buffer.data() + 4);
    if (tableLength == 0 || buffer.size() < 8ULL + tableLength)
    {
        snapshot.sources.push_back(TelemetrySourceStatus{"smbios", false, "Raw SMBIOS table length is invalid"});
        return;
    }

    const auto* cursor = buffer.data() + 8;
    const auto* tableEnd = cursor + tableLength;
    std::size_t structures = 0;
    while (cursor + sizeof(SmbiosHeader) <= tableEnd)
    {
        const auto* formatted = cursor;
        const auto header = reinterpret_cast<const SmbiosHeader*>(formatted);
        if (header->length < sizeof(SmbiosHeader) || formatted + header->length > tableEnd)
        {
            break;
        }

        const auto* stringsBegin = formatted + header->length;
        const auto strings = ParseSmbiosStrings(stringsBegin, tableEnd);
        if (header->type == 2)
        {
            ApplySmbiosBaseboard(formatted, header->length, strings, snapshot);
        }
        else if (header->type == 17)
        {
            ApplySmbiosMemoryDevice(formatted, header->length, strings, snapshot);
        }

        auto* next = stringsBegin;
        while (next + 1 < tableEnd && !(next[0] == 0 && next[1] == 0))
        {
            ++next;
        }
        if (next + 1 >= tableEnd)
        {
            break;
        }
        cursor = next + 2;
        ++structures;
    }

    snapshot.sources.push_back(TelemetrySourceStatus{
        "smbios",
        structures > 0,
        structures > 0 ? fmt::format("{} SMBIOS structures", structures) : "No SMBIOS structures parsed",
    });
}

void ProbeMemory(TelemetrySnapshot& snapshot)
{
    MEMORYSTATUSEX status{};
    status.dwLength = sizeof(status);
    if (!GlobalMemoryStatusEx(&status))
    {
        return;
    }
    snapshot.memory.totalBytes = status.ullTotalPhys;
    snapshot.memory.availableBytes = status.ullAvailPhys;
    snapshot.memory.usedBytes = status.ullTotalPhys > status.ullAvailPhys
        ? status.ullTotalPhys - status.ullAvailPhys
        : 0;
    if (status.ullTotalPhys != 0)
    {
        snapshot.memory.usedPct = static_cast<double>(snapshot.memory.usedBytes) * 100.0
            / static_cast<double>(status.ullTotalPhys);
    }
}

void ProbeDxgiGpuAdapters(TelemetrySnapshot& snapshot)
{
    auto adapters = EnumerateDxgiAdapters();
    auto best = ChooseBestGpuAdapter(adapters);
    if (best)
    {
        for (auto& adapter : adapters)
        {
            adapter.primaryCandidate = adapter.name == best->name
                && adapter.vendorId == best->vendorId
                && adapter.deviceId == best->deviceId
                && adapter.dedicatedVideoMemoryBytes == best->dedicatedVideoMemoryBytes;
        }
    }

    snapshot.sources.push_back(TelemetrySourceStatus{
        "dxgi",
        !adapters.empty(),
        adapters.empty() ? "No DXGI display adapters returned" : fmt::format("{} display adapters", adapters.size()),
    });

    if (best && !best->virtualAdapter)
    {
        if (snapshot.gpu.name.empty())
        {
            snapshot.gpu.name = best->name;
        }
        if (snapshot.gpu.memoryTotalBytes == 0)
        {
            snapshot.gpu.memoryTotalBytes = best->dedicatedVideoMemoryBytes;
        }
        if (snapshot.gpu.primarySource.empty())
        {
            snapshot.gpu.primarySource = "dxgi";
        }
    }

    snapshot.gpuAdapters = std::move(adapters);
}

std::string SensorUnit(std::string_view sensorType)
{
    if (IContains(sensorType, "temperature")) return "C";
    if (IContains(sensorType, "load")) return "%";
    if (IContains(sensorType, "fan")) return "RPM";
    if (IContains(sensorType, "power")) return "W";
    if (IContains(sensorType, "clock")) return "MHz";
    if (IContains(sensorType, "voltage")) return "V";
    if (IContains(sensorType, "data")) return "GB";
    return {};
}

int TemperatureScore(const SensorReading& sensor, bool gpu)
{
    const auto haystack = ToLower(sensor.id + " " + sensor.name);
    int score = 0;
    if (gpu)
    {
        if (haystack.find("/gpu") != std::string::npos || haystack.find("gpu") != std::string::npos) score += 30;
        if (haystack.find("core") != std::string::npos) score += 8;
        if (haystack.find("hot spot") != std::string::npos || haystack.find("hotspot") != std::string::npos) score -= 6;
    }
    else
    {
        if (haystack.find("/intelcpu") != std::string::npos || haystack.find("/amdcpu") != std::string::npos) score += 30;
        if (haystack.find("cpu") != std::string::npos) score += 16;
        if (haystack.find("package") != std::string::npos) score += 10;
        if (haystack.find("tctl") != std::string::npos || haystack.find("tdie") != std::string::npos) score += 10;
        if (haystack.find("core max") != std::string::npos) score += 6;
        if (haystack.find("distance") != std::string::npos) score -= 20;
    }
    return score;
}

std::optional<double> PickSensorValue(const std::vector<SensorReading>& sensors, std::string_view type, bool gpu)
{
    const SensorReading* best = nullptr;
    int bestScore = std::numeric_limits<int>::min();
    for (const auto& sensor : sensors)
    {
        if (!sensor.value.has_value() || !IContains(sensor.sensorType, type))
        {
            continue;
        }

        const auto haystack = ToLower(sensor.id + " " + sensor.name);
        int score = 0;
        if (IContains(type, "temperature"))
        {
            score = TemperatureScore(sensor, gpu);
        }
        else if (gpu)
        {
            if (haystack.find("/gpu") != std::string::npos || haystack.find("gpu") != std::string::npos) score += 30;
            if (haystack.find("core") != std::string::npos) score += 5;
        }
        else
        {
            if (haystack.find("/intelcpu") != std::string::npos || haystack.find("/amdcpu") != std::string::npos) score += 30;
            if (haystack.find("cpu") != std::string::npos) score += 10;
            if (haystack.find("total") != std::string::npos) score += 5;
            if (haystack.find("package") != std::string::npos) score += 5;
        }

        if (score > bestScore)
        {
            best = &sensor;
            bestScore = score;
        }
    }
    return best ? best->value : std::nullopt;
}

void ApplySensorCollection(const std::vector<SensorReading>& collected, const std::string& sourceName, TelemetrySnapshot& snapshot)
{
    for (const auto& sensor : collected)
    {
        if (IContains(sensor.sensorType, "fan"))
        {
            snapshot.fans.push_back(sensor);
        }
        if (IContains(sensor.sensorType, "power"))
        {
            snapshot.power.push_back(sensor);
        }
    }

    if (!snapshot.cpu.temperatureC.has_value())
    {
        snapshot.cpu.temperatureC = PickSensorValue(collected, "temperature", false);
    }
    if (!snapshot.cpu.loadPct.has_value())
    {
        snapshot.cpu.loadPct = PickSensorValue(collected, "load", false);
    }
    if (!snapshot.cpu.powerWatts.has_value())
    {
        snapshot.cpu.powerWatts = PickSensorValue(collected, "power", false);
    }
    if (!snapshot.gpu.temperatureC.has_value())
    {
        snapshot.gpu.temperatureC = PickSensorValue(collected, "temperature", true);
        if (snapshot.gpu.temperatureC.has_value() && snapshot.gpu.primarySource.empty())
        {
            snapshot.gpu.primarySource = sourceName;
        }
    }
    if (!snapshot.gpu.loadPct.has_value())
    {
        snapshot.gpu.loadPct = PickSensorValue(collected, "load", true);
    }
    if (!snapshot.gpu.powerWatts.has_value())
    {
        snapshot.gpu.powerWatts = PickSensorValue(collected, "power", true);
    }
}

void ProbeMonitorSensors(const wchar_t* namespaceName, std::string sourceName, TelemetrySnapshot& snapshot)
{
    std::string errorMessage;
    auto connection = ConnectWmi(namespaceName, errorMessage);
    if (!connection)
    {
        snapshot.sources.push_back(TelemetrySourceStatus{sourceName, false, errorMessage});
        return;
    }

    std::vector<SensorReading> collected;
    std::string queryError;
    const bool ok = ForEachWmiObject(
        connection->services.get(),
        L"SELECT Identifier, Name, SensorType, Value FROM Sensor",
        [&](IWbemClassObject* object)
        {
            SensorReading sensor;
            sensor.id = ReadWmiString(object, L"Identifier");
            sensor.name = ReadWmiString(object, L"Name");
            sensor.sensorType = ReadWmiString(object, L"SensorType");
            sensor.value = ReadWmiDouble(object, L"Value");
            sensor.source = sourceName;
            sensor.unit = SensorUnit(sensor.sensorType);
            if (!sensor.id.empty() || !sensor.name.empty())
            {
                collected.push_back(std::move(sensor));
            }
        },
        queryError);

    if (!ok)
    {
        snapshot.sources.push_back(TelemetrySourceStatus{sourceName, false, queryError});
        return;
    }

    snapshot.sources.push_back(TelemetrySourceStatus{
        sourceName,
        !collected.empty(),
        collected.empty() ? "Sensor WMI namespace is present but has no Sensor rows" : fmt::format("{} sensors", collected.size()),
    });

    ApplySensorCollection(collected, sourceName, snapshot);

    snapshot.sensors.insert(snapshot.sensors.end(), collected.begin(), collected.end());
}

std::string XmlTagText(const std::string& block, std::string_view tag)
{
    const std::string open = fmt::format("<{}>", tag);
    const std::string close = fmt::format("</{}>", tag);
    const auto start = block.find(open);
    if (start == std::string::npos)
    {
        return {};
    }
    const auto textStart = start + open.size();
    const auto end = block.find(close, textStart);
    if (end == std::string::npos)
    {
        return {};
    }
    return CleanHardwareString(DecodeXmlEntities(block.substr(textStart, end - textStart)));
}

std::string AidaSensorType(std::string_view id, std::string_view label)
{
    const auto idLower = ToLower(std::string(id));
    const auto haystack = ToLower(fmt::format("{} {}", id, label));
    if (haystack.find("fan") != std::string::npos || haystack.find("rpm") != std::string::npos)
    {
        return "Fan";
    }
    if (!idLower.empty() && idLower.front() == 'f')
    {
        return "Fan";
    }
    if (haystack.find("power") != std::string::npos || haystack.find("watt") != std::string::npos)
    {
        return "Power";
    }
    if (!idLower.empty() && idLower.front() == 'p')
    {
        return "Power";
    }
    if (haystack.find("load") != std::string::npos || haystack.find("util") != std::string::npos)
    {
        return "Load";
    }
    if (!idLower.empty() && idLower.front() == 'u')
    {
        return "Load";
    }
    if (haystack.find("volt") != std::string::npos)
    {
        return "Voltage";
    }
    if (!idLower.empty() && idLower.front() == 'v')
    {
        return "Voltage";
    }
    if (haystack.find("clock") != std::string::npos)
    {
        return "Clock";
    }
    if (!idLower.empty() && idLower.front() == 'c')
    {
        return "Clock";
    }
    if (haystack.find("temp") != std::string::npos || haystack.find("diode") != std::string::npos)
    {
        return "Temperature";
    }
    if (!idLower.empty() && idLower.front() == 't')
    {
        return "Temperature";
    }
    return "Sensor";
}

std::vector<SensorReading> ParseAida64SensorValues(const std::string& xml)
{
    std::vector<SensorReading> sensors;
    static const std::regex itemRe(R"(<(item|sensor)>\s*([\s\S]*?)\s*</\1>)", std::regex::icase);
    for (std::sregex_iterator it(xml.begin(), xml.end(), itemRe), end; it != end; ++it)
    {
        const auto block = (*it)[2].str();
        SensorReading sensor;
        sensor.id = XmlTagText(block, "id");
        sensor.name = XmlTagText(block, "label");
        if (sensor.name.empty())
        {
            sensor.name = XmlTagText(block, "name");
        }
        sensor.sensorType = XmlTagText(block, "type");
        auto valueText = XmlTagText(block, "value");
        if (valueText.empty())
        {
            valueText = XmlTagText(block, "temp");
        }
        sensor.value = ParseLooseDouble(valueText);
        sensor.source = "aida64_shared_memory";
        if (sensor.sensorType.empty())
        {
            sensor.sensorType = AidaSensorType(sensor.id, sensor.name);
        }
        sensor.unit = SensorUnit(sensor.sensorType);
        if (!sensor.name.empty() && sensor.value.has_value())
        {
            sensors.push_back(std::move(sensor));
        }
    }
    return sensors;
}

void ProbeAida64SharedMemory(TelemetrySnapshot& snapshot)
{
    wil::unique_handle mapping(OpenFileMappingW(FILE_MAP_READ, FALSE, kAida64SensorValuesMap));
    if (!mapping)
    {
        snapshot.sources.push_back(TelemetrySourceStatus{"aida64_shared_memory", false, "AIDA64_SensorValues mapping not found"});
        return;
    }

    void* view = MapViewOfFile(mapping.get(), FILE_MAP_READ, 0, 0, 0);
    if (!view)
    {
        snapshot.sources.push_back(TelemetrySourceStatus{"aida64_shared_memory", false, "MapViewOfFile failed"});
        return;
    }
    auto unmap = wil::scope_exit([&]() { UnmapViewOfFile(view); });

    // AIDA64 publishes a null-terminated XML-ish sensor list in this mapping.
    // Cap the scan to 1 MiB so a malformed mapping cannot make us walk arbitrary memory forever.
    constexpr std::size_t kMaxAidaBytes = 1024 * 1024;
    const auto* bytes = static_cast<const char*>(view);
    std::size_t length = 0;
    while (length < kMaxAidaBytes && bytes[length] != '\0')
    {
        ++length;
    }
    if (length == 0 || length == kMaxAidaBytes)
    {
        snapshot.sources.push_back(TelemetrySourceStatus{"aida64_shared_memory", false, "SensorValues payload missing terminator"});
        return;
    }

    const auto sensors = ParseAida64SensorValues(std::string(bytes, length));
    snapshot.sources.push_back(TelemetrySourceStatus{
        "aida64_shared_memory",
        !sensors.empty(),
        sensors.empty() ? "AIDA64 shared memory present but no sensor rows parsed" : fmt::format("{} sensors", sensors.size()),
    });
    ApplySensorCollection(sensors, "aida64_shared_memory", snapshot);
    snapshot.sensors.insert(snapshot.sensors.end(), sensors.begin(), sensors.end());
}

std::filesystem::path NvmlDefaultPath()
{
    if (auto programFiles = tryGetEnvPath(L"ProgramFiles"))
    {
        return *programFiles / L"NVIDIA Corporation" / L"NVSMI" / L"nvml.dll";
    }
    return {};
}

struct NvmlApi
{
    HMODULE module{nullptr};

    NvmlApi() = default;
    NvmlApi(const NvmlApi&) = delete;
    NvmlApi& operator=(const NvmlApi&) = delete;
    NvmlApi(NvmlApi&& other) noexcept
        : module(std::exchange(other.module, nullptr)),
          init(std::exchange(other.init, nullptr)),
          shutdown(std::exchange(other.shutdown, nullptr)),
          getCount(std::exchange(other.getCount, nullptr)),
          getHandleByIndex(std::exchange(other.getHandleByIndex, nullptr)),
          getTemperature(std::exchange(other.getTemperature, nullptr)),
          getFanSpeed(std::exchange(other.getFanSpeed, nullptr)),
          getPowerUsage(std::exchange(other.getPowerUsage, nullptr)),
          getName(std::exchange(other.getName, nullptr)),
          getMemoryInfo(std::exchange(other.getMemoryInfo, nullptr)),
          getUtilizationRates(std::exchange(other.getUtilizationRates, nullptr))
    {
    }
    NvmlApi& operator=(NvmlApi&& other) noexcept
    {
        if (this != &other)
        {
            if (module)
            {
                FreeLibrary(module);
            }
            module = std::exchange(other.module, nullptr);
            init = std::exchange(other.init, nullptr);
            shutdown = std::exchange(other.shutdown, nullptr);
            getCount = std::exchange(other.getCount, nullptr);
            getHandleByIndex = std::exchange(other.getHandleByIndex, nullptr);
            getTemperature = std::exchange(other.getTemperature, nullptr);
            getFanSpeed = std::exchange(other.getFanSpeed, nullptr);
            getPowerUsage = std::exchange(other.getPowerUsage, nullptr);
            getName = std::exchange(other.getName, nullptr);
            getMemoryInfo = std::exchange(other.getMemoryInfo, nullptr);
            getUtilizationRates = std::exchange(other.getUtilizationRates, nullptr);
        }
        return *this;
    }

    using nvmlDevice_t = struct nvmlDevice_st*;
    using InitFn = int (*)();
    using ShutdownFn = int (*)();
    using DeviceGetCountFn = int (*)(unsigned int*);
    using DeviceGetHandleByIndexFn = int (*)(unsigned int, nvmlDevice_t*);
    using DeviceGetTemperatureFn = int (*)(nvmlDevice_t, unsigned int, unsigned int*);
    using DeviceGetFanSpeedFn = int (*)(nvmlDevice_t, unsigned int*);
    using DeviceGetPowerUsageFn = int (*)(nvmlDevice_t, unsigned int*);
    using DeviceGetNameFn = int (*)(nvmlDevice_t, char*, unsigned int);
    struct MemoryInfo
    {
        unsigned long long total;
        unsigned long long free;
        unsigned long long used;
    };
    using DeviceGetMemoryInfoFn = int (*)(nvmlDevice_t, MemoryInfo*);
    struct Utilization
    {
        unsigned int gpu;
        unsigned int memory;
    };
    using DeviceGetUtilizationRatesFn = int (*)(nvmlDevice_t, Utilization*);

    InitFn init{nullptr};
    ShutdownFn shutdown{nullptr};
    DeviceGetCountFn getCount{nullptr};
    DeviceGetHandleByIndexFn getHandleByIndex{nullptr};
    DeviceGetTemperatureFn getTemperature{nullptr};
    DeviceGetFanSpeedFn getFanSpeed{nullptr};
    DeviceGetPowerUsageFn getPowerUsage{nullptr};
    DeviceGetNameFn getName{nullptr};
    DeviceGetMemoryInfoFn getMemoryInfo{nullptr};
    DeviceGetUtilizationRatesFn getUtilizationRates{nullptr};

    ~NvmlApi()
    {
        if (module)
        {
            FreeLibrary(module);
        }
    }
};

template <typename T>
T LoadProc(HMODULE module, const char* name)
{
    return reinterpret_cast<T>(GetProcAddress(module, name));
}

std::optional<NvmlApi> LoadNvml(std::string& message)
{
    NvmlApi api;
    api.module = LoadLibraryW(L"nvml.dll");
    if (!api.module)
    {
        const auto path = NvmlDefaultPath();
        if (!path.empty())
        {
            api.module = LoadLibraryW(path.c_str());
        }
    }
    if (!api.module)
    {
        message = "nvml.dll not found";
        return std::nullopt;
    }

    api.init = LoadProc<NvmlApi::InitFn>(api.module, "nvmlInit_v2");
    api.shutdown = LoadProc<NvmlApi::ShutdownFn>(api.module, "nvmlShutdown");
    api.getCount = LoadProc<NvmlApi::DeviceGetCountFn>(api.module, "nvmlDeviceGetCount_v2");
    api.getHandleByIndex = LoadProc<NvmlApi::DeviceGetHandleByIndexFn>(api.module, "nvmlDeviceGetHandleByIndex_v2");
    api.getTemperature = LoadProc<NvmlApi::DeviceGetTemperatureFn>(api.module, "nvmlDeviceGetTemperature");
    api.getFanSpeed = LoadProc<NvmlApi::DeviceGetFanSpeedFn>(api.module, "nvmlDeviceGetFanSpeed");
    api.getPowerUsage = LoadProc<NvmlApi::DeviceGetPowerUsageFn>(api.module, "nvmlDeviceGetPowerUsage");
    api.getName = LoadProc<NvmlApi::DeviceGetNameFn>(api.module, "nvmlDeviceGetName");
    api.getMemoryInfo = LoadProc<NvmlApi::DeviceGetMemoryInfoFn>(api.module, "nvmlDeviceGetMemoryInfo");
    api.getUtilizationRates = LoadProc<NvmlApi::DeviceGetUtilizationRatesFn>(api.module, "nvmlDeviceGetUtilizationRates");

    if (!api.init || !api.shutdown || !api.getHandleByIndex)
    {
        message = "nvml.dll is missing required entry points";
        return std::nullopt;
    }

    return std::move(api);
}

void ProbeNvml(TelemetrySnapshot& snapshot)
{
    constexpr int kNvmlSuccess = 0;
    constexpr unsigned int kTemperatureGpu = 0;

    std::string loadMessage;
    auto apiHolder = LoadNvml(loadMessage);
    if (!apiHolder)
    {
        snapshot.sources.push_back(TelemetrySourceStatus{"nvml", false, loadMessage});
        return;
    }
    auto& api = *apiHolder;

    int rc = api.init();
    if (rc != kNvmlSuccess)
    {
        snapshot.sources.push_back(TelemetrySourceStatus{"nvml", false, fmt::format("nvmlInit_v2 failed: {}", rc)});
        return;
    }
    auto shutdown = wil::scope_exit([&]() { (void)api.shutdown(); });

    unsigned int deviceCount = 1;
    if (api.getCount)
    {
        rc = api.getCount(&deviceCount);
        if (rc != kNvmlSuccess || deviceCount == 0)
        {
            snapshot.sources.push_back(TelemetrySourceStatus{"nvml", false, fmt::format("nvmlDeviceGetCount_v2 failed: {}", rc)});
            return;
        }
    }

    struct NvmlCandidate
    {
        NvmlApi::nvmlDevice_t device{nullptr};
        std::string name;
        NvmlApi::MemoryInfo memory{};
        unsigned int index{0};
        bool hasMemory{false};
    };

    std::vector<NvmlCandidate> candidates;
    for (unsigned int index = 0; index < deviceCount; ++index)
    {
        NvmlApi::nvmlDevice_t device = nullptr;
        rc = api.getHandleByIndex(index, &device);
        if (rc != kNvmlSuccess || !device)
        {
            continue;
        }

        NvmlCandidate candidate;
        candidate.device = device;
        candidate.index = index;
        if (api.getName)
        {
            char name[128]{};
            if (api.getName(device, name, static_cast<unsigned int>(sizeof(name))) == kNvmlSuccess)
            {
                candidate.name = CleanHardwareString(name);
            }
        }
        if (api.getMemoryInfo)
        {
            NvmlApi::MemoryInfo memory{};
            if (api.getMemoryInfo(device, &memory) == kNvmlSuccess)
            {
                candidate.memory = memory;
                candidate.hasMemory = true;
            }
        }
        candidates.push_back(candidate);
    }

    if (candidates.empty())
    {
        snapshot.sources.push_back(TelemetrySourceStatus{"nvml", false, "No NVIDIA devices returned usable handles"});
        return;
    }

    const auto best = std::max_element(candidates.begin(), candidates.end(), [](const NvmlCandidate& lhs, const NvmlCandidate& rhs)
    {
        return lhs.memory.total < rhs.memory.total;
    });
    NvmlApi::nvmlDevice_t device = best->device;

    if (!best->name.empty())
    {
        snapshot.gpu.name = best->name;
    }

    if (api.getTemperature)
    {
        unsigned int value = 0;
        if (api.getTemperature(device, kTemperatureGpu, &value) == kNvmlSuccess)
        {
            snapshot.gpu.temperatureC = static_cast<double>(value);
        }
    }
    if (api.getFanSpeed)
    {
        unsigned int value = 0;
        if (api.getFanSpeed(device, &value) == kNvmlSuccess)
        {
            snapshot.gpu.fanSpeedPct = static_cast<double>(value);
        }
    }
    if (api.getPowerUsage)
    {
        unsigned int milliwatts = 0;
        if (api.getPowerUsage(device, &milliwatts) == kNvmlSuccess)
        {
            snapshot.gpu.powerWatts = static_cast<double>(milliwatts) / 1000.0;
        }
    }
    if (api.getMemoryInfo)
    {
        if (best->hasMemory)
        {
            snapshot.gpu.memoryTotalBytes = best->memory.total;
            snapshot.gpu.memoryUsedBytes = best->memory.used;
        }
    }
    if (api.getUtilizationRates)
    {
        NvmlApi::Utilization utilization{};
        if (api.getUtilizationRates(device, &utilization) == kNvmlSuccess)
        {
            snapshot.gpu.loadPct = static_cast<double>(utilization.gpu);
        }
    }

    snapshot.gpu.primarySource = "nvml";
    snapshot.sources.push_back(TelemetrySourceStatus{
        "nvml",
        true,
        fmt::format("NVIDIA Management Library, selected GPU {} of {}", best->index, deviceCount),
    });
}

} // namespace

std::vector<SensorReading> ParseAida64SensorValuesForTest(const std::string& xml)
{
    return ParseAida64SensorValues(xml);
}

Result<TelemetrySnapshot> CollectTelemetry()
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
            return Error{"hw_telemetry_failed", fmt::format("CoInitializeEx failed: 0x{:08X}", static_cast<unsigned>(initResult)), 0};
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
            spdlog::warn("[hw-telemetry] CoInitializeSecurity failed: 0x{:08X}", static_cast<unsigned>(securityResult));
        }

        TelemetrySnapshot snapshot;
        snapshot.generatedAt = nowIso();

        std::string cimError;
        if (auto cim = ConnectWmi(kCimV2Namespace, cimError))
        {
            snapshot.sources.push_back(TelemetrySourceStatus{"wmi_cimv2", true, "Windows CIM/WMI hardware inventory"});
            ProbeMotherboard(cim->services.get(), snapshot);
            ProbeRamModules(cim->services.get(), snapshot);
        }
        else
        {
            snapshot.sources.push_back(TelemetrySourceStatus{"wmi_cimv2", false, cimError});
        }

        ProbeSmbios(snapshot);
        ProbeMemory(snapshot);
        ProbeDxgiGpuAdapters(snapshot);
        ProbeMonitorSensors(kLibreHardwareMonitorNamespace, "librehardwaremonitor_wmi", snapshot);
        ProbeMonitorSensors(kOpenHardwareMonitorNamespace, "openhardwaremonitor_wmi", snapshot);
        ProbeAida64SharedMemory(snapshot);
        ProbeNvml(snapshot);

        return snapshot;
    }
    catch (const std::exception& ex)
    {
        return Error{"hw_telemetry_failed", ex.what(), 0};
    }
    catch (...)
    {
        return Error{"hw_telemetry_failed", "Unknown hardware telemetry failure", 0};
    }
}

} // namespace vrcsm::core::hw
