# VRCSM 深度审计终裁 (AUDIT VERDICT)

> 复核已发布版本。本轮为**只读**审计,所有 `file:line` 均经亲验。
> 前置安全评审见 `docs/review-2026-07/REVIEW-SUMMARY.md`(WebView2 隔离、插件传送、radar HANDLE 竞态、junction 逃逸、无界缓存/promise、UnityBundle 分配均已修复,本轮不重复)。
> 严重度:[BLOCKER]/[HIGH]/[MEDIUM]/[LOW]/[NIT]。区分**真实缺陷**与**有意权衡**;区分**本轮新增**与**旧评审已登记的 carry-over**。

日期:2026-07-04 · 审计范围:架构 / 性能 / 类型安全 / 测试 / 韧性 / 无障碍-UX / 依赖-构建 / 文档-代码 / carry-over 复核

---

## (a) 记分卡 SCORECARD

| 轴线 | 评级 | 一句话理由 | 建议权重 |
|---|---|---|---|
| architecture | C | 依赖方向正确,但 `Database`(6059 行 / 24 表)与 `IpcBridge`(19 bridge 文件共享 1 个 383 行头)是两个上帝对象;单 `m_mutex` 串行化全部 DB 读写 | 15% |
| performance | B | 整体有性能意识(虚拟化 / 分页 / WAL / 多索引),但 Friends 零虚拟化 + N+1 `world.details`、LogParser 每行串行多次 regex 无前置字面量过滤是真实缺口 | 12% |
| type-safety | B− | C++ 入口守卫优秀且不崩,但整条 IPC 契约在 TS 侧是"编译期虚构"——响应侧 `resp.result` 从 `unknown` 直接 `as TResult` 零运行时校验,+ `ipc.ts` 27 处 `any` | 12% |
| testing | C | 纯逻辑 / 安全边界覆盖扎实,但最不可逆的删除 / 迁移 happy-path、DB 全迁移链、中央 dispatch 要么零覆盖要么只测拒绝分支 | 15% |
| resilience | B | `Result<T>` 纪律 + catch-all + alive-flag 防 UAF 扎实,但两处无界等待(shutdown / reg export)在 worker 卡死时可致关闭挂起;前端无全局 rejection 兜底 | 15% |
| a11y-ux | C | 基础设施到位,但 RelationshipGraph 键盘不可达、i18n 结构性大缺口(en 缺约 791 键、非中文约 41% 未译)、aria-live 近乎空白 | 10% |
| deps-build | C | tinygltf 死依赖、23MB wasm 无条件打进每个安装包(占 dist 约 81%,仅服务默认关闭的实验功能) | 8% |
| doc-code | B+ | `docs/reference/` 精确度异常高;腐化集中在 agent 最先读的顶层文档("10 pages" 实为 27)与交接文档("clean tree" vs 大量改动)——均为旧评审已登记项 | 5% |
| carryover-verify | C | 5 项旧评审明列的 carry-over 至今未闭环;#3 守卫存在但逻辑失效 | 8% |

**加权总评:C+(GPA ≈ 2.4 / 4.0)**

### 执行结论(答"还有什么缺点 / 缺点")

上一轮安全评审的严重项确已修复(见上),但 VRCSM 离"打磨完成"仍有明显距离,缺点集中在三块,均为可修的真实缺陷:

1. **技术债的中心化。** `Database`(6059 行 / 24 表,CRUD 与 `Predict*` / `CoPresence*` / `GlobalSearch` 纯算法混居,单 `m_mutex` 串行化全部读写)和 `IpcBridge`(19 个 bridge 文件共享一个 383 行头 + 全部 `m_*` 状态)两个上帝对象,让任何改动都要碰 6000 行文件或触发全量重编,是维护性的最大拖累。

2. **最高风险路径的验证空白。** 产品最不可逆的删除 / 迁移操作只测**拒绝分支**不测**成功路径**(SafeDelete `ExecutePlan`、Migrator `execute` 均零 happy-path 覆盖);DB 全升级链和中央 IPC dispatch 零专属单测;IPC 响应侧完全没有运行时校验层——前后端形状漂移编译期静默、运行时才崩。

3. **收尾纪律松弛。** 5 个旧评审已登记的 carry-over 无一闭环(其中 Friends 陈旧守卫 `__polledAt` 只在轮询侧盖章、pipeline 合并侧从不更新,守卫形同装饰),叠加 shutdown 在 worker 卡死时可挂起、i18n 约四成未译、23MB wasm 白打进包,说明"暂停开发"前的收尾并不干净。

