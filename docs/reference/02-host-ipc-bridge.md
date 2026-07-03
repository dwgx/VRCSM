# C++ 宿主 + IPC Bridge 方法目录

> 上级：[参考文档索引](README.md)　|　相关：[架构](01-architecture.md)、[IPC 往返链路](flows/ipc-roundtrip.md)、[插件安全](flows/plugin-security.md)

本页覆盖 `src/host/` 的 Win32 外壳、WebView2 初始化、IPC 路由，以及全部 IPC 方法目录。宿主本身不含 VRChat 业务逻辑，全部转发给 core。

## 1. 宿主启动与模块图

```
wWinMain (main.cpp:24)
  ├─ SetProcessDpiAwarenessContext + OleInitialize
  ├─ RegisterProtocolHandlers()      (UrlProtocol.cpp:123 — vrcsm:// / vrcx://)
  ├─ ToastNotifier::EnsureSetup()
  └─ App::Run (App.cpp:53)
       ├─ InitializeLogging()               (spdlog rotating sink)
       ├─ HandlePendingFactoryReset()       (启动时擦除 WebView2 用户数据)
       ├─ MainWindow::Create (MainWindow.cpp:12)
       │    └─ WebViewHost::Initialize (WebViewHost.cpp:47)
       │         └─ IpcBridge (WebViewHost.cpp:40-42)
       └─ GetMessageW 消息循环
```

`MainWindow` 持 `unique_ptr<WebViewHost>`；`WebViewHost` 构造时创建 `unique_ptr<IpcBridge>`；`IpcBridge` 持 `WebViewHost&` 反向引用。IPC 处理函数实现分散在 `bridges/*.cpp`（20 个文件），`RegisterHandlers()`（`IpcBridge.cpp:607`）只做"方法名 → lambda"接线。

## 2. 窗口与 WebView2 虚拟主机映射

无边框 Mica 窗口（`DWMWA_SYSTEMBACKDROP_TYPE=DWMSBT_MAINWINDOW`）。`ConfigureWebView()` 注册 5 个固定虚拟主机 + N 个插件主机：

| 虚拟主机 | 映射目录 | 访问策略 | 位置 |
|---|---|---|---|
| `app.vrcsm` | `<exeDir>/web` | ALLOW | WebViewHost.cpp:270-273 |
| `preview.local` | `AvatarPreview::PreviewCacheDir()` | ALLOW | :297-300 |
| `thumb.local` | `<appData>/thumb-cache-files` | ALLOW | :311-314 |
| `screenshots.local` | 检测到的截图根 | ALLOW | :326-329 |
| `screenshot-thumbs.local` | `ScreenshotThumbs::CacheDir()` | ALLOW | :341-344 |
| `plugin.<id>.vrcsm` | 插件 installDir | **DENY_CORS** | :351/659-662 |

### 导航与弹窗围栏（安全相关）

- **NewWindowRequested**：`put_Handled(TRUE)` 永不生成第二个 WebView 窗口；http(s) 交给 OS 浏览器，其它 scheme 吞掉。
- **NavigationStarting**：顶层帧白名单只有 `app.vrcsm`；`about:`/`data:` 放行，其余 `put_Cancel`。阻止脚本把顶层帧导航到外部源后仍访问 `chrome.webview.postMessage`。
- **`HostOfUri`**：小写化并剥离 userinfo/port，防 `evil.com@app.vrcsm` 绕过。
- **登出 cookie 清理**（`ClearVrcCookies`）：全量枚举删除 `auth`/`twoFactorAuth`，规避 VRChat 通配域导致的定向删除失效。

## 3. IPC 路由：DispatchFromOrigin

入口 `DispatchFromOrigin(originUri, jsonText)`（`IpcBridge.cpp:442`）。流程：

1. 解析 JSON 信封取 `id`/`method`/`params`。
2. **源分类**（`:459-478`）：插件源 → `callerPluginId`；host≠`app.vrcsm` → `forbidden_origin`；插件源但方法不在 `PluginReachableMethods()`（只含 `plugin.rpc`）→ `forbidden_origin`。
3. **插件处理器路径**：命中 `m_pluginHandlers`（带第三参 `callerPluginId`）→ 一律 `EnqueueAsync` 异步。
4. **常规处理器路径**：命中 `m_handlers`；方法在 `AsyncMethodSet()`（`:98-293`，约 180 个方法）则入线程池，否则 UI 线程内联。未命中 → `method_not_found`。

