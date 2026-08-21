# VRCSM successor acceptance pack — 2026-08-21 (v0.16.3 wrap)

**This file is the present-tense contract for the next agent window.**
`MEMORY.md` and older blocks in `docs/NEXT-AGENT-HANDOFF.md` are history. If they
disagree with this file plus `git status`, **git wins**.

Owner instruction that created this wrap (verbatim intent, not a new product slice):

> 现在上下文快满了 把没做的要做的各种我们历史记过的都按照 workflow 工作流程本地文档同步建立 清理 优化 清理漂移 … 封装好等待下一个窗口接手

Follow-on window **did** land the six named leftovers on dirty `main` (still
**v0.16.3**, no recut). GitHub Actions green after push is **unknown**. Next
window: init → this file → `git status` → wait for a named **commit** or **0.16.4**.

The 0.16.2 dirty-tree pack (FL1 uncommitted, HEAD `e22417c`) is **superseded**.
Archive copy: `C:\Users\dwgx1\.agent-system\ledger\90-archive\by-date\2026-08-21\VRCSM-SESSION-HANDOFF-0.16.2-dirty-pack.md`.

---

## 0. One-screen truth

| Item | Fact |
|---|---|
| Product | **v0.16.4** cut. LICENSE **VSAL**. Grey master **default ON**; assist/watch/IMAP still confirm. |
| HEAD | `33c8e85` (`docs: record v0.16.3 release hashes`). Branch `main` = `origin/main`. |
| Product commit | `984c6b6` `release: 0.16.3 friends locations and local-first follow-ups` |
| Tag | annotated `v0.16.3` peels to `33c8e85` |
| Version files | `VERSION` / `web/package.json` / `vcpkg.json` = **0.16.3** |
| This window | Six leftovers landed **uncommitted** on 0.16.3. |
| Shipped already (do not rebuild) | FL1, VL1, P15, MU1 fetchOne, P2 default OFF, P5 display-only, SR1 fold+FTS table, UX1, P17 `/migrate`, PathProbe/calendar/self-player/graph-key, 7-locale keys. **P18 / P16 / P4 / P12** in **0.16.0**. |
| Leftovers this window | GH-CI YAML, VER1 live counts, CI1 index list + PathProbe cache root, SR1-pop v21, MU1-db persist, P17 mocks. |
| Writer rule | Owner's newest named slice is the only product mission. Grok is not the default writer. |
| Commit | Do **not** commit control-plane (`CLAUDE.md`, `AGENTS.md`, `.agent/`, scratch txt). Product-doc edits from this wrap wait for a named docs commit. |

Exact next action: finish the estate init list, read **this file**, run
`git status --short --branch`. Default if Owner says “continue” without an id:
**commit** the leftover slice (still 0.16.3) then watch GitHub Actions. Do not
recut 0.16.3 MSI unless they name **0.16.4**.

---

## 1. Init (every new window, before product)

Same chain as `C:\Users\dwgx1\.agent-system\entry\CONTINUE.md`. Do not skip.

1. `C:\Users\dwgx1\.agent-system\entry\CONTINUE.md`
2. `entry/CLAUDE.md` → `entry/AGENTS.md`
3. `protocols/CORE.md`, `WORKFLOW.md`, `WORKFLOW-LOCK.md`
4. Project `CLAUDE.md` → `AGENTS.md`
5. `.agent/HANDOFF.md`
6. **This file** (`docs/SESSION-HANDOFF-2026-08-21.md`)
7. `git status --short --branch` — if MEMORY / HANDOFF disagree, **git wins**
8. Then the Owner-named slice only

Quality bar: `C:\Users\dwgx1\.agent-system\workflows\high-quality.md`. Prefer
reliability over token thrift. Heavy C++ in the **foreground**. Parallel writers
= `git worktree`, never a second writer on a dirty `main`.

---

## 2. Legal rails (non-negotiable unless the *current* Owner message names an exception)

