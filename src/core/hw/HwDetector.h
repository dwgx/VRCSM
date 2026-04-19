#pragma once

#include "../Common.h"

#include <cstdint>
#include <string>

#include <nlohmann/json.hpp>

namespace vrcsm::core::hw
{

struct HwReport
{
    std::string cpuName;
    int cpuCores{0};
    int cpuThreads{0};
    int cpuClockMhz{0};
    std::string gpuName;
    std::uint64_t gpuVramBytes{0};
    std::string gpuDriver;
    std::uint64_t ramBytes{0};
    std::string hmdModel;
    std::string hmdManufacturer;
    std::string osBuild;
};

void to_json(nlohmann::json& j, const HwReport& report);

Result<HwReport> Detect();

} // namespace vrcsm::core::hw