> 重要澄清:旧评审(`REVIEW-SUMMARY.md:253-256`)已将这 5 项**明确列为"Carry-overs not yet done"**,从未声称它们已修。本轮把它们标为"仍未闭环"是事实陈述,**不存在"反造已修假象"**。

---

## (b) 合并 TOP-15 问题(去重、按严重度)

> 标注 **[已知]** 者为旧评审已登记项(引 `REVIEW-SUMMARY.md`);标注 **[新增]** 者为本轮超出旧评审范围的发现。

| # | 严重度 | 问题 | `file:line` | 一句话修复 | 归属 |
|---|---|---|---|---|---|
| 1 | MEDIUM | `fs.listDir`/`fs.writePlan` 无根目录禁闭(枚举 / 任意已存在目录写);**需插件在清单显式声明 `ipc:fs:listDir`/`ipc:fs:writePlan` 令牌方可触达,非默认可达**;同文件 `HandleFsAppDataDir` 已用 `SafeRelativeSubdir`+`ensureWithinBase` 却未套用两方法 | `ShellBridge.cpp:216,330`(对照 `:412-429`) | 对两方法套用同文件已有的禁闭工具 | [已知] host M2/M3 |
| 2 | HIGH | shutdown 两处无界等待:`~IpcBridge` 的 `m_asyncCv.wait` 无超时且未向在途 worker 发取消;`reg export` 子进程 `WaitForSingleObject(INFINITE)`。**worker 卡死则关闭时无限挂起(PLAUSIBLE,非无条件死锁)** | `IpcBridge.cpp:399`, `VrcSettings.cpp:932` | 改 `wait_for` 加上限 + 接线 cancel token;子进程改有限轮询 + 超时 Terminate | [新增] |
| 3 | HIGH | SafeDelete `ExecutePlan` happy-path 从不执行(只测 preserved 被拒 + VRChat 运行时 SKIP),核心"批删保留 `__info`/`vrc-version`"主路径无覆盖 | `tests/CommonTests.cpp:260` | 造 hex 缓存树跑 `ExecutePlan` 删 CWP,断言 hex 消失 + preserved 保留 + 计数 | [新增] |
| 4 | HIGH | `Migrator::execute` 真实 junction 创建 / 回滚零覆盖,失败留半迁移态 | `Migrator.cpp`, `CommonTests.cpp:299`(仅测 preflight 拒绝) | 受控 temp base 内跑 execute,断言 junction 建立 + 数据可达 + 回滚 | [新增] |
| 5 | HIGH | `fetchInstance` 的 `location` 未 percent-encode 直接拼 URL;`percentEncode` 就在同文件(`:352`)且他处 17 次已用 | `VrcApi.cpp:2359` | 套 `percentEncode` | [已知] diff M1 |
| 5b | HIGH | `fetchWorld` 的 `worldId` 同样未编码 | `VrcApi.cpp:2335` | 同上 | [新增,扩展 M1] |
| 6 | HIGH | IPC 响应侧 `slot.resolve(resp.result)` 从 `unknown` 直接消费、`resolve(v as TResult)`,前后端形状漂移编译期不可见、运行时静默崩 | `ipc.ts:544,581` | 热点方法(auth/friends/scan/db.stats)接 per-method 运行时校验器,失败 reject `shape_mismatch` | [新增] |
| 7 | HIGH | Friends 陈旧守卫失效:`__polledAt` 只在轮询结果写入,pipeline 合并路径从不更新,挡不住"陈旧轮询覆盖 pipeline 合并" | `Friends.tsx:1150` + `friends-pipeline.ts`(0 处 `__polledAt`) | pipeline 合并处也盖 `__polledAt`(一行) | [已知] 关联 pages M6 |
| 8 | HIGH | Friends 列表无虚拟化 / 分页,一次性挂载全部行;每行各发 `world.details` = N+1 IPC | `Friends.tsx:435`(无 `useVirtualizer`) | 复用已装 `@tanstack/react-virtual` + 批量 `world.details` | [新增] |
| 9 | HIGH | 中央 IPC `Dispatch()` 与前端 `IpcClient` 零专属单测——两层架构唯一缝隙(测试目录仅 `ipc-mock-data.test.ts` 测 mock 数据) | `IpcBridge.cpp` Dispatch, `ipc.ts:465` | 对 `IpcClient` 单测 pending 解析 / timeout / 重复 id / reconnect 清理 | [新增] |
| 10 | HIGH | `UdonException` 全链路零 golden 测试;解析代码已在只差断言 | `LogAtoms.cpp:90,541`, `CommonTests.cpp`(0 处 `Udon`) | 追加一条 `VRC.Udon.VM.UdonVMException:` 断言 | [已知] build-docs H2 |
| 11 | HIGH | 23MB ONNX wasm 无条件进 MSI/ZIP(占 dist 约 81%),仅服务默认关闭的实验 CLIP 搜索;`<Files Include="...web\**">` 全量吞入无排除。**纯包体 / 供应链,非正确性,MEDIUM 亦合理** | `installer/vrcsm.wxs:55` | 打包排除 `ort-wasm-*.wasm`,运行时按需拉取 | [新增] |
| 12 | HIGH | RelationshipGraph `role="button"` 有 `onClick` 无 `tabIndex`/`onKeyDown`,纯鼠标可达 | `RelationshipGraph.tsx:201` | 加 `tabIndex={0}`+`onKeyDown`,对齐既有键盘模式 | [新增] |
| 13 | HIGH | i18n:en(fallback 源)缺约 791 键(约 750 为 SteamVR);ja/ko/ru/hi 各缺约 41% | `web/src/i18n/locales/*.json` | CI 键覆盖门禁 + 从 zh-CN 回填 en 缺键 | [新增] |
| 14 | HIGH | `Database` 上帝对象:24 表、约 210 个方法级声明,CRUD 与 `Predict*`/`CoPresence*`/`GlobalSearch` 纯算法混在 6059 行;单 `m_mutex` 串行化全部读写 | `Database.h:39`(class 起于 `:40`);`Database.cpp` 6059 行 | 按限界上下文拆 Repo + 提取 Analytics 服务 | [新增] |
| 15 | MEDIUM | `IpcBridge` 伪模块化:19 bridge 文件共享 383 行头 + 约 194 个 `Handle*` + 全部 `m_*` 状态,改头触发全量重编、bridge 间无隔离 | `IpcBridge.h`(383 行), `src/host/bridges/*.cpp`(19 + `BridgeCommon.h`) | 引入 `IBridge` 接口,各 bridge 拥有自己的类与状态,IpcBridge 退化为路由 | [新增] |

