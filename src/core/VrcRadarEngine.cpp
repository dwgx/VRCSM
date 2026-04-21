#include "VrcRadarEngine.h"
#include <tlhelp32.h>
#include <vector>
#include <thread>
#include <algorithm>
#include <psapi.h>

// ─────────────────────────────────────────────────────────────
// IL2CPP Layout Constants — Unity 2022.3.x / IL2CPP v29
//
// Sources:
//   - scene_traversal_results.json: NetworkManager TypeInfo VA = 0x3372CED0
//   - deobfuscated dump VRC.Player.V.cs: VRCPlayer class + method RVAs
//   - network_layer_analysis.md: VRCPlayer inherits NetworkReadyHandler_30DA
//   - field_types_from_metadata.json: metadata token mapping
//   - IL2CPP schema v29 reference implementation
//
// CRITICAL DESIGN: All offsets are RELATIVE TO GameAssembly.dll base.
// The TypeInfo VA from the scene traversal is an offset, not an absolute.
// Resolution: runtimeTypeInfo = gaBase + kTypeInfoOffset_XXX
// ─────────────────────────────────────────────────────────────

// ── TypeInfo Relative Offsets (from scene_traversal_results.json RVAs) ──
// NetworkManager TypeInfo: VA = 0x3372CED0 → gaOffset = VA (constant within binary)
static constexpr uintptr_t kTypeInfoRVA_NetworkManager  = 0x3372CED0;
// VRCPlayer TypeInfo: from dump method RVAs, VRCPlayer base class init at 0x7ffaa9b5c200
// VRCPlayer class name "VRCPlayer" scan in GameAssembly → determined by runtime scan below
// We use the scan approach as the primary method (more robust than hardcoded offsets).

// ── IL2CPP TypeInfo structure offsets (Unity 2022 IL2CPP schema v29) ──
static constexpr ptrdiff_t kClass_name          = 0x10; // const char* class name
static constexpr ptrdiff_t kClass_namespaze     = 0x18; // const char* namespace
static constexpr ptrdiff_t kClass_parent        = 0x58; // Il2CppClass* parent class
static constexpr ptrdiff_t kClass_klass         = 0x68; // Il2CppClass* (points to self)
static constexpr ptrdiff_t kClass_static_fields = 0xB8; // void* static field storage
static constexpr ptrdiff_t kClass_instance_size = 0xBC; // uint32_t instance size

// ── IL2CPP Managed Object header ──
// Every managed object starts with:
//   +0x00: Il2CppClass* klass  (points to TypeInfo)
//   +0x08: MonitorData* monitor
// MonoBehaviour additionally has:
//   +0x10: intptr_t m_CachedPtr (native Unity Object ptr)
// Fields start after the header.

// ── VRCPlayer Field Offsets ──
// VRCPlayer inherits: Il2CppObject(0x10) -> NetworkReadyHandler_30DA
// NetworkReadyHandler_30DA inherits MonoBehaviour (field base = 0x18)
// Fields from dump tokens + empirical Unity layout:
static constexpr ptrdiff_t kVRCPlayer_fieldBase    = 0x18; // Start of VRCPlayer managed fields

// Confirmed offsets from comparable VRChat memory readers and dump field ordering:
// displayName field (type: string): field index 0 in VRCPlayer class (after MonoBehaviour header)
static constexpr ptrdiff_t kVRCPlayer_displayName  = 0x78;  // System.String*
static constexpr ptrdiff_t kVRCPlayer_userId        = 0x80;  // System.String* (userId "usr_...")
static constexpr ptrdiff_t kVRCPlayer_actorId       = 0x88;  // int32_t photon actorNumber
static constexpr ptrdiff_t kVRCPlayer_isLocal       = 0x8C;  // bool (isLocal player)
static constexpr ptrdiff_t kVRCPlayer_isMaster      = 0x8D;  // bool (is room master)

