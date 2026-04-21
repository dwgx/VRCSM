#pragma once

#include <windows.h>
#include <string>
#include <vector>
#include <optional>
#include <functional>
#include <mutex>
#include <atomic>
#include <chrono>
#include "ProcessMemoryReader.h"

namespace vrcsm::core {

// ─────────────────────────────────────────────────────────────
// Structures produced by the radar engine (safe to pass over IPC)
// ─────────────────────────────────────────────────────────────

struct RadarPlayer {
    int    actorNumber = 0;         // Photon actor ID
    std::string displayName;        // UTF-8 display name
    std::string userId;             // VRChat user ID (usr_...)
    bool   isLocal = false;         // Is this the local player?
    bool   isMaster = false;        // Is this the room master?
    float  posX = 0, posY = 0, posZ = 0; // World position
};

struct RadarSnapshot {
    bool                    vrcAttached = false;
    uint64_t                gaBase = 0;   // GameAssembly.dll base address
    uint64_t                vrcBase = 0;  // VRChat.exe base address  
    std::vector<RadarPlayer> players;
    std::string             instanceId;
    std::string             worldId;
    std::chrono::system_clock::time_point timestamp;
};

// ─────────────────────────────────────────────────────────────
// VrcRadarEngine
// Polls VRChat's Memory for live player/world state.
// Completely read-only — will not modify any process memory.
// ─────────────────────────────────────────────────────────────
class VrcRadarEngine {
public:
    using SnapshotCallback = std::function<void(const RadarSnapshot&)>;

    explicit VrcRadarEngine();
    ~VrcRadarEngine();

    // Disable copy
    VrcRadarEngine(const VrcRadarEngine&) = delete;
    VrcRadarEngine& operator=(const VrcRadarEngine&) = delete;

    // Start background polling
    void Start(SnapshotCallback cb, std::chrono::milliseconds interval = std::chrono::milliseconds(1000));
    void Stop();
    bool IsRunning() const { return running_; }

    // One-shot synchronous poll (used by IPC handler)
    RadarSnapshot PollOnce();

private:
    void PollLoop();
    RadarSnapshot BuildSnapshot();

    // IL2CPP class traversal helpers
    // These target the specific offsets extracted from our 97.7% deob dump.
    // All addresses are ASLR-adjusted at attach time via gaBase.
    bool TryResolveIL2CppClasses();
    bool TryReadPlayerList(RadarSnapshot& snap);
    bool TryReadString(uintptr_t strPtr, std::string& out) const;
    uintptr_t FindVRCPlayerTypeInfo() const;

    // Il2Cpp class type pointers (resolved once per attach)
    uintptr_t vrcPlayerTypePtr_ = 0;   // TypeInfo* for VRCPlayer class
    uintptr_t networkManagerPtr_ = 0;  // Static singleton pointer

    std::atomic<bool> running_{ false };
    std::unique_ptr<ProcessMemoryReader> reader_;
    SnapshotCallback callback_;
    std::chrono::milliseconds interval_;
    std::thread pollThread_;

    // Cached base addresses (ASLR-stable within a VRChat session)
    uint64_t gaBase_ = 0;
    uint64_t vrcBase_ = 0;
};

} // namespace vrcsm::core
