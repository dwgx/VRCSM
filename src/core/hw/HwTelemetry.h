#pragma once

#include "../Common.h"
#include "GpuProbe.h"

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace vrcsm::core::hw
{

struct TelemetrySourceStatus
{
    std::string name;
    bool available{false};
    std::string message;
};

struct MotherboardInfo
{
    std::string manufacturer;
    std::string product;
    std::string version;
    std::string serialNumber;
};

struct RamModuleInfo
{
    std::string bankLabel;
    std::string deviceLocator;
    std::string manufacturer;
    std::string partNumber;
    std::string serialNumber;
    std::uint64_t capacityBytes{0};
    int speedMhz{0};
    int configuredClockMhz{0};
    int memoryType{0};
    int smbiosMemoryType{0};
    int formFactor{0};
    std::string memoryTypeLabel;
    std::string formFactorLabel;
};

struct SensorReading
{
    std::string id;
    std::string name;
    std::string sensorType;
    std::string source;
    std::string unit;
    std::optional<double> value;
};

struct CpuTelemetry
{
    std::optional<double> temperatureC;
    std::optional<double> loadPct;
    std::optional<double> powerWatts;
};

struct GpuTelemetry
{
    std::string name;
    std::optional<double> temperatureC;
    std::optional<double> loadPct;
    std::optional<double> fanSpeedPct;
    std::optional<double> powerWatts;
    std::uint64_t memoryUsedBytes{0};
    std::uint64_t memoryTotalBytes{0};
    std::string primarySource;
};

struct MemoryTelemetry
{
    std::uint64_t totalBytes{0};
    std::uint64_t availableBytes{0};
    std::uint64_t usedBytes{0};
    std::optional<double> usedPct;
};

struct TelemetrySnapshot
{
    std::string generatedAt;
    MotherboardInfo motherboard;
    MemoryTelemetry memory;
    std::vector<RamModuleInfo> ramModules;
    CpuTelemetry cpu;
    GpuTelemetry gpu;
    std::vector<GpuAdapterInfo> gpuAdapters;
    std::vector<SensorReading> fans;
    std::vector<SensorReading> power;
    std::vector<SensorReading> sensors;
    std::vector<TelemetrySourceStatus> sources;
};

void to_json(nlohmann::json& j, const TelemetrySourceStatus& status);
void to_json(nlohmann::json& j, const MotherboardInfo& info);
void to_json(nlohmann::json& j, const RamModuleInfo& module);
void to_json(nlohmann::json& j, const SensorReading& reading);
void to_json(nlohmann::json& j, const CpuTelemetry& cpu);
void to_json(nlohmann::json& j, const GpuTelemetry& gpu);
void to_json(nlohmann::json& j, const MemoryTelemetry& memory);
void to_json(nlohmann::json& j, const TelemetrySnapshot& snapshot);

Result<TelemetrySnapshot> CollectTelemetry();

std::vector<SensorReading> ParseAida64SensorValuesForTest(const std::string& xml);

} // namespace vrcsm::core::hw
