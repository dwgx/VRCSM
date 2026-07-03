# C++ Core Review — `src/core/**` (Read-Only Audit)

Date: 2026-07-01
Scope: pure-logic + safety-critical core and concurrency. Files already covered by other
passes (Migrator overflow/count-verify, CacheIndex, updater/UpdatePackage, VrcApi fetchInstance
percent-encode M1, Database, DiscordRpc, AvatarIdHarvest, LogAtoms UdonException test gap) were
NOT re-reviewed except for genuinely new issues; none found.

## Files read in full

- `src/core/SafeDelete.cpp` + `SafeDelete.h`
- `src/core/CacheScanner.cpp`
- `src/core/JunctionUtil.cpp`
- `src/core/PathProbe.cpp`
- `src/core/AuthStore.cpp`
- `src/core/BundleSniff.cpp`
- `src/core/UnityBundle.cpp` (full: ByteReader, decompress, parse + validate)
- `src/core/Common.cpp` + `Common.h` (`ensureWithinBase`, path conversion, `secureClearString`)
- `src/core/Pipeline.cpp` + `Pipeline.h`
- `src/core/LogTailer.cpp`
- `src/core/TaskQueue.cpp` + `TaskQueue.h`
- `src/core/ScreenshotWatcher.cpp`
- `src/core/VrcRadarEngine.cpp` + `VrcRadarEngine.h`
- `src/core/ProcessMemoryReader.cpp`
- `src/core/hw/HwTelemetry.cpp` (concurrency paths) + `src/core/hw/GpuProbe.cpp`

Cross-checked callers: `src/host/IpcBridge.cpp` (async dispatch / thread pool),
`src/host/bridges/RadarBridge.cpp`, `src/host/bridges/PipelineBridge.cpp`,
`src/core/VrcApi.cpp` (cache state, bundle-validate call sites).

---

## CRITICAL

None found.

---

## HIGH

### H1. Data race on `VrcRadarEngine` shared state / process HANDLE across threads

- File: `src/core/VrcRadarEngine.cpp:231-308` (`TryReadPlayerList`, calls `reader_->Detach()` at
  line 237), `:313-334` (`BuildSnapshot`, `reader_->Attach()` + writes `gaBase_/vrcBase_/vrcPlayerTypePtr_`),
  `src/core/ProcessMemoryReader.cpp:49-55` (`Detach` closes + nulls `hProcess_`).
- Owner: `src/host/IpcBridge.h:349` `VrcRadarEngine m_radarEngine;` (single shared instance).
- Concurrent callers, both unsynchronized:
  - `src/host/bridges/RadarBridge.cpp:35` `m_radarEngine.PollOnce()` — `radar.poll` is registered
    in `AsyncMethodSet()` (`src/host/IpcBridge.cpp:271`) so it runs on the `IpcThreadPool`
    (2–8 worker threads, `IpcBridge.cpp:30-44`). Two overlapping `radar.poll` requests (Radar page
    auto-poll, React StrictMode double-invoke, rapid navigation) run on different pool threads.
  - `src/host/bridges/PipelineBridge.cpp:424` `m_radarEngine.PollOnce()` from inside the
    **ScreenshotWatcher callback thread** (`ScreenshotWatcher::WatchLoop`), entirely independent
    of the pool.

- Problem: `VrcRadarEngine` has no mutex (`VrcRadarEngine.h:62-87` — only `std::atomic<bool> running_`).
  `PollOnce()` → `BuildSnapshot()` reads and writes `gaBase_`, `vrcBase_`, `vrcPlayerTypePtr_`, and
  drives `ProcessMemoryReader::Attach()`/`Detach()`, which mutate `hProcess_`/`processId_` and call
  `CloseHandle(hProcess_)`. Thread A can execute `reader_->Detach()` (line 237, on the MZ-header
  failure path) — closing the HANDLE and nulling it — while Thread B is mid-`ReadProcessMemory`
  on the same `hProcess_` or has just re-`Attach()`ed.
