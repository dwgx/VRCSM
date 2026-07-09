# AGENTS.md

This file provides guidance to Codex agents when working with code in this repository. It mirrors `CLAUDE.md`; keep the two synchronized on architecture, build, and baseline facts.

## Continuity Documents

Before changing code in a fresh session, read:

1. `MEMORY.md` — repo-local current state and verification baseline.
2. `docs/NEXT-AGENT-HANDOFF.md` — latest continuation notes, sensitive decisions, and recent verification.
3. `docs/MD-INDEX.md` — Markdown document map and reading order.

These docs are the handoff surface for future agents. Keep them updated when shipping a release-facing change or changing avatar thumbnail, SteamVR repair, plugin IPC, cache, or packaging behavior.

## Build Commands

**Prerequisites:** MSVC 2026 (VS18), CMake 3.28+, Ninja, vcpkg (at `third_party/vcpkg`), pnpm

```bash
# Configure + build (debug)
cmake --preset x64-debug && cmake --build --preset x64-debug

# Release
cmake --preset x64-release && cmake --build --preset x64-release

# Run
./build/x64-debug/src/host/VRCSM.exe

# Frontend dev server (hot reload, mock IPC — not inside WebView2)
cd web && pnpm dev

# Build frontend only
cd web && pnpm build    # runs tsc -b && vite build

# MSI installer (requires dotnet tool wix)
scripts/build-msi.bat
```

The CMake post-build step (`cmake/sync-web-dist.cmake`) copies `web/dist/` into the build output's `web/` folder so the WebView2 host can serve it. Rebuild the frontend with `pnpm build` in `web/` before rebuilding the C++ host if you changed frontend code.

Tests: C++ `ctest --test-dir build\x64-release`, web `pnpm test` (vitest) and `pnpm test:smoke` (Playwright UI smoke). Current green baseline: ctest 151/151 (3 opt-in live network probes DISABLED by default), 366 vitest, Playwright UI smoke 54/54, `tsc` + build clean. Run the full web vitest with `--no-file-parallelism` — the default parallel runner flakes ~25 fails in the two heavy render suites (contention, not a regression). See `MEMORY.md` for the full verification sequence.

## Architecture

VRCSM is a three-layer desktop app: a **C++ Win32 host** embedding **WebView2** that renders a **React SPA**, backed by a platform-agnostic **C++ core** library.

### Layers

```
┌──────────────────────────────────────────────┐
│  web/  (React 19 + Vite + Tailwind + shadcn) │  ← UI only, no platform logic
├──────────────────────────────────────────────┤
│  src/host/  (Win32 window + WebView2 + IPC)  │  ← thin shell, dispatches to core
├──────────────────────────────────────────────┤
│  src/core/  (platform-agnostic C++ library)  │  ← all VRChat logic lives here
└──────────────────────────────────────────────┘
```

- **`src/core/`** — Static library (`vrcsm_core`, ~52 modules). Contains all VRChat-specific logic: cache scanning (`CacheScanner`, `CacheIndex`), log parsing (`LogParser`, `LogTailer`, `LogAtoms`, `LogEventClassifier`), bundle/mesh work (`BundleSniff`, `UnityBundle`, `UnityMesh`, `UnityPreview`), path resolution (`PathProbe`), NTFS junction migration (`Migrator`, `JunctionUtil`), safe deletion (`SafeDelete`), VRChat API calls (`VrcApi`) over the extracted WinHTTP transport (`HttpClient`, `vrcsm::core::http`), auth/session (`AuthStore`), settings (`VrcSettings`, `VrcConfig`), avatar preview (`AvatarPreview`, `AvatarData`, `AvatarIdHarvest`, `PngMetadata`). It also holds: now-playing media (`NowPlaying`, via C++/WinRT GSMTC), the HTTPS lyrics proxy with SSRF rail (`LyricsProxy`), OSC send/listen (`OscBridge`), Discord rich presence (`DiscordRpc`), radar (`VrcRadarEngine`), process/screenshot/toast/VR-overlay integration (`ProcessMemoryReader`, `ScreenshotWatcher`, `ToastNotifier`, `VrOverlayNotifier`), friend-graph analytics (`FriendAnalytics`), infra (`RateLimiter`, `TaskQueue`, `Pipeline`, `Report`), and the split SQLite layer (`Database.cpp` + 9 domain TUs + `Database_internal.h`). Mostly Win32-free, but several modules (`NowPlaying` via WinRT, `ProcessMemoryReader`, `ScreenshotWatcher`, `ToastNotifier`, `VrOverlayNotifier`, `DiscordRpc`, junction/process) do use platform APIs.
- **`src/host/`** — Win32 executable. `main.cpp` → `App` → `MainWindow` → `WebViewHost` → `IpcBridge`. The host creates a borderless window with Mica backdrop, adds a `Shell_NotifyIconW` system tray icon (minimize-to-tray, self-healing add/modify), initializes WebView2, maps `https://app.vrcsm/` to the local `web/` folder, and routes all IPC through `IpcBridge::DispatchFromOrigin()` (which threads the origin URI through for the plugin sandbox). Method handlers are split across 21 per-domain bridge translation units under `src/host/bridges/` sharing `BridgeCommon.h`.
- **`web/`** — React SPA (~33 page components, 27 mounted as `lazy()` routes in `App.tsx`), TanStack React Query for server state, `AuthContext`/`ReportContext` for shared state, i18next for localization across 7 locales (`en`, `zh-CN`, `ja`, `ko`, `ru`, `th`, `hi`) at full parity, non-default locales lazy-loaded.