异常收敛：`IpcException` 保留稳定 code，`std::exception` → `handler_error`。完整往返（含线程池、`WM_APP_POST_WEB_MESSAGE` 编组、优雅关闭）见 [IPC 往返链路专章](flows/ipc-roundtrip.md)。

Handler 签名：`json Handle*(const json& params, const optional<string>& id)`，返回 JSON 或抛 `IpcException{Error{code,message,httpStatus}}`。共享辅助 `bridges/BridgeCommon.h`：`JsonStringField`、`unwrapResult`（把 `Result<json>` 失败转 throw）、`ParamInt`、`ToJson`。

## 4. 方法目录

> 约定：**async** = 在 `AsyncMethodSet()` 中（线程池 worker）；**sync** = UI 线程内联。core delegate 列出委托的核心模块。所有方法注册于 `IpcBridge.cpp:607-853`。

### 4.1 AuthBridge（core：VrcApi / AuthStore）

| 方法 | 参数 | 结果 | 委托 | 同步性 |
|---|---|---|---|---|
| `auth.status` | — | `{authed, displayName, userId}` | `fetchCurrentUser`；`auth_expired` 时 `AuthStore::Clear` | async |
| `auth.login` | `{username, password}` | `{status, user?, twoFactorMethods?, ...}` | `loginWithPassword`；成功推 `auth.loginCompleted` 事件；creds `secureClearString` 擦除 | async |
| `auth.verify2FA` | `{method="totp", code}` | `{ok, user?, ...}` | `verifyTwoFactor` + `fetchCurrentUser` | async |
| `auth.logout` | — | `{ok:true}` | `AuthStore::Clear` + `ClearVrcCookies()` | async |
| `auth.user` | — | `{authed, user}` | `fetchCurrentUser` | async |

> 密码 locals 在所有返回路径安全擦除；注释 `AuthBridge.cpp:53-56` 标注 `params` JSON 拷贝**未**被擦除。

### 4.2 CacheBridge（core：PathProbe / LogParser / CacheScanner / BundleSniff / SafeDelete / Database）

| 方法 | 参数 | 结果 | 委托 | 同步性 |
|---|---|---|---|---|
| `scan` | — | 完整缓存报告 JSON | `PathProbe::Probe` + 日志回填 `RecordAvatarSeen` + `buildReport` + `PersistAvatarBenchmarks` | async |
| `bundle.preview` | `{entry}` | sniff JSON + `{infoText, versionPath, dataPath}` | `ensureWithinBase` 路径逃逸守卫 + `BundleSniff::sniff` | async |
| `delete.dryRun` | delete-target | `ResolveTargets` JSON | `SafeDelete::ResolveTargets` | async |
| `delete.execute` | delete-target | `{deleted:N}`（error 形态转 IpcException） | `SafeDelete::Execute` | async |

### 4.3 EventBridge（core：Database 事件录制，全 async）

`event.start` / `event.stop` / `event.delete` / `event.list` / `event.attendees` / `event.addAttendee` → `Database::StartRecording/StopRecording/DeleteRecording/ListRecordings/RecordingAttendees/AddAttendee`。缺字段抛 `IpcException{"missing_field",...,400}`。

### 4.4 HwBridge（core：hw::*、SteamVrConfig，全 async）

`hw.applyPreset`（`{tier}` → `PresetForTier` + `SteamVrConfig::Write`）、`hw.detect`、`hw.recommend`（+ 可选社区 feed 覆盖）、`hw.telemetry`。四者都 try/catch 转 `hw_*_failed`。

### 4.5 LogsBridge（core：LogParser / LogTailer / LogEventClassifier / Database / ProcessGuard，全 async）

