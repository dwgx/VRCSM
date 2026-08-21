# VRCSM successor acceptance pack — 2026-08-21

**This file is the present-tense contract for the next agent window.**
`MEMORY.md` and older blocks in `docs/NEXT-AGENT-HANDOFF.md` are history. If they disagree with this file plus `git status`, **git wins**.

Owner instruction that created this pack (verbatim intent, not a new slice):

> Context is low. Do **not** start Friends Locations / virtual lists / FTS / mutuals / P15 / P2 / P5 now. Write an acceptance document so the next session keeps depth, can spawn many subagents with copy-paste prompts, may clone and research on the web, and has a ranked task list. Sync every drifted doc.

This session **did not** implement the ranked backlog. It **did** land an uncommitted usability + graph-data slice on dirty `main`. Next window: init → this file → `git status` → wait for the Owner to **name** a slice (or name commit). Default named product slice, when they say go: **Friends Locations**.

---

## 0. One-screen truth

| Item | Fact |
|---|---|
| Product | **v0.16.2** released. GitHub Latest. LICENSE **VSAL**. |
| HEAD | `e22417c` (`docs: record v0.16.2 release hashes`). Branch `main` = `origin/main` plus **dirty working tree**. |
| Version files | `VERSION` / `web/package.json` / `vcpkg.json` = **0.16.2**. Do **not** bump unless Owner names a release. |
| This window's job | Handover pack written 2026-08-21. **Follow-on Grok window landed FL1 uncommitted** (still 0.16.2). |
| Uncommitted slice | Real-machine usability + co-presence `world_visits` seed + palette/feed load fixes. Still **0.16.2**. |
| Biggest remaining daily gap vs VRCX | **Friends Locations** (instance-first grouping), then virtual lists, then FTS/kana, then opt-in mutuals. |
| Parked P-ids | **P15** OnLeftRoom atoms, **P2** Discord webhook, **P5** display-only join recommend. Plan later; do not start unless named. |
| Shipped already (do not rebuild) | **P18** `cache_expiry_delay`, **P16** visit dwell hours, **P4** Hot Worlds, **P12** `{hr.bpm}` — all in **0.16.0**. |
| Writer rule | Grok is not the default writer. Owner's newest named slice is the only product mission. |
| Commit | Do **not** commit unless Owner names it. Never commit `CLAUDE.md`, `AGENTS.md`, `.agent/`, scratch txt. |

Exact next action: finish the estate init list, read **this file**, run `git status --short --branch`. **FL1 is on the dirty tree** (instance-first Friends + virtualizer). Then either (a) commit usability + FL1 if Owner names commit (still 0.16.2), or (b) named next slice **VL1** or **VER1**. Do not bump VERSION. Do not ship another 0.16.2 MSI.

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

Quality bar: `C:\Users\dwgx1\.agent-system\workflows\high-quality.md`. Prefer reliability over token thrift. Heavy C++ in the **foreground**; background C++ subagents have hung on the inference gateway. Web recon/research subagents are fine in parallel. Parallel writers = `git worktree`, never a second writer on this dirty `main`.

---

## 2. Legal rails (non-negotiable)

Copy these into every subagent prompt.

- LICENSE is **VSAL** (source-available, not OSS). Do not relicense.
- **Never paste** GPLv3 **VRCX-0** source (`vrcx-team` rewrite / dump under `D:\Reference\vrc-tools` if present). Ideas only.
- **Never paste** VNCOL **VRCNext** source. Ideas only.
- **Never copy** SaoMoLa kernel / UnityFS decrypt / keys into VRCSM. 3D preview of encrypted VRChat UnityFS stays empty on purpose. SaoMoLa live tree: `D:\Project\SaoMoLa` (read for *ideas* of cache layout only).
- Grey helpers (Invite Assist, Event Watch, IMAP OTP, OscTts) stay **default OFF**. Do not widen G5/G6.
- Never mutate live VRChat user data in dev. Destructive ops default dry-run. Block if `VRChat.exe` is running (`ProcessGuard`).
- Preserve `__info` and `vrc-version` at `Cache-WindowsPlayer` root on bulk delete.
- UTF-8 everywhere; `wchar_t` only at Win32 boundaries.
- Mutual friends: official `GET /users/{userId}/mutuals/friends` only, **opt-in**, rate-limited, **never a startup crawl**.
- No AI commit attribution (`Co-Authored-By`, “Generated with”).
- No secrets in prompts, docs, or ledger.

Skip list still skip: in-process VRCVideoCacher, InviteMessage messenger, Space Flight compositor (G2 is the clean-room offset), unofficial Spotify `sp_dc`, cache-mover `move_dir` wipe, Permini/Event Snipe bots.

---

## 3. Git truth (verified 2026-08-21 this pack)

```
branch: main...origin/main
HEAD:   e22417c docs: record v0.16.2 release hashes
parent: c241b36 release: bump version to 0.16.2
```

`git rev-parse v0.16.2^{commit}` **failed** in the previous window (`Needed a single revision`). Treat **HEAD `e22417c`** as the release commit. Re-check `git tag -l v0.16.2` and `git show v0.16.2` before any release talk. Do not invent a tag.

### 3.1 Dirty tracked files (product)

`git diff --stat HEAD` at pack time: **24 files, +713 / −331**.