Copy these into every subagent prompt.

- LICENSE is **VSAL** (source-available, not OSS). Do not relicense.
- **Never paste** GPLv3 **VRCX-0** source. Ideas only. Local clone `D:\Reference\VRCX` at `5ea37a2` (Version 2026.07.18) is research-only.
- **Never paste** VNCOL **VRCNext** source. Ideas only. Dump: `D:\Reference\vrc-tools`.
- **Never copy** SaoMoLa kernel / UnityFS decrypt / keys into VRCSM. 3D preview of encrypted VRChat UnityFS stays empty. SaoMoLa live tree: `D:\Project\SaoMoLa` (cache-layout ideas only).
- Grey helpers (Invite Assist, Event Watch, IMAP OTP, OscTts) stay **default OFF**. Do not widen G5/G6.
- Never mutate live VRChat user data in dev. Destructive ops default dry-run. Block if `VRChat.exe` is running (`ProcessGuard`).
- Preserve `__info` and `vrc-version` at `Cache-WindowsPlayer` root on bulk delete.
- UTF-8 everywhere; `wchar_t` only at Win32 boundaries.
- Mutual friends: official `GET /users/{userId}/mutuals/friends` only, **opt-in**, rate-limited, **never a startup crawl**.
- No AI commit attribution (`Co-Authored-By`, “Generated with”).
- No secrets in prompts, docs, or ledger.

A prior window heard Owner say previously-forbidden items were “都允许”. That
window **still did not ship** decrypt / GPL paste / crawl / grey default ON /
live VRChat mutation / in-process VRCVideoCacher. Next window: do not start
those unless the **current** message names them. Default remains the skip list.

Skip list still skip: in-process VRCVideoCacher, InviteMessage messenger,
Space Flight compositor (G2 is the clean-room offset), unofficial Spotify
`sp_dc`, cache-mover `move_dir` wipe, Permini/Event Snipe bots.

---

## 3. Git truth (verified 2026-08-21 this wrap)

```
branch: main...origin/main
HEAD:   33c8e85 docs: record v0.16.3 release hashes
parent: 984c6b6 release: 0.16.3 friends locations and local-first follow-ups
tag:    v0.16.3  →  33c8e85
```

GitHub Latest: https://github.com/dwgx/VRCSM/releases/tag/v0.16.3

| Artifact | Size | SHA256 |
|---|---|---|
| `VRCSM_v0.16.3_x64_Installer.msi` | 9,633,792 | `8f3495c6c0ab3a4f0d6ec780699052a179e8cf23fb351a0ee0994bf7f6c02ced` |
| `VRCSM_v0.16.3_x64.zip` | 12,814,756 | `9d0e11d8d712ca6ed53bc48843a7bf617f8ffdbe1f497be21ee21e20fe6d4795` |

`SHA256:` lines are required in GitHub notes (updater fail-closed).

### 3.1 Working tree

Product source at HEAD is **committed**. After this wrap, expect:

| Path | Why dirty | Commit? |
|---|---|---|
| `CLAUDE.md`, `AGENTS.md` | Control-plane version/baseline text | **never** |
| `2026-07-04-111708-local-command-caveatcaveat-the-messages-below.txt` | Scratch | **never** |
| `.agent/HANDOFF.md` | Untracked progress | **never** |
| `docs/SESSION-HANDOFF-2026-08-21.md` and other handoff docs edited this wrap | Present-tense sync | only if Owner names a **docs commit** |

Do not `git reset` / stash / clean to tidy. Do not recut 0.16.3.

### 3.2 Reinstall trap (still true)

Stop VRCSM before installing an MSI. Same-version `REINSTALLMODE=amus` will
**not** replace hashed `web/`. If the same version is already installed:
`msiexec /x` then `/i`. Quit the running WebView2 first.

