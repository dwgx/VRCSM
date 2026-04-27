# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

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

## Architecture

VRCSM is a two-layer desktop app: a **C++ Win32 host** embedding **WebView2** that renders a **React SPA**.

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

- **`src/core/`** — Static library (`vrcsm_core`). Contains all VRChat-specific logic: cache scanning (`CacheScanner`), log parsing (`LogParser`, `LogTailer`), bundle metadata (`BundleSniff`), path resolution (`PathProbe`), NTFS junction migration (`Migrator`, `JunctionUtil`), safe deletion (`SafeDelete`), VRChat API calls (`VrcApi`), auth/session (`AuthStore`), settings (`VrcSettings`, `VrcConfig`), avatar preview (`AvatarPreview`). Has **zero Win32 deps** except junction/process modules.
- **`src/host/`** — Win32 executable. `main.cpp` → `App` → `MainWindow` → `WebViewHost` → `IpcBridge`. The host creates a borderless window with Mica backdrop, initializes WebView2, maps `https://app.vrcsm/` to the local `web/` folder, and routes all IPC through `IpcBridge::Dispatch()`.
- **`web/`** — React SPA with 10 lazy-loaded pages, TanStack React Query for server state, `AuthContext`/`ReportContext` for shared state, i18next for localization.

### IPC Protocol

JSON-RPC style over `postMessage`/`PostWebMessageAsString`:

```
Request:  { id: "uuid", method: "scan", params: {} }
Response: { id: "uuid", result: {...} }  or  { id: "uuid", error: { code, message } }
Event:    { event: "migrate.progress", data: {...} }   // unsolicited push
```

Frontend side: `web/src/lib/ipc.ts` — `IpcClient` class handles pending promises, `IpcError` carries structured error codes.
Host side: `IpcBridge::Dispatch()` matches method strings to handler functions. Methods listed in `AsyncMethodSet()` spawn a detached worker thread; the result is marshaled back to the UI thread via `WM_APP_POST_WEB_MESSAGE`.

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
