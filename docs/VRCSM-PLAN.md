# VRCSM — 超越 VRCX 路线图 PLAN

> 起草日期:2026-04-15
> 对标版本:VRCX `2026.02.11`(`D:\Reference\VRCX`)
> VRCSM 当前:`v0.1.2` dev(`cbeb19a`,已 push)
> 原则:VRCX 有的我们有,VRCX 没有的我们也有,能比 VRCX 更强的就更强

---

## 0. 先回答一个问题:VRCX 真能"复制别人的私有 avatar"吗?

**不能**。结论来自对 VRCX 完整源码的 code-level 扒阅(不是猜、不是读 README),证据链:

| 检查项 | 结果 | 证据 |
|---|---|---|
| VRCX 能下载别人的私有 avatar 的 asset bundle 吗? | 不能 | `/Dotnet/AssetBundleManager.cs` 全 244 行只做 `GetAssetId()`(SHA256 路径哈希)、`CheckVRChatCache()`(本地 cache 检测)、`DeleteCache()`。**零**一行 `UnityWebRequest` / `DownloadHandler` / `WriteAllBytes` / bundle parser |
| VRCX 能让你"穿"别人的非公开 avatar 吗? | 不能 | `/src/api/avatar.js:68-93` 的 `selectAvatar()` 就是直调 VRChat 官方 API `PUT /api/1/avatars/{id}/select`。VRChat 服务端强制校验 ownership/visibility,**零**客户端 bypass |
| VRCX 有游戏内存注入 / native hook 吗? | 没有 | `/Dotnet/libs/` 仅 Blake2Sharp.dll(哈希)/ librsync.net.dll(rsync 同步)/ openvr_api.dll(VR 控制器)。无 MelonLoader、无 runtime patcher、无 DLL injector |
| VRCX 有 IPC 进游戏吗? | 有但无害 | `/Dotnet/IPC/VRCIPC.cs` 仅 43 行,只是 `vrchat://launch?...` URL pipe 协议,不动游戏状态 |
| CefCustomDownloadHandler 会吗? | 不会 | `/Dotnet/Cef/CefCustomDownloadHandler.cs:7-31` 只是 CEF 浏览器内的"另存为"对话框(比如导出好友列表) |

**视频说的真相,最大概率是这三种之一:**

1. **Clickbait + 公开 avatar**:视频里演示的就是 select 一个 `releaseStatus=public` 的 avatar,标题写"复制私有" 骗点击
2. **第三方 ripper 工具**:用的是 VRCX 之外的 C# app / MelonLoader mod / Unity asset extractor,但在视频里挂 VRCX 的名
3. **术语混淆**:up 主把"查看本地 cache 里已经下载过的 avatar"(VRCX 支持,因为文件就在你硬盘上)当成了"复制别人的私有 avatar"

**VRCSM 的决策**:v0.1.2 及之后 **也不做** 私有 avatar 复制。不是"做不到",是 VRChat 服务端强制校验,做了就是 cheat/ToS 违规,不在 VRCSM 目标范围内。我们走 VRCX 同样的 API 尊重路线 —— 以下所有 "avatar favorites / avatar history / 换装" 都指**你自己或 public** 的 avatar。

---

## 1. VRCSM 现状快照(Smoke Test,2026-04-15)

### 1.1 后端(C++ core)—— 绿

| 组件 | 检查 | 结果 |
|---|---|---|
| `dump_logs.exe` | 解析 5 个真实 `output_log_*.txt` | ✅ 17 world events / 83 avatar events / **93 player events** / **83 avatar switches** / **3 screenshots**(v0.1.2 新增,全部有 sticky timestamp) |
| `dump_settings.exe` | 解码 VrcX.json | ✅ **597 条**(250 bool / 298 int / 49 string),**0 条 raw 未解码**,分 12 组,`other` 组仅 2 条 |
| `dump_thumbnails.exe` | `api.vrchat.cloud` 缩略图 | ✅ 2/2 hit,负缓存正常 |
| IPC 注册表 | `IpcBridge::RegisterHandlers()` | **16 个** method(`app.version` / `path.probe` / `scan` / `bundle.preview` / `delete.{dryRun,execute}` / `process.vrcRunning` / `settings.{readAll,writeOne,exportReg}` / `migrate.{preflight,execute}` / `junction.repair` / `shell.{pickFolder,openUrl}` / `thumbnails.fetch`) |
| LogParser 新字段 IPC 通路 | 直接走现有 `scan` → `LogReport` 序列化 | ✅ 零新 IPC 连线,新字段自动流入前端 |
| 触碰文件 TODO/FIXME 扫描 | LogParser.{cpp,h}、VrcApi.cpp、VrcSettings.cpp、types.ts | ✅ 0 处 |