`ninja: no work to do` does **not** copy `web/dist`. After `pnpm build`,
`Copy-Item` dist into `build\x64-release\src\host\web` (or rebuild the host
target so POST_BUILD runs). VERSION is configure-time — reconfigure the CMake
preset after a bump.

---

## 4. What shipped in v0.16.3 — do not rebuild

All of this is in `984c6b6`, not on a dirty tree.

### 4.1 FL1 Friends Locations

`/friends` defaults to instance-first sections keyed by the **full location
tag**, virtualized like Feed (`@tanstack/react-virtual`). Same-instance-as-me
first. Private / traveling / offline stay separate. Status buckets remain as a
toggle. `world.details` only for visible rows plus the inspector. View-model:
`web/src/lib/friends-view-model.ts`. Header: `web/src/components/friends/LocationSectionHeader.tsx`.
Do not add a third list owner (page state vs `useFriendsPipelineSync`).

### 4.2 VL1 virtual lists

Logs timeline and Bundles list use the Feed virtualizer. Variable-height Logs
rows measure inside `totalSize`. Bundles still `parseInfoText` on Unity
`__info` (four-line cache manifest, not a URL). Encrypted 3D preview stays empty.

### 4.3 Paths / calendar / self / graph

- `PathProbeResult.configJson` is always `baseDir / config.json`. Missing file
  reads as `{}`. Save creates it. Relative `cache_directory` resolves against
  the VRChat base dir. VRChat running still blocks the write.
- Calendar: discover/featured max 2 pages; user `/calendar` max 3. Non-auth
  list errors surface. Groups tab can show events even if `groupCount=0`.
- `web/src/lib/self-player.ts`: id mismatch is **not** self (namesake-as-self
  was a test lock; id wins).
- Co-presence: `world_visits` seeds the graph center. `presenceSessionKey` +
  world-only ↔ full-instance overlap. Distinct full instances stay split.
  Tests: `CoPresenceUsesWorldVisitsWhenSelfAbsentFromEvents`,
  `CoPresenceMatchesVisitFullInstanceToNullEventInstance`,
  `CoPresenceKeepsDistinctFullInstancesSeparate`.

### 4.4 P15 log atoms

`[Behaviour] OnLeftRoom` and Udon String/image URL atoms. Drop
`localhost:22500` / `127.0.0.1:22500`. Remote `OnPlayerLeft` unchanged. Do not
fetch those URLs.

### 4.5 MU1 fetchOne

Official `GET /users/{id}/mutuals/friends` (`n` ≤ 100). IPC
`social.mutual.fetchOne`. Friend inspector button. HTTP 403 = hidden, not zero.
**No startup crawl. No `friend_mutual_edges` / `friend_mutual_meta` tables.**

### 4.6 P2 webhook

`WebhookNotifier` HTTPS allowlist `discord.com` / `discordapp.com`. Default
**OFF**. Settings row next to toasts. No bot token. No send in unit tests.

### 4.7 P5 join recommend

Display-only panel + `web/src/lib/join-recommend.ts`. Never calls
`user.inviteTo` / `inviteSelf` automatically.

### 4.8 SR1 search

`normalizeSearchQuery` does ASCII/kana/fullwidth fold. `vcpkg.json` sqlite3
feature `fts5`. Schema v20 optional virtual table `search_docs`. `GlobalSearch`
tries MATCH then falls back to `LIKE '%'||?||'%'`. Seed is **one INSERT if
table empty** from `local_favorites` ∪ `world_visits`. **No triggers. No
ongoing populate.**

### 4.9 UX1 / P17 / i18n / load

SocialGraph / AvatarBenchmark / Bundles skeletons. Playwright ROUTES include
`/migrate` visual + click-through. 7-locale new keys; coverage 13/13.
Command palette fetches session logs after the first non-empty query and does
not cancel that fetch on extra keystrokes. Feed invalidation keeps a 1.5s
trailing flush.

### 4.10 Already shipped earlier (do not put back)