| Path | Why dirty |
|---|---|
| `src/core/PathProbe.h/.cpp` | Always name `config.json` path; `cacheRoot` from `cache_directory`; `ResolveVrchatCacheRoot` |
| `src/core/VrcConfig.cpp` | Missing file → `{}` so Settings can Save-create; still error if baseDir unknown |
| `src/core/CacheScanner.h` | Uses cache root from probe |
| `src/core/Database_Friends.cpp` | Co-presence SQL: `COALESCE(instance_id, world_id)`; load `world_visits` |
| `src/core/FriendAnalytics.h/.cpp` | `VisitPresenceRow`; `coPresenceEgoNetwork(..., visits = {})` synthesizes self join/left |
| `src/core/Report.h/.cpp` | Path/report fields for config/cache |
| `src/core/VrcApi.cpp` | Calendar discover/featured **max 2 pages**; user `/calendar` **max 3** |
| `src/host/bridges/ApiBridge.cpp` | Calendar/jams coerce; avatars.listOwned / related |
| `src/host/bridges/CacheBridge.cpp` | Probe cache root |
| `tests/CommonTests.cpp` | PathProbe / VrcConfig cases |
| `tests/FriendAnalyticsTests.cpp` | `CoPresenceUsesWorldVisitsWhenSelfAbsentFromEvents` |
| `web/src/App.tsx` | Prefetch `calendar.list` + `groups.list` only — **not** `calendar.discover` |
| `web/src/components/CommandPalette.tsx` | Fetch 500 `player_events` only after the user types; once per open |
| `web/src/pages/AvatarBenchmark.tsx` | Owned+log names; visible-only thumbs; drop self-only wearers |
| `web/src/pages/Bundles.tsx` | Parse current Unity `__info` (not URL-only) |
| `web/src/pages/Calendar.tsx` | User feed; field coerce; featured TDZ fix (`mine.data?.events?.length`) |
| `web/src/pages/Feed.tsx` | Pipeline invalidate **≤ once / 1.5s** |
| `web/src/pages/Settings/TabConfigJson.tsx` | Empty config is valid |
| `web/src/pages/SocialGraph.tsx` | Self from auth **or** LocalAvatarData; window chips; click → `FriendDetailDialog`; empty if only center |

Also dirty, **do not commit**: `AGENTS.md`, `CLAUDE.md` (control-plane). Leave them; do not tidy.

### 3.2 Untracked product (must be in any commit of this slice)

```
web/src/lib/self-player.ts
web/src/lib/calendar-events.ts
web/src/lib/bundle-info.ts
web/src/lib/__tests__/self-player.test.ts
web/src/lib/__tests__/calendar-events.test.ts
web/src/lib/__tests__/bundle-info.test.ts
```

### 3.3 Untracked — never commit

```
2026-07-04-111708-local-command-caveatcaveat-the-messages-below.txt
```

`.agent/` is local control-plane. `docs/SESSION-HANDOFF-2026-08-21.md` **is** product docs — include it when Owner names a docs/handoff commit.

---

## 4. What already landed (uncommitted) — keep this

Do not re-solve these. Independent scores from the six-way research (pre-visits graph was 2/5; visits seed landed after).

### 4.1 Settings / paths (score ~4/5)

VRChat only writes `%LocalLow%\VRChat\VRChat\config.json` after the user changes an engine setting. Old probe treated “file missing” as “path not detected”, so Settings looked broken on most machines.

Now: `PathProbeResult.configJson` is always `baseDir / config.json` once `baseDir` is known. `VrcConfig::ReadJson` maps `not_found` → `{}`. Save creates the file. `cache_directory` in that JSON, if it exists on disk, becomes `cacheRoot` (parent of `Cache-WindowsPlayer`).

### 4.2 Calendar / Jams (score ~3/5)

Hang + four skeleton cards: `calendar.discover` paged the **public catalog** without a cap, and event fields that were objects hit `.toUpperCase`. Featured tab TDZ: `myEvents` used before declaration.

Now: Groups tab uses `calendar.list` (`GET /api/1/calendar`, 3 pages). Discover/featured capped at **2** pages (`VrcApi.cpp` `fetchPagedAuthedArray(..., maxPages)`). `web/src/lib/calendar-events.ts` coerces titles/dates/group ids. App.tsx must **not** prefetch discover.

### 4.3 Self exclusion + co-presence (graph empty was a data bug)

VRChat almost never logs **you** as `OnPlayerJoined`. `player_events` is other people. Self presence is `world_visits`. Old SQL dropped rows with NULL `instance_id`. Auth-only `userId` missed `usr_8817eeb8` (example: dwgx) sitting in `LocalAvatarData`.

Now:

- Web: `web/src/lib/self-player.ts` — `collectSelfIdentity` / `isSelfPlayer` / `primarySelfUserId` / `friendStubFromIdentity`. Used by SocialGraph + AvatarBenchmark.
- Core: `VisitPresenceRow` merged as synthetic center joined/left. SQL `COALESCE(instance_id, world_id)`.
- UI: chips 14/30/90/365d and overlap 15s/60s/5m/15m; node / “most met” click opens `FriendDetailDialog` `readOnly`; ranking skeletons; empty copy when only the center node exists.

Locking test: `FriendAnalytics.CoPresenceUsesWorldVisitsWhenSelfAbsentFromEvents`.

**Still unknown:** live debug exe against the machine’s ~10k `player_events` + real `world_visits`. Do that before calling the graph “fixed for the Owner”.

### 4.4 Avatar benchmark

IDs instead of names + N+1 `avatar.details` + 414 log-only searches. Now: `avatars.listOwned` + log names, prefetch visible thumbs only, drop self-only “seen on others”.

### 4.5 Bundles

Current Unity cache `__info` is **not** a URL:

```
-1
<unix-seconds>
1
__data
```

`parseInfoText` in `web/src/lib/bundle-info.ts`. 3D preview of **encrypted** UnityFS remains empty (legal). Do not copy decrypt.

### 4.6 Palette + Feed load

Ctrl+K no longer pulls 500 logs on open; fetch after non-empty query, once per open. Empty copy: “没有匹配的人、世界或命令”. Feed invalidates on friend-online/offline/location/active at most every **1500 ms**.

### 4.7 OTA / smoke