### 1.2 前端 —— 绿(热修后)

- `pnpm build` → 2.48s,`index-*.js` 454KB / gzip 143KB
- TS2739(v0.1.2 扩字段破坏 `buildMockReport()`)—— 已修(commit `cbeb19a`)
- 版本字符串 —— IpcBridge `0.1.1` → `0.1.2`;`web/package.json` `0.1.1` → `0.1.2`
- `recharts@^2.15.0` dead dep —— 已删(grep 确认 `web/src` 零 import,属于被 v0.1.1 砍掉的 pie chart 残留)

### 1.3 已知空洞

| 空洞 | 影响 | 打算 |
|---|---|---|
| 新事件流(player/switch/screenshot)无前端消费者 | 数据流到了但没渲染 | P0:Logs 页加 3 个分栏(玩家时间线、avatar 切换流、截图列表) |
| Settings 页只展示不写回 | 用户可看不可改 | P0:补 Write 路径,`settings.writeOne` 早已在 IPC 注册 |
| 没有 auth 层 | 所有好友/通知/instance/收藏 API 全走不通 | P2:按 VRCX cookie-jar 模型做,见第 4 节 |
| `dump_settings` harness 采样 hardcoded | smoke test 反馈受限 | P3:小工具,不着急 |

---

## 2. VRCX 全特性清单 × VRCSM 映射

从 VRCX 源码(`Dotnet/`、`src/views/`、`src/coordinators/`)过了一遍,下面是完整清单。**S/M/L/XL** 是开发规模估算,**AUTH** 标记表示需要 VRChat 真实会话 cookie。

### 2.1 Friend / Social

| VRCX 特性 | VRCX 文件 | VRCSM 状态 | 规模 | 阻塞 |
|---|---|---|---|---|
| 好友在线状态(live presence) | `friendPresenceCoordinator.js`、`friend.js` store | ❌ | XL | **AUTH** |
| 好友分组 + tag | `FriendList.vue`、`friend.js` | ❌ | L | AUTH |
| 好友日志(join/leave/status 变更) | `FriendLog.vue`、`friendLogCoordinator.js` | 🟡 v0.1.2 的 PlayerEvent 能做 instance 范围内的,全局需 AUTH | M(本地) / L(全局) | 部分 AUTH |
| 好友位置图(谁在哪个世界) | `FriendsLocations.vue`、`locationCoordinator.js` | ❌ | L | AUTH |
| 好友列表导出 CSV | `ExportFriendsListDialog.vue` | ❌ | M | AUTH |
| 好友笔记(per-user memo) | `saveNote()` in `misc.js` | ❌ | S | AUTH(但可先做本地版) |

### 2.2 Avatar

| VRCX 特性 | VRCX 文件 | VRCSM 状态 | 规模 | 阻塞 |
|---|---|---|---|---|
| **私有 avatar 复制** | —— 不存在 —— | ⛔ 不做(见第 0 节) | —— | —— |
| 我的 avatar 历史(本地记录 + 使用计数) | `MyAvatars.vue`、`avatarCoordinator.js` | 🟡 VRCSM 已能从 gamelog 抽 avatar id + name + author,**缺 UI** | S | — |
| Avatar 收藏 | `FavoritesAvatar.vue`、`favoriteCoordinator.js` | ❌ | L | AUTH(VRChat 同步)/ S(本地 bookmark) |
| 远端 avatar 搜索 / 数据库 | `Search.vue`、`search.js` | ❌ | L | AUTH |
| Avatar 下载数据库导出 | `ExportAvatarsListDialog.vue` | ❌ | M | AUTH |

### 2.3 World / Instance

