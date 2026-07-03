# 核心：VrcApi / 认证 / 限流 / 设置

> 上级：[核心子系统总览](README.md)　|　相关：[编排层](orchestration.md)、[数据生命周期专章](../flows/data-cache-lifecycle.md)

本页覆盖针对 `api.vrchat.cloud` 的 HTTP 客户端、会话/认证、限流、以及设置/配置读写。

> [!IMPORTANT] 密钥卫生：本页描述认证/会话的**信任模型与算法**，从不写入任何字面机密（cookie 值、session 字节、密码、真实用户 id）。所有机密按名称/角色/存放位置引用。

## 1. 模块概览

| 模块 | 职责 |
|---|---|
| `VrcApi` | WinHTTP HTTP 客户端 + 缩略图磁盘缓存 |
| `AuthStore` | 会话 cookie 进程级单例 + DPAPI 加密持久化（`session.dat`） |
| `RateLimiter` | 进程级令牌桶限流单例 |
| `VrcSettings` | VRChat Unity PlayerPrefs 注册表读写（`HKCU\Software\VRChat\VRChat`） |
| `VrcConfig` | VRChat `config.json` 原子读写 |
| `SteamVrConfig` | SteamVR `steamvr.vrsettings` 合并式读写 + 硬件信息提取 |

调用路径：需登录端点 → `getLoadedCookieHeader()`（`VrcApi.cpp:507`）→ `AuthStore::Instance().BuildCookieHeader()`（`AuthStore.cpp:254`）；所有出网请求 → `httpRequest()`（`VrcApi.cpp:730`）→ `RateLimiter::Instance().Acquire()`（`:743`）→ `httpRequestOnce()`（`:568`）。

## 2. VrcApi —— HTTP 客户端

### 传输层（WinHTTP）

`httpRequestOnce()`（`:568-725`）每次新建 `WinHttpOpen`/`Connect`/`OpenRequest` 三级句柄，用 RAII deleter 管理 —— **无连接复用**。UA 固定 `VRCSM/1.0`（无 UA 时 `/api/1/image/*` 返 403，`:42-46`）。强制 HTTPS（`:607`），四阶段各 8000ms 超时。`captureSetCookie=true` 时循环 `WinHttpQueryHeaders(WINHTTP_QUERY_SET_COOKIE)` 逐条读所有 Set-Cookie（`:657-708`）。

### 限流与重试

`httpRequest()`（`:730-769`）每次尝试前 `RateLimiter::Acquire()`；仅对 HTTP 429 重试，最多 `kMaxRetries=3`，指数退避 1s/2s/4s（`:738-764`）。

### API Key（非机密）

`kApiKey`（`VrcApi.cpp:104`）是 VRChat 客户端 bundle 中公开出现的**公共 key**，非机密，被所有社区工具（VRCX 等）使用（注释 `:99-103`）。作为查询参数 `?apiKey=` 拼接到匿名/公开端点。

### 登录流程（密码 + 2FA）

**loginWithPassword**（`:1688-1800`）：

1. `GET /api/1/auth/user`，`Authorization: Basic base64(percentEncode(user):percentEncode(pass))`（`buildBasicAuthHeader` `:1651`）。关键：用户名/密码在 base64 前先 percent-encode，因为 VRChat 服务端对原始字节跑 `decodeURIComponent`，非 ASCII 密码若不编码会静默失败（`:1647-1650`）。
2. 凭据中间串与最终 header 在函数退出时用 `wil::scope_exit` + `secureClearString` 擦除（`:1660-1665`、`:1710-1717`）。
3. 无论是否需 2FA，都立即 `SetCookies(*authCookie, {})` + `Save()` 持久化 `auth` cookie（`:1785-1786`），以便后续 2FA verify 复用同一会话。
4. `requiresTwoFactorAuth` 数组非空 → `Requires2FA`；否则 `Success`。

**verifyTwoFactor**（`:1802-1913`）：

- **方法白名单**：仅允许 `totp`/`emailOtp`/`otp`，注释明确是为防 `/twofactorauth/../admin/` 路径穿越（`:1817-1822`）。
- 成功判据是响应里的 `twoFactorAuth` Set-Cookie 而非 body 的 `verified` 字段（`:1872-1882`）。
- 从现有内存 header 抽出 `auth` 值，与新 `twoFactorAuth` 合并 `SetCookies` + `Save`，避免覆盖丢失主 cookie（`:1884-1909`）。

### 缩略图缓存与安全下载

- 磁盘缓存 `%LocalAppData%\VRCSM\thumb-cache.json`；正缓存永久，负缓存（`not_found`）TTL 7 天（`:119/:1378`）。401 **不写负缓存**（登录后旧匿名 miss 不应遮蔽有效头像，`:1416-1423`）。
- **下载安全闸**：
  - `isTrustedVrchatImageUrl()`（`:947-969`）强制 HTTPS + host 必须是 `api.vrchat.cloud`/`*.vrchat.cloud`/`assets.vrchat.com`/`*.assets.vrchat.com`。
  - `downloadUrlToFileAtomic()`（`:1053-1220`）：写 `.part` → 校验 Content-Length 与实际字节一致 → 运行 validate 回调（图片 magic 或 `validateUnityBundleStructure`）→ 原子 rename → 写 `.download.json` 元数据。
  - 缓存复用需 `trustedDownloadMetadataMatches()` 校验 url+bytes+complete 三者匹配（`:1019-1032`），防投毒/半下载文件被信任。
  - `trimCacheDirectory()` LRU 按 mtime 淘汰，缩略图目录上限 512MB（`:1222-1263`）。