OTA SHA256 fail-closed **unchanged**. Full pages-smoke under load **34 timeouts** in the previous window — contention, not used as a product-regression claim. Targeted calendar / social / settings / benchmark / dashboard smokes were green. **Do not copy stale ctest counts.** Historical “229/76/61” is the **0.16.2 cut**, not a re-run of this dirty tree. `AGENTS.md` already says: historical 229/76/61 is not current green until re-run.

---

## 5. Verification ledger (status words)

Only `verified` / `accepted` close a claim. This pack uses CORE status words.

| Claim | Status | Evidence |
|---|---|---|
| HEAD is 0.16.2 / `e22417c` | **verified** | `git log -1`, `VERSION` = 0.16.2 |
| Dirty usability + visits-graph on working tree | **verified** | `git status --short`, diff stat 24 files |
| `FriendAnalytics.*` including visits-center test | **verified** (prior window) | `CoPresenceUsesWorldVisitsWhenSelfAbsentFromEvents` |
| `tsc -b` clean on dirty tree | **verified** (prior window) | not re-run while writing this pack |
| vitest self-player / calendar-events / bundle-info | **verified** (prior window) | 4 + calendar + bundle tests added |
| RelationshipGraph + command-palette-search | **verified** (prior window) | 4 + 17 |
| Targeted pages-smoke calendar/social/settings/benchmark | **verified** (prior window) | |
| Full dirty-tree `ctest` | **unknown** | not re-run after visits merge except FriendAnalytics |
| Full Playwright UI smoke | **unknown** | 0.16.2 cut was 61/61; dirty tree not re-run |
| Full pages-smoke 76 | **unknown** / previously 34 timeouts under parallel load |
| Live graph vs 10k `player_events` | **unknown** | must launch debug exe |
| Vite `web/dist` synced into `build/x64-debug/src/host/web` | **observed** prior window | ninja no-op does **not** copy dist — `Copy-Item` required after `pnpm build` |
| OTA hash gate | **observed** unchanged | fail-closed still needs `SHA256:` in GitHub notes |
| Tag `v0.16.2` peel | **unknown** this window | `rev-parse v0.16.2^{commit}` failed once |
| This pack vs git | **verified** | written against `git status` 2026-08-21 |

Commands the next implementer should actually run (foreground):

```powershell
# Web (from repo root). Use --no-file-parallelism for full vitest.
cd web
corepack pnpm exec tsc -b
corepack pnpm exec vitest run src/lib/__tests__/self-player.test.ts src/lib/__tests__/calendar-events.test.ts src/lib/__tests__/bundle-info.test.ts --no-file-parallelism
corepack pnpm exec vite build
# After vite build, if host is already linked:
Copy-Item -Recurse -Force dist\* ..\build\x64-debug\src\host\web\

# C++ — VsDevCmd quoting matters on this machine
cmd.exe /s /c '"D:\Software\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 && cmake --build --preset x64-debug && ctest --test-dir build\x64-debug -R FriendAnalytics --output-on-failure'
```

WiX trap still true: stop VRCSM before MSI. Same-version `REINSTALLMODE=amus` will **not** replace hashed `web/`. Node `fs` fallback in `lyrics.ts` is **vitest-only**; WebView2 uses `lyrics.readFolder`. Keep it. Do not delete `fs.writePlan` etc. without a plugin/caller audit.

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
- Database is split: `Database.cpp` + `Database_Analytics/AssetCache/Avatars/Embeddings/Favorites/Friends/History/Recordings/Rules.cpp` + `Database_internal.h`.
- Friend graph compute is **pure** in `FriendAnalytics` (no sqlite, no Windows.h). SQL lives in `Database_Friends.cpp`, then `coPresenceEgoNetwork(...)`.
- `search.global` v1: `Database::GlobalSearch` merges favorites, visits, encounters, timeline, avatar history. SQL is `lower(col) LIKE '%'||q||'%'`. `normalizeSearchQuery` = collapse ASCII whitespace + lowercase. **No FTS5 in product sqlite** (`vcpkg.json` depends on `"sqlite3"` with **no fts5 overlay**). Spec already says FTS is the 1-month follow-up: `docs/GLOBAL-SEARCH-SPEC.md`.
- `@tanstack/react-virtual` is already a dependency. **In use:** `web/src/pages/Feed.tsx`, `web/src/pages/ActivityLedger.tsx`. **Not in use:** `Friends.tsx`, `Logs.tsx`, `Bundles.tsx`. Copy Feed’s pattern: `scrollParentRef` + `useVirtualizer({ estimateSize: 64, overscan: 8, getItemKey })`.
- Friends page **already has** `locationGroups` and smart views (`all/favorites/sameInstance/joinable/online/offline`) but the **rendered list is still status-bucketed** (`STATUS_BUCKET_ORDER`: joinMe/active/askMe/busy/offline) around `Friends.tsx` grouped `useMemo`. That is the VRCX daily miss: VRCX default is **instance groups**, not status sections.
- Pipeline friend events already merge via `web/src/lib/friends-pipeline.ts` + `useFriendsPipelineSync`. `Friends.tsx` **also** keeps page-local list state + its own Pipeline subscription. Two owners — `docs/FRIENDS-PAGE-OPTIMIZATION-PLAN.md` §2. Do not add a third.
- Self location: `useSelfLocation`. Location parse: `web/src/lib/vrcFriends.ts` `parseLocation`.
- Mutuals endpoint **exists** (community OpenAPI): `GET /users/{userId}/mutuals/friends` (`n` ≤ 100, `offset`). **No VRCSM wrapper yet.** `docs/BEAT-VRCX-PLAN.md` B3 / `docs/FRIENDS-RELATIONSHIP-REDESIGN-RESEARCH.md`.
- i18n: 7 locales. New keys: add `defaultValue` in code; expand JSON when doing a locale slice (0.16.1 already filled companion keys).
- CMake: bump `VERSION` then **reconfigure** the preset (configure-time). Plain ninja after `pnpm build` does **not** copy `web/dist` if the host target is otherwise no-op.

