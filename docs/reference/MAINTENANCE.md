# 参考文档维护指南

本页服务于 `docs/reference/` 这套内部技术参考的**长期维护**:改代码时哪份文档要跟着改、
已知的代码/文档矛盾集中追踪在哪、以及如何整体刷新本文档集。

> 文档正文记录的是**撰写时的真实行为**(含"文档承诺了但代码没实现"的矛盾)。行号会随代码演进漂移,
> 引用意在定位而非逐字复现。改动 load-bearing 行为时,请一并更新对应文档,别让它腐化成谎言。

## 一、联动更新地图(改源码 → 改文档)

改到左列的源文件/行为时,右列文档需同步复核。这是防止文档腐化的第一道闸。

| 改动的源码 / 行为 | 需同步复核的文档 |
| --- | --- |
| `src/host/IpcBridge.cpp` 新增/改 IPC 方法、改 `AsyncMethodSet()` | `02-host-ipc-bridge.md`、`flows/ipc-roundtrip.md` |
| `web/src/lib/ipc.ts` IPC 客户端、mock 分支、`types.ts` | `03-web-frontend.md`、`02-host-ipc-bridge.md` |
| `src/core/Database.cpp` schema(`user_version`)、`isClearableTable` allowlist | `core/avatar-preview-db.md`、`flows/data-cache-lifecycle.md` |
| `data.clear` 目标 / `DatabaseBridge.cpp` `tableTargets()` / 前端 `DataClearTarget` | `flows/data-cache-lifecycle.md`、`02-host-ipc-bridge.md` |
| `src/core/CacheScanner.cpp` / `CacheIndex.cpp` / `BundleSniff.cpp` | `core/cache-and-bundle.md`、`docs/CACHE-ARCHITECTURE.md` |
| `src/core/AuthStore.cpp` / `VrcApi.cpp`(登录/2FA/会话) | `core/api-auth-settings.md`、`flows/ipc-roundtrip.md` |
| `src/core/Pipeline.cpp`(重连/退避/token) | `core/orchestration.md` |
| `src/core/plugins/*` / `PluginBridge.cpp` / 插件权限模型 | `flows/plugin-security.md`、`core/hw-updater-plugins.md` |
| `src/host/WebViewHost.cpp`(origin 校验、虚拟主机映射) | `flows/plugin-security.md`、`flows/ipc-roundtrip.md`、`01-architecture.md` |
| `src/core/SafeDelete.cpp` / `Migrator.cpp` / `JunctionUtil.cpp` | `core/safedelete-migrate.md` |
| `src/core/LogParser.cpp` / `LogAtoms.h`(新增 `LogAtomKind`) | `core/log-pipeline.md` |
| CMake 目标、测试文件、i18n locale、`package_release.ps1` | `04-build-release.md` |
| 三层架构、`Result<T>` 错误模型、IPC 信封格式 | `01-architecture.md` |

## 二、已知代码/文档矛盾与潜在问题(集中追踪)

这些是本文档集撰写时经二次核实的**真实矛盾/潜在问题**。集中列在此处,避免未来每个 agent
重新痛苦地发现一遍。**它们是待办线索,不是让人盲目去"修"的** —— 动手前先有复现。

| # | 现象 | 源码锚点 | 文档锚点 | 性质 |
| --- | --- | --- | --- | --- |
| 1 | `CacheIndex` 承诺按根目录 mtime 失效,但 `ScanWorker` 未见 mtime 比较 | `CacheIndex.h:23` vs `CacheIndex.cpp` | `core/cache-and-bundle.md:66` | 文档/代码矛盾(可能待实现) |
| 2 | Pipeline 文档写指数退避 5→10→30→60s,实现是扁平 5s | `Pipeline.h:29-30` vs `Pipeline.cpp:211-216` | `core/orchestration.md:50` | 刻意(注释称抄 VRCX),头文件注释过时 |
| 3 | `PluginIdFromOrigin` 注释称"prefer exact match",实际只返回首个 sanitised-label 匹配 | `PluginRegistry.cpp:96-114` | `flows/plugin-security.md:72` | 潜在 bug:两 id 归一后同 label 会误归因权限 |
| 4 | 顶层 WebMessage origin 校验 fail-open(回落可信 SPA),帧通道 fail-closed | `WebViewHost.cpp:376-379` vs `:435` | `flows/plugin-security.md:80`、`flows/ipc-roundtrip.md:30` | 安全非对称,需评估 |

> 修复其中任一项后:更新本表状态、更新对应文档正文的 `[!WARNING]`、并在 `MEMORY.md` 的
> [codebase-load-bearing-facts] 条目中同步。

## 三、如何刷新本文档集

本文档集由 ultracode workflow(`vrcsm-codegraph-deep`)生成:16 个分区分析师 + 3 个端到端 tracer
并发建代码图 → 综合 → 对抗式准确性复审(逐条抽查 `file:line`)→ 落盘。大幅重构后可重跑该 workflow
整体刷新;局部改动则按上面的联动地图手工更新对应页即可,成本更低。

- 生成脚本:`.../workflows/scripts/vrcsm-codegraph-deep-*.js`(项目 workflow 目录下)
- 硬约束:只读代码、只写文档、每条关键论断引用真实 `file:line`、密钥卫生(不写字面机密)。
