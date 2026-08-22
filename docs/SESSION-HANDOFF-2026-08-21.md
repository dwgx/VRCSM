# VRCSM successor acceptance pack — 2026-08-21 (v0.16.4 wrap)

**Historical.** Present tense moved to `docs/SESSION-HANDOFF-2026-08-22.md` (v0.16.5).
I18N-grey and FTS-gate shipped in 0.16.5. Do not recut 0.16.4 or 0.16.5.

**This file was the present-tense contract for the 0.16.4 window.**
If MEMORY / NEXT-AGENT / HANDOFF disagree with this file plus `git status`,
**git wins**.

Owner instruction that created this wrap:

> 准备被接手项目吧 封装好各种文档开始同步

No new product slice in this window. Docs only. Next window: init → this file →
`git status` → wait for a named slice (default **I18N-grey** or **FTS-gate**,
as **0.16.5** — do not recut 0.16.4).

Superseded 0.16.2 dirty pack:
`C:\Users\dwgx1\.agent-system\ledger\90-archive\by-date\2026-08-21\VRCSM-SESSION-HANDOFF-0.16.2-dirty-pack.md`

---

## 0. One-screen truth

| Item | Fact |
|---|---|
| Product | **v0.16.4** released. GitHub Latest. LICENSE **VSAL**. |
| HEAD | `803adca` `release: 0.16.4 leftovers, grey default on, mutuals crawl` |
| Tag | annotated `v0.16.4` peels to HEAD. `main` = `origin/main` |
| Version files | `VERSION` / `web/package.json` / `vcpkg.json` = **0.16.4** |
| Grey | Master **default ON** (helpers visible). Invite Assist / Event Watch auto-join / IMAP still need confirm. G5/G6 clamps unchanged. Saved `greyEnabled: false` stays false. |
| Mutuals | Persist tables + inspector cache + **Friends toolbar crawl** (cancelable, not App mount). Official GET only. |
| UnityFS 3D | Encrypted stays empty. No keys. Empty-state copy says so. |
| This window | Docs wrap. No src/web feature. |
| Writer | Owner's newest named slice only. Do not commit `CLAUDE.md` / `AGENTS.md` / `.agent/` / scratch txt. |

Exact next action: estate init → this file → `git status --short --branch`. Default if Owner says continue without an id: **I18N-grey** (six locale `grey.master.desc`) as **0.16.5**. Do not recut 0.16.4.

---

## 1. Init (every new window)

1. `C:\Users\dwgx1\.agent-system\entry\CONTINUE.md`
2. `entry/CLAUDE.md` → `entry/AGENTS.md`
3. `protocols/CORE.md`, `WORKFLOW.md`, `WORKFLOW-LOCK.md`
4. Project `CLAUDE.md` → `AGENTS.md`
5. `.agent/HANDOFF.md`
6. **This file**
7. `git status --short --branch` — git wins
8. Named slice only

Quality: `workflows/high-quality.md`. Heavy C++ in the **foreground**. Parallel writers = `git worktree`.

---

## 2. Legal rails

Copy into every subagent prompt.

- LICENSE **VSAL**. Do not relicense. Do not paste GPLv3 VRCX-0 or VNCOL VRCNext. Ideas only. VRCX clone `D:\Reference\VRCX` at `5ea37a2`. Dump `D:\Reference\vrc-tools`.
- Never copy SaoMoLa decrypt / keys. Encrypted UnityFS 3D stays empty. `D:\Project\SaoMoLa` is cache-layout ideas only.
- Grey master default ON in **0.16.4**. Invite Assist / Event Watch auto-join / IMAP still confirm-gated. Do not widen G5/G6 (cancel 5s, cooldown 600–3600, join delay 15–60).
- Tests use **temp dirs**. Do not wipe live `%LocalLow%\VRChat\VRChat`. Product Save/migrate/delete already write live data after confirm + ProcessGuard. `config.write` rethrows `{error}`.
- Mutuals: official `GET /users/{id}/mutuals/friends` only. Crawl is **user-triggered**, not App.tsx startup.
- No AI commit attribution. No secrets in docs or ledger.
- Preserve `__info` and `vrc-version` on Cache-WindowsPlayer bulk delete.
- UTF-8 everywhere; `wchar_t` only at Win32 boundaries.

