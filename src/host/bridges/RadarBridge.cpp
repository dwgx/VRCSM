#include "../../pch.h"
#include "BridgeCommon.h"

#include "../../core/ProcessMemoryReader.h"
#include "../../core/VrcRadarEngine.h"

nlohmann::json IpcBridge::HandleMemoryStatus(const nlohmann::json& params, const std::optional<std::string>& id)
{
    (void)params;
    (void)id;

    vrcsm::core::ProcessMemoryReader memoryReader(L"VRChat.exe");
    bool attached = memoryReader.Attach();
    uint64_t vrcBase = 0;
    uint64_t gaBase = 0;

    if (attached) {
        vrcBase = memoryReader.GetModuleBase(L"VRChat.exe");
        gaBase = memoryReader.GetModuleBase(L"GameAssembly.dll");
        memoryReader.Detach();
    }

    return nlohmann::json{
        {"attached", attached},
        {"vrcBase", vrcBase},
        {"gaBase", gaBase}
    };
}

nlohmann::json IpcBridge::HandleRadarPoll(const nlohmann::json& params, const std::optional<std::string>& id)
{
    (void)params;
    (void)id;

    auto snap = m_radarEngine.PollOnce();

    nlohmann::json playersArr = nlohmann::json::array();
    for (const auto& p : snap.players) {
        playersArr.push_back({
            {"actorNumber", p.actorNumber},
            {"displayName", p.displayName},
            {"userId",      p.userId},
            {"isLocal",     p.isLocal},
            {"isMaster",    p.isMaster},
            {"posX",        p.posX},
            {"posY",        p.posY},
            {"posZ",        p.posZ},
        });
    }

    return nlohmann::json{
        {"attached",   snap.vrcAttached},
        {"vrcBase",    snap.vrcBase},
        {"gaBase",     snap.gaBase},
        {"players",    playersArr},
        {"instanceId", snap.instanceId},
        {"worldId",    snap.worldId},
    };
}
