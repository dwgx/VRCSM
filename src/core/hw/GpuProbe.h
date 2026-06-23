#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include <nlohmann/json.hpp>

namespace vrcsm::core::hw
{

struct GpuAdapterInfo
{
    std::string name;
    std::string vendor;
    std::string pnpId;
    std::string driverVersion;
    std::string source;
    std::uint32_t vendorId{0};
    std::uint32_t deviceId{0};
    std::uint64_t dedicatedVideoMemoryBytes{0};
    std::uint64_t adapterRamBytes{0};
    bool software{false};
    bool virtualAdapter{false};
    bool primaryCandidate{false};
    int score{0};
};

void to_json(nlohmann::json& j, const GpuAdapterInfo& adapter);

std::string GpuVendorFromId(std::uint32_t vendorId);
std::string GpuVendorFromText(std::string_view text);
bool IsVirtualDisplayAdapter(std::string_view name, std::string_view pnpId, bool software);
int ScoreGpuAdapter(const GpuAdapterInfo& adapter);
std::vector<GpuAdapterInfo> EnumerateDxgiAdapters();
std::optional<GpuAdapterInfo> ChooseBestGpuAdapter(std::vector<GpuAdapterInfo> adapters);

} // namespace vrcsm::core::hw
