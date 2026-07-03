---
name: session-persist-diagnosis
description: "每次重登" 根因排查结论 — 持久化层正常,快捷方式指向旧 release
metadata:
  type: project
---

用户报告 "每次重启应用都要重新登录"（密码 + 2FA 登录）。2026-07-04 排查结论：

AuthStore 持久化层（DPAPI session.dat / Save / Load）**完全正常**。用带 `[session-diag]` 日志桩的今日 debug 版复现，全链路健康：
- 密码登录 → `Save() wrote 320 bytes`
- 2FA 验证 → `Save() wrote 656 bytes`（合并 auth + twoFactorAuth cookie）
- 关闭应用 → 文件保留在盘（关闭路径无 Clear）
- 重启 → `Load() read 656 bytes`，2 秒后 Pipeline connected，无 401、无 Clear，登录态保持

真凶：开始菜单快捷方式 `VRCSM.lnk` 指向 `D:\Project\VRCSM\build\x64-release\src\host\VRCSM.exe`，那是 **2026-07-01 的旧 release 构建**。今天的 debug（含所有未提交改动）能保持登录，旧 release 不能。

**How to apply:** 修复 = 用当前代码重新构建 release，让快捷方式指向的 exe 带上最新改动。诊断日志桩（AuthStore.cpp/h 的 `[session-diag]` + Clear 的 reason 参数）是临时的，定位完成后应清理或降级为 debug 级别。

每 30 秒一次 `Load()→Clear(reason=AuthStatus/auth_expired)` 是前端 `auth.status` 定时轮询（auth-context.tsx:267 `setInterval(30_000)`），未登录时 hadSession=false 无害。
