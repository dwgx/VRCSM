# VRCSM Next Agent Handoff

Last updated: 2026-06-25

## Current State

- Branch: `main`
- Working tree expectation: clean after the `v0.14.6` release checkpoint and post-release doc cleanup; re-check with `git status --short` before changing code.
- Latest shipped release tag: `v0.14.6`
- Remote: `origin https://github.com/dwgx/VRCSM.git`
- Current app version: `0.14.6`
- VS2026 path: `D:\Software\Microsoft Visual Studio\18` (current machine path).
- Project status: release checkpoint shipped and active development paused after `v0.14.6`. Only critical bugfixes, packaging fixes, or security repairs should be assumed in-scope unless the user explicitly resumes feature work.

## Fixes Included In v0.14.6

- **Migration IPC single-response fix.** `migrate.execute` remains in `AsyncMethodSet()` and `MigrateBridge` no longer enqueues its own inner worker or posts a second result for the same request id. It still emits `migrate.progress` and `migrate.done`; the React page listens to both and guards against duplicate completion to avoid a stuck running state on failure.
- **`world_visits` duplicate upgrade repair.** `Database::InitSchema()` now creates the table and normal indexes first, deletes duplicate `(world_id, instance_id, joined_at)` rows while preferring a row with `left_at`, and only then creates `uq_world_visits`.
- **Updater IPC error semantics fixed.** `UpdateBridge` now throws `IpcException` instead of returning `{error}` as a successful JSON result, so frontend `try/catch` paths receive normal IPC errors.
- **Updater install boundary tightened.** `update.install` now requires `path`, `version`, `size`, optional `sha256`, and optional `fileName`; validates that the installer is the expected MSI under the VRCSM updates directory with matching size/hash; and invokes `msiexec` with the canonical validated updates path.
- **Updater release-asset filename sync fixed.** The shipped GitHub release asset is named `VRCSM_v0.14.6_x64_Installer.msi`, not the older assumed `VRCSM-<version>.msi`. `UpdateChecker` now carries the release asset `fileName`; `UpdateBridge` download/install passes and validates that filename; frontend `UpdateDialog` includes it in download/install IPC params. Tests cover accepting the real release asset name and rejecting a mismatched expected name.
- **Packaging scripts no longer require global WiX only.** `package_release.ps1` and `scripts/build-msi.bat` now resolve WiX from `VRCSM_WIX`, user-global `%USERPROFILE%\.dotnet\tools\wix.exe`, or repo-local `build\tools\wix.exe`.
- **pnpm 11 build-script approvals are project-local.** `web/pnpm-workspace.yaml` allows build scripts for `esbuild`, `onnxruntime-node`, `protobufjs`, and `sharp`; `corepack pnpm --dir web build` now completes.
- **Avatar preview diagnostics improved.** Native avatar preview now preserves known UnityPreview failure codes (`bundle_invalid`, `typetree_unsupported`, `no_meshes`, `encrypted`) instead of folding them all into `preview_failed`. `CommonTests.AvatarPreviewPreservesBundleInvalidFailureCode` locks this behavior.
- **Frontend API facade cleanup started.** Reusable wrappers now exist in `web/src/lib/vrchat-api.ts`, `web/src/lib/social.ts`, `web/src/lib/history-api.ts`, and `web/src/lib/shell-api.ts`. Profile save, Friends actions, Workspace friend request-invite, and FriendDetailDialog social actions now use these facades instead of direct low-level IPC calls.
- **OSC Studio hardware telemetry expanded.** `src/core/hw/GpuProbe.*` now centralizes GPU candidate scoring and DXGI adapter enumeration. `hw.recommend` returns GPU vendor/source/virtual status; `hw.telemetry` returns `gpu_adapters`, uses finite WMI row timeouts, and NVML now selects across NVIDIA devices instead of hardcoding index 0. The OSC hardware panel displays GPU source, VRAM, adapter count and primary adapter.
- **Local CodeGraph index ignored.** `.codegraph/` is intentionally local and ignored by Git.
- **UI repair / VRCX parity plan added.** `docs/UI-REPAIR-VRCX-PARITY-PLAN.md` is now the execution guide for visible UI fixes, VRCX-parity feature sequencing, and the rule that new reusable frontend IPC/API calls should live in `web/src/lib` domain modules instead of being scattered across pages.
- **VRCX reference checked.** Local reference clone `D:\Reference\VRCX` is at `e69d1e983ced794b791317e2b75ec3d23bdb8780` (`Fix group moderation actions`, 2026-06-09), matching `origin/master`.
- **`D:\Project\vrchat-il2cpp-re` checked for unpacking ideas.** It is not a complete Unity/VRChat avatar model unpacker. Its useful pieces are cache/log correlation (`tools/load_cached_worlds.py`) and IL2CPP/runtime research scripts; no UnityFS/CAB/LZ4/LZMA/Texture2D/SkinnedMeshRenderer/GLB export pipeline was found there.
- **Friends/i18n/social scan responsiveness slice.** Friends no longer has the misleading "has model/avatar" smart view; i18n keys were added for Friends views, OSC Studio, and Social Analytics in `en`, `zh-CN`, `ja`, `ko`, `ru`, `th`, and `hi`; Social Analytics excludes `useAuth().status.userId` from encounter rankings; `HandleScan` now reuses the `LogParser::parse()` result already needed for avatar-history backfill instead of parsing logs twice; Worlds thumbnail lookahead is capped to the first 96 low-priority rows after the 24 visible rows.
- **OSC Studio interaction pass.** `web/src/lib/osc-studio.ts` first reset older local defaults to a cleaner set, then the card-builder slice bumped profile defaults to version 4 with exactly four Chatbox-oriented templates: clock, compact performance, hardware names, and thermal/power. `web/src/pages/OscTools.tsx` has live clock preview, latest-state refs for auto send, telemetry refresh during auto send, partial hardware snapshot fallback, Chatbox rate-limit waiting for auto mode, a larger selected-template edit area, and a drag/click hardware component-card palette for time/CPU/GPU/RAM/motherboard/sensor fragments. i18n keys were updated across all locale files; watch for Windows console encoding when editing non-ASCII locale text.
- **Social Analytics lazy world rows + OSC DIY composer.** `web/src/pages/SocialGraph.tsx` now lazy-mounts `WorldPopupBadge` behind `IntersectionObserver`, so the Most Visited Worlds list does not construct world badges/thumbnails until rows are visible. `web/src/pages/OscTools.tsx` also has a visual composer above the raw template textarea: chunks can be moved/removed, custom text can be inserted, separators are one click, and component cards show descriptions plus live values while still persisting a plain template string. New strings were added to all locale files.
- **OSC usability + SMBIOS hardware identity fallback.** `web/src/pages/OscTools.tsx` now defaults component cards to a recommended subset, adds search/category filters, explicit click-to-insert text, and robust drag payload handling for both the composer drop zone and raw textarea. Avatar parameter scan now explains it creates OSC control cards rather than unpacking models. `src/core/hw/HwTelemetry.cpp` now reads raw SMBIOS via `GetSystemFirmwareTable('RSMB')` after CIM/WMI, filling motherboard and RAM module identity when WMI is empty or slow. A local RSMB probe on this machine returned 4736 bytes for `0x52534D42` and 0 for the reversed signature, confirming the provider constant.
- **About dialog acknowledgement removal.** `web/src/components/AboutDialog.tsx` no longer renders the extra acknowledgement card; `web/src/lib/assets.ts`, all locale JSON files, and `docs/gh-pages/index.html` no longer carry that removed personal avatar/text reference. Keep it removed unless the user explicitly asks to restore it.
- **Why VRCX feels faster, verified from local reference.** `D:\Reference\VRCX\Dotnet\LogWatcher.cs` keeps a per-log `LogContext.Position` and resumes reading from that offset, while `src\stores\location.js` keeps `lastLocation.playerList/friendList` as running UI state. VRCSM still has several full-scan surfaces; the next serious performance step is a persisted incremental scan index and live state store instead of more page-level full scans.
- **Unified asset cache + lazy metadata slice.** `src/core/Database.cpp` schema v12 adds `asset_cache` for world/avatar/user names, remote image URLs, local thumbnail URLs, payload, source, confidence, expiry, and negative-cache timestamps. `assets.resolve`, `assets.prefetch`, and `assets.invalidate` are registered as async IPC handlers; resolve seeds from hints/local favorites/avatar history/player encounters, then uses the existing thumbnail resolver only for missing world/avatar covers. `ApiBridge` now backfills verified user/world/avatar cache rows from friends list, user profile, world details, and avatar details.
- **Frontend asset-cache integration.** `web/src/lib/assets-cache.ts` is the shared frontend cache. `WorldPopupBadge`, `AvatarPopupBadge`, `UserPopupBadge`, and `Worlds.tsx` now use it. `UserPopupBadge` no longer calls `user.getProfile` merely because it mounted; full profile fetch happens only when the dialog opens. Worlds warms visible rows and queues lookahead rows through `prefetchAssets` / `prefetchAssetsLowPriority`, reusing log names as hints.
- **Cache governance + first implementation slice.** `docs/CACHE-ARCHITECTURE.md` is now the read-first document before changing cache behavior. `web/src/lib/query-keys.ts` adds typed query key factories and `library.ts` / `useFriendsPipelineSync.ts` now use them for favorites and `friends.list` cache updates. `web/src/lib/assets-cache.ts` now honors backend `expiresAt` / `negativeUntil` and exposes `invalidateAssetsCoherent()` so backend `assets.invalidate` and frontend memo clearing stay paired. `src/core/CacheIndex.cpp` no longer unlocks a mutex owned by `std::lock_guard`, snapshots state before writing `cache-index.json`, and skips obviously stale persisted entries. `src/core/Database.cpp` now sets a 5s SQLite busy timeout and runs best-effort `PRAGMA optimize` after schema initialization.
- **Full audit + enhancement-research pass (2026-06-29).** A five-domain read-only audit (destructive ops, cache/db, auth/secrets/VrcApi/plugin, frontend cache ownership, IPC surface) plus deep research (bundle unpack feasibility, hardware telemetry, VRCX parity, relationship-graph/GUI design) is consolidated into `docs/ENHANCEMENT-ROADMAP.md`. Three audit fixes were shipped and verified this pass: (1) `Migrator.cpp` integer-overflow in `sizeOf`/copy loop — `file_size()` returns `(uintmax_t)-1` on error and was folded into the running total before clearing the error; now only added when the call succeeds. (2) Migration verify now compares file count AND byte total before renaming source→backup. (3) Updater MSI hash is now mandatory/fail-closed in `UpdatePackage.cpp::ValidateDownloadedPackage` (`update_hash` on missing/empty SHA256), and `package_release.ps1` now always emits a `SHA256:` release-notes snippet so legitimate releases keep working — **pasting that snippet into the GitHub release notes is now a required release step**. New tests `UpdatePackageValidationRejectsMissingSha256` / `...RejectsWrongSha256`. Open audit findings still to address are listed in the roadmap (M3 SafeDelete reparse guard, M4 VrcApi URL path encoding, M5/M6 plugin fs permission containment + host-label collision, M7 CacheIndex startup I/O-under-lock, M8 asset_cache unbounded growth, H2 frontend account-switch component-state leak, L5 plugin error-text leakage). Bundle work is scoped to local inspection/preview only — no avatar-export-for-redistribution pipeline; ~96% of the live cache is encrypted and stays walled off.
- **Frontend cache ownership + card image proxy slice.** `web/src/lib/cache-ownership.ts` is now the single frontend reset path for account-scoped localStorage, React Query roots, and process image/thumbnail/asset memo caches. `AuthProvider` uses it for login, 2FA, logout, auth-expiry, and account-switch transitions; the self `ProfileCard` logout button now goes through `useAuth().logout()` instead of direct IPC. `ProfileCard` and `FriendDetailDialog` now route VRChat profile/avatar image URLs through `useCachedImageUrl()` so high-traffic info cards can reuse the host `images.cache` / `thumb.local` path instead of repeatedly loading remote CDN URLs in WebView. `image-cache.ts` now treats existing `thumb.local`, `preview.local`, and `screenshot-thumbs.local` URLs as already local.
- **OSC Studio cleanup after in-VR bad-value report.** `TemplateBuilderPanel` now has a localized clear-editor button. `renderOscTemplate()` drops pipe-separated template segments containing `--`, so unavailable CPU temperature/fan/board/sensor values do not get sent into VRChat Chatbox when other segments are valid. This is a UI/rendering guard, not a substitute for deeper sensor-source work.
- **OSC auto-send timing and stale-message fix.** `web/src/pages/OscTools.tsx` now renders Chatbox templates through a callback after telemetry refresh and after any 2-second Chatbox rate-limit wait, so `{time.short}` seconds reflect the actual send moment instead of the moment the async task started. Auto-send is a single cancellable `setTimeout` loop keyed by `autoRunIdRef`; it no longer overlaps async `setInterval` sends, and `stopAutoSend()` cancels in-flight waits before an old message can be sent. `web/src/lib/osc-studio.ts` now removes missing-value placeholders inside segments, drops CPU/fan-only segments when the values are missing, and treats a lone category label like `Thermal` as an empty message.
- **OSC auto-send visibility + AIDA64 sensors.** `OscTools` now exposes per-card Auto/Stop buttons and an active auto-send status panel with sent/skipped counters, next-send countdown, last message, and last error. `HwTelemetry` now reads the public AIDA64 `AIDA64_SensorValues` shared-memory feed, parses XML-ish sensor rows, classifies T/F/P/U/V/C style rows into temperature/fan/power/load/voltage/clock, and folds them into the same source-status contract as LibreHardwareMonitor/OpenHardwareMonitor/NVML. The OSC hardware panel now lists the first live sensor readings, and old/default thermal templates migrate from `Fan {gpu.fanPct}` to `{fan.0}` so RPM-style fan sensors can render. HWiNFO shared memory is still **not** implemented; add it only with a clear legal/SDK boundary.
- **ACPI thermal-zone fallback added.** `HwTelemetry` now also queries `ROOT\WMI:MSAcpi_ThermalZoneTemperature`, converts tenths-Kelvin `CurrentTemperature` values to Celsius, validates the result range, exposes readings as `acpi_thermal_zone`, and uses the first one only as a CPU temperature fallback when no more specific provider produced a CPU temperature. This improves out-of-box coverage but must remain labeled as platform thermal-zone data, not exact CPU package/core telemetry.
- **OSC send-flow behavior adjusted.** `StudioToolbar` preset buttons now apply the preset into the selected card/editor instead of always appending another card. Default OSC Studio card/scene `autoIntervalSec` values are now `1`. Manual Chatbox sends use a local `5 messages / 5 seconds` burst guard with a visible error string, while auto-send skips that local manual guard and sends with notification SFX disabled. `Send selected` / `Auto send` now toast a localized error if no card is selected.
- **OSC auto-send hotfix landed.** `web/src/lib/osc-api.ts` now sends `/chatbox/input` args in VRChat's real order (`string`, `sendImmediately`, `playNotificationSound`) instead of treating the second bool like the SFX toggle. `web/src/pages/OscTools.tsx` now commits card-list mutations synchronously into both React state and `latestCardsRef`, which fixes the immediate-start race where a just-created or just-edited card could be reported as "Auto-send card was removed". The interval editors and new template cards also now default to and accept `1s` consistently instead of clamping the UI back to `2`.
- **OSC send diagnostics + auto pacing repair.** `src/core/OscBridge.*` now returns structured send failures for invalid IPv4 host input, `socket()` failure, and `sendto()` failure; `src/host/bridges/PipelineBridge.cpp` converts them into real IPC errors so the frontend stops showing a bare generic `ERROR`. `web/src/pages/OscTools.tsx` also restored a dedicated Chatbox auto-send pacing gate (`2000ms`) so `1s` editor defaults still queue correctly against VRChat's practical Chatbox cadence instead of appearing to run while messages are skipped or race each other.