- Why it matters: this is a textbook data race (UB) on a kernel HANDLE. Best case the racing read
  fails benignly; worst case is a double-`CloseHandle` of a handle value the OS has already reused
  for an unrelated resource, which closes that unrelated handle — a process-wide corruption bug
  that manifests far from here. Torn reads of `vrcPlayerTypePtr_` can also point the pointer-scan
  at a stale TypeInfo. The radar is read-only against VRChat, so user VRChat data is safe, but the
  in-process handle-lifetime hazard is real and reachable in normal use (Radar page open while a
  screenshot is captured).
- Fix: serialize `PollOnce()`/`BuildSnapshot()` with a `std::mutex` member held for the whole
  attach→scan→detach sequence, or give the engine a single owning poll thread and have IPC/screenshot
  callers read the last published snapshot under a lock (double-buffer). At minimum, guard every
  access to `reader_`, `gaBase_`, `vrcBase_`, `vrcPlayerTypePtr_` with one mutex.

---

## MEDIUM

### M-core-1. `readJunctionTarget` trusts attacker-controllable reparse offsets → heap over-read

- File: `src/core/JunctionUtil.cpp:106-112`.
- Problem: after `DeviceIoControl(FSCTL_GET_REPARSE_POINT)` fills a 16 KiB buffer
  (`MAXIMUM_REPARSE_DATA_BUFFER_SIZE`, line 92), the code computes
  `base = data->PathBuffer + (SubstituteNameOffset/2)` and builds
  `std::wstring sub(base, SubstituteNameLength / sizeof(WCHAR))` with **no validation** that
  `SubstituteNameOffset + SubstituteNameLength` stays within the `returned` byte count (or even
  within the 16 KiB allocation). `SubstituteNameOffset`/`SubstituteNameLength` are `WORD` fields
  read straight from the on-disk reparse data; a crafted mount-point reparse point can set
  `SubstituteNameLength` up to `0xFFFF` (~64 KiB) with `Offset` 0, causing `std::wstring`'s
  constructor to read ~49 KiB past the end of the heap buffer.
- Why it matters: out-of-bounds heap read (info leak / crash). `Repair()` gates the *source* to the
  three detected cache roots (`isRepairableCacheRoot`, line 44-70), so triggering it requires a
  malicious/corrupt reparse point planted at a VRChat cache root — local-user-controlled, lowering
  exploitability, but the parse itself is unchecked and `readJunctionTarget` is also called on the
  result-reporting path (line 287).
- Fix: validate `data->ReparseDataLength`/`returned` covers the name fields, and that
  `SubstituteNameOffset + SubstituteNameLength <= ReparseDataLength` and
  `offsetof(PathBuffer) + SubstituteNameOffset + SubstituteNameLength <= returned`, before slicing.

### M-core-2. `uncompressedInfoSize` is uncapped before allocation in the bundle parser

- File: `src/core/UnityBundle.cpp:374-375` (read), `:430-434` (`decompressBlock(..., uncompressedInfoSize, ...)`),
  and the LZ4/LZMA/None paths at `:176`, `:233` which do `out.resize(uncompressedSize)`.
- Problem: the data-block total is capped at 2 GiB (`totalUncompressed`, lines 467-470), and
  `validateUnityBundleStructure` rejects `uncompressedInfoSize == 0` (line 632), but **neither path
  enforces an upper bound on `uncompressedInfoSize`** — a `u32` field read directly from the
  untrusted header. A bundle declaring `uncompressedInfoSize = 0xFFFFFFFF` drives a single
  ~4 GiB `std::vector` allocation inside `decompressBlock` before any block-table sanity is possible.
- Why it matters: memory-pressure DoS on attacker-influenced cache files (`__data` from any visited
  avatar/world). `parseUnityBundle`/`validateUnityBundleStructure` have no local `try/catch`; the
  `std::bad_alloc` propagates and is only swallowed at the IPC boundary (`IpcBridge.cpp:523`), so it
  is not a crash but is a large transient allocation under attacker control, contrary to the
  "no exceptions in core" contract.
