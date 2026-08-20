#include "PlayspaceOffset.h"

#include <chrono>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iterator>

#include <Windows.h>

#include <fmt/format.h>
#include <spdlog/spdlog.h>

namespace vrcsm::core
{

namespace
{

constexpr float kEps = 1e-6f;
constexpr uint64_t kButtonGripMask = 1ull << 2;
constexpr int kChaperoneLive = 1; // EChaperoneConfigFile_Live
constexpr int kAppUtility = 4;    // VRApplication_Utility
constexpr int kAppOverlay = 2;    // VRApplication_Overlay
constexpr uint32_t kMaxTrackedDevices = 64;
constexpr int kGetControllerStateIndex = 37; // FnTable:IVRSystem_026

Error MakeError(const char* code, const std::string& message)
{
    return Error{code, message, 0};
}

float VecLength(PlayspaceVec3 v)
{
    return std::sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

PlayspaceVec3 VecAdd(PlayspaceVec3 a, PlayspaceVec3 b)
{
    return {a.x + b.x, a.y + b.y, a.z + b.z};
}

bool ComponentExceeds(float v, float limit)
{
    return std::fabs(v) > limit + kEps;
}

std::string ReadAllUtf8(const std::filesystem::path& path)
{
    std::ifstream in(path, std::ios::binary);
    if (!in) return {};
    return std::string(std::istreambuf_iterator<char>(in), {});
}

#pragma pack(push, 8)
struct OpenVrControllerAxis
{
    float x;
    float y;
};

struct OpenVrControllerState
{
    uint32_t unPacketNum;
    uint64_t ulButtonPressed;
    uint64_t ulButtonTouched;
    OpenVrControllerAxis rAxis[5];
};
#pragma pack(pop)

struct OpenVrMatrix34
{
    float m[3][4];
};

struct ChaperoneSetupFnTable
{
    bool(__stdcall* CommitWorkingCopy)(int configFile);
    void(__stdcall* RevertWorkingCopy)();
    bool(__stdcall* GetWorkingPlayAreaSize)(float*, float*);
    bool(__stdcall* GetWorkingPlayAreaRect)(void*);
    bool(__stdcall* GetWorkingCollisionBoundsInfo)(void*, uint32_t*);
    bool(__stdcall* GetLiveCollisionBoundsInfo)(void*, uint32_t*);
    bool(__stdcall* GetWorkingSeatedZeroPoseToRawTrackingPose)(OpenVrMatrix34*);
    bool(__stdcall* GetWorkingStandingZeroPoseToRawTrackingPose)(OpenVrMatrix34*);
    void(__stdcall* SetWorkingPlayAreaSize)(float, float);
    void(__stdcall* SetWorkingCollisionBoundsInfo)(void*, uint32_t);
    void(__stdcall* SetWorkingPerimeter)(void*, uint32_t);
    void(__stdcall* SetWorkingSeatedZeroPoseToRawTrackingPose)(const OpenVrMatrix34*);
    void(__stdcall* SetWorkingStandingZeroPoseToRawTrackingPose)(const OpenVrMatrix34*);
};

using VrInitInternal2Fn = uint32_t(__cdecl*)(int* peError, int eApplicationType, const char* pStartupInfo);
using VrInitInternalFn = uint32_t(__cdecl*)(int* peError, int eApplicationType);
using VrShutdownInternalFn = void(__cdecl*)();
using VrGetGenericInterfaceFn = void*(__cdecl*)(const char* pchInterfaceVersion, int* peError);
using VrGetErrorDescFn = const char*(__cdecl*)(int error);
using VrGetControllerStateFn = bool(__stdcall*)(
    uint32_t index, OpenVrControllerState* state, uint32_t size);

PlayspaceMatrix34 FromOpenVr(const OpenVrMatrix34& src)
{
    PlayspaceMatrix34 out{};
    for (int r = 0; r < 3; ++r)
        for (int c = 0; c < 4; ++c)
            out.m[r][c] = src.m[r][c];
    return out;
}

OpenVrMatrix34 ToOpenVr(const PlayspaceMatrix34& src)
{
    OpenVrMatrix34 out{};
    for (int r = 0; r < 3; ++r)
        for (int c = 0; c < 4; ++c)
            out.m[r][c] = src.m[r][c];
    return out;
}

class SteamVrPlayspaceBackend final : public IPlayspaceBackend
{
public:
    explicit SteamVrPlayspaceBackend(std::filesystem::path vrpathFile)
        : m_vrpathFile(std::move(vrpathFile))
    {
    }

    ~SteamVrPlayspaceBackend() override { shutdown(); }

    Result<std::monostate> init() override
    {
        shutdown();

        const auto vrpath = m_vrpathFile.empty() ? DefaultOpenVrPathsFile() : m_vrpathFile;
        auto runtime = ResolveOpenVrRuntime(vrpath);
        if (!runtime)
        {
            return MakeError("steamvr_not_running", "openvrpaths.vrpath runtime[0] is missing");
        }
        m_runtime = toUtf8(runtime->wstring());

        const auto dll = OpenVrApiDllPath(*runtime);
        std::error_code ec;
        if (!std::filesystem::exists(dll, ec) || ec)
        {
            return MakeError(
                "steamvr_not_running",
                fmt::format("openvr_api.dll not found at {}", toUtf8(dll.wstring())));
        }

        m_module = LoadLibraryExW(dll.c_str(), nullptr, LOAD_WITH_ALTERED_SEARCH_PATH);
        if (!m_module)
        {
            return MakeError(
                "steamvr_not_running",
                fmt::format("LoadLibrary openvr_api.dll failed ({})", GetLastError()));
        }

        m_init2 = reinterpret_cast<VrInitInternal2Fn>(GetProcAddress(m_module, "VR_InitInternal2"));
        m_init1 = reinterpret_cast<VrInitInternalFn>(GetProcAddress(m_module, "VR_InitInternal"));
        m_shutdown = reinterpret_cast<VrShutdownInternalFn>(GetProcAddress(m_module, "VR_ShutdownInternal"));
        m_getIface = reinterpret_cast<VrGetGenericInterfaceFn>(
            GetProcAddress(m_module, "VR_GetGenericInterface"));
        m_errorDesc = reinterpret_cast<VrGetErrorDescFn>(
            GetProcAddress(m_module, "VR_GetVRInitErrorAsEnglishDescription"));

        if ((!m_init2 && !m_init1) || !m_shutdown || !m_getIface)
        {
            FreeLibrary(m_module);
            m_module = nullptr;
            return MakeError("steamvr_not_running", "openvr_api.dll is missing VR_Init/Shutdown exports");
        }

        int err = 1;
        const auto t0 = std::chrono::steady_clock::now();
        if (!CallInit(kAppUtility, &err))
        {
            CallInit(kAppOverlay, &err);
        }
        const auto elapsed = std::chrono::steady_clock::now() - t0;
        if (err != 0 || elapsed > std::chrono::milliseconds(kPlayspaceInitTimeoutMs))
        {
            if (m_vrInited)
            {
                m_shutdown();
                m_vrInited = false;
            }
            const char* desc = m_errorDesc ? m_errorDesc(err) : nullptr;
            return MakeError(
                "steamvr_not_running",
                desc && desc[0] ? desc : "OpenVR VR_Init failed");
        }
        m_vrInited = true;

        int ifaceErr = 0;
        m_chaperone = static_cast<ChaperoneSetupFnTable*>(
            m_getIface("FnTable:IVRChaperoneSetup_006", &ifaceErr));
        if (!m_chaperone || !m_chaperone->GetWorkingStandingZeroPoseToRawTrackingPose ||
            !m_chaperone->SetWorkingStandingZeroPoseToRawTrackingPose ||
            !m_chaperone->CommitWorkingCopy)
        {
            shutdown();
            return MakeError("steamvr_not_running", "IVRChaperoneSetup_006 is unavailable");
        }

        ifaceErr = 0;
        void** sysTable = static_cast<void**>(m_getIface("FnTable:IVRSystem_026", &ifaceErr));
        if (sysTable)
        {
            m_getControllerState = reinterpret_cast<VrGetControllerStateFn>(sysTable[kGetControllerStateIndex]);
        }

        return std::monostate{};
    }

    void shutdown() override
    {
        m_chaperone = nullptr;
        m_getControllerState = nullptr;
        if (m_vrInited && m_shutdown)
        {
            m_shutdown();
        }
        m_vrInited = false;
        if (m_module)
        {
            FreeLibrary(m_module);
            m_module = nullptr;
        }
        m_init2 = nullptr;
        m_init1 = nullptr;
        m_shutdown = nullptr;
        m_getIface = nullptr;
        m_errorDesc = nullptr;
    }

    Result<PlayspaceMatrix34> getStandingPose() override
    {
        if (!m_chaperone || !m_chaperone->GetWorkingStandingZeroPoseToRawTrackingPose)
        {
            return MakeError("steamvr_not_running", "chaperone setup is not initialized");
        }
        OpenVrMatrix34 mat{};
        if (!m_chaperone->GetWorkingStandingZeroPoseToRawTrackingPose(&mat))
        {
            return MakeError("error", "GetWorkingStandingZeroPoseToRawTrackingPose failed");
        }
        return FromOpenVr(mat);
    }

    Result<std::monostate> setStandingPose(const PlayspaceMatrix34& pose) override
    {
        if (!m_chaperone || !m_chaperone->SetWorkingStandingZeroPoseToRawTrackingPose)
        {
            return MakeError("steamvr_not_running", "chaperone setup is not initialized");
        }
        auto mat = ToOpenVr(pose);
        m_chaperone->SetWorkingStandingZeroPoseToRawTrackingPose(&mat);
        return std::monostate{};
    }

    Result<std::monostate> commitLive() override
    {
        if (!m_chaperone || !m_chaperone->CommitWorkingCopy)
        {
            return MakeError("steamvr_not_running", "chaperone setup is not initialized");
        }
        if (!m_chaperone->CommitWorkingCopy(kChaperoneLive))
        {
            return MakeError("error", "CommitWorkingCopy(Live) failed");
        }
        return std::monostate{};
    }

    std::vector<PlayspaceControllerSample> pollControllers() override
    {
        std::vector<PlayspaceControllerSample> out;
        if (!m_getControllerState) return out;
        for (uint32_t i = 1; i < kMaxTrackedDevices; ++i)
        {
            OpenVrControllerState state{};
            if (!m_getControllerState(i, &state, static_cast<uint32_t>(sizeof(state))))
            {
                continue;
            }
            const bool gripButton = (state.ulButtonPressed & kButtonGripMask) != 0;
            const bool gripAnalog = state.rAxis[2].x >= kPlayspaceGripThreshold;
            PlayspaceControllerSample sample;
            sample.gripHeld = gripButton || gripAnalog;
            sample.stickX = state.rAxis[0].x;
            sample.stickY = state.rAxis[0].y;
            out.push_back(sample);
        }
        return out;
    }

    std::string runtimePath() const override { return m_runtime; }

private:
    bool CallInit(int appType, int* err)
    {
        *err = 1;
        if (m_init2)
        {
            m_init2(err, appType, nullptr);
            return *err == 0;
        }
        if (m_init1)
        {
            m_init1(err, appType);
            return *err == 0;
        }
        return false;
    }

    std::filesystem::path m_vrpathFile;
    std::string m_runtime;
    HMODULE m_module{nullptr};
    bool m_vrInited{false};
    VrInitInternal2Fn m_init2{nullptr};
    VrInitInternalFn m_init1{nullptr};
    VrShutdownInternalFn m_shutdown{nullptr};
    VrGetGenericInterfaceFn m_getIface{nullptr};
    VrGetErrorDescFn m_errorDesc{nullptr};
    ChaperoneSetupFnTable* m_chaperone{nullptr};
    VrGetControllerStateFn m_getControllerState{nullptr};
};

} // namespace

const char* PlayspaceStateToString(PlayspaceState state) noexcept
{
    switch (state)
    {
    case PlayspaceState::Idle:
        return "idle";
    case PlayspaceState::Ready:
        return "ready";
    case PlayspaceState::Active:
        return "active";
    case PlayspaceState::SteamVrNotRunning:
        return "steamvr_not_running";
    case PlayspaceState::Error:
        return "error";
    }
    return "error";
}

void to_json(nlohmann::json& j, const PlayspaceVec3& v)
{
    j = nlohmann::json{{"x", v.x}, {"y", v.y}, {"z", v.z}};
}

void to_json(nlohmann::json& j, const PlayspaceLocks& l)
{
    j = nlohmann::json{{"lockX", l.lockX}, {"lockY", l.lockY}, {"lockZ", l.lockZ}};
}

void to_json(nlohmann::json& j, const PlayspaceStatus& s)
{
    j = nlohmann::json{
        {"state", PlayspaceStateToString(s.state)},
        {"offset", s.offset},
        {"locks", s.locks},
        {"gripHeld", s.gripHeld},
        {"offsetLimitHit", s.offsetLimitHit},
    };
    if (!s.error.empty()) j["error"] = s.error;
    if (!s.steamVrRuntime.empty()) j["steamVrRuntime"] = s.steamVrRuntime;
}

PlayspaceMat4 PlayspaceIdentity4()
{
    PlayspaceMat4 a{};
    a.m[0][0] = a.m[1][1] = a.m[2][2] = a.m[3][3] = 1.f;
    return a;
}

PlayspaceMat4 PlayspaceTranslation4(float x, float y, float z)
{
    auto a = PlayspaceIdentity4();
    a.m[0][3] = x;
    a.m[1][3] = y;
    a.m[2][3] = z;
    return a;
}

PlayspaceMat4 PlayspaceMultiply4(const PlayspaceMat4& a, const PlayspaceMat4& b)
{
    PlayspaceMat4 c{};
    for (int i = 0; i < 4; ++i)
    {
        for (int j = 0; j < 4; ++j)
        {
            c.m[i][j] = a.m[i][0] * b.m[0][j] + a.m[i][1] * b.m[1][j] +
                        a.m[i][2] * b.m[2][j] + a.m[i][3] * b.m[3][j];
        }
    }
    return c;
}

PlayspaceMat4 PlayspaceMat4From34(const PlayspaceMatrix34& pose)
{
    auto a = PlayspaceIdentity4();
    for (int r = 0; r < 3; ++r)
        for (int c = 0; c < 4; ++c)
            a.m[r][c] = pose.m[r][c];
    return a;
}

PlayspaceMatrix34 PlayspaceMat4To34(const PlayspaceMat4& a)
{
    PlayspaceMatrix34 pose{};
    for (int r = 0; r < 3; ++r)
        for (int c = 0; c < 4; ++c)
            pose.m[r][c] = a.m[r][c];
    return pose;
}

PlayspaceMatrix34 PlayspaceIdentity34()
{
    return PlayspaceMat4To34(PlayspaceIdentity4());
}

PlayspaceVec3 PlayspaceTranslationOf(const PlayspaceMatrix34& pose)
{
    return {pose.m[0][3], pose.m[1][3], pose.m[2][3]};
}

PlayspaceMatrix34 PlayspaceTranslateStanding(
    const PlayspaceMatrix34& standingToRaw,
    PlayspaceVec3 playspaceDelta)
{
    const auto a = PlayspaceMat4From34(standingToRaw);
    const auto t = PlayspaceTranslation4(playspaceDelta.x, playspaceDelta.y, playspaceDelta.z);
    return PlayspaceMat4To34(PlayspaceMultiply4(a, t));
}

PlayspaceVec3 PlayspaceApplyLocks(PlayspaceVec3 v, PlayspaceLocks locks)
{
    if (locks.lockX) v.x = 0;
    if (locks.lockY) v.y = 0;
    if (locks.lockZ) v.z = 0;
    return v;
}

Result<PlayspaceVec3> PlayspaceClampNudge(PlayspaceVec3 v)
{
    if (ComponentExceeds(v.x, kPlayspaceNudgeLimitM) ||
        ComponentExceeds(v.y, kPlayspaceNudgeLimitM) ||
        ComponentExceeds(v.z, kPlayspaceNudgeLimitM))
    {
        return MakeError("invalid_params", "nudge exceeds ±0.25 m per axis");
    }
    return v;
}

Result<PlayspaceVec3> PlayspaceClampSession(PlayspaceVec3 current, PlayspaceVec3 delta)
{
    const auto proposed = VecAdd(current, delta);
    if (VecLength(proposed) > kPlayspaceSessionLimitM + kEps)
    {
        return MakeError("offset_limit", "playspace offset exceeds 5.0 m");
    }
    return proposed;
}

PlayspaceVec3 PlayspaceStickDelta(
    float stickX,
    float stickY,
    float dtSeconds,
    float speedMps,
    float deadzone)
{
    const float mag = std::sqrt(stickX * stickX + stickY * stickY);
    if (mag < deadzone || dtSeconds <= 0.f || speedMps <= 0.f)
    {
        return {};
    }
    return {stickX * speedMps * dtSeconds, 0.f, stickY * speedMps * dtSeconds};
}

std::filesystem::path DefaultOpenVrPathsFile()
{
    auto localAppData = tryGetEnvPath(L"LOCALAPPDATA");
    if (!localAppData) return {};
    return *localAppData / L"openvr" / L"openvrpaths.vrpath";
}

std::optional<std::filesystem::path> ResolveOpenVrRuntime(const std::filesystem::path& vrpathFile)
{
    std::error_code ec;
    if (vrpathFile.empty() || !std::filesystem::exists(vrpathFile, ec) || ec)
    {
        return std::nullopt;
    }
    try
    {
        auto doc = nlohmann::json::parse(ReadAllUtf8(vrpathFile));
        const auto& runtime = doc.value("runtime", nlohmann::json::array());
        if (!runtime.is_array() || runtime.empty() || !runtime[0].is_string())
        {
            return std::nullopt;
        }
        const auto raw = runtime[0].get<std::string>();
        if (raw.empty()) return std::nullopt;
        return utf8Path(raw);
    }
    catch (const std::exception&)
    {
        return std::nullopt;
    }
}

std::filesystem::path OpenVrApiDllPath(const std::filesystem::path& runtimeRoot)
{
    auto primary = runtimeRoot / L"bin" / L"win64" / L"openvr_api.dll";
    std::error_code ec;
    if (std::filesystem::exists(primary, ec) && !ec) return primary;
    auto fallback = runtimeRoot / L"openvr_api.dll";
    if (std::filesystem::exists(fallback, ec) && !ec) return fallback;
    return primary;
}

std::unique_ptr<IPlayspaceBackend> MakeSteamVrPlayspaceBackend()
{
    return std::make_unique<SteamVrPlayspaceBackend>(std::filesystem::path{});
}

std::unique_ptr<IPlayspaceBackend> MakeSteamVrPlayspaceBackend(std::filesystem::path vrpathFile)
{
    return std::make_unique<SteamVrPlayspaceBackend>(std::move(vrpathFile));
}

PlayspaceOffset::PlayspaceOffset()
    : PlayspaceOffset(MakeSteamVrPlayspaceBackend())
{
}

PlayspaceOffset::PlayspaceOffset(std::unique_ptr<IPlayspaceBackend> backend)
    : m_backend(std::move(backend))
    , m_base(PlayspaceIdentity34())
    , m_prevGrip(kMaxTrackedDevices, 0)
    , m_gripRiseAt(kMaxTrackedDevices)
{
}

PlayspaceOffset::~PlayspaceOffset()
{
    stopWorker();
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_inited && m_backend)
    {
        m_backend->shutdown();
        m_inited = false;
    }
}

void PlayspaceOffset::stopWorker()
{
    m_stopWorker.store(true);
    if (m_worker.joinable())
    {
        m_worker.join();
    }
    m_stopWorker.store(false);
}

PlayspaceStatus PlayspaceOffset::snapshotLocked() const
{
    PlayspaceStatus s;
    s.state = m_state;
    s.error = m_error;
    s.offset = m_applied;
    s.locks = m_locks;
    s.gripHeld = m_gripHeld;
    s.offsetLimitHit = m_offsetLimitHit;
    if (m_backend) s.steamVrRuntime = m_backend->runtimePath();
    return s;
}

PlayspaceStatus PlayspaceOffset::status() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return snapshotLocked();
}