| VRCX 特性 | VRCX 文件 | VRCSM 状态 | 规模 | 阻塞 |
|---|---|---|---|---|
| 当前 instance 面板(world + 类型 + 玩家数) | `PlayerList.vue`、`instanceCoordinator.js` | 🟡 gamelog 可还原**最近一次**,live 需 AUTH | M | 部分 AUTH |
| instance 玩家列表(live) | `PlayerList.vue`、`gameLogCoordinator.js` | 🟡 93 个 PlayerEvent 已可还原 instance 名单快照,**live 需 tail** | M(tail) / L(AUTH 实时) | 可做到 tail 程度 |
| Instance 类型自动检测(public/friends/invite/group) | `instanceCoordinator.js` | ❌ | S(gamelog 有 `~private(usr_xxx)~region(...)` 串,纯解析) | —— |
| World 收藏 | `FavoritesWorld.vue` | 🟡 本地 bookmark 可做 | S(本地) / L(AUTH 同步) | 部分 AUTH |
| World 历史 | `Search.vue` world tab | ✅ VRCSM 的 Worlds 页已有(v0.1.1) | —— | —— |

### 2.4 Game Log

| VRCX 特性 | VRCX 文件 | VRCSM 状态 | 规模 | 阻塞 |
|---|---|---|---|---|
| **Live tail** | `LogWatcher.cs`(1442 行,1 秒 poll + `FileShare.ReadWrite`) | 🟡 v0.1.2 只有 cold batch scan | M | —— |
| 会话分组 + 时长 | `GameLog.vue` sessions tab | 🟡 数据已在 LogReport,缺 UI 分组 | S | —— |
| 截图追踪器 + 元数据 | `ScreenshotMetadata.vue`、`ScreenshotMetadata/` C# | ✅ v0.1.2 后端已抓,缺 UI | S | —— |
| 视频 URL 追踪(OSC clip) | `gameLogCoordinator.js` OSC 解析 | ❌ | M | —— |
| 通知 / 桌面提示(player joined alert) | `NotificationManager.cs` | ❌ | M | —— |

### 2.5 Communication

| VRCX 特性 | VRCX 文件 | VRCSM 状态 | 规模 | 阻塞 |
|---|---|---|---|---|
| 通知收件箱(DM/invite/request) | `Notifications.vue`、notification store | ❌ | L | AUTH |
| Discord Rich Presence | `Discord.cs` | ❌ | M | 半 AUTH(要 current user 的 displayName) |
| OSC 桥 | `osc` coordinator、OSC.NET | ❌ | L | —— |
| 自定义桌面通知 | `NotificationManager.cs` | ❌ | S | —— |

### 2.6 Safety / Moderation

| VRCX 特性 | VRCX 文件 | VRCSM 状态 | 规模 | 阻塞 |
|---|---|---|---|---|
| 封禁 / 静音 / 审核历史 | `Moderation.vue` | ❌ | L | AUTH |

### 2.7 System / Utility

| VRCX 特性 | VRCX 文件 | VRCSM 状态 | 规模 | 阻塞 |
|---|---|---|---|---|
| Auto-launch VRChat | `AutoAppLaunchManager.cs` | ❌ | S | —— |
| 进程监控 + auto-restart on crash | `ProcessMonitor.cs` | 🟡 VRCSM 只有 `process.vrcRunning` 状态位,没 monitor 循环 | M | —— |
| 更新检查 + 一键安装 | `Update.cs`、`AppApiCommon.cs` | ❌ | M | —— |
| 自动改在线状态 | `AutoChangeStatusDialog.vue` | ❌ | S | AUTH |
| 邀请消息模板 | `EditInviteMessagesDialog.vue` | ❌ | S | AUTH |

### 2.8 Data / Import

| VRCX 特性 | VRCX 文件 | VRCSM 状态 | 规模 | 阻塞 |
|---|---|---|---|---|
| 从旧版 VRCX 导入 | `userEventCoordinator.js`、`DBMerger/` | ❌ | M | —— |
| SQLite 浏览器 | `SQLite.cs` + sqlite viewer 弹窗 | ❌ | M | —— |
| 配置文件编辑器(`config.json`) | `VrcConfigFile.cs`、`VrcConfigDialog.vue` | 🟡 VRCSM 已做 registry 的 597 键,**没做** VRChat `config.json` | S | —— |
| 注册表备份 / 还原 | `RegistryBackupDialog.vue`、`RegistryPlayerPrefs.cs` | 🟡 VRCSM 有 `settings.exportReg`,没 import | S | —— |

### 2.9 Appearance / I18n

| VRCX 特性 | VRCX 文件 | VRCSM 状态 | 规模 | 阻塞 |
|---|---|---|---|---|
| 主题切换(亮/暗) | `settings/appearance.js` | ❌ VRCSM 只有暗色 | M | —— |
| 多语言 | `localization/` 20+ 语言 | ✅ VRCSM 已有 i18n 框架(zh/en) | —— | —— |
| 自定义 CSS 注入 | `CustomCss()` in `AppApiCommon.cs` | ❌ | S | —— |
| 可折叠边栏 / 可拖尺寸面板 | `Dashboard.vue` 可调整组 | 🟡 VRCSM 有基础 layout,无拖拽 | M | —— |