Last-instance, OSC nits, screenshot visits, activity ledger, avatar presets,
entity Quick Search, app-data backup, InviteSlots, PlayspaceOffset, OscTts,
AuthOtpMail, InviteAssist, EventWatch (default OFF), P18 `cache_expiry_delay`,
P16 visit dwell, P4 Hot Worlds, P12 `{hr.bpm}`, 0.16.1 7-locale companion
strings, 0.16.2 grey rails.

---

## 5. Verification ledger (status words)

Only `verified` / `accepted` close a claim.

| Claim | Status | Evidence |
|---|---|---|
| HEAD is 0.16.3 / `33c8e85` | **verified** | `git log -1`, tag `v0.16.3`, `VERSION` = 0.16.3 |
| Product slice committed | **verified** | `984c6b6` 81 files |
| `tsc -b` + `pnpm build` on the cut | **verified** (release window) | not re-run during this wrap |
| x64-debug ctest 239/0 | **verified** (release window) | 1 skipped, 5 live DISABLED |
| x64-release ctest 239/0 | **verified** (release window) | FileVersion 0.16.3.0 |
| Playwright UI smoke 62/62 | **verified** (release window) | includes `/migrate` |
| GitHub Latest assets + SHA256 | **verified** this wrap | `gh release view v0.16.3` |
| Live graph vs 10k `player_events` | **unknown** | unit tests only (VER1) |
| FTS incremental populate | **unknown** / not built | one-shot seed only |
| Mutual persist tables | **not started** | grep: only in old docs |
| GitHub CI green | **blocked** / observed red on `33c8e85` | see §7 GH-CI |
| Full pages-smoke under parallel vitest | **observed** flakes | use `--no-file-parallelism` |
| Encrypted UnityFS 3D | **accepted empty** | legal |
| This pack vs git | **verified** | written against `git status` + `gh` 2026-08-21 |

Commands the next implementer should actually run (foreground):

```powershell
cd web
corepack pnpm exec tsc -b
corepack pnpm exec vitest run --no-file-parallelism --testTimeout 30000
corepack pnpm exec vite build
# After vite, if host is already linked:
Copy-Item -Recurse -Force dist\* ..\build\x64-release\src\host\web\

cmd.exe /s /c '"D:\Software\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 && cmake --build --preset x64-debug && ctest --test-dir build\x64-debug --output-on-failure'
```

Node `fs` fallback in `lyrics.ts` is **vitest-only**; WebView2 uses
`lyrics.readFolder`. Keep it. Do not delete `fs.writePlan` etc. without a
plugin/caller audit.

Pre-existing compile noise (not a ship blocker): PluginBridge.cpp:172 `u8path`
C4996, CommonTests.cpp `getenv` C4996, sscanf C4996 in OtpMailParser/ImapClient,
wchar→char C4244 in LyricsProxy.

---

## 6. Architecture facts the next agent must not re-discover

Three layers. UI has no platform logic.

```
web/     React 19 + Vite 6 + Tailwind 4 + shadcn   (pages + lib)
src/host Win32 + WebView2 + IpcBridge              (21 bridges)
src/core vrcsm_core C++20                          (all VRChat logic)
```

- IPC: `{ id, method, params }` → `{ id, result }` or `{ id, error }`. Events: `{ event, data }`.
- Core errors: `Result<T>` = `variant<T, Error>`. No exceptions in core.
- Database is split: `Database.cpp` + 9 domain TUs + `Database_internal.h`. Schema **v20**.
- Friend graph compute is **pure** in `FriendAnalytics`. SQL lives in `Database_Friends.cpp`.
- `search.global`: MATCH on `search_docs` when FTS5 exists, else LIKE. Fold is in `normalizeSearchQuery`.
- `@tanstack/react-virtual` **in use:** Feed, ActivityLedger, **Friends, Logs, Bundles**.
- Friends list owners: still page state **and** `useFriendsPipelineSync`. Do not add a third.
- Mutuals: VrcApi wrapper + `social.mutual.fetchOne` + dialog. No persist schema.
- i18n: 7 locales. New keys: `defaultValue` in code; JSON when doing a locale slice.
- CMake: bump `VERSION` then **reconfigure**. Host CMake target is `VRCSM` (not lowercase `vrcsm` on this generator).
- `CacheIndex` is **avtr_* → bundle path** lookup (`Lookup`), background scan of Cache-WindowsPlayer. It is **not** the Bundles page list owner. Bundles still walks cache dirs. Startup can scan the cache twice (CI1).