### 6.1 Local data the graph depends on

| Store | Role |
|---|---|
| `%LocalLow%\VRChat\VRChat\` | Logs, `LocalAvatarData/<usr_*>/<avtr_*>` JSON (params, **not** names) |
| `Cache-WindowsPlayer/<hex>/` | `__info` + `__data` UnityFS (often encrypted) |
| `%LocalAppData%\VRCSM\` | SQLite (`player_events`, `world_visits`, favorites, …), session DPAPI |
| `player_events` | Other players join/left. `occurred_at` often DOT `YYYY.MM.DD HH:MM:SS`. `instance_id` nullable on old rows |
| `world_visits` | **You** were here. Mixed DOT vs ISO+offset historically; P16 shipped normalize helper `NormalizeVisitTimestamp` |

---

## 7. Competitor gap ranking (research distilled)

Local VRCX clone at `D:\Reference\VRCX` is **missing** as of this pack (`Test-Path` false). Old research used commit `e69d1e98` (2026.05.03). Next session **should clone** `https://github.com/vrcx-team/VRCX` into `D:\Reference\VRCX` (read-only reference). Dump ideas: `D:\Reference\vrc-tools` (present). **Do not copy dump source.**

2026 competitors are not only classic VRCX: **VRCX-0** (GPLv3 Tauri rewrite), **VRCNext** (VNCOL launcher). Ideas only.

| Rank | Gap | Why it is daily | VRCSM today |
|---|---|---|---|
| 1 | **Friends Locations** | “Who is in which instance” is the Friends home view in VRCX | Status buckets; `locationGroups` computed but not the default layout |
| 2 | **Virtual lists** on Friends / Logs / Bundles | Offline friends + log files + cache dirs are large | Feed + ActivityLedger already virtualized |
| 3 | **FTS5 + kana/alias fold** | Ctrl+K / friends filter is `LIKE %q%` / `includes()` | `search.global` v1 local-only; P24 parked |
| 4 | **Mutuals graph** | Real friend-of-friend edges | Ego net = log overlap only; no mutuals API |
| 5 | Palette entity UX (thumbs, friend-as-entity) | VRCX Quick Search is entity-first | 0.16.0 ranked entities above commands; still thin |
| 6 | Loading UX | SocialGraph / Bundles / Benchmark were D-grade | Skeletons started on SocialGraph rankings only |
| later | P15 / P2 / P5 | Named parked companion leftovers | Do not start unless Owner names them |
| never here | Encrypted UnityFS 3D | Needs keys | Out of product |

VRCX Friends Locations reference files (when cloned):

- `src/views/FriendsLocations/FriendsLocations.vue`
- `src/views/Sidebar/components/FriendsSidebar.vue`
- `src/views/FriendList/FriendList.vue`
- `src/coordinators/friendRelationshipCoordinator.js`

VRCSM should **not** clone Vue. Target: instance-first workspace in `Friends.tsx` + `web/src/lib/friends-view-model.ts` + `web/src/components/friends/`, reuse `parseLocation`, Pipeline, `FriendDetailDialog`.

Loading-grade from prior research (qualitative): Feed **A-**; SocialGraph/Bundles/Benchmark **D** before skeletons. Re-score after this dirty tree.

---

## 8. Six-subagent findings (consumed, not on disk as reports)

Prior window spawned six explore/research agents. Distill so the next window does not pay that cost again.

1. **Archaeology.** Same-day 2026-08-20: git restore → companion `d0c06a1` → 0.16.0/1/2. P18/P16/P4/P12 **shipped in 0.16.0**. `REMAINING-SLICES.md` ranking them #1–4 was stale (rewritten with this pack). Still parked: P15, P2, P5. Grok product commits on this tree: companion wave through `e22417c`.
2. **Usability slice scores.** config 4, asset preview 3, calendar 3, self-exclusion 3, co-presence **2 before visits seed**, benchmark 3, smoke/OTA 1. Graph blank was missing `world_visits` as self, not a force-layout bug.
3. **Search / index.** `GlobalSearch` full-scan LIKE. `CacheIndex` exists but Bundles does not drive off it. `LogParser` can run twice at start (startup backfill + UI). Palette used to prefetch 500 logs — fixed.
4. **VRCX graph.** VRCX: live same-instance + mutuals. VRCSM: historical overlap ego net. Different product; both useful. Daily miss is Locations, not a prettier force graph.
5. **UX remainder.** Instance-first friends, virtualization, palette thumbs. Feed persistence already close to VRCX GameLog.
6. **Loading.** SocialGraph/Bundles/Benchmark weak; Feed strong (virtual + infinite).

Independent review of the uncommitted slice was **not** a fresh-context `/review`. Next window should run one after commit-or-before-commit.

---

## 9. Doc drift that this pack syncs

| Doc | Was | Now |
|---|---|---|
| `docs/NEXT-AGENT-HANDOFF.md` | 0.16.2 release as “READ FIRST”; parked P15/P2/P5 only | Points here; dirty main described |
| `MEMORY.md` | Last updated v0.16.0; “working tree clean” | Snapshot = 0.16.2 + dirty usability |
| `docs/MD-INDEX.md` | Last updated 2026-08-20 as 0.16.0 Latest | 0.16.2 + this file in startup order |
| `ledger/.../sdd/REMAINING-SLICES.md` | Ranked next = P18/P16/P4/P12 | Those shipped; ranked next = FL1/VL1/SR1/MU1/P15/P2 |
| `ledger/.../sdd/progress.md` | “in flight” companion waves | Waves landed in 0.16.0; this dirty slice noted |
| `.agent/HANDOFF.md` | Short usability note | Present tense = this pack |
| Friends / search / Beat-VRCX plans | June 2026 as current | Status banner → this file; body kept as design |
| `CHANGELOG.md` `[Unreleased]` | Empty | Stay empty until a commit exists |