Skip unless the **current** Owner message names them: decrypt, GPL paste, in-process VRCVideoCacher, grey auto-invite without confirm, live-cache test wipes.

---

## 3. Git truth (this wrap)

```
branch: main...origin/main
HEAD:   803adca release: 0.16.4 leftovers, grey default on, mutuals crawl
parent: 33c8e85 docs: record v0.16.3 release hashes
tag:    v0.16.4  →  803adca
```

https://github.com/dwgx/VRCSM/releases/tag/v0.16.4

| Artifact | Size | SHA256 |
|---|---|---|
| `VRCSM_v0.16.4_x64_Installer.msi` | 9,342,976 | `018cd4e4a1ba4973670fcbb95f8d960133f647bad5293bbb3a72c10c75697363` |
| `VRCSM_v0.16.4_x64.zip` | 21,838,741 | `2138528e0f38cc7a6cb021642f0d38469cb2a9477c0d04c8944f1442fc2c6736` |

`SHA256:` lines required in GitHub notes (updater fail-closed).

Stop VRCSM before MSI reinstall. Same-version `REINSTALLMODE=amus` will not replace hashed `web/`. After `pnpm build`, ninja no-op does not copy `web/dist`. VERSION is configure-time.

Working tree after this wrap: control-plane dirty (`CLAUDE.md`, `AGENTS.md`, scratch) + tracked handoff docs if rewritten. Never commit control-plane.

---

## 4. What shipped — do not rebuild

### 0.16.4 (`803adca`)

GH-CI YAML (Node 22 + pnpm 11, vitest `--no-file-parallelism` 30s, skip `onnxruntime-node` postinstall) · CI1 CacheIndex `ListBundles` + Report reuse + `StartScan(cacheWindowsPlayerDir())` · SR1-pop schema v21 FTS rebuild + triggers (LIKE fallback) · MU1-db `friend_mutual_*` + `readCache` · Friends toolbar mutuals crawl · P17 plugin mocks (host handlers kept) · grey master default ON · `config.write` `rethrowIfErrorEnvelope` · encrypted 3D copy.

### 0.16.3 (`984c6b6` / hashes `33c8e85`)

FL1 Locations + virtual Friends · VL1 Logs/Bundles · PathProbe always-named config.json · calendar paging · self-player id-wins · `world_visits` graph center · P15 OnLeftRoom/Udon URL · MU1 fetchOne · P2 webhook default OFF · P5 join recommend display-only · SR1 fold + FTS table · UX1 · P17 `/migrate` Playwright.

### 0.16.0–0.16.2

Phase 1 1–7, Wave 4 grey hosts (default was OFF until 0.16.4 master), P18 P16 P4 P12, 7-locale companion strings, grey rails.

---

## 5. Verification ledger

| Claim | Status | Evidence |
|---|---|---|
| HEAD 0.16.4 / `803adca` | **verified** | `git log -1`, tag `v0.16.4`, `VERSION` = 0.16.4 |
| ctest debug+release 248/0 | **verified** (release window) | 1 skipped, 5 live DISABLED |
| Playwright 62/62 | **verified** (before 0.16.4 extra edits; leftover tree) | includes `/migrate` |
| FileVersion 0.16.4.0 | **verified** | release exe |
| GitHub Latest assets | **verified** | `gh release view v0.16.4` |
| Ubuntu CI on `803adca` | **verified** success | https://github.com/dwgx/VRCSM/actions/runs/32478662811 |
| Pages on `803adca` | **verified** success | run 32478662686 |
| Windows Release Actions | **unknown** / was in_progress at wrap | run 32478662713 |
| Six-locale grey default copy | **observed wrong** | en updated; zh-CN/ja/ko/ru/th/hi still “default off” |
| FTS rebuild only on v21 upgrade | **not done** | every `Open()` DELETE+INSERT `search_docs` |
| Live graph UI click/chips | **unknown** | VER1 sqlite+code passed; WebView2 not driven |
| Encrypted 3D empty | **accepted** | legal |

Commands:

```powershell
cd web
corepack pnpm exec tsc -b
corepack pnpm exec vitest run --no-file-parallelism --testTimeout 30000
corepack pnpm exec vite build

cmd.exe /s /c '"D:\Software\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 && cmake --build --preset x64-debug && ctest --test-dir build\x64-debug --output-on-failure'
```

Node `fs` fallback in `lyrics.ts` is **vitest-only**; WebView2 uses `lyrics.readFolder`. Keep it. Do not delete plugin IPC (`fs.writePlan`, …) without a caller audit.

Pre-existing compile noise: PluginBridge `u8path` C4996, CommonTests `getenv` C4996, sscanf C4996 OtpMailParser/ImapClient, LyricsProxy C4244.

---

## 6. Architecture the next agent must not re-discover

Three layers. UI has no platform logic.

```
web/     React 19 + Vite 6 + Tailwind 4 + shadcn
src/host Win32 + WebView2 + IpcBridge (21 bridges)
src/core vrcsm_core C++20
```

- IPC `{ id, method, params }` → `{ id, result | error }`. Events `{ event, data }`.
- Core `Result<T>` = `variant<T, Error>`. No exceptions in core.
- Database split TUs. Schema **v21**.
- `search.global`: MATCH on `search_docs` then LIKE. Fold in `normalizeSearchQuery`.
- `@tanstack/react-virtual` in Feed, ActivityLedger, Friends, Logs, Bundles.
- Friends list owners: page state **and** `useFriendsPipelineSync`. Do not add a third.
- `CacheIndex::Lookup` is avtr→path. `ListBundles` / `TryListBundlesFor` for Report. Empty ready list currently falls back to sniff (Low).
- Mutuals: persist + readCache + toolbar `crawlMutuals` in `web/src/lib/mutuals-crawl.ts`.
- i18n: 7 locales. New keys: `defaultValue` plus JSON when doing a locale slice.

Live DB on this machine (VER1, read-only): `player_events` 10543, `world_visits` 106. Self `usr_8817eeb8-13b2-43e7-a0f4-b3b27adf2726`.

---

## 7. Ranked remaining

| # | ID | Slice | Status | Acceptance |
|---|---|---|---|---|
| 1 | **I18N-grey** | Six locales `grey.master.desc` | **observed** | zh-CN/ja/ko/ru/th/hi match English “on by default; helpers still confirm”. IMAP “off by default” can stay — IMAP is still off. |
| 2 | **FTS-gate** | Skip FTS wipe if `user_version >= 21` | **not done** | First open after v20 rebuilds; later opens do not DELETE `search_docs`. LIKE fallback stays. |
| 3 | **WIN-CI** | Confirm Windows Release Actions | **unknown** at wrap | `gh run view 32478662713` green for a stated reason. |
| later | P6 P7 P14 P25 P1 P3 P9 | Parked S/M/L | park | Owner names. Clean-room only. |

Do not put back: FL1 VL1 P15 P2 P5 MU1 fetchOne/db crawl SR1 fold/table/pop CI1 GH-CI YAML UX1 P17 P18 P16 P4 P12 Phase 1 Wave 4 hosts.

---

## 8. Copy-paste recon prompt

```
You are a read-only recon agent for VRCSM at D:\Project\VRCSM.
Mission: rebuild disk/Git truth. Do not edit.
Read CLAUDE.md, AGENTS.md, .agent/HANDOFF.md, docs/SESSION-HANDOFF-2026-08-21.md.
Run git status --short --branch and git log -8 --oneline.
Confirm HEAD 803adca and tag v0.16.4.
Return: branch/HEAD/dirty list; VERSION; one sentence whether this is still the 0.16.4 wrap.
Non-goals: implementation.
```

---

## 9. Open Owner decisions

1. First named slice: I18N-grey vs FTS-gate vs wait for WIN-CI vs parked P6?
2. Docs commit of this wrap, or leave handoff docs dirty?
3. Version: **no recut of 0.16.4**. Next product bump is 0.16.5 / 0.17.0 when named.
4. Decrypt / GPL paste: still skip unless **this** window’s Owner message names them.

End of pack. **v0.16.4 is released.** Next named slice: **I18N-grey** (default) as 0.16.5.