### 2.10 Fun / Other

| VRCX 特性 | VRCX 文件 | VRCSM 状态 | 规模 | 阻塞 |
|---|---|---|---|---|
| 活动 Feed(朋友加入、avatar 换、世界访问) | `Feed.vue`、`sharedFeedStore` | 🟡 v0.1.2 已有原始事件,缺 feed 视图 | M | 部分 AUTH |
| Charts / analytics(请求趋势、热力图) | `Charts/` views | ❌ | M | —— |
| 照片画廊 | `Gallery.vue`、`gallery.js` | ❌ | M | —— |
| Boop 计数器(彩蛋) | 散落在 coordinators | ❌ | S | AUTH |
| **VR 头显内 overlay** | `vr/`、`vr.html`(单独 Unity 构建) | **⛔ 不做** | —— | 技术栈根本不兼容(VRCSM 是 WebView2,VRCX 的 overlay 是 Unity) |

---

## 3. VRCSM 能独有的优势(VRCX 根本没做的)

VRCX 是社交工具,对 cache / 设置 / 迁移这类 ops 层面功能是**次要**的。VRCSM 已经在 ops 侧领先,要保持这个差异化。

| # | 特性 | VRCSM 已有基础 | 为什么 VRCX 不会做 |
|---|---|---|---|
| 1 | **Cache 精细 dashboard**(按类别饼图、填满预测、安全清理建议) | `CacheScanner.cpp` 已完整 | 他们 cache 功能只有"删全部"按钮 |
| 2 | **Bundle 格式逆向查看器**(hex view、内嵌 shader、贴图分辨率、animator 参数) | `BundleSniff.cpp`(v0.1.1) | 他们只读不解析 |
| 3 | **Settings key catalog + 搜索**(597 键带描述/范围/默认值) | `VrcSettingsKnownKeys.inc` | 他们根本没碰注册表设置 |
| 4 | **自动备份编排**(定时快照 AvatarData.json,corruption 时自动回滚) | 已有迁移逻辑可扩 | 超出他们范围 |
| 5 | **Cache 碎片整理 / 孤儿 chunk 重打包** | `CacheScanner.cpp` 扫 + 删逻辑 | 他们不碰 cache 结构 |
| 6 | **多机 cache 同步**(junction + 时间感知 sync) | `JunctionUtil.cpp` 已就位 | 他们不做文件系统层 |
| 7 | **Bundle 依赖映射**(哪个 avatar 用了哪些 bundle → 清理影响分析) | 扫描器可扩 | 他们数据层只到元数据 |
| 8 | **Settings diff 工具**(快照比对 + 个键回滚 + AI safety 历史) | `settings.readAll` 快照序列化已有 | 他们不关心设置历史 |
| 9 | **便携版 VRCSM 生成器**(dump 报告 + portable exe → U 盘可用) | C++ 核心天然 self-contained | Electron 太大(100MB+),天然劣势 |
| 10 | **Crash dump 检视器**(解析 VRChat crash log → 建议修复) | LogParser 已能抽 stack trace | 他们只追 gameplay event |
| 11 | **VRChat 多账户切换器**(PlayerPrefs + AppData 隔离) | 已理解 PlayerPref 双格式 | 需要 ops 层能力 |
| 12 | **MSI 签名安装包** | WiX 5 已就位(v0.1.0) | Electron 工具链难签 |

---

## 4. Auth 层方案(这是第 3-4 节一半特性的前置)

### 4.1 VRCX 的做法

`Dotnet/WebApi.cs:54-75`:

```csharp
public WebApi() {
    CookieContainer = new CookieContainer();
    _timer = new Timer(TimerCallback, null, -1, -1);
}
private void LoadCookies() { /* 从磁盘读 */ }
public void SaveCookies() { /* 1 秒 debounce 写盘 */ }
```

- **机制**:简单的 file-backed cookie jar
- **加密**:**无**(明文 base64(JSON))—— 这是 VRCX 被批评的点
- **登录 UI**:走 Electron/CEF 自带浏览器,让 VRChat 官网的登录页自己处理密码 + 2FA,cookie 写下来
- **MFA**:不显式处理,依赖 cookie 已经 auth'd 过