### IPC Protocol

JSON-RPC style over `postMessage`/`PostWebMessageAsString`:

```
Request:  { id: "uuid", method: "scan", params: {} }
Response: { id: "uuid", result: {...} }  or  { id: "uuid", error: { code, message } }
Event:    { event: "migrate.progress", data: {...} }   // unsolicited push
```

Frontend side: `web/src/lib/ipc.ts` — `IpcClient` class handles pending promises, `IpcError` carries structured error codes.
Host side: `IpcBridge::DispatchFromOrigin()` is the entry point (the `Dispatch()` inline defaults the origin to `https://app.vrcsm/`); it matches method strings to handler functions registered from the per-domain bridge files in `src/host/bridges/`. Methods listed in `AsyncMethodSet()` spawn a detached worker thread; the result is marshaled back to the UI thread via `WM_APP_POST_WEB_MESSAGE`. Recent methods include `music.nowPlaying` (GSMTC now-playing media) and `lyrics.fetch` (HTTPS lyrics proxy).

### Error Handling

C++ core uses `vrcsm::core::Result<T>` (`std::variant<T, Error>`) — no exceptions in core. The `Error` struct has `code`, `message`, `httpStatus`. IpcBridge converts `Result` failures into JSON error responses. Frontend receives them as `IpcError` exceptions with machine-readable `.code`.

## Key Constraints

- **Never modify user VRChat data during dev.** Use temp dirs for tests. Destructive ops default to dry-run.
- **Detect VRChat.exe before migration/delete** — block if running (`ProcessGuard`).
- **NTFS junctions** for migration, not symlinks (no admin rights needed).
- **Preserve `__info` and `vrc-version`** at `Cache-WindowsPlayer` root when bulk-deleting.
- **UTF-8 everywhere.** `wchar_t` only at Win32 API boundaries; convert immediately with `toUtf8()`/`toWide()`.

## Coding Standards

**C++:** C++20, `#pragma once`, PascalCase types, camelCase vars, kCamelCase constants. Use `nlohmann::json`, `fmt`, `spdlog`. No `using namespace std;` in headers. MSVC flags: `/utf-8 /W4 /permissive- /EHsc`.

**TypeScript:** Strict mode, no `any`, function components only, Tailwind utility classes, shadcn/ui patterns.

## Tech Stack (locked — do not deviate)

C++20 + WebView2 + React 19 + Vite 6 + Tailwind 4 + shadcn/ui + WiX v7. **Forbidden:** Qt, WinForms, WPF, Electron, Tauri, MFC, ATL, GDI, FLTK, wxWidgets.

## VRChat Data Paths

Base: `%LocalLow%\VRChat\VRChat\`. Cache entries are hex-named dirs under `Cache-WindowsPlayer/` containing `__info` (text) and `__data` (UnityFS binary). `LocalAvatarData/<usr_xxx>/<avtr_xxx>` are JSON files. Logs are `output_log_<timestamp>.txt` at the base dir.
