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
    // DXGI adapter LUID packed as (HighPart << 32) | LowPart, used to match the
    // chosen adapter when re-querying live VRAM via IDXGIAdapter3. 0 == unknown.
    std::uint64_t luid{0};
    bool hasLuid{false};
    bool software{false};
    bool virtualAdapter{false};
    bool primaryCandidate{false};
    int score{0};
};

void to_json(nlohmann::json& j, const GpuAdapterInfo& adapter);

// Pack a Windows LUID (LowPart: DWORD, HighPart: LONG) into a single 64-bit key
// for adapter matching. Bit-pattern only — never interpreted as a number.
std::uint64_t PackLuid(std::uint32_t lowPart, std::int32_t highPart);

std::string GpuVendorFromId(std::uint32_t vendorId);
std::string GpuVendorFromText(std::string_view text);
bool IsVirtualDisplayAdapter(std::string_view name, std::string_view pnpId, bool software);
int ScoreGpuAdapter(const GpuAdapterInfo& adapter);
std::vector<GpuAdapterInfo> EnumerateDxgiAdapters();
std::optional<GpuAdapterInfo> ChooseBestGpuAdapter(std::vector<GpuAdapterInfo> adapters);

// Live VRAM bytes in use on the local memory segment of the adapter with the
// given packed LUID, via IDXGIAdapter3::QueryVideoMemoryInfo. Vendor-neutral
// (AMD/Intel/NVIDIA). Returns nullopt when the adapter or interface is missing.
std::optional<std::uint64_t> QueryDxgiVideoMemoryUsed(std::uint64_t packedLuid);

} // namespace vrcsm::core::hw
