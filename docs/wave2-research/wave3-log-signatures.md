# Wave 3 log-signatures research — A4 Avatar Pedestal + Emoji Spawn

Research date: 2026-06-29. Read-only. No source files edited.
Scope: verify modern (2024–2025) VRChat `output_log_*.txt` signatures for two atoms.

Verification key: **VERIFIED** = confirmed against a primary source I read this session
(VRCX current master source, a real captured log, or VRChat official docs). **UNVERIFIED** =
could not confirm a verbatim line; not fabricated.

Repo anchors I read:
- `D:\Project\VRCSM\src\core\LogAtoms.cpp:57-58` — existing `kStickerSpawnRe`.
- `D:\Project\VRCSM\src\core\LogAtoms.cpp:75-77` — existing `kAvatarPedestalRe` (the MEDIUM-confidence A4).
- `D:\Project\VRCSM\src\core\LogAtoms.cpp:495-500` — A4 classify block (captures `display_name` from match[1]).
- `D:\Project\VRCSM\src\core\LogEventClassifier.cpp:140-146` — `avatarPedestalFromAtom`.
- `D:\Project\VRCSM\tests\CommonTests.cpp:1550-1565` — existing A4/A9 golden test (pedestal + user-id backfill).

Sources fetched this session:
- VRCX current master `Dotnet/LogWatcher.cs` (1442 lines, fetched verbatim to /tmp). Active parse chain at line 244; `ParseLogAvatarPedestalChange` at 605–622; `ParseStickerSpawn` at 1341–1372. `grep -ci emoji` over the whole file = **0**.
- TORISOUP log gist (https://gist.github.com/TORISOUP/e8285427b3a7ab9441f24359302e0eb5) — contains `[Network Processing] RPC invoked …` family.
- BluWizard10 log gist (https://gist.github.com/BluWizard10/6f279c9ef59ab1109b5d2ccbee1694d6) — build `2025.1.3p1-1607`.
- VRChat docs 2024.2.1 (https://docs.vrchat.com/docs/202421) — animated emoji shipped 2024-04-24.

---

## 1. A4 — AVATAR PEDESTAL CHANGE

### Verdict: KEEP the atom. Existing regex is CORRECT and current. Upgrade confidence MEDIUM → VERIFIED-against-VRCX-master.

**VERIFIED — the line is still parsed by stock-log tooling.** VRCX current master ships
`ParseLogAvatarPedestalChange` in the active parse chain (`LogWatcher.cs:244` calls it; body at
`:605`). The match is a fixed 68-char `string.Compare`, not a dated heuristic:

```csharp
// LogWatcher.cs:609  (VRCX master, verbatim)
if (string.Compare(line, offset,
    "[Network Processing] RPC invoked SwitchAvatar on AvatarPedestal for ",
    0, 68, StringComparison.Ordinal) != 0)
    return false;
var data = line.Substring(offset + 68);   // LogWatcher.cs:613 — `data` is the display name
```

So the modern body (after VRCSM's `kLinePrefixRe` strips `timestamp Level  -  `) is:

```
[Network Processing] RPC invoked SwitchAvatar on AvatarPedestal for <DisplayName>
```

**VERIFIED — the `RPC invoked … on … for …` grammar is present in real logs across eras.**
The TORISOUP capture contains a sibling of the same emitter:

```
2020.06.25 01:11:57 Log        -  [Network Processing] RPC invoked UdonSyncRunProgramAsRPC on Monorail_2 for thakyuu
```

and VRCX's own portal comment (`LogWatcher.cs:543`) shows the same family for `ConfigurePortal`.
This confirms the `[Network Processing] RPC invoked <Method> on <Target> for <Name>` line shape is
how the networking layer logs received RPCs, and the `SwitchAvatar`/`AvatarPedestal` variant rides
that same grammar. VRCX still gates on it byte-for-byte in master, i.e. it has NOT been removed.

**UNVERIFIED (narrow gap):** I did not find an in-the-wild 2024+ capture containing the literal
`SwitchAvatar on AvatarPedestal` token — pedestal switches are rare in public log dumps. The line
shape and the VRCX active matcher are verified; a fresh capture of an actual pedestal use would be
the last 5%. This does NOT justify changing or dark-gating the atom: VRCX master still ships it.

### Corrected regex (prefix-stripped body convention)

The **existing** `kAvatarPedestalRe` at `LogAtoms.cpp:77` already matches VRCX master exactly:

```cpp
R"(\[Network Processing\] RPC invoked SwitchAvatar on AvatarPedestal for (.+?)\s*$)"
```

No change needed. The `.+?` + `\s*$` correctly captures the trailing `<DisplayName>` and trims, which
mirrors VRCX's `line.Substring(offset + 68)`. Recommended doc action: update the `LogAtoms.cpp:75`
comment from "MEDIUM confidence — 2021 sample, re-verify" to "VERIFIED 2026-06 against VRCX master
LogWatcher.cs:609 (still active)".

### Captured fields

| Field | Source | Notes |
|-------|--------|-------|
| `display_name` | match[1] | The player switching avatar via the pedestal RPC. |
| `user_id` | (not on this line) | Backfilled by VRCSM from joined players — already implemented; see `LogParser.cpp:913-925` + `CommonTests.cpp:1562-1565` (A9). |

The line carries **no `avtr_` id** — only the display name. Do not attempt to extract an avatar id from it.

### Golden test line (already shipped; keep)

`tests/CommonTests.cpp:1550` already contains the canonical golden line:

```
2026.06.23 22:55:03 Log        -  [Network Processing] RPC invoked SwitchAvatar on AvatarPedestal for Mona
```

This is correct and matches the VERIFIED VRCX-master string. No new test required for A4 unless you
want an explicit standalone classifier assertion mirroring `LogEventClassifierEmitsStickerSpawnFlippedOrder`.

---

## 2. EMOJI SPAWN

### Verdict: UNVERIFIED — SKIP. Do NOT add an atom or invent a regex.

**VERIFIED that no signature is known to existing tooling:**
- VRCX current master `LogWatcher.cs` has **zero** emoji references (`grep -ci emoji` = 0 over all 1442
  lines). It parses `[StickersManager] … spawned sticker inv_…` (`:1343-1345`) but has **no**
  emoji-spawn parser. This matches the task premise ("VRCX has NO emoji-spawn parser").
- GitHub code search for `"spawned emoji"` / `"EmojiManager"`-as-VRChat-log-marker returned **0**
  VRChat-related hits (all `EmojiManager` hits were unrelated Discord/game projects).
- Real captured logs checked (TORISOUP 2020, BluWizard10 build 2025.1.3p1, kamakiri01 viewer corpus)
  contain **no** `[EmojiManager]`, `spawned emoji`, or any emoji-clone-instantiation line. The only
  "emoji" tokens that appear are API file-query tags (`"tag":"emoji"` in a `Requesting Get files`
  line) — that is an inventory fetch, NOT a spawn event, and is unattributed/not per-spawn.

**Context (VERIFIED):** the feature exists — VRChat animated emoji shipped in 2024.2.1
(2024-04-24, docs.vrchat.com/docs/202421), and the sticker subsystem (`[StickersManager]`) is the
closest analog. But the existence of the feature does NOT imply a parseable spawn line, and none was
found. Emoji spawns appear to NOT emit a dedicated, stable, attributed log marker in the stock client
(unlike stickers).

**Do not fabricate.** No `[EmojiManager]`, no `spawned emoji`, no `Instantiated … Emoji clone` regex
is justified by any source I read.

### What a live capture would need to show before this atom is implementable

Capture an `output_log_*.txt` from a current client (2025.x) where you (or another instance member)
spawn an emoji, then grep the file for a line that satisfies ALL of:
1. A stable, single-event marker token (analogous to `[StickersManager] … spawned sticker`), e.g. a
   `[EmojiManager]` / `[Emoji…]` / `Instantiated … Emoji…clone` prefix that fires once per spawn.
2. An attribution field — a `usr_` id and/or display name on the same line (sticker line has both,
   in flipped order). Without attribution the atom adds no feed value over a raw count.
3. An identifier for the emoji (an `inv_` id, a file id, or an emoji name) so the feed row is distinct.
4. Reproducibility: the same shape on a second spawn (rule out a one-off debug line).

If such a line is captured, it can follow the StickerSpawn 6-touch-point pattern exactly. Until then:
leave emoji-spawn **unimplemented** (not even flag-gated-dark — there is nothing to gate).

---

## Summary of changes implied for the implementer

- **A4 Avatar Pedestal:** no code change required. Existing regex (`LogAtoms.cpp:77`) and golden test
  (`CommonTests.cpp:1550`) are correct and verified against VRCX master. Optional: bump the
  source comment from "MEDIUM confidence" to "VERIFIED 2026-06 vs VRCX master".
- **Emoji Spawn:** SKIP. No verifiable signature. Do not add an enum/regex/test. Re-open only after a
  live capture meets the 4 criteria above.

---

## Implementation decision log (2026-06-29)

- **A4:** Implemented as recommended. `LogAtoms.cpp` `kAvatarPedestalRe` comment bumped from
  "MEDIUM confidence — 2021 sample, re-verify" to "VERIFIED 2026-06 against VRCX master
  LogWatcher.cs:609". Regex unchanged (already byte-for-byte correct). Added standalone classifier
  golden test `LogEventClassifierEmitsAvatarPedestalChange` in `tests/CommonTests.cpp` (asserts kind
  `avatarPedestal` + `display_name` capture). The existing A8/A9 batch golden line at
  `CommonTests.cpp:1550` was kept.
- **EMOJI:** SKIPPED entirely. No `LogAtomKind::EmojiSpawn`, no regex, no test added — no verifiable
  signature exists (VRCX master `grep -ci emoji` = 0; no `[EmojiManager]`/`spawned emoji` in any
  captured log read this session). Re-open only after a live capture meets the 4 criteria above.