- Fix: cap `uncompressedInfoSize` (blocksInfo is normally a few KiB; a 1–16 MiB ceiling is generous)
  and return `Error{"bundle_invalid", ...}` above it, before calling `decompressBlock`, in both
  `parseUnityBundle` and `validateUnityBundleStructure`.

### M-core-3. SafeDelete containment is lexical-only; `remove_all` can follow a junction planted in the cache

- File: `src/core/SafeDelete.cpp:79-106` (`validateDeleteTarget` → `ensureWithinBase`),
  `:166` (`std::filesystem::remove_all(target, ec)`); `ensureWithinBase` is intentionally
  non-canonical (`Common.cpp:171-216`, comment lines 173-177).
- Problem: containment uses `absolute()+lexically_normal()` and deliberately does **not** resolve
  reparse points (correct for the relocate-via-junction use case). But `ExecutePlan` then calls
  `remove_all` on each validated target. On MSVC, mount-point junctions (`IO_REPARSE_TAG_MOUNT_POINT`)
  are not reported as symlinks by `std::filesystem`, so `remove_all` can recurse **through** a
  junction and delete the junction's target contents. A junction sitting inside a safe-delete
  category (e.g. a hash dir under `Cache-WindowsPlayer/` pointing at an unrelated folder) passes the
  lexical check yet deletes data outside the cache tree.
- Why it matters: destructive op escaping the intended root. Likelihood is low (requires a junction
  already present inside the cache), but the blast radius is real deletion outside `baseDir`, which
  the whole module exists to prevent.
- Fix: before `remove_all`, reject targets that are reparse points
  (`std::filesystem::is_symlink` is insufficient for junctions — check
  `GetFileAttributesW(...) & FILE_ATTRIBUTE_REPARSE_POINT`, as `JunctionUtil::isReparsePoint`
  already does, `JunctionUtil.cpp:73-78`), or `remove()` the reparse point itself rather than
  `remove_all` recursing into it.

---

## LOW

### L-core-1. Signed-overflow UB in node range check in `parseUnityBundle`

- File: `src/core/UnityBundle.cpp:558-559`: `static_cast<std::uint64_t>(node.offset + node.size)`
  where both are `int64_t`. After the `< 0` guards, two large positives still overflow the signed
  addition (UB) before the cast. The sibling `validateUnityBundleStructure` already uses the safe
  form (`:734-736`: compare `length > totalUncompressed - start` after a `start <= total` check).
- Impact: UB on attacker-controlled values; functionally the wrapped result is still rejected and
  `UnityBundle::view()` re-bounds-checks (`:315-322`, safe for non-negative int64), so no known
  exploitable path — but compilers may assume no overflow. Fix: mirror the validate-side pattern.

### L-core-2. `CacheScanner`/`BundleSniff` recursion has no junction-cycle protection

- File: `src/core/CacheScanner.cpp:61-90` (`scanDirectory`), `src/core/BundleSniff.cpp:64-99`
  (`aggregate`). Both use `recursive_directory_iterator` with `skip_permission_denied` but no
  follow-symlink option and no cycle detection. As in M-core-3, MSVC may recurse into mount-point
  junctions; a junction pointing at an ancestor inside the scanned tree yields an effectively
  unbounded walk that hangs the scan thread (read-only, so no data loss).
- Fix: skip entries whose `GetFileAttributesW` has `FILE_ATTRIBUTE_REPARSE_POINT` during the walk.

### L-core-3. Decrypted cookie copy in the parsed JSON document is not securely wiped

- File: `src/core/AuthStore.cpp:120-141`. `jsonText` is wiped via `secureClearString` (line 125),
  and members are wiped on clear/dtor, but `nlohmann::json doc` (line 127) holds its own heap copy
  of the `auth`/`twoFactorAuth` strings and is freed normally when it goes out of scope, leaving the
  cookie bytes on the CRT free-list. Best-effort scrubbing elsewhere is otherwise consistent.
