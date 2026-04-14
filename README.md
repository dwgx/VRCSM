# VRC Settings Manager (VRCSM)

*a.k.a. VRC Shit Manager — because Settings == Shit when SM stays the same*

中文：一个用于扫描、预览、清理和迁移 VRChat 本地缓存的 Windows 桌面工具。

VRCSM is a Windows desktop app for inspecting VRChat local data, previewing cache entries, deleting removable data safely, migrating large cache folders off the system drive with junctions, and exposing a small settings surface. It exists because the original Python prototype proved the workflow, but a native C++ host with a WebView2 UI is a better fit for a modern Windows 11 tool.

Features:
- Scan VRChat data categories and summarize size, file counts, timestamps, and broken links
- Preview cache bundle metadata before taking action
- Delete removable cache and data entries with dry-run-first behavior
- Migrate cache directories from `C:` to another drive using NTFS junctions
- Read and write VRChat-related settings exposed by the app

Stack: `C++20` · `WebView2` · `React` · `Vite` · `Tailwind` · `shadcn/ui` · `WiX v7`

## Quick Start

Prerequisites:
- Windows 10 22H2 or newer, x64
- Visual Studio 2026 Build Tools or newer with MSVC
- CMake 3.28+
- Ninja
- Git

This repository expects `third_party/vcpkg` to exist as the vcpkg checkout used by CMake presets.

Configure:

```powershell
cmake --preset x64-debug
```

Build:

```powershell
cmake --build --preset x64-debug
```

Run:

```powershell
.\build\x64-debug\src\host\VRCSM.exe
```

Release preset:

```powershell
cmake --preset x64-release
cmake --build --preset x64-release
```

Notes:
- Dependencies are resolved through vcpkg manifest mode
- The frontend is hosted by WebView2 at `https://app.vrcsm/`
- Tests are not wired into the top-level build yet