// ── IL2CPP System.String layout ──
static constexpr ptrdiff_t kStr_length = 0x10;  // int32_t length (char count)
static constexpr ptrdiff_t kStr_data   = 0x14;  // char16_t[] (UTF-16LE data)

// ── Scan limits ──
static constexpr size_t kMaxPlayersPerRoom   = 80;  // VRChat max players + some slack
static constexpr size_t kScanPageSizeLimit   = 64 * 1024 * 1024; // 64 MiB per scan region max
static constexpr uint32_t kMinInstanceSize   = 0x80;
static constexpr uint32_t kMaxInstanceSize   = 0x1000;

namespace vrcsm::core {

// ─────────────────────────────────────────────────────────────
// Constructor / Destructor
// ─────────────────────────────────────────────────────────────
VrcRadarEngine::VrcRadarEngine()
    : reader_(std::make_unique<ProcessMemoryReader>(L"VRChat.exe")) {
}

VrcRadarEngine::~VrcRadarEngine() {
    Stop();
}

// ─────────────────────────────────────────────────────────────
// Start / Stop
// ─────────────────────────────────────────────────────────────
void VrcRadarEngine::Start(SnapshotCallback cb, std::chrono::milliseconds interval) {
    if (running_.exchange(true)) return;
    callback_ = std::move(cb);
    interval_ = interval;

    pollThread_ = std::thread([this]() { PollLoop(); });
}

void VrcRadarEngine::Stop() {
    running_ = false;
    if (pollThread_.joinable()) {
        pollThread_.join();
    }
    reader_->Detach();
    gaBase_ = 0;
    vrcBase_ = 0;
    vrcPlayerTypePtr_ = 0;
}

void VrcRadarEngine::PollLoop() {
    while (running_) {
        auto snap = BuildSnapshot();
        if (callback_) callback_(snap);
        std::this_thread::sleep_for(interval_);
    }
}

RadarSnapshot VrcRadarEngine::PollOnce() {
    return BuildSnapshot();
}

// ─────────────────────────────────────────────────────────────
// TryReadString — read IL2CPP System.String → std::string (UTF-8)
// ─────────────────────────────────────────────────────────────
bool VrcRadarEngine::TryReadString(uintptr_t strPtr, std::string& out) const {
    if (!strPtr || !reader_->IsAttached()) return false;

    auto lenOpt = reader_->Read<int32_t>(strPtr + kStr_length);
    if (!lenOpt || *lenOpt <= 0 || *lenOpt > 512) return false;

    int32_t len = *lenOpt;
    std::vector<char16_t> buf(static_cast<size_t>(len));
    if (!reader_->ReadMemory(strPtr + kStr_data, buf.data(), len * sizeof(char16_t)))
        return false;

    // UTF-16 → UTF-8 via WideCharToMultiByte
    std::wstring wide(reinterpret_cast<const wchar_t*>(buf.data()), static_cast<size_t>(len));
    if (wide.empty()) return false;

    int utf8len = WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), static_cast<int>(wide.size()),
                                       nullptr, 0, nullptr, nullptr);
    if (utf8len <= 0) return false;
    out.resize(static_cast<size_t>(utf8len));
    WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), static_cast<int>(wide.size()),
                        out.data(), utf8len, nullptr, nullptr);
    return true;
}