## Last Verified Build (2026-06-24 OSC auto-send visibility + AIDA64 sensor slice)

- Official VRChat docs checked during this slice:
  - `https://docs.vrchat.com/docs/osc-overview.md`: VRChat receives OSC on `9000` and sends on `9001` by default.
  - `https://docs.vrchat.com/docs/osc-as-input-controller.md`: Chatbox text is limited to 144 characters and 9 displayed lines; `/chatbox/input` takes string, send-immediately bool, and notification-SFX bool.
- Sensor-source references checked during this slice:
  - `https://www.aida64.com/user-manual/hardware-monitoring/external-applications?language_content_entity=en`: AIDA64 external applications can publish sensor values via shared memory; `AIDA64_SensorValues` is the sensor-value mapping.
  - `https://docs.nvidia.com/deploy/nvml-api/group__nvmlDeviceQueries.html`: NVML exposes NVIDIA device temperature, fan speed, power usage, memory, and utilization APIs.
  - `https://github.com/LibreHardwareMonitor/LibreHardwareMonitor`: upstream sensor monitor used as the WMI source for temperature/fan/power/load-style readings when running.
  - Microsoft `MSAcpi_ThermalZoneTemperature` / ACPI thermal-zone WMI references were checked for the tenths-Kelvin `CurrentTemperature` behavior; keep this provider labeled as `acpi_thermal_zone`.