`CLAUDE.md` / `AGENTS.md` may still say mixed test counts (151 vs 229). Do not treat either as dirty-tree green. Re-run.

---

## 10. How the next session should fan out

Recommended shape (Owner names the slice first):

1. **One** writer on `D:\Project\VRCSM` dirty `main` (or commit first if named).
2. **Many** read-only research subagents in parallel (clone VRCX, OpenAPI, sqlite FTS5 overlay, Friends.tsx blast radius). Isolation `none` for read-only; `worktree` if they might edit.
3. Then **one** implementation mission. Do not start FL1+VL1+SR1+MU1 in one window.
4. Fresh-context review before commit.
5. Ledger event + update this file’s date block if the slice lands.

If Owner says “do the backlog”: still one named slice per window, in the rank in §12.

---

## 11. Copy-paste subagent prompts

Replace nothing except optional `{OWNER_NOTE}`. Each prompt is self-contained. Legal rails are repeated on purpose.

### 11.0 Session recon (read-only, run first)

```
You are a read-only recon agent for VRCSM at D:\Project\VRCSM.

Mission: rebuild disk/Git truth after a new window. Do not edit files.

Read: project CLAUDE.md, AGENTS.md, .agent/HANDOFF.md, docs/SESSION-HANDOFF-2026-08-21.md, then run git status --short --branch and git log -8 --oneline. Confirm HEAD e22417c and whether the dirty usability files in SESSION-HANDOFF §3 are still present.

Also: Test-Path D:\Reference\VRCX, D:\Reference\vrc-tools, D:\Project\SaoMoLa. git tag -l v0.16.2.

Legal: no commits, no live VRChat mutation, no secrets.

Return exactly:
1. branch/HEAD/dirty file list (tracked vs untracked)
2. whether untracked web/src/lib/{self-player,calendar-events,bundle-info}.ts still exist
3. VRCX clone present? v0.16.2 tag present?
4. one sentence: is this tree still the 2026-08-21 handover tree or did someone commit/reset?

Non-goals: implementation, review of code quality, starting Friends Locations.
```

### 11.1 Clone + map VRCX Friends Locations (research, clone allowed)

```
You are a research agent. VRCSM product code is D:\Project\VRCSM (do not edit it).

Mission: produce a clean-room map of VRCX "Friends Locations" so VRCSM can build instance-first friends WITHOUT copying VRCX source into the product.

Clone if missing:
  git clone --depth 1 https://github.com/vrcx-team/VRCX D:\Reference\VRCX
If D:\Reference\VRCX already exists, git fetch + log -1 --oneline. Record commit and Version file.

Read (VRCX):
  src/views/FriendsLocations/FriendsLocations.vue
  src/views/Sidebar/components/FriendsSidebar.vue
  src/views/Sidebar/friendsSidebarUtils.js (if present)
  src/views/FriendList/FriendList.vue
  virtual scroll / instance grouping helpers

Read (VRCSM, compare only):
  docs/SESSION-HANDOFF-2026-08-21.md §6–7
  docs/FRIENDS-PAGE-OPTIMIZATION-PLAN.md
  docs/FRIENDS-RELATIONSHIP-REDESIGN-RESEARCH.md
  web/src/pages/Friends.tsx (especially locationGroups, smartView, grouped status buckets ~1213–1320)
  web/src/lib/vrcFriends.ts
  web/src/lib/friends-pipeline.ts
  web/src/pages/Feed.tsx virtualizer (~251–276)

Legal:
- VSAL product. Do NOT copy VRCX/VRCX-0/VRCNext source into D:\Project\VRCSM.
- Ideas, grouping rules, UX structure only. No Vue paste. No GPL file copies.
- Never mutate live VRChat data.

Return a structured report:
1. VRCX commit + Version
2. Default view: how instances are keyed (full location string vs worldId vs worldId+instance)
3. Section order (same-instance, private, offline, favorites, …)
4. Virtualization: library, estimated row height, what is a "row" (header vs friend)
5. World-name fetch: N+1 or batched?
6. What VRCSM already has that maps 1:1 (parseLocation, locationGroups, smart views, Pipeline)
7. Smallest VRCSM implementation slice: owned paths, non-goals, acceptance tests
8. Risks: two list owners in Friends.tsx vs useFriendsPipelineSync

Non-goals: implementing, mutuals crawl, FTS, P15/P2/P5.
```

### 11.2 Friends Locations implementation (only after Owner names it + 11.1 report)

```
You are the writer for ONE slice: Friends Locations on VRCSM.

Repo: D:\Project\VRCSM dirty main, product v0.16.2. Do not bump VERSION.
Read first: docs/SESSION-HANDOFF-2026-08-21.md, then the Friends Locations research report from this session.

Mission: make /friends default to an instance-first Locations workspace (VRCX daily behavior), without cloning VRCX.

Owned paths (keep the page from becoming a god-object):
- web/src/lib/friends-view-model.ts (NEW, pure, tested)
- web/src/components/friends/ (NEW: location section header, virtual row)
- web/src/pages/Friends.tsx (composition only)
- web/src/lib/vrcFriends.ts (extend parse/group helpers if needed)
- locale defaultValue in TSX; do not skip i18n strings
- tests under web/src/lib/__tests__/

Forbidden:
- src/core decrypt / SaoMoLa
- VRCX file paste
- starting FTS, mutuals job, P15/P2/P5
- committing CLAUDE.md AGENTS.md .agent/ scratch txt
- third list owner (page state AND react-query AND a new store). Prefer collapsing toward useFriendsPipelineSync + query cache as the plan already says
- auto-invite / grey helpers
- n+1 world.details for offscreen rows — only visible virtual rows + selected inspector

Must reuse:
- parseLocation, statusBucket, inviteSelf/requestInvite facades
- FriendDetailDialog for inspector (right pane on desktop; dialog on narrow)
- @tanstack/react-virtual like Feed.tsx (scroll parent, estimateSize, overscan, getItemKey)
- existing smart views as left chips, but Locations is the default operational view

Acceptance:
- Friends with the same full location string (world instance) share one section header showing world name + instance type + count
- Offline / private / traveling are separate sections, not mixed into instance groups
- 500+ friends (offline included) only mount visible rows
- Pipeline friend-location events move a row between sections without a full friends.list refetch clobber (respect __touchedAt / query cache — do not regress)
- Self (useSelfLocation) "same instance as me" is visually first
- vitest for the view-model (grouping keys, empty, private, traveling)
- tsc -b clean
- pages-smoke /friends still finds a marker
- 7-locale: defaultValue on new keys

Evidence: commands you actually ran + screenshots or smoke output. Do not claim Playwright if not run.

Do not commit unless the Owner message in THIS window names commit.
```