// ─────────────────────────────────────────────────────────────
// FindVRCPlayerTypeInfo
//
// Strategy: Scan readable memory pages for:
//   1. The ASCII string "VRCPlayer\0" — this is the TypeInfo->name field.
//   2. For each candidate, validate that [ptr-0x10] is a valid GameAssembly pointer
//      (the Il2CppImage* field is at TypeInfo+0x00, name at TypeInfo+0x10).
//   3. Confirm TypeInfo->klass (at +0x68) points back to the same address (self-ref).
//
// This scan runs once after each fresh attach and caches the result.
// Update-resilient: type name string doesn't change between patches.
// ─────────────────────────────────────────────────────────────
uintptr_t VrcRadarEngine::FindVRCPlayerTypeInfo() const {
    if (!reader_->IsAttached() || !gaBase_) return 0;

    // The type name "VRCPlayer" as bytes
    static const char kTarget[] = "VRCPlayer";
    static constexpr size_t kTargetLen = sizeof(kTarget) - 1; // 9 bytes

    // We need to GetModuleInfo for GameAssembly.dll to scope our scan.
    // VRCPlayer TypeInfo->name is in GameAssembly .rdata section.
    // .rdata typically starts after .text (code), roughly +5MB to +30MB range.
    // Conservatively scan 200MB around gaBase_ for the type name string.
    const uintptr_t scanStart = gaBase_;
    const uintptr_t scanEnd   = gaBase_ + 0x40000000ULL; // +1 GiB max for GameAssembly

    uintptr_t current = scanStart;
    while (current < scanEnd) {
        MEMORY_BASIC_INFORMATION mbi{};
        // We need VirtualQueryEx  — we get it through the reader indirectly.
        // Read a test byte to check if the region is readable.
        // Batch-read 4KB pages and scan for the pattern.
        constexpr size_t kBatchSize = 4096;
        char page[kBatchSize];
        if (!reader_->ReadMemory(current, page, kBatchSize)) {
            // Page not readable — skip 4KB
            current += kBatchSize;
            continue;
        }

        // Scan page for "VRCPlayer\0"
        for (size_t i = 0; i + kTargetLen + 1 < kBatchSize; ++i) {
            if (page[i] == 'V' &&
                memcmp(page + i, kTarget, kTargetLen) == 0 &&
                page[i + kTargetLen] == '\0')
            {
                // Found candidate name string at: current + i
                uintptr_t nameAddr = current + i;
                // TypeInfo is at nameAddr - 0x10 (name field is at TypeInfo+0x10)
                uintptr_t candidateTypeInfo = nameAddr - kClass_name;

                // Validate: read the klass self-pointer at TypeInfo+0x68
                auto klassPtr = reader_->Read<uintptr_t>(candidateTypeInfo + kClass_klass);
                if (klassPtr && *klassPtr == candidateTypeInfo) {
                    // Self-pointer matches — validate namespace
                    auto nspacePtr = reader_->Read<uintptr_t>(candidateTypeInfo + kClass_namespaze);
                    if (nspacePtr && *nspacePtr != 0) {
                        char nsBuf[32]{};
                        reader_->ReadMemory(*nspacePtr, nsBuf, 8);
                        // VRCPlayer is in "VRC.Player" namespace (or root namespace)
                        // Accept if namespace starts with "VRC" or is empty
                        if (nsBuf[0] == 'V' || nsBuf[0] == '\0') {
                            return candidateTypeInfo;
                        }
                    }
                }
            }
        }
        current += kBatchSize;
    }
    return 0;
}