- `cmd /c node_modules\.bin\vitest.CMD run src/lib/__tests__/osc-studio.test.ts --reporter verbose --testTimeout 20000` from `web\`: passed, 6/6.
- `cmd /c node_modules\.bin\vitest.CMD run src/lib/__tests__/osc-studio.test.ts src/__tests__/pages-smoke.test.tsx --reporter verbose --testTimeout 20000` from `web\`: passed, 29/29.
- `cmd /c node_modules\.bin\tsc.CMD -b --pretty false` from `web\`: passed.
- Locale integrity script over `web/src/i18n/locales/*.json`: passed.
- `cmd /c node_modules\.bin\vitest.CMD run src/__tests__/pages-smoke.test.tsx --reporter verbose --testTimeout 20000` from `web\`: passed, 23/23; only existing mock IPC / React Router / Three.js warnings.
- `build\x64-release\tests\VRCSM_Tests.exe --gtest_filter=CommonTests.Aida64SensorValuesParserAcceptsCommonXmlRows`: passed.
- `build\x64-release\tests\VRCSM_Tests.exe --gtest_filter=CommonTests.AcpiThermalZoneConvertsTenthsKelvinToCelsius`: passed.
- `build\x64-release\tests\VRCSM_Tests.exe`: passed, 50 passed / 1 skipped. The skipped test was `CommonTests.DeleteExecuteRejectsPreservedCwpRootTargets` because VRChat was running and the delete path correctly stopped at the process guard before path validation.
- `git diff --check`: passed.
- `cmd /c node_modules\.bin\vite.CMD build` from `web\`: passed; emitted existing empty `react-vendor` and large-chunk warnings.
- `cmake --build --preset x64-release --target vrcsm` through the VS2026 bundled CMake: passed; `web/dist` was synced into the host output and the host output contains `OscTools-2buEcSyc.js`.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\package_release.ps1`: passed after syncing frontend dist.
- Startup smoke: `build\x64-release\src\host\VRCSM.exe` launched visibly, PID 39720, window title `VRC Settings Manager`, responding after 8 seconds.

## Last Verified Build (2026-06-25 cache ownership + card image proxy slice)

- `cmd /c node_modules\.bin\vitest.CMD run src/lib/__tests__/query-keys.test.ts src/lib/__tests__/assets-cache.test.ts src/lib/__tests__/image-cache.test.ts src/lib/__tests__/cache-ownership.test.ts --reporter verbose --testTimeout 20000` from `web\`: passed, 10/10.
- `cmd /c node_modules\.bin\tsc.CMD -b --pretty false` from `web\`: passed.
- `cmd /c node_modules\.bin\vite.CMD build` from `web\`: passed; emitted the existing empty `react-vendor` and large-chunk warnings.
- `cmd /c node_modules\.bin\vitest.CMD run src/__tests__/pages-smoke.test.tsx --reporter verbose --testTimeout 20000` from `web\`: passed, 23/23; only existing mock IPC / React Router / Three.js warnings.
- `cmd.exe /s /c '"D:\Software\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 && cmake --build --preset x64-release --target VRCSM_Tests --parallel 1'`: passed before the frontend-only ownership/card image follow-up.
- `build\x64-release\tests\VRCSM_Tests.exe`: passed before the frontend-only ownership/card image follow-up, 52/52.
- `git diff --check`: passed.

## Last Verified Build (2026-06-24 OSC auto-send hotfix slice)

- `cmd /c node_modules\.bin\tsc.CMD -b --pretty false` from `web\`: passed.
- `cmd /c node_modules\.bin\vitest.CMD run src/lib/__tests__/osc-api.test.ts src/lib/__tests__/osc-studio.test.ts src/__tests__/pages-smoke.test.tsx --reporter verbose --testTimeout 20000` from `web\`: passed, 30/30.
- `cmd /c node_modules\.bin\vite.CMD build` from `web\`: passed; emitted the existing empty `react-vendor` and large-chunk warnings.
- New regression test `web/src/lib/__tests__/osc-api.test.ts` locks the `/chatbox/input` argument order so future refactors do not silently break auto-send again.

## Last Verified Build (2026-06-24 OSC send diagnostics + pacing slice)

- `cmd /c node_modules\.bin\tsc.CMD -b --pretty false` from `web\`: passed.
- `cmd /c node_modules\.bin\vitest.CMD run src/lib/__tests__/osc-api.test.ts src/lib/__tests__/osc-studio.test.ts src/__tests__/pages-smoke.test.tsx --reporter verbose --testTimeout 20000` from `web\`: passed.
- `cmd.exe /s /c '"D:\Software\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 && cmake --build --preset x64-release --target VRCSM_Tests --parallel 1'`: passed.
- `build\x64-release\tests\VRCSM_Tests.exe --gtest_filter=CommonTests.OscBridgeRejectsInvalidIpv4Host`: passed.
- `cmd.exe /s /c '"D:\Software\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 && cmake --build --preset x64-release --target vrcsm --parallel 1'`: passed and synced `web/dist` into the release host output; the host output contains `OscTools-C-BGdlaM.js`.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\package_release.ps1`: passed.
- Startup smoke: `build\x64-release\src\host\VRCSM.exe` launched visibly, PID 31600, window title `VRC Settings Manager`, responding after 8 seconds.

## Last Verified Build (2026-06-24 v0.14.6 release checkpoint)

- `cmd /c node_modules\.bin\tsc.CMD -b --pretty false` from `web\`: passed.
- `cmd /c node_modules\.bin\vitest.CMD run src/lib/__tests__/osc-api.test.ts src/lib/__tests__/osc-studio.test.ts src/__tests__/pages-smoke.test.tsx --reporter verbose --testTimeout 20000` from `web\`: passed, 30/30.
- `cmd /c node_modules\.bin\vite.CMD build` from `web\`: passed; emitted the existing empty `react-vendor` and large-chunk warnings.
- `cmd.exe /s /c '"D:\Software\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 && cmake --build --preset x64-release --target VRCSM_Tests --parallel 1'`: passed.
- `build\x64-release\tests\VRCSM_Tests.exe --gtest_filter=CommonTests.OscBridgeRejectsInvalidIpv4Host`: passed.
- `cmd.exe /s /c '"D:\Software\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 && cmake --build --preset x64-release --target vrcsm --parallel 1'`: passed and synced `web/dist` into the release host output.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\package_release.ps1`: passed for `0.14.6`.
- Startup smoke: `build\x64-release\src\host\VRCSM.exe` launched visibly, PID 31604, window title `VRC Settings Manager`, responding after 8 seconds.

Final local artifacts from this verification:

- `build\release\VRCSM_v0.14.6_x64.zip`
  - SHA256: `E431C1CF2436C0A4F82D8C0C7988F39823FA6BBEA7CE6D0502D0CBB7B05CA50E`
- `build\release\VRCSM_v0.14.6_x64_Installer.msi`
  - SHA256: `37C605FB3DCF75F07ED40DA5AF7FCEDF6FB33D94DA2FFC65D29DD3D9814A8614`

## What Changed Since 0.14.3

### Critical Bug Fixes

- **Log backfill always-on (was: only when DB empty).** `LogsBridge.cpp` used to skip historical log import once the tables had any data. That meant sessions after day 1 never appeared in world history / player events / friend log. Now always scans the 20 newest log files on startup with `INSERT OR IGNORE`.
- **Non-friend player names cleaned.** VRChat appends hex hashes to display names of unresolved players (`Alice_f76f94e9_542d`). `stripUnresolvedHashSuffix()` removes them in both batch LogParser and live LogEventClassifier.
- **vrchat://launch no longer spawns second VRChat.exe.** `ShellBridge::HandleShellOpenUrl` intercepts `vrchat://launch` when VRChat is running and uses `VrcApi::inviteSelf` REST API instead.
- **Friends list polling race condition.** Background poll used `setData(result)` which could overwrite WebSocket pipeline event merges. Now uses functional updater + timestamp guard.

### New Features

- **VRChat recently encountered players API.** `visits.list` IPC -> `GET /api/1/visits`. Frontend `ipc.visitsList()` available.
- **Hardware recommendation tab.** Settings -> Hardware: WMI GPU/CPU/RAM/HMD detection, hardware score, recommended SteamVR parameters. GPU table covers RTX 50-series, AMD RX 9000/7000/6000, Intel Arc.
- **Plugin market hero SVG.** `PluginHero.tsx` - widescreen banner with robot mascot and floating plugin cards.
- **Plugin install dialog.** shadcn Dialog replaces `window.confirm()`, shows manifest permissions.
- **BoopCard emoji-only.** No more message type tabs or slot buttons - just emoji wheel + send.
- **Calendar & Bundles moved to Lab** sidebar.

### Data Changes

- `world_visits` now has `CREATE UNIQUE INDEX uq_world_visits ON world_visits(world_id, instance_id, joined_at)`. As of 2026-06-22, `InitSchema()` dedupes old rows before creating this index, so DBs from <=0.14.4 with duplicate visits should open and self-repair instead of failing schema init.
- Log scan limits raised: `kMaxLogFiles` 5->20, `kMaxEventsPerKind` 500->2000.

## Last Verified Build (2026-06-23 local full)

- `web\node_modules\.bin\tsc.cmd -b web\tsconfig.json --pretty false`: passed.
- `web\node_modules\.bin\vitest.cmd run src/__tests__/pages-smoke.test.tsx`: passed, 22/22.
- `corepack pnpm --dir web build`: passed after project-local pnpm build-script approvals in `web/pnpm-workspace.yaml`.
- Debug native: `cmake --build --preset x64-debug --target VRCSM_Tests` passed; `ctest --test-dir build\x64-debug --output-on-failure` passed 44/44.
- Release native: `cmake --build --preset x64-release` passed; `ctest --test-dir build\x64-release --output-on-failure` passed 44/44.
- `git diff --check`: no whitespace errors; only line-ending warnings for `package_release.ps1` and `scripts/build-msi.bat`.
- Packaging: `powershell -ExecutionPolicy Bypass -File .\package_release.ps1` passed using repo-local WiX.
- Startup smoke: `build\x64-release\src\host\VRCSM.exe` launched hidden, process was alive/responding after 8 seconds, then the smoke-started process was stopped.

## Last Verified Build (2026-06-23 OSC Studio interaction slice)

- `web\node_modules\.bin\tsc.cmd -b web\tsconfig.json --pretty false`: passed.
- `node_modules\.bin\vitest.cmd run src/__tests__/pages-smoke.test.tsx -t "/tools/osc"` from `web\`: passed, 1/1 selected.
- `node_modules\.bin\vitest.cmd run src/__tests__/pages-smoke.test.tsx` from `web\`: passed, 23/23.
- `node_modules\.bin\vite.cmd build` from `web\`: passed; emitted existing large-chunk warnings.
- Release host web bundle was synced with `cmake -DSOURCE=... -DDEST=... -P cmake/sync-web-dist.cmake` through the VS2026 environment because `ninja: no work to do` does not rerun POST_BUILD copy.
- `git diff --check`: no whitespace errors; only line-ending warnings for existing files.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\package_release.ps1`: passed.
- Startup smoke: `build\x64-release\src\host\VRCSM.exe` launched, PID 41500, responding after 8 seconds.

Final local artifacts from this verification:

- `build\release\VRCSM_v0.14.5_x64.zip`
  - Size: 18,623,855 bytes
  - SHA256: `A3EA9A6F8CD814CEB50D6CCC3EF0C04C56F626AE6EE85590627D0B87CFA3BA4B`
- `build\release\VRCSM_v0.14.5_x64_Installer.msi`
  - Size: 8,617,984 bytes
  - SHA256: `221AB16CE892D475BCAC4D2DD681F1FDD74C5E7A4B79B0660A45F5E8DAD7308F`

## Last Verified Build (2026-06-23 About cleanup slice)

- Full residual search for the removed acknowledgement key/title/name/avatar id across `web`, `src`, `docs`, `README.md`, and `CHANGELOG.md`: no matches outside this handoff note.
- `web\node_modules\.bin\tsc.cmd -b web\tsconfig.json --pretty false`: passed.
- `node .\node_modules\vitest\vitest.mjs run src/__tests__/pages-smoke.test.tsx` from `web\`: passed, 23/23.
- `.\node_modules\.bin\vite.cmd build` from `web\`: passed; emitted existing empty `react-vendor` chunk and large-chunk warnings.
- Release host web bundle was synced with `cmake -DSOURCE=... -DDEST=... -P cmake/sync-web-dist.cmake` through the VS2026 environment.
- `git diff --check -- web/src/components/AboutDialog.tsx web/src/lib/assets.ts web/src/i18n/locales/... docs/gh-pages/index.html CHANGELOG.md`: passed.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\package_release.ps1`: passed.
- Startup smoke: `build\x64-release\src\host\VRCSM.exe` launched, PID 42420, responding after 8 seconds.

Final local artifacts from this verification:

- `build\release\VRCSM_v0.14.5_x64.zip`
  - SHA256: `75DFC858FE1245547565D05AC7C680003F625FE48B7FE1A7882D3DC1E3559706`
- `build\release\VRCSM_v0.14.5_x64_Installer.msi`
  - SHA256: `767E874F0A3DE6C35699EA37510864486BEEE2E28F64EBDF5682601EC0274449`

## Last Verified Build (2026-06-23 OSC usability + SMBIOS fallback slice)

- `web\node_modules\.bin\tsc.cmd -b web\tsconfig.json --pretty false`: passed.
- Locale integrity script over `web/src/i18n/locales/*.json`: passed; no `???` in new OSC Studio keys.
- `cmd.exe /c ... cmake --build --preset x64-release --target vrcsm_core --parallel 1`: passed after adding SMBIOS parser.
- Local RSMB probe: `GetSystemFirmwareTable(0x52534D42, 0, nullptr, 0)` returned 4736 bytes; reversed signature returned 0.
- `node .\node_modules\vitest\vitest.mjs run src/__tests__/pages-smoke.test.tsx -t "/tools/osc"` from `web\`: passed, 1/1 selected.
- `node .\node_modules\vitest\vitest.mjs run src/__tests__/pages-smoke.test.tsx` from `web\`: passed, 23/23.
- `.\node_modules\.bin\vite.cmd build` from `web\`: passed; emitted existing large-chunk warnings.
- First release host relink failed with `LNK1104 cannot open file src\host\VRCSM.exe` because the prior smoke-started VRCSM process was still running. The process was stopped and the same build command then passed.
- `cmd.exe /c ... cmake --build --preset x64-release --target vrcsm --parallel 1`: passed and synced `web/dist` into release host output.
- `ctest --test-dir build\x64-release --output-on-failure`: passed, 48/48.

## Last Verified Build (2026-06-24 asset-cache/lazy metadata slice)

- `web\node_modules\.bin\tsc.CMD -b --pretty false` from `web\`: passed.
- `cmd.exe /c ... cmake --build --preset x64-release --target VRCSM_Tests --parallel 1`: passed.
- `build\x64-release\tests\VRCSM_Tests.exe --gtest_filter=CommonTests.AssetCacheKeepsVerifiedDataOverHints:CommonTests.GlobalSearchMergesFavoriteAndVisitEvidence:CommonTests.DatabaseOpenDedupesWorldVisitsBeforeUniqueIndex`: passed, 3/3.
- `cmd.exe /c ... cmake --build --preset x64-release --target vrcsm --parallel 1`: passed; only pre-existing `std::filesystem::u8path` warning in `PluginBridge.cpp`.
- `web\node_modules\.bin\vite.CMD build`: passed; emitted existing empty `react-vendor` and large-chunk warnings.
- First `vitest run src/__tests__/pages-smoke.test.tsx` attempt timed out on `/bundles` and left later assertions with an empty DOM; rerun with verbose reporter and 15s timeout passed 23/23. Treat the verbose full pass as current smoke evidence.
- Release host web bundle was synced with `cmake -DSOURCE=D:/Project/VRCSM/web/dist -DDEST=D:/Project/VRCSM/build/x64-release/src/host/web -P cmake/sync-web-dist.cmake` because `ninja: no work to do` did not rerun POST_BUILD copy.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\package_release.ps1`: passed.
- Startup smoke: `build\x64-release\src\host\VRCSM.exe` launched, PID 20916, responding after 8 seconds.

Final local artifacts from this verification:

- `build\release\VRCSM_v0.14.5_x64.zip`
  - Size: 18,728,928 bytes
  - SHA256: `3421E29ADCCF6B0DC660C4665C9348DED49EF556A8B7037158DCB46E7B0D75C9`
- `build\release\VRCSM_v0.14.5_x64_Installer.msi`
  - Size: 8,642,560 bytes
  - SHA256: `A89AEDA07E900FB05C14B364872251FBAF8F45857C1F62D670E9008A692CC78D`
- `git diff --check -- web/src/pages/OscTools.tsx ... src/core/hw/HwTelemetry.cpp`: passed.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\package_release.ps1`: passed.
- Startup smoke: `build\x64-release\src\host\VRCSM.exe` launched, PID 40016, responding after 8 seconds.
- Codex subagent research attempt was launched via `codex.cmd exec ... -o %TEMP%\vrcsm-hw-telemetry-research.txt`, but did not produce useful output during this turn; direct official-source verification and local probes were used instead.

Final local artifacts from this verification:

- `build\release\VRCSM_v0.14.5_x64.zip`
  - SHA256: `19CDD54EDAC35D2B3C7338CF0D987805ECBDB885A01FF6145374A062FE019B28`
- `build\release\VRCSM_v0.14.5_x64_Installer.msi`
  - SHA256: `EED97B6C009D1C1A41078CD27688FC9BDD07C196C4ED2A00CC51A12B9B5EEB89`

## Last Verified Build (2026-06-23 social lazy + OSC DIY composer slice)

- `web\node_modules\.bin\tsc.cmd -b web\tsconfig.json --pretty false`: passed.
- Locale integrity script over `web/src/i18n/locales/*.json`: passed; no `???` in new Social Analytics / OSC Studio keys.
- `node .\node_modules\vitest\vitest.mjs run src/__tests__/pages-smoke.test.tsx -t "/social|/tools/osc"` from `web\`: passed, 1/1 selected.
- `node .\node_modules\vitest\vitest.mjs run src/__tests__/pages-smoke.test.tsx` from `web\`: passed, 23/23.
- `.\node_modules\.bin\vite.cmd build` from `web\`: passed; emitted existing large-chunk warnings.
- Release host web bundle was synced with `cmake -DSOURCE=... -DDEST=... -P cmake/sync-web-dist.cmake` through the VS2026 environment.
- `git diff --check -- web/src/pages/SocialGraph.tsx web/src/pages/OscTools.tsx ...locales`: passed.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\package_release.ps1`: passed.
- Startup smoke: `build\x64-release\src\host\VRCSM.exe` launched, PID 26284, responding after 8 seconds.
- Note: the first targeted vitest attempt used a stale path from inside `web\`; direct `node .\node_modules\vitest\vitest.mjs` was used successfully because the pnpm shim reported "The system cannot find the path specified" in that context.

Final local artifacts from this verification:

- `build\release\VRCSM_v0.14.5_x64.zip`
  - SHA256: `EFE502EA77005C0582FF1E0F79336DCDAEF34987499F33A70E9CC0AA8DA8C520`
- `build\release\VRCSM_v0.14.5_x64_Installer.msi`
  - SHA256: `11C1742EE35315D6DA350970511A64BDA04C7EFAEDDA6A96909C6255A7EFCA59`

## Last Verified Build (2026-06-23 OSC Studio card-builder slice)

- `web\node_modules\.bin\tsc.cmd -b web\tsconfig.json --pretty false`: passed.
- Locale integrity script over `web/src/i18n/locales/*.json`: passed; no `???` in new OSC Studio keys.
- `node_modules\.bin\vitest.cmd run src/__tests__/pages-smoke.test.tsx -t "/tools/osc"` from `web\`: passed, 1/1 selected.
- `node_modules\.bin\vitest.cmd run src/__tests__/pages-smoke.test.tsx` from `web\`: passed, 23/23.
- `node_modules\.bin\vite.cmd build` from `web\`: passed; emitted existing large-chunk warnings.
- Release host web bundle was synced with `cmake -DSOURCE=... -DDEST=... -P cmake/sync-web-dist.cmake` through the VS2026 environment.
- `git diff --check`: no whitespace errors; only line-ending warnings for existing files.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\package_release.ps1`: passed.
- Startup smoke: `build\x64-release\src\host\VRCSM.exe` launched, PID 44228, responding after 8 seconds.

Final local artifacts from this verification:

- `build\release\VRCSM_v0.14.5_x64.zip`
  - Size: 18,625,983 bytes
  - SHA256: `83B29EEB3CD39C2C5C8B1391D0AB62365AA0B999E3A41353313AA235C7F3A5C2`
- `build\release\VRCSM_v0.14.5_x64_Installer.msi`
  - Size: 8,617,984 bytes
  - SHA256: `BC75F32652FE6A1C7DF0859ED9F63D6F55ED46E87992364AD3212C77DB225A2F`

## Last Verified Build (2026-06-23 friends/i18n/scan responsiveness slice)

- `web\node_modules\.bin\tsc.cmd -b web\tsconfig.json --pretty false`: passed.
- `node_modules\.bin\vitest.cmd run src/__tests__/pages-smoke.test.tsx` from `web\`: passed, 23/23.
- `node_modules\.bin\vite.cmd build` from `web\`: passed; emitted existing large-chunk warnings.
- `cmd.exe /c 'call "D:\Software\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 && cmake --build --preset x64-release --target vrcsm --parallel 1'`: passed and synced `web/dist` into the release host output. Warnings were existing `std::filesystem::u8path` deprecation in `PluginBridge.cpp` plus googletest CMake deprecation warnings.
- `cmd.exe /c 'call "D:\Software\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 && ctest --test-dir build\x64-release --output-on-failure'`: passed, 48/48.
- `git diff --check`: no whitespace errors; only line-ending warnings for `package_release.ps1`, `scripts/build-msi.bat`, and `web/src/pages/Worlds.tsx`.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\package_release.ps1`: passed.

Final local artifacts from this verification:

- `build\release\VRCSM_v0.14.5_x64.zip`
  - Size: 18,621,561 bytes
  - SHA256: `3D5FCE3543DAF15C5F0EA9EAF50E2A34B7C218A8A7D1AEB19EEB7FA62E4A33AA`
- `build\release\VRCSM_v0.14.5_x64_Installer.msi`
  - Size: 8,622,080 bytes
  - SHA256: `E9147718B0632E206FE0057836525D365B6C4CC66DDD788ADB7D6332087BDC71`

## Last Verified Build (2026-06-23 OSC telemetry slice)

- `web\node_modules\.bin\tsc.cmd -b web\tsconfig.json --pretty false`: passed.
- `node_modules\.bin\vite.cmd build` from `web\`: passed; emitted existing large-chunk warnings.
- `cmd.exe /s /c 'call "D:\Software\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 && cmake --build --preset x64-debug --target vrcsm_core_hw --parallel 1'`: passed.
- `cmd.exe /s /c 'call "D:\Software\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 && cmake --build --preset x64-debug --target vrcsm --parallel 1'`: passed and synced `web/dist` into the debug host output.

Final local artifacts from this verification:

- `build\release\VRCSM_v0.14.5_x64.zip`
  - Size: 18,525,688 bytes
  - SHA256: `CF3C001901C40B1515FCBDB315704EE3329CA375C0B1608A0708179E1BC6A747`
- `build\release\VRCSM_v0.14.5_x64_Installer.msi`
  - Size: 8,568,832 bytes
  - SHA256: `528B95E1C4D83E8CF9FA680274704737046B7D2D101619A52E588719E2D77C63`

## Last Verified Build (2026-05-09)

- Web build: passed (tsc -b + vite build).
- Web smoke: passed (22/22).
- C++ release build: passed (MSVC 2026, Ninja).
- CTest: 39/39 passed (100%).
- MSI + ZIP: built at `build\release\VRCSM_v0.14.5_x64_*`.
- GitHub release v0.14.5 created with artifacts.

## Release Workflow (corrected)

```powershell
# 1. Build frontend
corepack pnpm --dir web build
web\node_modules\.bin\vitest.cmd run src/__tests__/pages-smoke.test.tsx
# 2. Build C++ (VS2026)
cmd.exe /s /c '"D:\Software\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 && cmake --build --preset x64-release'
ctest --test-dir build\x64-release --output-on-failure
# 3. Package MSI + ZIP
powershell -NoProfile -ExecutionPolicy Bypass -File .\package_release.ps1
# 4. Tag + Release
git tag -a v0.14.6 -m "VRCSM v0.14.6"
git push origin main --tags
gh release create v0.14.6 --title "VRCSM v0.14.6" --notes-file CHANGELOG.md
gh release upload v0.14.6 "build\release\VRCSM_v0.14.6_x64_Installer.msi" "build\release\VRCSM_v0.14.6_x64.zip" --clobber
```

## Known Watch Points

- Stop `VRCSM.exe` before C++ build or linker may fail with file lock.
- `D:\Software\Microsoft Visual Studio\18` is the correct VS path on this machine.
- WiX can be repo-local at `build\tools\wix.exe`; the packaging scripts now find it automatically. A local install command that worked here was `D:\Software\dotnet\dotnet.exe tool install --tool-path build\tools wix --version 6.*`.
- Ninja and cmake may need reinstall after system updates (use `pip install ninja cmake`).
- `react-router-dom` must stay at v6 (v7 breaks the app); `pnpm-lock.yaml` was updated.
- Do not commit `web/dist`, `build/`, or MSI artifacts.
- `stripUnresolvedHashSuffix()` uses regex `_[0-9a-f]{4,}$` - legitimate names ending in 4+ hex chars after underscore will be incorrectly trimmed. This is a known tradeoff.
- Before adding VRCX-inspired UI features, read `docs/UI-REPAIR-VRCX-PARITY-PLAN.md`; prefer library wrappers such as `social.ts`, `history-api.ts`, `vrchat-api.ts`, `media-api.ts`, and `shell-api.ts` over raw `ipc.call` in pages.

## If The User Says "Continue"

1. `git status --short`
2. Read `MEMORY.md` and this file.
3. Inspect the feature area before changing code.
4. Full verification baseline + MSI before claiming done.
5. Commit, push, tag, release with artifacts.

## Do Not Regress These Decisions

- Log backfill must run every startup (not only when DB is empty).
- `vrchat://launch` must use REST API when VRChat is running.
- Non-friend player names must be cleaned of hex hash suffix.
- Avatar thumbnail semantics: wearer profile images are reference only.
- SteamVR repairs must be backup-first.
- Plugin permissions must stay split and explicit.
- BoopCard should stay simple (emoji wheel only, no message type tabs).