### 4.2 VRCSM 的选项

| 方案 | 可行性 | 风险 |
|---|---|---|
| **A. WebView2 跑登录,JS bridge 回传 cookie** | 可行 —— WebView2 `ICoreWebView2CookieManager` 能读写 cookie | WebView2 不直接暴露给 C++,需要 JS bridge |
| **B. 独立 React 登录页 → C++ HTTP 库提交** | 可行 —— 用 WinHTTP(已在 VrcApi.cpp 里) | MFA 要自己做,VRChat 有时会出 captcha |
| **C. 借 VRCX 的 cookie**(如果用户已经装了 VRCX) | 可行 —— `%AppData%\VRCX\cookies.dat` 是明文 | 依赖外部工具,不优雅 |
| **D. 延后,先做所有 no-auth 的功能** | ✅ v0.1.2 选这个 | 推迟决定 |

**v0.1.2 决定**:**走 D**。先把所有不需要 auth 的特性做满(第 5 节 P0+P1),auth 层留给 v0.2.x 重点做。做 auth 时优选 **方案 A**(WebView2 + JS bridge),因为:

1. WebView2 是主机已有依赖,不新增
2. 可以让 VRChat 官网自己处理 password + 2FA + captcha
3. Cookie 用 **DPAPI** 加密后再落盘,不学 VRCX 的明文路线

### 4.3 Auth 加密改进

明确写入 PLAN:VRCSM 的 cookie 存储 **必须** 过 DPAPI(`CryptProtectData`,跟 VrcSettings.cpp 已经用的 API 一致),不能学 VRCX 的明文 base64。用户级 DPAPI 够,不用 system 级。

---

## 5. v0.1.2 → v0.3.x 路线图

按 **不做 Auth** 的阶段先满血,然后进 Auth 阶段。

### 5.1 v0.1.2 剩余范围(本 sprint 目标)

已完成:
- ✅ `2b7fc0e` humanize comments(VrcApi + VrcSettings)
- ✅ `cac427a` LogParser 三流事件(player/switch/screenshot)
- ✅ `cbeb19a` 前端 build 修复 + 版本 bump + recharts 砍

剩余 **P0**:

| # | 项 | 文件 | 规模 |
|---|---|---|---|
| 1 | **Settings 页写回能力**(bool switch / int number / string input,带未运行保护、rollback) | `web/src/pages/Settings.tsx`、现有 `settings.writeOne` IPC | M |
| 2 | **Logs 页三分栏:Player timeline / Avatar switch / Screenshots**(渲染 v0.1.2 新数据) | `web/src/pages/Logs.tsx` | S |
| 3 | **MSI 重打 0.1.2**(WiX `ProductVersion` + `scripts/build-msi.bat`) | `installer/vrcsm.wxs` | S |
| 4 | **About 对话框读 `app.version`**(现在可能还硬编码) | `web/src/components/AboutDialog.tsx` | S |

剩余 **P1**(v0.1.2 可延到 v0.1.3):

| # | 项 | 规模 |
|---|---|---|
| 5 | Dashboard 小段放大(Tools/OSC/LocalAvatarData 条目太小看不清) | S |
| 6 | Bundles 页 column sort + 搜索 | S |
| 7 | Migrate 页实做(一键从旧 VRCC 导入) | M |
| 8 | 主题亮色模式(CSS var toggle) | M |

### 5.2 v0.1.3 —— **Game Log Live Tail**(单独一个 sprint,值得)

VRCX 的 `LogWatcher.cs`(1442 行)有经验告诉我们两件事:
1. **绝不** 用 `FileSystemWatcher`,VRChat 是 buffered 写入,miss + 假阳
2. 1 秒 `poll + FileShare.ReadWrite + 65536 buffer + per-file offset` 是黄金路径

VRCSM v0.1.3 目标:
- 把现在的 cold batch scan 改成 live tail
- 每 1 秒检查当前最新 log 文件的 size,从 offset 位置追读
- 把增量 line 送 parser,emit 事件到前端(IPC event channel,**不是** polling RPC)
- 前端 Logs 页从"刷新时显示快照" 改为 "live 滚动"

预估规模:L(要加 IPC event 通路,要处理 log rotation)

### 5.3 v0.1.4 —— **VRCSM 独有功能第一波**

从第 3 节的 12 条独有里挑最能展示"ops 差异化"的 4 条:

| # | 特性 | 优先顺序 |
|---|---|---|
| 1 | Settings diff 工具(快照对比 + 回滚) | ★★★ |
| 2 | Cache 按类别饼图 dashboard + 填满预测 | ★★★ |
| 3 | AvatarData 自动备份(5 分钟 snapshot + 腐败回滚) | ★★ |
| 4 | Bundle 依赖映射 | ★★ |

### 5.4 v0.2.0 —— **Auth 层**

真正的大头。子任务:
- WebView2 JS bridge:创建隐藏的 WebView2 子实例加载 `https://vrchat.com/home/login`,用户在里面完成 login 流程
- Cookie 抽取:JS 侧监听 `document.cookie`,通过 bridge 把 `auth` / `twoFactorAuth` cookie 回传给 C++
- DPAPI 加密落盘:`%LocalAppData%\VRCSM\session.dat`(加密后的 JSON)
- 自动重用:启动时先读 `session.dat`,解密后直接发 `/auth/user` 验活
- 过期处理:403 → 弹 WebView2 重登

### 5.5 v0.2.1+ —— **Auth-gated 特性批量上**

- 好友列表 + 在线状态(P0)
- 好友位置图(P0)
- 当前 instance 玩家列表(live,P0)
- 通知收件箱(P1)
- Avatar / World 收藏(P1)
- Moderation 工具(P2)
- Discord Rich Presence(P2)

### 5.6 v0.3.0 —— **超越 VRCX 的独有功能第二波**

- Cache 碎片整理 / 孤儿 chunk 重打包
- 多机 cache 同步(junction + 时间感知)
- 便携版 VRCSM 生成器
- Crash dump 检视器
- VRChat 多账户切换器

---

## 6. 明确 **不做** 的事

刻在 PLAN 里,以后别再回头争论:

1. **私有 avatar 复制**(VRCX 都不做,服务端强制校验,做了就违规)
2. **Unity VR overlay**(WebView2 架构不兼容,VRCX 的 `vr/` 是独立 Unity 项目)
3. **加回 pie chart 到 Dashboard**(用户明确说过"不好看")
4. **接入 recharts**(刚砍掉,2026-04-15,PLAN 写完后别再装回来)
5. **匿名 avatar 缩略图探索**(死胡同已确认,401 wall 全 avatar 都过不去)
6. **avatar id 复数 `avatars`**(backend 用单数 `avatar`,v0.1.1 已统一)
7. **Electron**(已经选 WebView2 + C++,v0.1.0 拒掉 Qt 之后的最终答案)

---

## 7. 第 0 节之外的补充结论:VRCX 架构让我们学到什么

读完他们的代码,有几个可以直接拿来用的设计:

1. **Coordinator 模式**:VRCX 把"业务逻辑层" 叫 `coordinators/`,聚合 store + API + 事件。VRCSM 目前的 page 直接调 IPC,可以引入一层 `services/` 或 `coordinators/` 来收纳业务规则
2. **SQLite 本地库**:VRCX 把所有 feed / 日志 / 好友状态都存在 `%AppData%\VRCX\VRCX.sqlite3`。VRCSM 现在全 in-memory + JSON cache,长期看 v0.1.3 live tail 后应该引入 SQLite(C++ 有 `sqlite3.c` amalgamation,零依赖)
3. **`LogWatcher.cs` 的注释质量**:他们写过什么"FileSystemWatcher 不可靠"、"OnPlayerLeft 会 false positive 在 client crash 场景",这些都是血的教训。继续把 VRCSM 的代码也写成这个风格(见 commit `2b7fc0e`)
4. **分模块 csproj**:VRCX 有 `VRCX-Cef.csproj` / `VRCX-Electron.csproj` / `VRCX-Electron-arm64.csproj` 三份前端容器,后端共享。VRCSM 走 CMake targets,目前已经是类似结构(`vrcsm_core` 静态库 + `VRCSM` exe + 三个 dump tool),保持这个分法

---

## 8. 下一步(这次会话后续)

1. **读完 PLAN 让用户确认方向**(特别是第 0 节的 VRCX ripper 结论、第 5.1 节的 v0.1.2 剩余 P0)
2. 开干 v0.1.2 P0#1 **Settings 页写回** —— 用户从 v0.1.1 起就最期待这个
3. 顺手 P0#2 **Logs 页三分栏** —— 新数据已经在 IPC 里,纯 UI 工作

**本 sprint DoD**:Settings 能改+保存,Logs 能看到 player/switch/screenshot 三栏,MSI 0.1.2 重打,tag `v0.1.2`,push。
