# VRCSM successor acceptance pack — 2026-08-22 (v0.16.5 wrap)

**This file is the present-tense contract for the next agent window.**
If MEMORY / NEXT-AGENT / HANDOFF disagree with this file plus `git status`,
**git wins**.

Owner instruction that created this wrap:

> github上打包发布各种东西要然后文档梳理是本地的继续做吧

GitHub work in this window: pack MSI/ZIP, tag `v0.16.5`, GitHub Latest + `SHA256:` line.
Docs work is local handoff. **Do not recut 0.16.4 or 0.16.5.**

---

## 0. One-screen truth

| Item | Fact |
|---|---|
| Product | **v0.16.5** released. GitHub Latest. LICENSE **VSAL**. |
| HEAD | `881368d` `release: 0.16.5 leftovers, FTS-gate, history timestamps` |
| Tag | annotated `v0.16.5` peels to HEAD. Do not force-move `v0.16.4`. |
| Version files | `VERSION` / `web/package.json` / `vcpkg.json` / README badge = **0.16.5** |
| Grey | Master **default ON**. Invite Assist / Event Watch auto-join / IMAP still confirm. G5/G6 unchanged. |
| UnityFS 3D | Encrypted stays empty. No keys. No GPL/VNCOL/SaoMoLa paste. |
| This window | Product leftovers + GitHub pack + local docs. |
| Writer | Owner's newest named slice only. Do not commit `CLAUDE.md` / `AGENTS.md` / `.agent/` / scratch txt. |

Exact next action: estate init → this file → `git status --short --branch`. Default if Owner says continue without an id: parked **P6 / P7 / P14 / P25 / P1** or wait for a named slice. Do not recut 0.16.5.

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

Quality: `workflows/high-quality.md`. Heavy C++ in the **foreground**. Parallel writers = `git worktree`. Ninja `-j4` if MSVC C1060 (heap). `corepack pnpm@11.8.0` (bare `corepack pnpm` is 11.22 and refuses this repo).

---

## 2. Legal rails

Copy into every subagent prompt.

- LICENSE **VSAL**. Do not relicense. Do not paste GPLv3 VRCX-0 or VNCOL VRCNext. Ideas only. VRCX clone `D:\Reference\VRCX` at `5ea37a2`.
- Never copy SaoMoLa decrypt / keys. Encrypted UnityFS 3D stays empty.
- Grey master default ON. Invite Assist / Event Watch auto-join / IMAP still confirm-gated. Do not widen G5/G6 (cancel 5s, cooldown 600–3600, join delay 15–60).
- Tests use **temp dirs**. Do not wipe live `%LocalLow%\VRChat\VRChat`. Product Save/migrate/delete already write live data after confirm + ProcessGuard.
- Mutuals: official `GET /users/{id}/mutuals/friends` only. Crawl is **user-triggered**.
- No AI commit attribution. Cursor's `git commit` wrapper currently appends `Co-authored-by: Cursor`; strip before push if you can without `--force` on a published tag.
- Preserve `__info` and `vrc-version` on Cache-WindowsPlayer bulk delete.
- UTF-8 everywhere; `wchar_t` only at Win32 boundaries.

Skip unless the **current** Owner message names them: decrypt, GPL paste, in-process VRCVideoCacher, grey auto-invite without confirm, live-cache test wipes.

---

## 3. Git truth (this wrap)

```
branch: main
HEAD:   881368d release: 0.16.5 leftovers, FTS-gate, history timestamps
parent: 803adca release: 0.16.4 leftovers, grey default on, mutuals crawl
tag:    v0.16.5  →  HEAD
```

https://github.com/dwgx/VRCSM/releases/tag/v0.16.5

| Artifact | Size | SHA256 |
|---|---|---|
| `VRCSM_v0.16.5_x64_Installer.msi` | 9,351,168 | `6174a30a8541a80b6b8cb6ae017ca03d63d878cafd0f3f93ef3e025f8463b6c6` |
| `VRCSM_v0.16.5_x64.zip` | 21,850,459 | `f02ab9681762c2223eeae82c87fce92ff6db16678966ed5937d2fb3649943e0c` |

`SHA256:` lines required in GitHub notes (updater fail-closed).

Stop VRCSM before MSI reinstall. Same-version `REINSTALLMODE=amus` will not replace hashed `web/`. After `pnpm build`, ninja no-op does not copy `web/dist`. VERSION is configure-time. `build_release.bat` calls `pnpm`; this machine has no `pnpm` on PATH — use `corepack pnpm@11.8.0`.

---

## 4. What shipped — do not rebuild

### 0.16.5 (`881368d`)

FTS-gate (skip `search_docs` wipe when already v21) · I18N-grey six locales master ON copy · Invite Assist / Event Watch fire-time re-check (failed invite/join does not burn cooldown; stop/remove cancel pending) · World History / UnifiedFeed julian (DOT vs ISO) · GlobalSearch FTS favorites real `type` + julian last-seen · Log atoms accept Unity `Debug` · `auth.logout` cookie COM on UI thread · LyricsProxy `toUtf8`/`toWide` + CGNAT/ULA · download cookies only for trusted VRChat hosts · Event Watch copy keys · Invite Assist hidden prefs-set removed + IPC `.catch` · smoke matrices for plugin/settings/workspace tabs (visual ROUTES unchanged) · `junction.repair` test accepts VRChat-running refuse.

### 0.16.4 (`803adca`)