nlohmann::json PlayspaceOffset::statusJson() const
{
    return status();
}

Result<std::monostate> PlayspaceOffset::writeAppliedLocked()
{
    if (!m_backend || !m_inited)
    {
        return MakeError("steamvr_not_running", "playspace helper is not started");
    }
    const auto pose = PlayspaceTranslateStanding(m_base, m_applied);
    auto setRes = m_backend->setStandingPose(pose);
    if (!isOk(setRes)) return error(setRes);
    auto commitRes = m_backend->commitLive();
    if (!isOk(commitRes)) return error(commitRes);
    return std::monostate{};
}

void PlayspaceOffset::workerLoop()
{
    auto lastTick = std::chrono::steady_clock::now();
    auto lastPush = lastTick;
    while (!m_stopWorker.load())
    {
        const auto now = std::chrono::steady_clock::now();
        float dt = std::chrono::duration<float>(now - lastTick).count();
        lastTick = now;
        if (dt > 0.25f) dt = 0.02f;
        PlayspaceStatus snap{};
        StatusCallback cb;
        bool push = false;
        {
            std::lock_guard<std::mutex> lock(m_mutex);
            if (m_state == PlayspaceState::Ready || m_state == PlayspaceState::Active)
            {
                tickLocked(dt);
            }
            if (now - lastPush >= std::chrono::milliseconds(100) &&
                m_state == PlayspaceState::Active)
            {
                lastPush = now;
                snap = snapshotLocked();
                cb = m_statusCb;
                push = static_cast<bool>(cb);
            }
        }
        if (push) cb(snap);
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
}

Result<PlayspaceStatus> PlayspaceOffset::startLocked()
{
    if (m_state == PlayspaceState::Ready || m_state == PlayspaceState::Active)
    {
        return snapshotLocked();
    }

    if (!m_backend)
    {
        m_state = PlayspaceState::SteamVrNotRunning;
        m_error = "no OpenVR backend";
        return snapshotLocked();
    }

    auto initRes = m_backend->init();
    if (!isOk(initRes))
    {
        m_inited = false;
        m_state = PlayspaceState::SteamVrNotRunning;
        m_error = error(initRes).message;
        m_gripHeld = false;
        return snapshotLocked();
    }

    auto poseRes = m_backend->getStandingPose();
    if (!isOk(poseRes))
    {
        m_backend->shutdown();
        m_inited = false;
        m_state = PlayspaceState::SteamVrNotRunning;
        m_error = error(poseRes).message;
        return snapshotLocked();
    }

    m_inited = true;
    m_base = value(poseRes);
    m_applied = {};
    m_error.clear();
    m_gripHeld = false;
    m_offsetLimitHit = false;
    m_state = PlayspaceState::Ready;
    m_prevGrip.assign(kMaxTrackedDevices, 0);
    m_gripRiseAt.assign(kMaxTrackedDevices, {});
    return snapshotLocked();
}

Result<PlayspaceStatus> PlayspaceOffset::start(bool spawnWorker)
{
    Result<PlayspaceStatus> result;
    bool launch = false;
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        result = startLocked();
        launch = spawnWorker && isOk(result) &&
                 (value(result).state == PlayspaceState::Ready ||
                  value(result).state == PlayspaceState::Active) &&
                 !m_worker.joinable();
        if (launch) m_stopWorker.store(false);
    }
    if (launch)
    {
        m_worker = std::thread([this]() { workerLoop(); });
    }
    return result;
}