### 6.1 Local data the graph depends on

| Store | Role |
|---|---|
| `%LocalLow%\VRChat\VRChat\` | Logs, `LocalAvatarData/<usr_*>/<avtr_*>` JSON |
| `Cache-WindowsPlayer/<hex>/` | `__info` + `__data` UnityFS (often encrypted) |
| `%LocalAppData%\VRCSM\` | SQLite, session DPAPI |
| `player_events` | Other players join/left. `instance_id` nullable on old rows |
| `world_visits` | **You** were here. P16 shipped `NormalizeVisitTimestamp` |

---

## 7. Ranked remaining (later sessions)

Owner: **name commit** (or 0.16.4). The six leftovers below are **landed uncommitted**.

| # | ID | Slice | Cost | Status | Acceptance (short) |
|---|---|---|---|---|---|
| 1 | **GH-CI** | GitHub Actions YAML | S–M | **verified** locally; Actions green **unknown** until push | Node 22 + pnpm 11; vitest flags; onnxruntime-node skip |
| 2 | **VER1** | Live graph vs ~10k `player_events` | S | **verified** sqlite+code; UI click **unknown** | 10543 / 106; visits seed center; self not #1 after filter |
| 3 | **CI1** | CacheIndex vs Bundles list | M | **verified** 6 gtests | Lookup stays avtr; ListBundles; Report fallback; StartScan uses `cacheWindowsPlayerDir()` |
| 4 | **SR1-pop** | FTS populate + triggers | M | **verified** 2 gtests | v21 rebuild + triggers; LIKE fallback |
| 5 | **MU1-db** | Persist fetchOne | S–M | **verified** 1 gtest | tables + readCache; 403 hidden; no crawl |
| 6 | **P17-B11** | Dead-handler audit | S–M | **verified** vitest 5/5 | mocks only; do not delete plugin IPC |
| later | **P3 P6 P7 P9 P10 P11 P13 P14 P23 P25** | Parked S/M in REMAINING-SLICES | — | park | Owner names. |
| never here unless named | P1 P8 P19 P20 P21 P22, encrypted 3D, crawl, grey ON | L/XL / skip | park | |

**Do not put back on the wave:** FL1, VL1, P15, P2, P5, MU1 fetchOne, SR1 fold+table, UX1, P17 `/migrate`, P18, P16, P4, P12, companion Phase 1, Wave 4 grey hosts.

### 7.1 GH-CI evidence (this wrap, `gh run view`)

Push of `33c8e85`:

| Workflow | Result | Actual cause (not folklore) |
|---|---|---|
| Deploy GitHub Pages | **success** | — |
| CI / Release Metadata | **success** | — |
| CI / TypeScript Check | **success** | Node 22, pnpm 10 in yaml |
| CI / Vite Build | **failure** | `onnxruntime-node` postinstall `ETIMEDOUT` to `150.171.110.210:443` |
| CI / Vitest | **failure** | `interaction-smoke` `/tools/osc` **5000ms** timeout. Command is `vitest run --passWithNoTests` — **no** `--no-file-parallelism`. 1 failed / 51 files passed. |
| Build Windows Release | **failure** | Node **20** + `packageManager: pnpm@11.8.0` → `Error [ERR_UNKNOWN_BUILTIN_MODULE]: node:sqlite`. **Same class of fail on 0.16.2.** |

`web/package.json` has `"packageManager": "pnpm@11.8.0"` and `"pnpm": ">=11"`.
`ci.yml` pins pnpm **10** + Node **22**. `build-win.yml` pins Node **20**.

Likely smallest GH-CI slice: Node 22 on `build-win.yml`; vitest `--no-file-parallelism` (and/or higher testTimeout) on CI vitest; ignore-scripts or cache onnxruntime native for Ubuntu postinstall. Do not drop experimental visual-search wasm from MSI without Owner.

---

## 8. How the next session should fan out

1. One writer on `D:\Project\VRCSM`. If this wrap left product docs dirty, either (a) Owner names a docs commit first, or (b) worktree for a product slice.
2. Read-only recon is cheap. Heavy C++ stays foreground.
3. One named implementation mission. Do not start GH-CI+VER1+CI1+SR1-pop in one window.
4. Fresh-context review before commit.
5. Ledger event + update this file’s date block if the slice lands.

---

## 9. Copy-paste subagent prompts (remaining work only)

Replace nothing except optional `{OWNER_NOTE}`. Legal rails are repeated on purpose.

### 9.0 Session recon (read-only, run first)

```
You are a read-only recon agent for VRCSM at D:\Project\VRCSM.