GH-CI YAML · CI1 CacheIndex Bundles · SR1-pop schema v21 FTS rebuild+triggers · MU1-db + mutuals crawl · grey master default ON · `config.write` rethrow · encrypted 3D copy.

Older cuts: `docs/SESSION-HANDOFF-2026-08-21.md` (historical after this file).

---

## 5. Verification ledger

| Claim | Status | Evidence |
|---|---|---|
| HEAD 0.16.5 / `881368d` | **verified** (this wrap) | `git log -1`, `VERSION` = 0.16.5 |
| ctest x64-release 255/0 | **verified** | 1 skipped, 5 live DISABLED, 5 other skipped |
| FileVersion 0.16.5.0 | **verified** | release `VRCSM.exe` |
| `tsc -b` + vite production | **verified** | `corepack pnpm@11.8.0 --dir web build` |
| MSI/ZIP SHA256 | **verified** | `package_release.ps1` notes |
| Playwright 78/78 | **prior this tree** | leftover session; visual ROUTES unchanged |
| jsdom 97/97 | **prior this tree** | leftover session |
| Live `vrcsm.db` Open 19→21 | **not done** | data-touching; Owner must know first |

Commands:

```powershell
corepack pnpm@11.8.0 --dir web exec tsc -b
corepack pnpm@11.8.0 --dir web build

cmd.exe /s /c '"D:\Software\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 -host_arch=x64 && cmake --preset x64-release && cmake --build --preset x64-release -- -j4 && ctest --test-dir build\x64-release --output-on-failure'
```

Node `fs` fallback in `lyrics.ts` is **vitest-only**; WebView2 uses `lyrics.readFolder`. Keep it. Do not delete plugin IPC (`fs.writePlan`, …) without a caller audit.

Installed VRCSM on this machine was **0.16.2-era** (schema 19) when leftovers were written. Do not open live `%Local%\VRCSM\vrcsm.db` with this tree without telling Owner (Open 19→21 rebuilds FTS once).

Pre-existing compile noise: PluginBridge `u8path` C4996, CommonTests `getenv` C4996, sscanf C4996 OtpMailParser/ImapClient.

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
- Database split TUs. Schema **v21**. `SqlInstantJd` / `SqlEventInVisitWindow` in `Database_internal.h` for DOT+ISO wall clocks.
- `search.global`: MATCH on `search_docs` then LIKE. FTS wipe only on v20→v21. Favorites JOIN `local_favorites` for real `type`.
- Friends list owners: page state **and** `useFriendsPipelineSync`. Do not add a third.
- Mutuals crawl is toolbar, not App mount.
- Grey: master default ON; helpers still confirm. `grey.prefs.set` still accepts confirm stamps (SPA Event Watch confirm uses this path).

Live DB copy used for leftovers recon: `%TEMP%\vrcsm-live-ro-20260822132415\vrcsm.db` — 106 `world_visits` (79 DOT + 27 ISO), 10543 `player_events` all DOT.

---

## 7. Ranked remaining

| # | ID | Slice | Status | Acceptance |
|---|---|---|---|---|
| done | **I18N-grey** | Six locales `grey.master.desc` | **in 0.16.5** | match English on-by-default |
| done | **FTS-gate** | Skip FTS wipe if `user_version >= 21` | **in 0.16.5** | later Open does not DELETE `search_docs` |
| 1 | **WIN-CI** | Confirm Windows Release Actions on `881368d` | **unconfirmed** | `gh run list` green for a stated reason |
| later | P6 P7 P14 P25 P1 P3 P9 | Parked | park | Owner names. Clean-room only. |
| later | CacheIndex empty-ready sniff | scan-stop race | park | Owner names |
| later | `world_visits` DEDUPE every `Open()` | unique-key twins on live DB | park | versioned rewrite + backup; Owner names |
| later | plugin iframe `https://app.vrcsm/` | no frame NavigationStarting gate | park | HIGH security, not a casual leftover |
| later | `shell.openUrl` UI-thread `inviteSelf` | unbounded IPC shutdown wait | park | Owner names |

Do not put back: I18N-grey, FTS-gate, FL1 VL1 P15 P2 P5 MU1 fetchOne/db crawl SR1 fold/table/pop CI1 GH-CI YAML UX1 P17 P18 P16 P4 P12 Phase 1 Wave 4 hosts.

Keep: `fs.writePlan` / `fs.appDataDir` (plugin auto-uploader). LyricsProxy DNS fail-open / TOCTOU / body cap still parked.

---

## 8. Copy-paste recon prompt

```
You are a read-only recon agent for VRCSM at D:\Project\VRCSM.
Mission: rebuild disk/Git truth. Do not edit.
Read CLAUDE.md, AGENTS.md, docs/SESSION-HANDOFF-2026-08-22.md.
Run git status --short --branch and git log -8 --oneline.
Confirm HEAD 881368d and tag v0.16.5.
Return: branch/HEAD/dirty list; VERSION; one sentence whether this is still the 0.16.5 wrap.
Non-goals: implementation.
```

---

## 9. Open Owner decisions

1. First named slice after 0.16.5: P6 / P7 / P14 / P25 / P1 vs WIN-CI vs wait.
2. Docs commit of this wrap (`docs: record v0.16.5 release hashes`), or leave handoff docs dirty locally.
3. Version: **no recut of 0.16.5**. Next product bump is 0.16.6 / 0.17.0 when named.
4. Live DB: this tree Open() of schema 19 is data-touching. Ask before pointing the new exe at `%Local%\VRCSM\vrcsm.db`.

End of pack. **v0.16.5 is the current cut.** Next named slice waits for Owner.