### 11.3 Virtualize Logs + Bundles (can parallel with 11.2 ONLY in a worktree)

```
You are the writer for list virtualization of Logs and Bundles in VRCSM.
Repo: D:\Project\VRCSM. Product v0.16.2. Do not bump VERSION.

Mission: apply the Feed.tsx @tanstack/react-virtual pattern to Logs.tsx and Bundles.tsx so large log/cache lists do not mount every row.

Read:
- docs/SESSION-HANDOFF-2026-08-21.md §6
- web/src/pages/Feed.tsx (canonical virtualizer)
- web/src/pages/ActivityLedger.tsx (second sample)
- web/src/pages/Logs.tsx
- web/src/pages/Bundles.tsx
- web/src/lib/bundle-info.ts (already parses Unity __info; do not regress)

Owned: those pages + small helpers if a row model is needed. Tests for any extracted row-model.

Forbidden: Friends.tsx (owned by Locations slice), FTS, decrypt, new npm deps (react-virtual is already in package.json), CLAUDE.md commits.

Acceptance:
- Same scroll-parent + estimateSize + overscan pattern
- Variable height: use measureElement if row height varies
- Bundles still parses __info; 3D encrypted preview may stay empty
- tsc -b; targeted vitest; do not run the full flaky parallel vitest

If Friends.tsx is already being edited on main, work in `git worktree` and do not touch Friends.tsx.
Do not commit unless named.
```

### 11.4 FTS5 + kana/alias fold (research first, then impl if named)

```
You are a research-then-plan agent for VRCSM search. Default is RESEARCH. Implement only if the prompt includes the sentence IMPLEMENT NOW.

Repo: D:\Project\VRCSM. Do not bump VERSION.

Mission: replace LIKE %q% global search with FTS5 (or prove FTS5 is not enabled and plan the vcpkg overlay) plus JP kana/dakuten/fullwidth fold (parked P24).

Read:
- docs/SESSION-HANDOFF-2026-08-21.md
- docs/GLOBAL-SEARCH-SPEC.md (v1 shipped; FTS is the 1-month section)
- src/core/Database_Analytics.cpp GlobalSearch LIKE
- src/core/FriendAnalytics.cpp normalizeSearchQuery (ASCII whitespace + lower only)
- vcpkg.json (sqlite3 with NO fts5 overlay today)
- third_party/vcpkg/ports/sqlite3/vcpkg.json fts5 feature
- web/src/components/CommandPalette.tsx (defer logs; search.global)
- web/src/lib/command-palette-search.ts

Research allowed: SQLite FTS5 docs, vcpkg sqlite3 features, unicode NFKC + kana folding references. Web search OK.

Legal: local index only. search.global must stay local-first. includeRemote stays disabled. No VRChat API on keystroke.

Return (research mode):
1. Is the linked sqlite3 built with SQLITE_ENABLE_FTS5? How to verify (compile def or PRAGMA compile_options).
2. Overlay needed in vcpkg.json? Cost of rebuild.
3. Suggested virtual table(s) and triggers vs external-content FTS.
4. Folding: NFKC + kana small-tsu/dakuten/fullwidth map; where (C++ normalizeSearchQuery vs tokenizer).
5. Migration plan that does not break signed-out search.
6. Test fixtures: " vis " → vis; が vs か if fold says so; avtr_/usr_ exact id still wins.

If IMPLEMENT NOW: smallest slice is normalizeSearchQuery fold + tests, THEN FTS tables. Do not do both blindly in one diff if CMake sqlite rebuild is required — split commits conceptually.

Non-goals: mutuals crawl, Friends Locations, decrypt.
Do not commit unless named.
```

### 11.5 Mutuals API — opt-in, no startup crawl

```
You are the writer for opt-in mutual friends in VRCSM. Product v0.16.2. Do not bump VERSION.

HARD CONSTRAINT: never fetch mutuals on app start, on friends.list, or in a background loop over the whole friend list. First ship is fetchOne for the open inspector. A later job is explicit, cancelable, rate-limited.

Read:
- docs/SESSION-HANDOFF-2026-08-21.md §2 and §7
- docs/BEAT-VRCX-PLAN.md B3
- docs/FRIENDS-RELATIONSHIP-REDESIGN-RESEARCH.md (friend_mutual_edges / friend_mutual_meta)
- src/core/VrcApi.cpp / VrcApi.h (add a thin official GET wrapper)
- src/host/bridges/ApiBridge.cpp
- web/src/lib/vrchat-api.ts + web/src/lib/social.ts
- web/src/components/FriendDetailDialog.tsx

Official endpoint (community docs, re-verify live OpenAPI):
  GET https://vrchat.com/api/1/users/{userId}/mutuals/friends?n=100&offset=
Auth cookie already in VrcApi. n≤100.

Research allowed: clone/pull https://github.com/vrchatapi/specification and confirm the path. https://vrchat.community/reference/get-mutual-friends

Owned:
- VrcApi fetchMutuals(userId, n, offset)
- IPC social.mutual.fetchOne (name bikeshed OK but keep social.* )
- Database tables friend_mutual_edges + friend_mutual_meta (opted_out, last_error_code, fetched_at, mutual_count)
- FriendDetailDialog button "Load mutuals" + states: not fetched / 0 / hidden(403) / error / list
- RateLimiter use existing core helper; backoff on 429

Forbidden:
- startup crawl / "load all mutuals" default ON
- copying VRCX coordinator JS
- treating 403/opt-out as zero mutuals
- G5 auto-invite
- decrypt

Acceptance:
- Unsigned-in: method returns auth_expired, UI stays quiet
- One friend: button triggers one paged fetch, persisted, dialog shows names/ids
- 403/404 → opted_out or hidden, distinct from 0
- Unit tests with fake JSON pages; no live network in default ctest
- Do not call the endpoint from App.tsx prefetch

Do not commit unless named.
```