Mission: rebuild disk/Git truth after a new window. Do not edit files.

Read: project CLAUDE.md, AGENTS.md, .agent/HANDOFF.md, docs/SESSION-HANDOFF-2026-08-21.md, then run git status --short --branch and git log -8 --oneline. Confirm HEAD 33c8e85 and tag v0.16.3.

Also: Test-Path D:\Reference\VRCX, D:\Reference\vrc-tools, D:\Project\SaoMoLa.

Legal: no commits, no live VRChat mutation, no secrets.

Return exactly:
1. branch/HEAD/dirty file list (tracked vs untracked)
2. VERSION and whether tag v0.16.3 peels to HEAD
3. one sentence: is this tree still the 2026-08-21 v0.16.3 wrap, or did someone commit/reset?

Non-goals: implementation, starting GH-CI/VER1/CI1.
```

### 9.1 GH-CI (only after Owner names it)

```
You fix GitHub Actions for VRCSM so main is green without weakening local gates.

Repo: D:\Project\VRCSM. Product v0.16.3. Do not bump VERSION. Do not recut MSI.

Read docs/SESSION-HANDOFF-2026-08-21.md §7.1. Evidence already captured with gh run view on 33c8e85.

Owned:
- .github/workflows/build-win.yml (Node 20 → 22 so pnpm 11 can load node:sqlite)
- .github/workflows/ci.yml vitest step (--no-file-parallelism and/or testTimeout)
- optional: onnxruntime-node postinstall ETIMEDOUT on Ubuntu Vite job (ignore-scripts / cache native)

Forbidden: changing product tests to hide contention; deleting plugin IPC; CLAUDE.md commits; decrypt.

Acceptance: CI TypeScript + Vitest + Vite install/build, and Build Windows Release web step, succeed for a reason you show in logs — not "it was red so I skipped the job".

Do not commit unless named.
```

### 9.2 VER1 live graph (Owner machine, debug exe)

```
You verify co-presence against the real local DB. Do not change product code unless a bug is reproduced.

Repo: D:\Project\VRCSM.
Launch: build/x64-debug/src/host/VRCSM.exe (build if needed with VsDevCmd).
Never write to VRChat folders. Read-only SELECT on %LocalAppData%\VRCSM sqlite is OK.

Checks:
1. Social Analytics graph is non-empty when world_visits exist even if player_events has no self usr_
2. Center node is the local usr_ (LocalAvatarData and/or auth)
3. Self is not #1 on "most met"
4. Click a node opens FriendDetailDialog
5. Window chips 14/30/90/365 and overlap chips change the graph
6. Empty state copy if only center

