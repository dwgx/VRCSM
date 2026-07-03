# 核心：硬件遥测 / 更新 / 插件

> 上级：[核心子系统总览](README.md)　|　相关：[插件安全专章](../flows/plugin-security.md)、[构建与发布](../04-build-release.md)

本页覆盖 `src/core/hw/`、`src/core/updater/`、`src/core/plugins/` 三个子目录。

## 一、硬件遥测与画质推荐（`src/core/hw/`）

三条相互独立的能力，同处 `vrcsm::core::hw`：静态硬件清单（`HwDetector::Detect`）、实时遥测（`HwTelemetry::CollectTelemetry`）、画质预设推荐（`HwProfiler::Recommend` + `HwProfileFeed` 社区覆盖）。

### GPU 探测（`GpuProbe.cpp`）厂商中立

`EnumerateDxgiAdapters()` 用 `CreateDXGIFactory1`+`EnumAdapters1` 遍历。`IsVirtualDisplayAdapter` 匹配 13 个关键词（virtual/spacedesk/parsec/steam streaming 等）。`ScoreGpuAdapter` 给厂商加权（NVIDIA 450/AMD 420/Intel 260/Microsoft −250），虚拟/软件 −800。`ChooseBestGpuAdapter` 以「非虚拟 > 非软件 > 分数高 > 显存大」比较器取 max。实时 VRAM 用 `IDXGIAdapter3::QueryVideoMemoryInfo(LOCAL)`，厂商中立按 LUID 匹配。

### 遥测采集的「源优先级」（`HwTelemetry.cpp`）

`CollectTelemetry()` 严格按序执行探针，后者只在前者未填时补值（`:1691-1714`）：WMI 主板/内存条 → SMBIOS → 全局内存 → DXGI GPU → ACPI 温度 → LibreHardwareMonitor → OpenHardwareMonitor → AIDA64 共享内存 → NVML → **最后**原生 CPU 负载兜底（注释"让真实传感器源先赢"`:1712-1714`）。

**优先级机制**：`ApplySensorCollection` 全部用 `if (!snapshot.cpu.xxx.has_value())` 守卫。NVML 是例外 —— 无条件写 GPU 字段（`:1449-1495`），因为它是最权威的 NVIDIA 源。整个 `CollectTelemetry` 包在 try/catch，异常转 `Error{"hw_telemetry_failed"}`；单个探针失败仅记 source status 不中断。

### 画质推荐（`HwProfiler.cpp` + `HwProfileFeed.cpp`）

内嵌评分表 + 四档预设 ultra/high/balanced/low。HMD 上限收敛：`targetBandwidth = min(preset, hmd.maxBitrate)`。社区覆盖 feed 默认 `https://dwgx.github.io/VRCSM/hw-profiles.json`，5 分钟内存缓存，网络失败降级旧缓存。

> [!NOTE] `HwProfileFeed::MatchWildcard`（`:147-175`）的 `startsWithStar`/`endsWithStar` 结果被 `(void)` 丢弃（`:172-173`），通配符**锚定语义实际未实现**，退化为「去星号后子串包含」匹配。若 feed 作者依赖 `*` 锚定会与预期不符。

## 二、更新子系统（`src/core/updater/`）

四阶段管线：**Check → Download → Validate → Apply**。

### UpdateChecker（检查）

`FetchLatest`（`:299-376`）WinHTTP GET `api.github.com/repos/dwgx/VRCSM/releases/latest`。自研 `SemVer::Parse`+`operator<`（pre-release 低于 release）比较当前编译版本与 release `tag_name`。**SHA256 来源**：从 release body markdown 用正则 `SHA256:\s*([0-9a-fA-F]{64})` 提取（`:366-373`）。

### UpdateDownloader（下载 + 断点续传）

先校验 `targetFileName` 是安全 MSI 名。写 `.part`，支持 `Range: bytes=N-` 续传，最多 2 次尝试。完成后校验 size 与 SHA256，任一不符即删 part 报错。成功 rename 并 `DeleteOldMsis` 清理旧 MSI。

### UpdatePackage（校验核心，安装前最后闸门）

`ValidateDownloadedPackage`（`:234-314`）：

- fileName 必须是单一 `.msi`；用 `weakly_canonical`+`ensureWithinBase` 确保安装包在 `%AppData%/VRCSM/updates` 内（防目录穿越 `:251-267`）。
- **SHA256 强制 fail-closed**：注释明确"size-only 校验会让同尺寸 MSI 冒充并以安装器权限运行"，故缺 `SHA256:` 行即拒绝安装（`update_hash` `:294-300`）。哈希用 BCrypt 逐块计算。

### UpdateApplier（应用）

从 `GetSystemDirectory()` 解析 `msiexec.exe` 绝对路径，以 `/i "..." /passive /norestart` + `DETACHED_PROCESS` 拉起，然后 `QuitCurrentProcess` 让主程序退出以便 MSI 覆盖文件。

### 安全要点

