# 构建 / 测试 / i18n / 打包发布

> 上级：[参考文档索引](README.md)　|　相关：[核心 hw/updater/plugins](core/hw-updater-plugins.md)、[插件安全](flows/plugin-security.md)

本页覆盖构建图、测试面、i18n 键模型、随包插件、发布打包流程。构建命令的权威来源是 `CLAUDE.md` 的 Build Commands 段。

## 1. 构建图

### 1.1 版本单一真源

`CMakeLists.txt:5-8` 读取仓库根 `VERSION` 文件（当前 `0.14.6`）作为 `project(VRCSM VERSION ...)`，派生 `VRCSM_PRODUCT_VERSION`（`a.b.c.0`）与逗号分隔的 `VRCSM_FILE_VERSION`，供 `resources/app.rc` 用 `@ONLY` 展开。C++20、无扩展、标准强制；MSVC 全局 `/utf-8 /W4 /permissive- /Zc:__cplusplus /MP /EHsc` + `NOMINMAX/WIN32_LEAN_AND_MEAN/UNICODE`。运行时库为动态多线程（`CMAKE_MSVC_RUNTIME_LIBRARY`）—— 对 gtest 一致性重要。

### 1.2 目标依赖树

```
VRCSM.exe (vrcsm, WIN32)                 src/host/CMakeLists.txt:4
├── vrcsm_core (STATIC)                  src/core/CMakeLists.txt:1
│   ├── vrcsm_core_updater (STATIC)      winhttp / bcrypt (SHA256)
│   └── vrcsm_core_hw (STATIC)           wbemuuid / dxgi / winhttp
├── webview2 / WIL                       src/host/CMakeLists.txt:61-62
└── Win32: dwmapi shcore ole32 ...       :63-71

VRCSM_Tests                              tests/CMakeLists.txt:13
├── vrcsm_core                           （仅链 core，不链 host）
└── gtest_main (FetchContent)
```

`vrcsm_core` 静态编入 vendored `third_party/sqlite-vec/sqlite-vec.c`（`SQLITE_CORE=1`，静态链接直连 API），经 `sqlite3_auto_extension` 在 `Database::Open` 注册。PUBLIC 依赖 `sqlite3 / lz4 / LibLZMA`。host 显式 `/MANIFEST:NO`（自带 manifest 走 `resources/app.manifest`）。20 个 bridge 源文件按域拆分。

### 1.3 post-build 同步（关键耦合）

host 目标有三条 POST_BUILD 命令：

1. **web/dist → `<exe_dir>/web`**（`sync-web-dist.cmake`）：源缺失优雅 no-op，存在则先 `REMOVE_RECURSE` 目的地再全量 `file(COPY)`（刻意清桩防旧 chunk 泄漏）。
2. **图标 → `<exe_dir>/VRCSM.ico`**。
3. **plugins/ → `<exe_dir>/plugins`**（`sync-plugins.cmake`）：与 web 同构。

> [!IMPORTANT] `web/dist` **不由 CMake 生成**。改前端后必须先 `pnpm build`（`web/package.json:8` = `tsc -b && vite build`）再重建 C++，否则 host 拷贝旧 bundle 或触发 no-op（脚本注释明说）。

### 1.4 前端构建

Vite：`base:"./"`（适配 `https://app.vrcsm/` 虚拟主机）；注入 `__VRCSM_ASSET_REV__`（ISO 时间戳）；手动分包 `react-vendor/three-vendor/ui-vendor`；`target:esnext`、`sourcemap:false`、`emptyOutDir:true`。TS 严格模式全开（`noUnusedLocals/Parameters`、`noImplicitReturns`、`isolatedModules`、`noEmit`），别名 `@/*`。注意 `exactOptionalPropertyTypes:false`。

## 2. i18n 键模型

### 2.1 运行时装配

`web/src/i18n/index.ts` 静态 import 7 个 locale JSON（en/ja/ko/ru/th/hi/zh-CN），`fallbackLng:"en"`，探测顺序 `localStorage → navigator`，持久化键 `vrcsm.language`，`escapeValue:false`。