**荣誉提及(严重度稍低但极廉价):**
- tinygltf 死依赖(`vcpkg.json:13`,`src/` 内 0 处引用,一行删)——[新增]。
- LogParser 每行串行多次 regex、无前置字面量过滤(`LogParser.cpp:576` 附近;全文 `regex_search/match` 约 25 处;**"每行 19 次"数字未逐路径验证 — 需 repro**)——[新增]。
- 前端无全局 `unhandledrejection` 兜底(`web/src/main.tsx`)——[新增]。
- CLAUDE.md/顶层文档 "10 pages" 实为 27(`App.tsx` `lazy(` = 27)——[已知] build-docs M1。
- 交接文档 "clean tree" vs 实际大量改动——[已知] build-docs M5。

---

## (c) 最大赢面(按 value/effort 前 8)

1. **Friends 守卫一行修复**(carry-over,关联 pages M6):pipeline 合并处盖 `__polledAt`,让现有守卫从装饰变生效。`Friends.tsx:1116` 附近。
2. **fetchInstance + fetchWorld 套 `percentEncode`**(diff M1 + 扩展):helper 同文件已有,两处即消除 diff M1 并顺修 world 端点。`VrcApi.cpp:2335,2359`。
3. **UdonException 加一条 golden 断言**(build-docs H2):解析代码已在,`CommonTests.cpp` 追加即闭环。
4. **删 tinygltf + 排除 / 按需化 23MB wasm**:一行删死依赖减供应链面;排除 wasm 砍安装包约 80%。零功能风险。
5. **shutdown 等待加超时 + 接线 cancel token**:改 `~IpcBridge` 与 `VrcSettings.cpp:932`,消除"worker 卡死则关闭挂起"这一最影响体感的缺口。
6. **`fs.listDir`/`fs.writePlan` 套用已有 `ensureWithinBase`**(host M2/M3):工具就在同文件(`HandleFsAppDataDir` 已用),关掉一个安全 carry-over。
7. **i18n CI 键覆盖门禁 + 回填 en 791 键**:一个脚本持续挡回归,回填直接修复 fallback 链断裂,惠及全部 7 语言。
8. **RelationshipGraph 加 `tabIndex`+`onKeyDown`**:约 5 行,复用现成模式,兑现 `role="button"` 承诺。