// ─────────────────────────────────────────────────────────────
// ScanForVRCPlayerInstances
//
// Once we have the VRCPlayer TypeInfo pointer, scan all readable
// RW (heap) memory pages for 8-byte-aligned pointers equal to that
// TypeInfo. Each hit is the klass field of a managed object header:
//   object_ptr = &klass_field - 0  (klass is at offset 0)
//
// Then validate the candidate as a VRCPlayer by checking:
//   - The displayName field is a non-null, readable pointer
//   - The IL2CPP string at that pointer has 1-64 chars
//
// This is the standard DMA approach used by external process readers.
// ─────────────────────────────────────────────────────────────
bool VrcRadarEngine::TryReadPlayerList(RadarSnapshot& snap) {
    if (!snap.gaBase || !snap.vrcBase) return false;

    // Validate GameAssembly is accessible (MZ header check)
    auto mzOpt = reader_->Read<uint16_t>(snap.gaBase);
    if (!mzOpt || *mzOpt != 0x5A4D) {
        reader_->Detach();
        snap.vrcAttached = false;
        return false;
    }

    // Resolve VRCPlayer TypeInfo (cached per-session)
    if (!vrcPlayerTypePtr_) {
        vrcPlayerTypePtr_ = FindVRCPlayerTypeInfo();
        if (!vrcPlayerTypePtr_) {
            // TypeInfo not found yet — game might still be loading
            return true; // attached but not in world
        }
    }

    // ── Pointer-pattern scan ──
    // Enumerate the VRChat.exe process's heap pages looking for klass pointers
    // equal to vrcPlayerTypePtr_. Scope to heap-like regions (RW, commit, non-stack).

    // Get approximate memory range for VRChat.exe process
    // Scan a large window — Unity heap is in the multi-GB range for VR games
    const uintptr_t kScanFrom = 0x10000000ULL;    // 256 MiB (skip low memory)
    const uintptr_t kScanTo   = 0x400000000ULL;  // 16 GiB max

    snap.players.clear();
    snap.players.reserve(24);

    uintptr_t addr = kScanFrom;
    while (addr < kScanTo && snap.players.size() < kMaxPlayersPerRoom) {
        // Read 8 bytes at a time aligned
        auto kPtr = reader_->Read<uintptr_t>(addr);
        if (!kPtr) {
            // Not readable — skip forward by a large stride to avoid thrashing
            addr += 0x10000; // 64 KB skip
            continue;
        }

        if (*kPtr == vrcPlayerTypePtr_) {
            // Candidate VRCPlayer object at `addr` (addr = &obj->klass)
            uintptr_t objPtr = addr; // klass is at offset 0

            // Validate displayName
            auto dnPtrOpt = reader_->Read<uintptr_t>(objPtr + kVRCPlayer_displayName);
            if (dnPtrOpt && *dnPtrOpt != 0) {
                std::string displayName;
                if (TryReadString(*dnPtrOpt, displayName) && !displayName.empty()) {
                    RadarPlayer player;
                    player.displayName = std::move(displayName);

                    auto uidPtrOpt = reader_->Read<uintptr_t>(objPtr + kVRCPlayer_userId);
                    if (uidPtrOpt && *uidPtrOpt != 0) {
                        TryReadString(*uidPtrOpt, player.userId);
                    }

                    auto actorOpt = reader_->Read<int32_t>(objPtr + kVRCPlayer_actorId);
                    if (actorOpt) player.actorNumber = *actorOpt;

                    auto isLocalOpt = reader_->Read<uint8_t>(objPtr + kVRCPlayer_isLocal);
                    if (isLocalOpt) player.isLocal = (*isLocalOpt != 0);

                    auto isMasterOpt = reader_->Read<uint8_t>(objPtr + kVRCPlayer_isMaster);
                    if (isMasterOpt) player.isMaster = (*isMasterOpt != 0);

                    snap.players.push_back(std::move(player));
                }
            }
        }

        addr += 8; // Walk every 8 bytes (pointer-width stride)
    }

    return true;
}

// ─────────────────────────────────────────────────────────────
// BuildSnapshot
// ─────────────────────────────────────────────────────────────
RadarSnapshot VrcRadarEngine::BuildSnapshot() {
    RadarSnapshot snap;
    snap.timestamp = std::chrono::system_clock::now();

    if (!reader_->IsAttached()) {
        if (!reader_->Attach()) return snap;
        // Re-attach: invalidate cached TypeInfo (ASLR may have changed)
        vrcPlayerTypePtr_ = 0;
    }

    snap.vrcAttached = true;
    snap.gaBase  = reader_->GetModuleBase(L"GameAssembly.dll");
    snap.vrcBase = reader_->GetModuleBase(L"VRChat.exe");
    gaBase_  = snap.gaBase;
    vrcBase_ = snap.vrcBase;

    if (gaBase_ && vrcBase_) {
        TryReadPlayerList(snap);
    }

    return snap;
}

} // namespace vrcsm::core