### 2.2 键覆盖度（实测）

以 `en.json` 扁平化为源共 1833 键。各语言缺口：

| locale | keys | 缺失（en 有它无） | 多余（它有 en 无） |
|---|---|---|---|
| zh-CN | 2603 | 0 | 770 |
| ja / ko / ru / hi | 1548 | 295 | 10 |
| th | 1567 | 297 | 31 |

> [!WARNING] **i18n 有真实漂移，且无门禁捕获**：
> - **zh-CN 是事实超集**（+770 键，整棵 `vrchatWorkspace.*` 只在中文里）—— en 源落后于中文。翻译脚本以 en 为源（`i18n-translate.mjs:26`），且写回时只接受 en 中存在的键（`:269`），故这些仅中文存在的键**结构上无法回填**其他语言。
> - ja/ko/ru/hi 各缺 295、th 缺 297（整棵 `vrcPlus.*`、`nav.models` 等）—— VRC+ 新页面翻译未补齐，运行时回退英文。
> - 无任何构建期/测试期 i18n 校验门禁，键漂移不会让 `pnpm build` 或 vitest 失败。唯一检查手段是手动 `pnpm i18n:check`。

### 2.3 翻译脚本

`web/scripts/i18n-translate.mjs` 离线批量翻译器（以 en 为源补缺）。扁平化点号键、分批+并发池、每语言人设提示强制保留 `{{placeholders}}`/ICU/HTML。`--dry-run` 只报告。

> [!WARNING] **密钥卫生**：`i18n-translate.mjs:29` 硬编码默认 API key 字面量，已提交进仓库。虽是自建兼容端点、危害有限，仍属密钥卫生问题，建议改为纯环境变量、移除默认值。

## 3. 测试面

### 3.1 C++ 测试（gtest）

单一可执行体 `VRCSM_Tests`，源 `main.cpp` + `CommonTests.cpp`（84 个 TEST/TEST_F）+ `PluginManifestTests.cpp`（15 个 TEST），链接 `vrcsm_core + gtest_main`。gtest 经 FetchContent 固定，`gtest_force_shared_crt ON`（与顶层 `MultiThreadedDLL` 一致）。

`CommonTests.cpp` 覆盖：路径边界 `EnsureWithinBase*`、HW 遥测解析、SafeDelete 保护 CWP 根、Migrator/Junction 越界拒绝、AvatarPreview 缓存键与路径逃逸、AssetCache、avatar 基准 upsert、统一 feed/co-presence/好友预测、全局搜索、DB 世界访问去重、**UpdatePackage 校验（installer 目录约束、SHA256 缺失/错配）**、SteamVR 修复根/备份边界、**插件权限拆分（`ipc:shell` 不得触碰文件系统）**、UnityFS 截断 magic 不可信、LogAtoms/LogParser 全套日志解析、DiscordRpc 帧编解码、Toast/VrOverlay 格式化与门禁。`PluginManifestTests.cpp` 覆盖 SemVer 排序、manifest 形状、`SanitizePluginId` 目录穿越防护。

> [!NOTE] **C++ 测试盲区**：只链 `vrcsm_core`。host/IpcBridge/WebView/20 个 bridge、真实 HTTP（VrcApi）、真实 junction/删除的端到端**完全无 C++ 单测覆盖**（仅测 preflight 拒绝路径）。

### 3.2 前端测试（vitest + jsdom）

- **pages-smoke**（`web/src/__tests__/pages-smoke.test.tsx`）：mock IPC 下渲染真实 App 路由，`ROUTES` 数组覆盖 21 条路由（`:128-149`），断言到达非 fallback 首屏、不触发 `RouteErrorBoundary`。
- **interaction-smoke**（`web/src/__tests__/interaction-smoke.test.tsx`）：深度版，`ROUTES` 数组覆盖 27 条路由（`:408-436`），枚举每条路由所有可交互元素逐一点击，捕三类失败：RouteErrorBoundary 崩溃、未处理 promise rejection、`IpcError("mock_not_implemented")`（= dead interaction / mock 漂移）。