- `logs.stream.start`：引用计数式 tailer（`m_logTailerMutex`），首个订阅者做日志回填 + spawn `LogTailer`，回调推 `logs.stream` + `logs.stream.event` 事件并持久化分类原子。
- `logs.stream.stop`：递减引用计数，最后一个停止时 `Stop()`。
- `logs.files.clear`：`ProcessGuard::IsVRChatRunning` 跳过活动日志，删 `output_log_*.txt`。

### 4.6 ApiBridge（core：VrcApi 为主，全 async）

最大的一组。缩略图/资产、VRChat REST、Wave-2 社交、头像预览。选摘（完整清单见源码 `ApiBridge.cpp`）：

| 方法组 | 代表方法 | 委托 |
|---|---|---|
| 缩略图/图片 | `thumbnails.fetch`、`images.cache`（cap 64） | `fetchThumbnails`/`cacheImageUrls` |
| 好友/群组 | `friends.list`（+`Database::UpsertAssetCache`）、`groups.list`、`groups.setRepresented` | `fetchFriends`/`fetchGroups` |
| 头像 | `avatar.details`、`avatar.parameters.local`（`AvatarData`）、`avatar.search`、`avatar.select`、`avatars.listOwned`、`avatars.update`、`avatars.delete`(destructive)、`avatars.harvestIds`（`AvatarIdHarvest`，只读本地） | `VrcApi::*` / `AvatarData` / `AvatarIdHarvest` |
| 世界/实例 | `world.details`、`worlds.search`、`instance.details` | `fetchWorldDetails`/`searchWorlds`/`fetchInstance` |
| VRC+ 媒体 | `prints.*`、`files.*`、`inventory.list`、`files.uploadImage` | `VrcApi::*` |
| 头像预览 | `avatar.preview`（`m_previewQueue` + shared-future 去重，emit `avatar.preview.progress`）、`avatar.preview.status`、`avatar.preview.prefetch` | `AvatarPreview` |
| 下载 | `avatar.bundle.download`（拒绝非 https） | `VrcApi::downloadFile` |

> `avatar.preview.abort/retain/release` 三者均注册为 `IpcBridge.cpp` 内联 lambda（abort `:683`、retain `:692`、release `:701`），**不在 ApiBridge**。注意 async 分类有别：`avatar.preview.abort` 收录于 `AsyncMethodSet()`（`IpcBridge.cpp:147`）故走线程池异步派发；`retain`/`release` 为同步内联执行。`user.inviteTo` 注册于 `:749` 但 handler 在 PipelineBridge。

### 4.7 DatabaseBridge（core：Database 为主）

全 async **除 `db.avatarHistory.record`（内联）**。覆盖资产缓存（`assets.resolve/prefetch/invalidate`）、历史读取（`db.worldVisits.list`、`db.playerEvents.list`、`db.playerEncounters`、`db.coPresenceGraph`、`db.avatarHistory.*`、`db.avatarBenchmarks.list`）、统计（`db.stats.heatmap/overview`）、收藏（`favorites.*`）、好友日志/备注/存在（`friendLog.*`、`friendNote.*`、`friendPresence.*`）、统一 feed（`feed.unified`）、以及 **`data.usage` / `data.clear`**。

> `data.usage`/`data.clear` 的磁盘路径由 `getAppDataRoot()` + 编译期常量拼成，caller 的 key 只**选择**固定项、绝不贡献路径段；字节统计与删除都拒绝跟随 NTFS reparse point。表清空经 `Database::ClearTables` 白名单。完整目标映射见 [数据生命周期专章](flows/data-cache-lifecycle.md)。

### 4.8 MigrateBridge（core：Migrator / JunctionUtil，全 async）

`migrate.preflight` / `migrate.execute`（推 `migrate.progress` + `migrate.done` 事件）/ `junction.repair`。三个 handler 都忽略 `callerPluginId`，不做来源校验 —— 依赖 `PermissionTable()` 未收录这些 token，故插件经 `plugin.rpc` 也无法到达。详见 [安全删除/迁移文档](core/safedelete-migrate.md)。

### 4.9 PipelineBridge（core：Pipeline / OscBridge / DiscordRpc / ScreenshotWatcher / VrcApi，全 async）