Result<PlayspaceStatus> PlayspaceOffset::stop()
{
    stopWorker();
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_inited && m_backend)
    {
        m_backend->shutdown();
    }
    m_inited = false;
    m_state = PlayspaceState::Idle;
    m_error.clear();
    m_gripHeld = false;
    m_offsetLimitHit = false;
    return snapshotLocked();
}

Result<PlayspaceLocks> PlayspaceOffset::setLocks(
    std::optional<bool> lockX,
    std::optional<bool> lockY,
    std::optional<bool> lockZ)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (lockX) m_locks.lockX = *lockX;
    if (lockY) m_locks.lockY = *lockY;
    if (lockZ) m_locks.lockZ = *lockZ;
    return m_locks;
}

Result<PlayspaceStatus> PlayspaceOffset::set(const PlayspaceSetParams& params)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (params.lockX) m_locks.lockX = *params.lockX;
    if (params.lockY) m_locks.lockY = *params.lockY;
    if (params.lockZ) m_locks.lockZ = *params.lockZ;
    if (params.speedMps)
    {
        if (*params.speedMps <= 0.f)
        {
            return MakeError("invalid_params", "speedMps must be positive");
        }
        m_speedMps = *params.speedMps;
    }
    if (params.dx || params.dy || params.dz)
    {
        auto nudged = nudgeLocked(params.dx.value_or(0.f), params.dy.value_or(0.f), params.dz.value_or(0.f));
        if (!isOk(nudged)) return error(nudged);
    }
    return snapshotLocked();
}