> [!NOTE] **前端测试盲区**：全走 mock IPC，mock 与真实 host 的漂移仅被 interaction-smoke 被动暴露（`mock_not_implemented`）。无 i18n 键完整性测试，无 e2e/Playwright。

## 4. 随包插件

仓库 `plugins/` 下两个：**hello**（`dev.vrcsm.hello`，panel，权限仅 `ipc:vrc:cache`，参考插件）与 **vrc-auto-uploader**（`dev.vrcsm.autouploader`，panel，5 项权限，`autoInstall:false`，带 Python 后端 + Unity C# 脚本）。两者形状均符合 `PluginManifestTests` 校验的契约，经 §1.3 sync-plugins POST_BUILD 拷到 `<exe_dir>/plugins`。插件信任模型见 [插件安全专章](flows/plugin-security.md)。

## 5. 发布 / 打包流程

`package_release.ps1` 端到端打包器（需先手动 `cmake --build --preset x64-release`，它不自己触发构建）：

1. **前置**：版本来自 `VERSION`，校验 `build/x64-release/src/host/VRCSM.exe` 与 `.../web/index.html` 存在（依赖 §1.3 post-build 已跑）。定位 wix.exe。
2. **ZIP**：把 `build/x64-release/src/host` 整目录（排除 `.old` 陈旧备份）压缩。ZIP 内含 exe + dll + web/ + plugins/。
3. **MSI**：`wix build vrcsm.wxs -arch x64`。`vrcsm.wxs` 为 **perUser** 安装到 `LocalAppData\VRCSM`，四个组件组：HostFiles/WebFiles/BundledPlugins/Shortcuts。`MajorUpgrade` 允许同版本升级。
4. **SHA256 + release-notes**：算 MSI/ZIP 的 SHA256，生成 `..._release-notes.txt`，含 `SHA256: <hex>` 行。

> [!IMPORTANT] **`SHA256:` 行是硬约束**：in-app updater（`UpdatePackage.cpp`）要求 GitHub release notes 里有匹配的 `SHA256:` 行，否则拒装（fail-closed）。这条约束由 `CommonTests` 的 `UpdatePackageValidationRejectsMissingSha256/WrongSha256` 守护。粘贴该行是强制发布步骤。见 [更新子系统文档](core/hw-updater-plugins.md#二更新子系统srccoreupdater)。

版本一致性：`VERSION=0.14.6` 与 `web/package.json` 一致，与最近 release commit 吻合。

## 关键交接要点

1. **i18n 漂移**：zh-CN 超集 +770 键，其他语言缺 295~297；翻译脚本结构上只从 en 生成，无法回填中文独有键；无构建/测试门禁。
2. **密钥卫生**：`i18n-translate.mjs:29` 硬编码默认 API key。
3. **测试盲区**：C++ 测试只链 core；前端全走 mock。
4. **构建耦合**：`web/dist` 非 CMake 生成物，改前端后必须先 `pnpm build` 再重建 host。

## 相关文件

- `CMakeLists.txt`、`CMakePresets.json`、`cmake/sync-web-dist.cmake`、`cmake/sync-plugins.cmake`
- `src/host/CMakeLists.txt`、`src/core/CMakeLists.txt`、`tests/CMakeLists.txt`、`tests/CommonTests.cpp`、`tests/PluginManifestTests.cpp`
- `web/package.json`、`web/vite.config.ts`、`web/vitest.config.ts`、`web/src/i18n/index.ts`、`web/scripts/i18n-translate.mjs`
- `web/src/__tests__/{pages-smoke,interaction-smoke}.test.tsx`
- `package_release.ps1`、`installer/vrcsm.wxs`、`plugins/{hello,vrc-auto-uploader}/manifest.json`