### 写/破坏性端点

写操作头文件均标注风险级别，如 `deleteAvatar` 为 DESTRUCTIVE/软删除并要求调用方二次确认（`VrcApi.h:492-498`）。**核心层不做确认，仅执行**；确认责任在上层。

## 3. AuthStore —— 会话持久化

单例，持 `m_authCookie` + `m_twoFactorCookie`，全部操作在 `m_mutex` 下。持久化文件 `%LocalAppData%\VRCSM\session.dat`（`:271-274`）。

### 加密（DPAPI）

- **Save**（`:156-200`）：内层是明文 JSON `{"auth":..., "twoFactorAuth":...}`（便于 schema 演进），经 `CryptProtectData` 用户作用域加密 + 静态熵值（`kEntropy` `:15`），落盘为不透明二进制。明文用 `secureClearString` 擦除。
- **Load**（`:83-154`）：`CryptUnprotectData` 失败（profile 迁移/SID 变更）时降级为"已登出"而非崩溃（`:103-112`）。
- `BuildCookieHeader()`（`:254-269`）：`auth=<v>` 可选拼 `; twoFactorAuth=<v>`；auth 为空返回空串。

> [!NOTE] `session.dat` 内层为明文 JSON，仅靠 DPAPI 用户作用域 + 静态熵保护 —— 同用户上下文的进程可解密（DPAPI 设计固有，非缺陷）。

### [session-diag] 临时诊断日志

存在若干处 `spdlog::warn` 的 `[session-diag]` 标记日志（`AuthStore.cpp:92/197/231`、`VrcApi.cpp:1581`），用于排查"幽灵登出"。**用 warn 级别刻意提高可见度**。这些日志**不打印 cookie 值本身**，仅打印字节数/布尔标志，符合机密卫生。属临时排查代码，release 前宜降级或移除。

## 4. RateLimiter —— 令牌桶

进程级单例，`kMaxTokens=15`、`kRefillRate=15/60=0.25 tokens/s`（`RateLimiter.cpp:16-17`），对应 VRChat 文档"15 请求/60 秒"。`Acquire()`（`:42-69`）：token 不足则**释放锁后 sleep**（让其它线程排队而非全挤在 mutex 上，`:61-65`）。是所有出网请求的单一序列化点。

## 5. VrcSettings —— Unity PlayerPrefs 注册表

- 键 `HKCU\Software\VRChat\VRChat`。键名是 Unity 编码形式 `<name>_h<十进制哈希>`；`StripEncodedSuffix()`（`:224-241`）剥离。
- **值编解码（关键：Unity 双格式）** `DecodeBinaryValue()`（`:358-453`）：Unity 2019+ 无类型标签格式与遗留 pre-2019 标签格式。**先试新格式再回退旧标签**，顺序 load-bearing（`:369-384` 注释明确"不要清理"）。
- **写前 `ProcessGuard::IsVRChatRunning()` 阻断**（VRChat 运行时写会被退出时覆盖，`:835-841`）。

## 6. VrcConfig —— config.json 原子读写

- `Read()`（`:15-72`）：主文件不存在或解析失败时**回退到 `.bak` 备份**。
- `Write()`（`:74-127`）：原子写序列 `.tmp` → 备份原文件到 `.bak` → rename，每步失败清理并返回对应 Error。
- `WriteJson()`（`:155-195`）：**写前 `ProcessGuard::IsVRChatRunning()` 阻断**，返回 `vrc_running`。

## 7. SteamVrConfig —— steamvr.vrsettings

- Steam 路径来自注册表 `HKCU\Software\Valve\Steam\SteamPath`。
- **UTF-8 消毒**：`sanitizeUtf8()`（`:95-112`）把非法/截断字节折叠为 `?`，因 vrsettings 常含系统区域设备名的非 UTF-8 字节，而 nlohmann 解析/dump 会校验 UTF-8。
- **合并写**：`Write()` 深合并 `updates` 到现有文档，只覆盖调用方提供的 section/key，原子写 `.tmp`→`.bak`→rename。
- `IsSteamVrRunning()`：Toolhelp 快照检查 `vrmonitor.exe`/`vrserver.exe`/`steamlink.exe`。

## 8. 安全要点小结（供上层留意）

1. `[session-diag]` warn 级日志为临时排查代码（不含机密值），release 前宜清理。
2. `session.dat` 内层明文 JSON + DPAPI 用户作用域 + 静态熵；同用户进程可解密（DPAPI 固有）。
3. 2FA method 白名单（`VrcApi.cpp:1817`）与图片下载 host 白名单（`:965-968`）是两处显式的注入/SSRF 防护。
4. 下载信任依赖 `.download.json` 元数据的 url+bytes+complete 三元匹配（`:1019-1032`）。
5. `kApiKey` 为公开值（非机密）。
6. 本地文件写（settings/config）以 `ProcessGuard` 阻断 VRChat 运行；在线破坏性 API 在头文件要求上层二次确认。

## 相关文件

- `src/core/VrcApi.{cpp,h}`、`AuthStore.{cpp,h}`、`RateLimiter.{cpp,h}`
- `src/core/VrcSettings.{cpp,h}`、`VrcConfig.{cpp,h}`、`SteamVrConfig.{cpp,h}`
- `src/core/Common.h`（`secureClearString`/`getAppDataRoot`）

**未验证项**：`VrcSettingsKnownKeys.inc`/`VrcSettingsBoolKeys.inc` 为生成文件未读；`SteamVrConfig.cpp` 的 `Read()` 主体与 `DetectVrSettingsPath()` 部分路径拼接细节标记 unverified。