Result<PlayspaceVec3> PlayspaceOffset::nudgeLocked(float dx, float dy, float dz)
{
    if (m_state != PlayspaceState::Ready && m_state != PlayspaceState::Active)
    {
        return MakeError("steamvr_not_running", "playspace helper is not started");
    }
    auto clamped = PlayspaceClampNudge({dx, dy, dz});
    if (!isOk(clamped)) return clamped;
    auto delta = PlayspaceApplyLocks(value(clamped), m_locks);
    auto session = PlayspaceClampSession(m_applied, delta);
    if (!isOk(session))
    {
        m_offsetLimitHit = true;
        return session;
    }
    m_applied = value(session);
    auto wrote = writeAppliedLocked();
    if (!isOk(wrote))
    {
        m_state = PlayspaceState::Error;
        m_error = error(wrote).message;
        return error(wrote);
    }
    return m_applied;
}

Result<PlayspaceVec3> PlayspaceOffset::nudge(float dx, float dy, float dz)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return nudgeLocked(dx, dy, dz);
}

Result<PlayspaceVec3> PlayspaceOffset::resetLocked()
{
    m_applied = {};
    m_offsetLimitHit = false;
    if (m_inited && m_backend)
    {
        m_base = PlayspaceIdentity34();
        auto setRes = m_backend->setStandingPose(m_base);
        if (!isOk(setRes)) return error(setRes);
        auto commitRes = m_backend->commitLive();
        if (!isOk(commitRes)) return error(commitRes);
    }
    return m_applied;
}