### 11.6 Independent review of the uncommitted usability slice

```
You are a fresh-context reviewer. You did not author the dirty tree.

Repo: D:\Project\VRCSM. Read-only. Do not edit, do not commit.

Mission: review the UNCOMMITTED usability+graph slice against the original Owner request (settings/paths work for everyone; bundle preview; calendar/jams load; exclude self from social analytics; empty graph; avatar benchmark names/thumbs; no OTA change; no version bump).

Read docs/SESSION-HANDOFF-2026-08-21.md §4–5, then git diff HEAD --stat and the actual diffs for:
  PathProbe, VrcConfig, Database_Friends, FriendAnalytics, VrcApi calendar paging,
  Calendar.tsx, SocialGraph.tsx, AvatarBenchmark.tsx, Bundles.tsx, CommandPalette.tsx, Feed.tsx,
  web/src/lib/self-player.ts, calendar-events.ts, bundle-info.ts

Axes: correctness, safety (no live VRChat mutation, no decrypt paste), spec match, regressions, tests, i18n, commit hygiene (CLAUDE.md dirty?).

Return: findings ordered by severity, with file:symbol. Explicitly list what was NOT verified (live 10k graph, full ctest, Playwright).
```

### 11.7 Live graph verification (Owner machine, debug exe)

```
You verify co-presence against the real local DB. Do not change product code unless a bug is reproduced.

Repo: D:\Project\VRCSM.
Launch: build/x64-debug/src/host/VRCSM.exe (build if needed with VsDevCmd).
Never write to VRChat folders. Read-only against %LocalAppData%\VRCSM sqlite is OK if you only SELECT.

Checks:
1. Social Analytics graph is non-empty when world_visits exist even if player_events has no self usr_
2. Center node is the local usr_ (LocalAvatarData and/or auth)
3. Self is not #1 on "most met"
4. Click a node opens FriendDetailDialog
5. Window chips 14/30/90/365 and overlap chips change the graph
6. Empty state copy if only center

Return pass/fail per check + screenshot paths or a precise DOM description. If fail, minimized hypothesis — do not shotgun-edit.
```

### 11.8 P15 — OnLeftRoom + Udon URL atoms (parked; only if named)

```
You implement parked slice P15 only.

Repo: D:\Project\VRCSM. v0.16.2. No version bump.

Bible leftovers:
- log line "[Behaviour] OnLeftRoom"
- Udon "Attempting to load String/image from URL" — parse host, DROP localhost:22500 (VRCVideoCacher local)

Owned: src/core/LogAtoms.h/.cpp, LogEventClassifier.cpp, feed pack in src/host/bridges/LogsBridge.cpp, golden lines in tests/CommonTests.cpp.

Forbidden: fetching those URLs, in-process video cacher, GPL paste.

Read ledger: C:\Users\dwgx1\.agent-system\ledger\10-projects\VRCSM\sdd\REMAINING-SLICES.md P15 row.
VRCX reference LogWatcher.cs is the signature bible — read, do not copy files in.

Do not commit unless named.
```

### 11.9 P2 — Discord-format webhook (parked; only if named)

```
You implement parked slice P2: user-owned Discord-compatible webhook for selected Pipeline events.

Repo: D:\Project\VRCSM. v0.16.2. No version bump.

Owned: new WebhookNotifier in core, notify.webhook.set or notify.setPrefs extension, Settings row next to toasts, DPAPI or %LocalAppData%\VRCSM for URL.

SSRF: allowlist discord.com / discordapp.com / user-confirmed host. No Discord bot token. No send in unit tests (golden JSON body only).

Forbidden: copying VRCX-0/VRCNext Media Relay source. Do not enable by default.

Probe whether discord.com/api/webhooks still accepts unauthenticated POST from desktop before coding (research).

Do not commit unless named.
```

### 11.10 P5 — display-only join recommend (parked; only if named)

```
You implement parked slice P5: a "who to join now" PANEL.

HARD: display-only. NEVER call user.inviteTo / inviteSelf automatically. G5 InviteAssist is a different product and stays default OFF.

Inputs already in tree: coPresenceEgoNetwork, predictFriendOnlineWindows, live friends.list locations, SocialGraph rankings.

Owned: web/src/lib/join-recommend.ts (pure scores) + a panel on Friends or Radar. Tests: online+history > online-only.

Read docs/SESSION-HANDOFF-2026-08-21.md and REMAINING-SLICES P5 row.

Do not commit unless named.
```

### 11.11 Commit hygiene (only if Owner names commit)