**纵深防御哈希闸门**：Downloader 与 UpdatePackage 都做 SHA256，且 UpdatePackage 缺哈希时 fail-closed —— 防"同尺寸恶意 MSI 以 installer 权限执行"。`ensureWithinBase`+`weakly_canonical` 双保险约束 MSI 落在受控 updates 目录。这套约束由 `tests/CommonTests.cpp` 的 `UpdatePackageValidationRejectsMissingSha256/WrongSha256` 守护，也是发布流程必须粘贴 `SHA256:` 行的原因，见 [构建与发布](../04-build-release.md)。

## 三、插件子系统（`src/core/plugins/`）

四个类各司其职：**PluginManifest**（schema + 解析）、**PluginStore**（磁盘布局 + 启停持久化）、**PluginInstaller**（`.vrcsmplugin` zip 安装）、**PluginFeed**（市场 feed）、**PluginRegistry**（IpcBridge 门面：路由 + 权限门 + 虚拟主机映射）。

> 插件的完整信任模型（虚拟主机隔离、两道权限闸、已知弱点）见 [插件安全专章](../flows/plugin-security.md)。本节只记录 core 侧模块事实。

### PluginManifest schema（`PluginManifest.cpp:175-284`）严格校验

id 必须 sanitise 后不变、长度 3~96；version/hostMin 合法 SemVer；shape 必须 panel/service/app；**entry 一致性**（`hasPanel()` 要求 entryPanel 非空）；未知 permission token 静默保留（前向兼容）。`SemVer::parse` 拒绝构建元数据与尾部垃圾，比 UpdateChecker 的 SemVer 更严。

### PluginStore 磁盘布局 + 状态

安装 `%LocalAppData%/VRCSM/plugins/<id>/`，数据 `plugin-data/<id>/`，状态 `plugin-state.json`。

- **MirrorBundledLocked**（`:297-391`）：从 `<exeDir>/plugins/` 镜像到 LocalAppData。**bundled 标志 = autoInstall**（`:386`）—— auto-install 的一等插件标记为 bundled（不可卸载，每次启动重建）。
- **RescanLocked**：目录名必须等于 sanitise 后的 id，否则跳过。
- **Uninstall**：bundled 插件拒绝卸载（`plugin_bundled`），`ensureWithinBase` 双校验后 `remove_all`。
- 状态原子写：`.tmp` 再 rename。

### PluginInstaller 七步（`:267-386`）—— zip-slip 纵深防御

1. **zip magic** `PK\x03\x04` 校验。
2. **可选 SHA256**（wincrypt CALG_SHA_256）。
3. **解压到 PluginsRoot 内随机 staging** 用 System32 的 `tar.exe`（默认拒绝绝对路径与 `../`）。
4. **FlattenSingleTopDir** 剥单层顶级目录。
5. **VerifyNoEscape**（`:105-142`）纵深防御：拒绝任何 symlink/reparse（`install_symlink`），逐条 `weakly_canonical` 前缀检查确保在 staging 内（`install_escape`）。
6. **hostMin 门**：`HostVersion() < manifest.hostMin` 即拒。
7. **原子交换**：`remove_all(finalDir)` 后 `rename`，`RegisterInstalled(bundled=false)`。

### PluginRegistry 门面 + 权限

- 虚拟主机命名 `HostNameFor(id)` = `plugin.<sanitised>.vrcsm`（dots→dashes）。反向解析 `PluginIdFromOrigin`（`:77-115`）。
- **权限模型**：`FreeMethods()`（`:16-24`）`app.version`/`path.probe`/`process.vrcRunning` 免声明；`PermissionTable()` 粗粒度 token→方法集；`CanPermissionsInvoke`（`:153-175`）任何 `plugin.*` 方法一律拒绝（belt-and-braces）。

### PluginFeed 市场 feed

单例，默认 `https://dwgx.github.io/VRCSM/plugins.json`，磁盘缓存 `plugin-feed-cache.json` 5 分钟 TTL，网络失败降级旧缓存，parse-on-read 设计。

## 交叉观察

- `MatchWildcard` 通配符锚定未实现（见上文 note）。
- Updater 与 Installer 各自实现 SHA256（BCrypt vs wincrypt CryptoAPI）与 SemVer（`UpdateChecker.cpp` 与 `PluginManifest.cpp` 各一份），两套逻辑相似但独立，尾部字符处理不完全一致。

## 相关文件

- `src/core/hw/GpuProbe.{cpp,h}`、`HwDetector.cpp`、`HwTelemetry.{cpp,h}`、`HwProfiler.cpp`、`HwProfileFeed.cpp`
- `src/core/updater/UpdateChecker.{cpp,h}`、`UpdateDownloader.cpp`、`UpdatePackage.cpp`、`UpdateApplier.cpp`、`UpdateState.h`
- `src/core/plugins/PluginManifest.{h,cpp}`、`PluginStore.{h,cpp}`、`PluginInstaller.cpp`、`PluginRegistry.{h,cpp}`、`PluginFeed.{h,cpp}`