`pipeline.start/stop`、`notify.setPrefs`、`notifications.*`、`message.send`、`discord.setActivity/clearActivity/status`、`osc.send/listen.start/listen.stop`、`screenshots.watcher.start/stop`、`screenshots.injectMetadata/readMetadata`、`user.inviteTo`。`m_pipeline`/`m_osc`/`m_discordRpc`/`m_screenshotWatcher` 按需惰性创建。详见 [实时集成文档](core/realtime-integrations.md)。

### 4.10 PluginBridge（安全关键，全 async）

两道防线：来源门（`PluginReachableMethods` 只放 `plugin.rpc`）+ `RejectPluginCaller`（管理类方法若 `callerPluginId` 非空即抛 `forbidden_caller`）。管理方法 `plugin.list/install/uninstall/enable/disable/marketFeed`；`plugin.rpc` 是插件访问 host 的唯一入口，经 `CanInvoke` 权限裁决 + `shell.openUrl` 的 `vrchat://` 专项硬拦。完整信任模型见 [插件安全专章](flows/plugin-security.md)。

### 4.11 其余 bridge

| Bridge | 方法 | 同步性 |
|---|---|---|
| RadarBridge | `memory.status`、`radar.poll`（进程内存读取，必须离 UI 线程） | async |
| RuleBridge | `rules.list/get/create/update/delete/setEnabled/history` → `Database::*Rule*` | async |
| ScreenshotBridge | `screenshots.list/open/folder/delete`（均 `ensureWithinBase` + 扩展名白名单） | async |
| SearchBridge | `search.global` → `Database::GlobalSearch` | async |
| SettingsBridge | `settings.readAll/writeOne/exportReg`、`config.read/write`、`steamvr.read/write`(**sync**)、`steamvr.link.diagnose/repair/backups/restore` | 混合 |
| ShellBridge | `app.version`/`path.probe`/`process.vrcRunning`/`shell.pickFolder`/`shell.openUrl`/`autoStart.*`(**sync**)、`fs.listDir/writePlan/appDataDir`/`app.factoryReset`(async) | 混合 |
| UpdateBridge | `update.check/download/install/skipVersion/unskipVersion/getState` | async |
| VectorBridge | `vector.upsertEmbedding/search/getUnindexed/removeEmbedding`（实验视觉搜索） | async |
| VrDiagBridge | `vr.diagnose`、`vr.audio.switch` | async |

> `steamvr.read`/`steamvr.write` 未列入 `AsyncMethodSet`，走 UI 线程内联；`config.read`/`config.write` 已在 async 集。

## 5. 跨切面安全观察

- **源分类是唯一权限边界**：`app.vrcsm` 全权，插件源必须过 `plugin.rpc` 权限门，其它源 `forbidden_origin`。
- **路径安全**：ScreenshotBridge 的 open/folder/delete、ShellBridge 的 fs.* 统一用 `ensureWithinBase` + `weakly_canonical`；`fs.writePlan` 只写固定文件名 `.vrcsm-upload-plan.json`。
- **账号级动作加固**：`shell.openUrl` 的 `vrchat://` → `VrcApi::inviteSelf` 是唯一被 PluginBridge 专门二次拦截的普通方法。
- **破坏性/不可逆**：`app.factoryReset`（删数据 + 退出）、`update.install`（重启）、`migrate.execute`、`junction.repair`、`screenshots.delete` 均只对可信 `app.vrcsm` 开放。
- **出厂重置两阶段**：ShellBridge 删文件后 `WM_APP_FACTORY_RESET_QUIT` → MainWindow 在 UI 线程 `ClearVrcCookies()`、写 `.factory-reset-pending` 标记、自重启；下次启动 `HandlePendingFactoryReset` 擦除 WebView2 目录。

## 相关文件

- `src/host/main.cpp`、`App.cpp`、`MainWindow.cpp`、`WebViewHost.{cpp,h}`、`IpcBridge.{cpp,h}`、`UrlProtocol.cpp`
- `src/host/bridges/*.cpp`（20 个）、`bridges/BridgeCommon.h`
- `src/core/plugins/PluginRegistry.cpp`（权限表）

**未验证项**：`IpcBridge.h` 第 80-300 的 `Handle*` 声明段未逐行读取，但为纯声明列表，不影响上述控制流结论。