```
You prepare the commit. You do not push. You do not tag. You do not bump VERSION.

Repo: D:\Project\VRCSM.

Include: all product src/ web/ tests/ files from git status that belong to the usability+graph slice, plus untracked web/src/lib/{self-player,calendar-events,bundle-info}.ts and their tests, plus docs/SESSION-HANDOFF-2026-08-21.md and the MEMORY / NEXT-AGENT-HANDOFF / MD-INDEX updates if the Owner wants docs in the same commit.

Exclude ALWAYS:
- CLAUDE.md AGENTS.md .agent/
- 2026-07-04-111708-local-command-caveatcaveat-the-messages-below.txt
- secrets, build/, web/dist if generated and gitignored

Message: no Co-Authored-By, no "Generated with". Author remains dwgx / existing repo convention.

Do not git reset/stash/clean to tidy. Do not commit unless the parent agent confirmed Owner named commit.
```

### 11.12 CacheIndex vs Bundles (research)

```
Read-only. Why does Bundles.tsx not use CacheIndex? Is startup scanning Cache-WindowsPlayer twice? Report owned paths for a later slice. Do not implement. Repo D:\Project\VRCSM. See CacheScanner, CacheIndex, CacheBridge, Bundles.tsx, bundle-info.ts.
```

---

## 12. Ranked task list (later sessions)

Owner: **name one**. Default if they say “continue the backlog” without an id: **FL1**.

| # | ID | Slice | Cost | Depends on | Acceptance (short) |
|---|---|---|---|---|---|
| 0 | **DOC/COMMIT** | Commit dirty usability+graph+this pack | S | Owner word | Clean product paths only; still 0.16.2; no control-plane files |
| 1 | **FL1** | Friends Locations (instance-first) | M | 11.1 research | **Landed uncommitted 2026-08-21.** Default Locations + virtualizer + view-model tests. Status toggle kept. |
| 2 | **VL1** | Virtualize Friends (if FL1 didn’t) + Logs + Bundles | S–M | Feed pattern | Offscreen rows unmounted; no new deps |
| 3 | **SR1** | FTS5 index + P24 kana fold | M | vcpkg overlay check | 10k rows interactive; LIKE gone for global search; signed-out works |
| 4 | **MU1** | Opt-in mutuals fetchOne | M | OpenAPI confirm | No startup crawl; 403 ≠ 0; persisted meta |
| 5 | **P15** | OnLeftRoom + Udon URL atoms | S | LogAtoms bible | Golden tests; no URL fetch |
| 6 | **P2** | Discord webhook notify | M | SSRF allowlist | Default OFF; golden JSON; no bot token |
| 7 | **P5** | Join recommend panel | M | FL1 nice-to-have | Display only; no auto-invite |
| 8 | **UX1** | Loading/skeleton pass SocialGraph Bundles Benchmark | S | — | No four-skeleton hang; empty vs loading distinct |
| 9 | **VER1** | Live graph vs 10k events | S | debug exe | Center from world_visits; self not ranked first |
| 10 | **P17** | Audit B10 `/migrate` smoke + B11 dead handlers | S–M | CI hygiene | Do not delete plugin-only IPC |
| 11 | **P3/P9/…** | Remaining parked S/M in REMAINING-SLICES | — | Owner | See ledger table |

**Do not put back on the wave:** last-instance, OSC nits, screenshot visits, activity ledger, avatar presets, entity quick search, app-data backup, InviteSlots, PlayspaceOffset, OscTts, AuthOtpMail, InviteAssist, EventWatch, Hot Worlds, `{hr.bpm}`, `cache_expiry_delay`, visit dwell normalize, 0.16.1 7-locale companion strings, 0.16.2 grey rails.

**L/XL stay parked:** P1 per-account logs, P8 MCP, P19 QQ `.qrc`, P20 overlay, P21 VRCX DB import, P22 social AI, encrypted UnityFS 3D.

---

## 13. Subagent operating notes (quality)

- Prefer `git worktree` under `C:\Users\dwgx1\.grok\worktrees\` if two writers. This `main` is already dirty — a second writer **will** collide.
- C++: one ninja build dir. Do not two cmake builds at once.
- Web: `corepack pnpm` (local vitest/tsc/vite if corepack version mismatches).
- VsDevCmd: `cmd.exe /s /c '"D:\Software\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 && …'`
- After `pnpm build`, copy `web/dist` into the host `web/` if you need WebView2 to show the change (CMake sync is a post-build of the host, not a ninja no-op).
- i18n: `defaultValue` always; full 7-locale JSON when doing a string wave.
- Tests: full vitest **must** use `--no-file-parallelism` or the two heavy render suites flake ~25.
- Ledger: `C:\Users\dwgx1\.agent-system\scripts\record-ledger-event.ps1` after material work.
- Do not steal other live trees (origin, WindsurfAPI, kirostudio, catpie-reverse, grokcli2bot).

---

## 14. Open Owner decisions (do not silently choose)

1. Commit the dirty 0.16.2 working tree now, or keep iterating uncommitted?
2. First named product slice: FL1 vs VER1 (live graph) vs review-then-commit?
3. Clone VRCX to `D:\Reference\VRCX` — allowed (this pack says yes for research).
4. Mutuals: fetchOne-only in v1, or also a manual “build graph” job in the same slice?
5. FTS: allow sqlite overlay rebuild (CMake/vcpkg time) or fold-only P24 first?
6. Version bump: **no** until Owner names 0.16.3 / 0.17.0.

---

## 15. Files this pack expects next agent to treat as current

Tracked / to-track:

- `docs/SESSION-HANDOFF-2026-08-21.md` — **this file**
- `docs/NEXT-AGENT-HANDOFF.md` — pointer
- `MEMORY.md` — continuity snapshot
- `docs/MD-INDEX.md` — index
- `C:\Users\dwgx1\.agent-system\ledger\10-projects\VRCSM\sdd\REMAINING-SLICES.md` — ranked next
- `.agent/HANDOFF.md` — untracked progress

Code still uncommitted: §3.

End of pack. **FL1 is on the dirty tree.** Next named slice: VL1 (worktree) or VER1. Do not commit unless Owner names it. Version stays 0.16.2.