Result<PlayspaceVec3> PlayspaceOffset::reset()
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return resetLocked();
}

Result<PlayspaceStatus> PlayspaceOffset::tickLocked(float dtSeconds)
{
    if (m_state != PlayspaceState::Ready && m_state != PlayspaceState::Active)
    {
        return snapshotLocked();
    }
    if (!m_backend || !m_inited)
    {
        m_state = PlayspaceState::SteamVrNotRunning;
        return snapshotLocked();
    }

    auto samples = m_backend->pollControllers();
    bool anyGrip = false;
    bool dualReset = false;
    const auto now = std::chrono::steady_clock::now();
    PlayspaceVec3 stick{};
    bool haveStick = false;

    for (std::size_t i = 0; i < samples.size(); ++i)
    {
        const bool held = samples[i].gripHeld;
        if (held) anyGrip = true;
        const bool rose = held && (i >= m_prevGrip.size() || m_prevGrip[i] == 0);
        if (i < m_prevGrip.size()) m_prevGrip[i] = held ? 1 : 0;
        if (rose)
        {
            if (i < m_gripRiseAt.size()) m_gripRiseAt[i] = now;
            for (std::size_t j = 0; j < m_gripRiseAt.size(); ++j)
            {
                if (j == i) continue;
                const auto at = m_gripRiseAt[j];
                if (at.time_since_epoch().count() == 0) continue;
                const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(now - at).count();
                if (ms >= 0 && ms <= kPlayspaceDualGripResetMs)
                {
                    dualReset = true;
                }
            }
        }
        if (held && !haveStick)
        {
            stick = {samples[i].stickX, 0.f, samples[i].stickY};
            haveStick = true;
        }
    }
    if (samples.size() < m_prevGrip.size())
    {
        for (std::size_t i = samples.size(); i < m_prevGrip.size(); ++i) m_prevGrip[i] = 0;
    }

    if (dualReset)
    {
        resetLocked();
        m_gripHeld = anyGrip;
        m_state = anyGrip ? PlayspaceState::Active : PlayspaceState::Ready;
        return snapshotLocked();
    }

    m_gripHeld = anyGrip;
    m_state = anyGrip ? PlayspaceState::Active : PlayspaceState::Ready;

    if (anyGrip && haveStick && dtSeconds > 0.f)
    {
        auto delta = PlayspaceStickDelta(stick.x, stick.z, dtSeconds, m_speedMps);
        delta = PlayspaceApplyLocks(delta, m_locks);
        if (VecLength(delta) > kEps)
        {
            auto session = PlayspaceClampSession(m_applied, delta);
            if (!isOk(session))
            {
                m_offsetLimitHit = true;
            }
            else
            {
                m_applied = value(session);
                auto wrote = writeAppliedLocked();
                if (!isOk(wrote))
                {
                    m_state = PlayspaceState::Error;
                    m_error = error(wrote).message;
                }
            }
        }
    }

    return snapshotLocked();
}

Result<PlayspaceStatus> PlayspaceOffset::tick(float dtSeconds)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return tickLocked(dtSeconds);
}

void PlayspaceOffset::setStatusCallback(StatusCallback cb)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    m_statusCb = std::move(cb);
}

} // namespace vrcsm::core
