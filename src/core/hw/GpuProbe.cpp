#include "GpuProbe.h"

#include "../Common.h"

#include <Windows.h>
#include <dxgi1_6.h>

#include <wil/com.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <utility>

namespace vrcsm::core::hw
{

void to_json(nlohmann::json& j, const GpuAdapterInfo& adapter)
{
    j = nlohmann::json{
        {"name", adapter.name},
        {"vendor", adapter.vendor},
        {"pnp_id", adapter.pnpId},
        {"driver_version", adapter.driverVersion},
        {"source", adapter.source},
        {"vendor_id", adapter.vendorId},
        {"device_id", adapter.deviceId},
        {"dedicated_video_memory_bytes", adapter.dedicatedVideoMemoryBytes},
        {"adapter_ram_bytes", adapter.adapterRamBytes},
        {"software", adapter.software},
        {"virtual", adapter.virtualAdapter},
        {"primary_candidate", adapter.primaryCandidate},
        {"score", adapter.score},
    };
}

namespace
{

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
    static constexpr std::array<std::string_view, 8> kPlaceholders{
        "",
        "unknown",
        "none",
        "not specified",
        "not available",
        "microsoft basic display adapter",
        "basic render driver",
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

bool StartsWithInsensitive(std::string_view text, std::string_view prefix)
{
    if (text.size() < prefix.size())
    {
        return false;
    }
    return ToLower(text.substr(0, prefix.size())) == ToLower(prefix);
}

int MemoryScore(std::uint64_t bytes, int pointsPerGiB, int maxPoints)
{
    if (bytes == 0)
    {
        return 0;
    }
    const auto gib = static_cast<int>(std::min<std::uint64_t>(bytes / (1024ull * 1024ull * 1024ull), 64));
    return std::min(maxPoints, std::max(1, gib) * pointsPerGiB);
}

} // namespace

std::string GpuVendorFromId(std::uint32_t vendorId)
{
    switch (vendorId)
    {
    case 0x10DE: return "NVIDIA";
    case 0x1002:
    case 0x1022: return "AMD";
    case 0x8086: return "Intel";
    case 0x1414: return "Microsoft";
    default: return {};
    }
}

std::string GpuVendorFromText(std::string_view text)
{
    const auto lowered = ToLower(text);
    if (lowered.find("ven_10de") != std::string::npos || lowered.find("nvidia") != std::string::npos
        || lowered.find("geforce") != std::string::npos || lowered.find("rtx") != std::string::npos
        || lowered.find("gtx") != std::string::npos)
    {
        return "NVIDIA";
    }
    if (lowered.find("ven_1002") != std::string::npos || lowered.find("ven_1022") != std::string::npos
        || lowered.find("advanced micro devices") != std::string::npos || lowered.find("amd") != std::string::npos
        || lowered.find("radeon") != std::string::npos)
    {
        return "AMD";
    }
    if (lowered.find("ven_8086") != std::string::npos || lowered.find("intel") != std::string::npos
        || lowered.find("arc") != std::string::npos || lowered.find("iris") != std::string::npos)
    {
        return "Intel";
    }
    if (lowered.find("microsoft") != std::string::npos)
    {
        return "Microsoft";
    }
    return {};
}

bool IsVirtualDisplayAdapter(std::string_view name, std::string_view pnpId, bool software)
{
    if (software)
    {
        return true;
    }

    const auto loweredName = ToLower(name);
    const auto loweredPnp = ToLower(pnpId);
    static constexpr std::array<std::string_view, 13> kVirtualMarkers{
        "virtual",
        "indirect display",
        "remote display",
        "microsoft basic",
        "basic render",
        "gameviewer",
        "spacedesk",
        "parsec",
        "miracast",
        "steam streaming",
        "virtual desktop",
        "rdp",
        "vmware",
    };
    for (const auto marker : kVirtualMarkers)
    {
        if (loweredName.find(marker) != std::string::npos || loweredPnp.find(marker) != std::string::npos)
        {
            return true;
        }
    }

    if (StartsWithInsensitive(pnpId, "ROOT\\"))
    {
        return true;
    }

    return false;
}

int ScoreGpuAdapter(const GpuAdapterInfo& adapter)
{
    if (adapter.name.empty())
    {
        return -1000;
    }

    int score = 0;
    if (adapter.virtualAdapter || adapter.software)
    {
        score -= 800;
    }

    const auto vendor = !adapter.vendor.empty()
        ? adapter.vendor
        : GpuVendorFromText(adapter.name + " " + adapter.pnpId);
    if (vendor == "NVIDIA")
    {
        score += 450;
    }
    else if (vendor == "AMD")
    {
        score += 420;
    }
    else if (vendor == "Intel")
    {
        score += 260;
    }
    else if (vendor == "Microsoft")
    {
        score -= 250;
    }

    score += MemoryScore(adapter.dedicatedVideoMemoryBytes, 22, 220);
    score += MemoryScore(adapter.adapterRamBytes, 12, 120);

    if (StartsWithInsensitive(adapter.pnpId, "PCI\\VEN_"))
    {
        score += 150;
    }
    else if (!adapter.pnpId.empty() && !adapter.virtualAdapter)
    {
        score += 10;
    }

    const auto name = ToLower(adapter.name);
    if (name.find("rtx") != std::string::npos) score += 120;
    if (name.find("gtx") != std::string::npos) score += 80;
    if (name.find("radeon") != std::string::npos || name.find("rx ") != std::string::npos) score += 100;
    if (name.find("arc") != std::string::npos) score += 70;
    if (!adapter.driverVersion.empty()) score += 5;
    if (adapter.source == "dxgi") score += 30;

    return score;
}

std::vector<GpuAdapterInfo> EnumerateDxgiAdapters()
{
    std::vector<GpuAdapterInfo> adapters;

    wil::com_ptr<IDXGIFactory1> factory;
    HRESULT hr = CreateDXGIFactory1(IID_PPV_ARGS(factory.put()));
    if (FAILED(hr) || !factory)
    {
        return adapters;
    }

    for (UINT index = 0;; ++index)
    {
        wil::com_ptr<IDXGIAdapter1> adapter;
        hr = factory->EnumAdapters1(index, adapter.put());
        if (hr == DXGI_ERROR_NOT_FOUND)
        {
            break;
        }
        if (FAILED(hr) || !adapter)
        {
            continue;
        }

        DXGI_ADAPTER_DESC1 desc{};
        if (FAILED(adapter->GetDesc1(&desc)))
        {
            continue;
        }

        GpuAdapterInfo info;
        info.name = CleanHardwareString(toUtf8(desc.Description));
        info.vendorId = desc.VendorId;
        info.deviceId = desc.DeviceId;
        info.vendor = GpuVendorFromId(desc.VendorId);
        info.dedicatedVideoMemoryBytes = static_cast<std::uint64_t>(desc.DedicatedVideoMemory);
        info.adapterRamBytes = info.dedicatedVideoMemoryBytes;
        info.software = (desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) != 0;
        info.source = "dxgi";
        info.virtualAdapter = IsVirtualDisplayAdapter(info.name, info.pnpId, info.software);
        info.score = ScoreGpuAdapter(info);
        if (!info.name.empty())
        {
            adapters.push_back(std::move(info));
        }
    }

    return adapters;
}

std::optional<GpuAdapterInfo> ChooseBestGpuAdapter(std::vector<GpuAdapterInfo> adapters)
{
    if (adapters.empty())
    {
        return std::nullopt;
    }

    for (auto& adapter : adapters)
    {
        adapter.virtualAdapter = IsVirtualDisplayAdapter(adapter.name, adapter.pnpId, adapter.software);
        if (adapter.vendor.empty())
        {
            adapter.vendor = GpuVendorFromText(adapter.name + " " + adapter.pnpId);
        }
        adapter.score = ScoreGpuAdapter(adapter);
    }

    const auto less = [](const GpuAdapterInfo& lhs, const GpuAdapterInfo& rhs)
    {
        if (lhs.virtualAdapter != rhs.virtualAdapter)
        {
            return lhs.virtualAdapter && !rhs.virtualAdapter;
        }
        if (lhs.software != rhs.software)
        {
            return lhs.software && !rhs.software;
        }
        if (lhs.score != rhs.score)
        {
            return lhs.score < rhs.score;
        }
        return lhs.dedicatedVideoMemoryBytes < rhs.dedicatedVideoMemoryBytes;
    };

    const auto best = std::max_element(adapters.begin(), adapters.end(), less);
    if (best == adapters.end())
    {
        return std::nullopt;
    }
    return *best;
}

} // namespace vrcsm::core::hw