- Impact: minor at-rest-in-RAM residue; DPAPI-at-rest and member scrubbing are otherwise solid.
  Fix: extract fields then `secureClearString` the relevant string nodes / overwrite before `doc`
  is destroyed, or copy out and reset.

### L-core-4. `JunctionUtil::Repair` target path is only checked for "not inside source"

- File: `src/core/JunctionUtil.cpp:218-246`. The user-supplied `target` is validated only by
  `ensureWithinBase(source, *target)` (must not be inside source, line 231); it is otherwise an
  arbitrary path at which `create_directories` runs (lines 237-242) and a junction is then pointed.
  Params originate from the local UI so this is low-risk, but an unvalidated arbitrary directory
  create is worth a sanity bound (e.g. require an absolute, existing-drive path, reject system dirs).

---

## Positive verifications (claims checked against code)

- SafeDelete two-phase model: `Plan` previews, `ExecutePlan` re-validates **every** caller-supplied
  target through `validateDeleteTarget` (`SafeDelete.cpp:158-169`), and blocks before VRChat-running
  (`ProcessGuard::IsVRChatRunning`, line 151). `__info`/`vrc-version` preservation is enforced in
  both the planner (`:140`) and the executor (`isPreservedCwpRootTarget`, `:65-73`, `:94-100`).
  Category roots and `baseDir` itself cannot be deleted (child-of-category requirement, `:57-63`).
- `ensureWithinBase` resolves `..` lexically and compares components case-insensitively
  (`Common.cpp:191-216`); deliberate non-canonical design is documented — sound except for the
  reparse-point gap noted in M-core-3.
- BundleSniff only reads 8 magic bytes (`:114-136`, bounded) and the first `__info` line
  (`:101-112`, bounded); the real UnityFS parse is in `UnityBundle.cpp`, whose `ByteReader`
  bounds-checks every read (`:39-119`), caps block/node counts at `0x10000`, caps decompressed data
  at 2 GiB, and re-checks node ranges and block payload EOF.
- AuthStore uses user-scope DPAPI (`CryptProtectData`/`CryptUnprotectData`, `:104`,`:172`), never
  logs cookie values (only `GetLastError`/messages), scrubs members and transient buffers, and fails
  closed to "signed out" on decrypt failure.
- Concurrency hot spots that are correctly synchronized: `Pipeline` active-socket handoff
  (`m_activeSocketMutex`, `Pipeline.cpp:137-147`, `:340-362`) cleanly interrupts a blocked
  `WinHttpWebSocketReceive` on `Stop()`; `TaskQueue` guards queue/active-token under `m_mutex` and
  joins its worker in the dtor; `LogTailer` and `ScreenshotWatcher` join their threads in `Stop()`
  and swallow callback exceptions; `HwTelemetry` CPU-load sampling guards its `static` previous
  sample with a `std::mutex` and the lock-drop-around-`Sleep` is reasoned and safe; `VrcApi`
  thumbnail cache state is a `std::mutex`-guarded singleton.

---

## Area-health summary

- The destructive and credential surfaces (SafeDelete, AuthStore, the UnityFS parser bounds) are
  well-defended and clearly the most-reviewed code; the one real gap is reparse-point handling
  (M-core-1 over-read, M-core-3 delete-escape, L-core-2 walk hang) — junctions are trusted lexically
  but never inspected before traversal/parse.
- The standout concurrency defect is `VrcRadarEngine` (H1): a genuinely unsynchronized shared
  object driven from both the IPC thread pool and the screenshot-watcher thread, racing on a kernel
  HANDLE. Every other threaded component in core is correctly mutex/atomic-guarded.
- Untrusted-binary parsing is solid on bounds but missing one allocation cap (M-core-2,
  `uncompressedInfoSize`) and carries one cosmetic signed-overflow UB (L-core-1) that the
  validate-side path already does correctly.