Return pass/fail per check. If fail, minimized hypothesis — do not shotgun-edit.
```

### 9.3 CI1 CacheIndex vs Bundles (research first)

```
Read-only unless the prompt includes IMPLEMENT NOW.

Why does Bundles.tsx not use CacheIndex? CacheIndex::Lookup is avtr_* → bundle path, not a cache-dir listing. Startup currently can scan Cache-WindowsPlayer twice (IpcBridge StartScan + Bundles walk).

Repo D:\Project\VRCSM. Read CacheIndex.h/.cpp, CacheScanner, CacheBridge, Bundles.tsx, bundle-info.ts.

Return: current owners, blast radius, smallest slice that does not break avtr lookup. Do not invent a third index.
```

### 9.4 SR1-pop FTS populate (only if named)

```
You add incremental FTS populate for VRCSM search_docs. Product v0.16.3. Do not bump VERSION.

Table already exists (schema v20, CREATE VIRTUAL TABLE IF NOT EXISTS, one-shot INSERT if empty). LIKE fallback must stay.

Owned: Database.cpp / Database_Analytics.cpp / triggers or explicit reindex API. Tests with a temp DB.

Forbidden: remote search on keystroke; dropping LIKE; CLAUDE.md commits; crawl.

Acceptance: a new local_favorites row is MATCH-visible without deleting search_docs; FTS-less sqlite still opens.
```

### 9.5 MU1-db persist (only if named)

```
You add friend_mutual_edges + friend_mutual_meta for already-shipped social.mutual.fetchOne.

HARD: no startup crawl, no friends.list loop, no App.tsx prefetch. 403 stays hidden≠0.

Repo D:\Project\VRCSM. v0.16.3. No version bump.

Read VrcApi GetMutuals, ApiBridge HandleSocialMutualFetchOne, FriendDetailDialog.

Do not commit unless named.
```

### 9.6 Docs commit hygiene (only if Owner names a docs commit)

```
You prepare a docs-only commit of the v0.16.3 wrap. You do not push. You do not tag. You do not bump VERSION.

Include tracked handoff docs rewritten this wrap (SESSION-HANDOFF, MEMORY, NEXT-AGENT-HANDOFF, MD-INDEX, plan banners).

Exclude ALWAYS: CLAUDE.md AGENTS.md .agent/ 2026-07-04-111708-*.txt secrets build/ web/dist

Message: no Co-Authored-By. Author remains dwgx.
```

---

## 10. Open Owner decisions (do not silently choose)

1. First named product slice: GH-CI vs VER1 vs CI1 vs SR1-pop vs MU1-db?
2. Docs commit of this wrap, or leave product-doc diffs dirty?
3. GitHub Vite onnxruntime postinstall: ignore-scripts vs vendor native vs leave red?
4. Version bump: **no** until Owner names 0.16.4 / 0.17.0.
5. Previously-forbidden items (decrypt, GPL paste, crawl, grey ON): still skip unless **this** window’s Owner message names them.

---

## 11. Files this pack expects next agent to treat as current

- `docs/SESSION-HANDOFF-2026-08-21.md` — **this file**
- `.agent/HANDOFF.md` — untracked progress
- `docs/NEXT-AGENT-HANDOFF.md` — pointer + historical sessions
- `MEMORY.md` — continuity snapshot
- `docs/MD-INDEX.md` — index
- `C:\Users\dwgx1\.agent-system\ledger\10-projects\VRCSM\sdd\REMAINING-SLICES.md` — ranked remaining
- Archive of the superseded 0.16.2 dirty pack: `C:\Users\dwgx1\.agent-system\ledger\90-archive\by-date\2026-08-21\`

End of pack. **v0.16.3 is released.** Next named slice: **GH-CI** (default) or VER1 / CI1. Do not commit control-plane files. Do not recut 0.16.3.
