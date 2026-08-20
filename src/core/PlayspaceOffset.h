#pragma once

#include "Common.h"

#include <atomic>
#include <chrono>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <filesystem>
#include <string>
#include <thread>
#include <vector>

#include <nlohmann/json.hpp>

namespace vrcsm::core
{

inline constexpr float kPlayspaceNudgeLimitM = 0.25f;
inline constexpr float kPlayspaceSessionLimitM = 5.0f;
inline constexpr float kPlayspaceStickDeadzone = 0.15f;
inline constexpr float kPlayspaceDefaultSpeedMps = 1.5f;
inline constexpr float kPlayspaceGripThreshold = 0.7f;
inline constexpr int kPlayspaceDualGripResetMs = 400;
inline constexpr int kPlayspaceInitTimeoutMs = 3000;

enum class PlayspaceState
{
    Idle,
    Ready,
    Active,
    SteamVrNotRunning,
    Error,
};

const char* PlayspaceStateToString(PlayspaceState state) noexcept;

struct PlayspaceVec3
{
    float x{0};
    float y{0};
    float z{0};
};

struct PlayspaceLocks
{
    bool lockX{false};
    bool lockY{true};
    bool lockZ{false};
};

// OpenVR HmdMatrix34_t layout: row-major 3x4, rotation in the 3x3, translation in column 3.
struct PlayspaceMatrix34
{
    float m[3][4]{};
};

// Row-major 4x4 used for the standing-pose × translation multiply.
struct PlayspaceMat4
{
    float m[4][4]{};
};

struct PlayspaceStatus
{
    PlayspaceState state{PlayspaceState::Idle};
    std::string error;
    PlayspaceVec3 offset{};
    PlayspaceLocks locks{};
    std::string steamVrRuntime;
    bool gripHeld{false};
    bool offsetLimitHit{false};
};

struct PlayspaceControllerSample
{
    bool gripHeld{false};
    float stickX{0};
    float stickY{0};
};

struct PlayspaceSetParams
{
    std::optional<bool> lockX;
    std::optional<bool> lockY;
    std::optional<bool> lockZ;
    std::optional<float> dx;
    std::optional<float> dy;
    std::optional<float> dz;
    std::optional<float> speedMps;
};

void to_json(nlohmann::json& j, const PlayspaceVec3& v);
void to_json(nlohmann::json& j, const PlayspaceLocks& l);
void to_json(nlohmann::json& j, const PlayspaceStatus& s);

PlayspaceMat4 PlayspaceIdentity4();
PlayspaceMat4 PlayspaceTranslation4(float x, float y, float z);
PlayspaceMat4 PlayspaceMultiply4(const PlayspaceMat4& a, const PlayspaceMat4& b);
PlayspaceMat4 PlayspaceMat4From34(const PlayspaceMatrix34& pose);
PlayspaceMatrix34 PlayspaceMat4To34(const PlayspaceMat4& a);
PlayspaceMatrix34 PlayspaceIdentity34();
PlayspaceVec3 PlayspaceTranslationOf(const PlayspaceMatrix34& pose);

// standingToRaw * Translate(playspaceDelta). lockY is applied by the caller via ApplyLocks.
PlayspaceMatrix34 PlayspaceTranslateStanding(
    const PlayspaceMatrix34& standingToRaw,
    PlayspaceVec3 playspaceDelta);

PlayspaceVec3 PlayspaceApplyLocks(PlayspaceVec3 v, PlayspaceLocks locks);

// Rejects any component whose absolute value exceeds ±0.25 m.
Result<PlayspaceVec3> PlayspaceClampNudge(PlayspaceVec3 v);

// Rejects a step that would push |current+delta| above 5.0 m.
Result<PlayspaceVec3> PlayspaceClampSession(PlayspaceVec3 current, PlayspaceVec3 delta);

// Stick X → playspace X, stick Y → playspace Z. Radial deadzone, no rescale.
PlayspaceVec3 PlayspaceStickDelta(
    float stickX,
    float stickY,
    float dtSeconds,
    float speedMps,
    float deadzone = kPlayspaceStickDeadzone);

// Same file VrDiagnostics::ParseOpenVrPaths reads: %LOCALAPPDATA%\openvr\openvrpaths.vrpath
std::filesystem::path DefaultOpenVrPathsFile();
std::optional<std::filesystem::path> ResolveOpenVrRuntime(
    const std::filesystem::path& vrpathFile);
std::filesystem::path OpenVrApiDllPath(const std::filesystem::path& runtimeRoot);

class IPlayspaceBackend
{
public:
    virtual ~IPlayspaceBackend() = default;
    virtual Result<std::monostate> init() = 0;
    virtual void shutdown() = 0;
    virtual Result<PlayspaceMatrix34> getStandingPose() = 0;
    virtual Result<std::monostate> setStandingPose(const PlayspaceMatrix34& pose) = 0;
    virtual Result<std::monostate> commitLive() = 0;
    virtual std::vector<PlayspaceControllerSample> pollControllers() = 0;
    virtual std::string runtimePath() const { return {}; }
};

std::unique_ptr<IPlayspaceBackend> MakeSteamVrPlayspaceBackend();
std::unique_ptr<IPlayspaceBackend> MakeSteamVrPlayspaceBackend(
    std::filesystem::path vrpathFile);

class PlayspaceOffset
{
public:
    PlayspaceOffset();
    explicit PlayspaceOffset(std::unique_ptr<IPlayspaceBackend> backend);
    ~PlayspaceOffset();

    PlayspaceOffset(const PlayspaceOffset&) = delete;
    PlayspaceOffset& operator=(const PlayspaceOffset&) = delete;

    PlayspaceStatus status() const;
    nlohmann::json statusJson() const;

    // spawnWorker: grip/stick integration thread. Tests pass false and call tick().
    Result<PlayspaceStatus> start(bool spawnWorker = true);
    Result<PlayspaceStatus> stop();
    Result<PlayspaceLocks> setLocks(
        std::optional<bool> lockX,
        std::optional<bool> lockY,
        std::optional<bool> lockZ);
    Result<PlayspaceStatus> set(const PlayspaceSetParams& params);
    Result<PlayspaceVec3> nudge(float dx, float dy, float dz);
    Result<PlayspaceVec3> reset();
    Result<PlayspaceStatus> tick(float dtSeconds);

    using StatusCallback = std::function<void(const PlayspaceStatus&)>;
    void setStatusCallback(StatusCallback cb);

private:
    void stopWorker();
    void workerLoop();
    PlayspaceStatus snapshotLocked() const;
    Result<PlayspaceStatus> startLocked();
    Result<PlayspaceVec3> nudgeLocked(float dx, float dy, float dz);
    Result<PlayspaceVec3> resetLocked();
    Result<PlayspaceStatus> tickLocked(float dtSeconds);
    Result<std::monostate> writeAppliedLocked();

    mutable std::mutex m_mutex;
    std::unique_ptr<IPlayspaceBackend> m_backend;
    PlayspaceState m_state{PlayspaceState::Idle};
    std::string m_error;
    PlayspaceLocks m_locks{};
    PlayspaceVec3 m_applied{};
    PlayspaceMatrix34 m_base{};
    float m_speedMps{kPlayspaceDefaultSpeedMps};
    bool m_gripHeld{false};
    bool m_offsetLimitHit{false};
    bool m_inited{false};
    StatusCallback m_statusCb;
    std::thread m_worker;
    std::atomic<bool> m_stopWorker{false};
    std::vector<std::uint8_t> m_prevGrip;
    std::vector<std::chrono::steady_clock::time_point> m_gripRiseAt;
};

} // namespace vrcsm::core
