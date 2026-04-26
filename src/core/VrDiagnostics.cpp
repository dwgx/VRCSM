#include "VrDiagnostics.h"
#include "SteamVrConfig.h"

#include <algorithm>
#include <fstream>
#include <string>

#include <WinSock2.h>
#include <WS2tcpip.h>
#include <Windows.h>
#include <iphlpapi.h>
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
            catch (...) {}
        }
        if (std::regex_search(l, m, kLatency))
        {
            try
            {
                const double v = std::stod(m[1].str());
                if (v > s.maxLatencyMs) s.maxLatencyMs = v;
            }
            catch (...) {}
        }
    }
    if (bitrateCount > 0) s.avgBitrateMbps = bitrateSum / bitrateCount;
    return s;
}

} // namespace

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
        if (a.isVirtual && a.isUp && !a.ipAddress.empty())
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
            auto hw = SteamVrConfig::ExtractHardwareInfo(doc);
            r.hmdModel = hw.hmdModel;
            r.hmdDriver = hw.hmdDriver;

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
                    catch (...) {}
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