---

## (d) Carry-over 状态表

> 表头声明:以下 5 项均为**旧评审 `REVIEW-SUMMARY.md:253-256` 已登记**的 "Carry-overs not yet done",本轮为**闭环复核**,非新发现。旧评审从未声称其已修。

| carry-over(旧评审归属) | 状态 | 证据(亲验) |
|---|---|---|
| #1 UdonException golden 测试(build-docs H2) | **Still-open** | 解析已实现(`LogAtoms.cpp:90` `kUdonExceptionRe`、`:541`),但 `CommonTests.cpp` 全文 0 处 `Udon` |
| #2 fetchInstance location 编码(diff M1) | **Still-open** | `VrcApi.cpp:2359` 原样拼入 `location`;`percentEncode`(`:352`)他处 17 次已用唯独此漏;**fetchWorld(`:2335`)同病,为超出 M1 的真新增** |
| #3 Friends 陈旧守卫(关联 pages M6) | **Still-open(守卫在但失效)** | `Friends.tsx:1150-1151` 只挡轮询 vs 轮询;`friends-pipeline.ts` 0 处 `__polledAt` |
| #4 IPC 边界 `any`(lib M3/diff M2) | **Still-open(基本未减)** | `ipc.ts` `\bany\b` 27 处;`types.ts` 两处索引签名 `any` |
| #5 fs.listDir/writePlan 根禁闭(host M2/M3) | **Still-open** | `ShellBridge.cpp:216` 枚举无禁闭;`:330` 任意已存在目录可写;同文件 `HandleFsAppDataDir`(`:412-429`)已用禁闭工具却未套用两方法 |
| **回归检查** | **无回归** | plugin teleport 修复完好:`PluginBridge.cpp:316-321` 短路 `plugin.*` 递归,`:323-327` 过 `CanInvoke` 权限门;`PluginRegistry.cpp:16-24` FreeMethods 仅 3 个纯读端点,fs 方法(`:44-45`)需显式令牌 |

**冲突裁决:**
- 各轴对 "bridge 数量" 表述一致为 19 个 bridge `.cpp` + `BridgeCommon.h`;文档若宣称 "20" 为腐化。
- UdonException / fetchInstance / fs 禁闭 / `any` 在 testing、carryover、security 等轴重复出现,已合并计一次,以 carry-over 的 `file:line` 与旧评审归属为准。
- 草稿曾将 `fs.listDir/writePlan` 定为 **BLOCKER 且"经 plugin.rpc 默认可达"**——经亲验(`PluginRegistry.cpp:16-24,44-49`、`PluginBridge.cpp:323-327`)**证伪**:两方法需插件清单显式声明 fs 令牌,旧 `ipc:shell` 已不再继承文件系统面。故本终裁**降为 MEDIUM 并标 [已知] host M2/M3**。这是本轮相对草稿的最重要修正。

---

## 附:发布前已应用的 5 项复核修正(供追溯)

1. #1 `fs` 禁闭:BLOCKER → **MEDIUM**,标 [已知] host M2/M3(严重度夸大 + "plugin.rpc 默认可达"失真)。
2. carryover-verify:**D → C**,删除"反造已修假象"措辞,标注 5 项均为旧评审已登记待办。
3. "10 pages"、"clean tree"、fs 禁闭、`any`、fetchInstance 均标 [已知];仅 fetchWorld 扩展、tinygltf、上帝对象拆分、shutdown 无界等待、Friends 守卫失效细节为 [新增]。
4. #2 shutdown:"致死锁" → **"worker 卡死则挂起(PLAUSIBLE,非必然)"**。
5. LogParser "每行 19 次" 标**未验 — 需 repro**;Database "222 成员" 改为**量级估计**(约 210 方法级声明 + 24 表,私有 `m_` 成员实为少数)。

**密钥卫生:** 全文无字面 token/session/cookie/私钥/真实 VRChat id;`kApiKey` 仅按名引用。通过。
