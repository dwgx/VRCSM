# Surpass-VRCX Master Plan — Research Synthesis & Roadmap

Last updated: 2026-06-29

This consolidates four research streams (VRCX feature deep-dive, GitHub
ecosystem scan, VRChat API/extensibility survey, and a VRCSM code audit) into a
single gap analysis + prioritized roadmap. Goal (per user): **beat VRCX across
模型管理 / 本地模型管理 / 日志管理 / 好友管理 / 算法扩展性 / 兼容性.**

Builds on and does not duplicate `BEAT-VRCX-PLAN.md` (telemetry/social/GUI
tracks), `CACHE-ARCHITECTURE.md` (account-scoping), `ENHANCEMENT-ROADMAP.md`.

Hard rules carried in: new reusable IPC lives in `web/src/lib` domain modules,
not pages. Account-derived caches stay account-scoped. No VRChat data mutation
without explicit user action. API polling ≤ 1/60s per VRChat policy; seed from
REST once, then maintain state from the websocket pipeline.

---

## Scoreboard: where we stand vs VRCX (from the audit)

| Area | VRCX | VRCSM today | Verdict |
|---|---|---|---|
| Avatar 3D preview | ❌ none | ✅ `AvatarPreview` + UnityFS decode | **we win already** |
| Local cache mgmt | ❌ near-zero | ✅ scan/index/migrate/safe-delete/junction | **we win already** |
| Bundle metadata sniff | ❌ none | ✅ `BundleSniff` UnityFS | **we win already** |
| Visual/CLIP avatar search | ❌ none | 🟡 experimental (`avatar-embedding.ts`) | **unique, finish it** |
| Log event coverage | ✅ ~25 types | 🔴 6 types (`LogAtoms.cpp`) | **VRCX moat — close it** |
| Feed (persistence) | 🟡 flat, 24h window, paging bugs | ✅ persisted+searchable+virtualized | **we win, extend** |
| Friend presence/log | ✅ mature | ✅ pipeline + friend_log + presence events | **parity** |
| Relationship graph | ❌ none | 🟡 leaderboard only (B3 unbuilt) | **headline, build it** |
| Local favorites (beat limits) | ✅ unlimited groups | 🟡 local_favorites tables exist | **verify + match** |
| Discord Rich Presence | ✅ join button + media | ❌ none | **VRCX win — add** |
| OSC engine | 🔴 only detects failure | ✅ OSC Studio + send flow | **we win, extend** |
| Notifications/toasts | ✅ desktop toast | ❌ none (B5 unbuilt) | **VRCX win — add** |
| i18n | ✅ 10 langs | 🟡 7 locales | **close 3** |
| Import/export | ✅ rich + DB merger | ❓ unaudited | **match** |
| Plugin system | 🟡 vrcx:// + external providers | ✅ sandboxed manifest+market | **we win, leverage** |
| Cross-platform | 🟡 Wine/compat (buggy) | Windows-native | context |

Strategy: **defend the four areas we already win** (cache, preview, feed, OSC),
**close the two real VRCX moats** (log coverage, Discord RP + toasts), and
**ship the headline VRCX-can't-do features** (relationship path, native local
avatar DB, visual search) to make migration a one-way door.

---

## Track L — Log event coverage parity+ (close VRCX's biggest moat)

Today `ParseVrchatLogAtom` (`src/core/LogAtoms.cpp`) emits 6 atom kinds. VRCX
parses ~25. Each new atom is: a regex + `LogAtomKind` + classifier case + a feed
`source_kind`/category, then it flows through the existing feed pipeline for free.

Add atoms (priority order by user value):
- **L1 Video/media play** — `[Video Playback] ...`, AVPro, USharpVideo, SDK2;
  capture URL + title. VRCX's most-loved feed item. Feed category `video`.
  **SHIPPED 2026-06-29:** `LogAtomKind::VideoPlay` + `kVideoResolveRe` (matches
  `[Video Playback] (Attempting to resolve|Resolving) URL '<url>'`) in `LogAtoms.cpp`;
  `VideoPlayEvent` struct + `to_json` in `LogParser.{h,cpp}`; classifier emits
  `kind:"videoPlay"` (`LogEventClassifier.cpp`). Frontend: `VideoPlayEvent` type,
  `video_play` timeline kind + pink `PlayCircle` style + `videos` filter + live
  stream buffer in `Logs.tsx`. Unit tests `LogAtomsParseVideoPlaybackResolveUrl` +
  `LogEventClassifierEmitsVideoPlay` (60/60 C++ pass, 112/112 web pass).
- **L2 Portal spawn** — `[Behaviour] Instantiated a (Clone [N] Portals/PortalInternalDynamic)`.
  Category `portal`. **SHIPPED 2026-06-29.** Note: modern VRChat (2023+) emits no
  dropper name or destination on this line (verified against VRCX `LogWatcher.cs` —
  the older `... for <Name>` RPC variants are gone), so it is presence-of-event only.
- **L3 Vote-kick** — `[ModerationManager] A vote kick has been initiated against <name>, do you agree?`
  + `Vote to kick <name> succeeded` + self `[Behaviour] Received executive message: ...`.
  Category `moderation`. **SHIPPED 2026-06-29** (`phase`: initiated/succeeded/self).
- **L4 Join-blocked / failed-to-join** — `[Behaviour] Failed to join instance '<loc>' due to '<reason>'`
  (instance full surfaces here as reason text) + master-timeout "Moving to a new instance".
  Category `moderation`. **SHIPPED 2026-06-29** (`reason_kind`: failed/blocked).
- **L5 Sticker spawn** — `[StickersManager] User usr_… (Name) spawned sticker inv_…`
  (note the flipped id-before-name order). Category `sticker`. **SHIPPED 2026-06-29.**
  Emoji spawn deferred: no stock-client `[EmojiManager]` log line could be verified
  in VRCX or any maintained parser — needs a live-log capture before shipping.
- **L6 Notification lines** — invites/requests echoed in log (cross-check pipeline).
- **L7 Udon exceptions** (opt-in toggle), **OSC failed-to-start**, **shader
  keyword limit**, **audio device change** — diagnostics category, default off.
- **L8 Instance reset warning**, **app quit**, **OpenVR/desktop mode** — session markers.

Verification: golden-line unit tests per atom (feed `LogAtoms` test pattern),
extend `feed.unified` categories + `feed.ts` `categorize()`. Beat VRCX on
reliability: our feed is already virtualized + deduped (their #1788/#1801 paging
bugs are our differentiator — keep stable composite keys).

---

## Track M — Native local avatar database (beat VRCX's third-party-provider hack)

VRCX has **no native avatar DB**; it forwards avatar IDs to external remote
providers (avtrDB/worldbalancer/avatarrecovery) with zero docs (#1017) and
breaks when those services die (#412/#430). We own the local cache — make the
local DB the product.

- **M1 Local avatar index** — union `avatar_history` + `asset_cache` + cache
  bundles (via `CacheIndex`) into one searchable local DB with thumbnail, author,
  first/last-seen, times-worn, source. `avatar-models.ts` already merges 3
  sources — extend to surface as a first-class "Avatar DB" page.
- **M2 Avatar-ID sourcing post-encryption** (legit paths only): parse the
  **Amplitude analytics file** (VRC-LOG's technique — avatar IDs on world switch)
  and log `Loading Avatar Data:` lines. Document TOS nuance; read-only, local.
- **M3 Optional pluggable lookup providers** — like VRCX but as a *plugin* (our
  sandboxed system), so resolving an unknown ID → name/author/thumb is opt-in
  and provider-agnostic, not hardcoded. Cache results in `asset_cache`.
- **M4 Per-avatar parameter profiles** (borrow VRCKit/VRCOSC) — persist local
  avatar OSC params per avatar, auto-restore on switch via `AvatarData.cpp`
  `readParameters` + OSC Studio. VRCX has nothing here.
- **M5 Finish visual/CLIP search** — `avatar-embedding.ts` is experimental;
  graduate it (index on cache scan, surface in Avatar DB). Unique to us.

---

## Track G — Relationship graph + connection path (the headline VRCX lacks)

This is BEAT-VRCX-PLAN Track B3, still unbuilt. Highest "VRCX can't do this"
value. Co-presence edges from `player_events`∩`world_visits`; confirmed edges
from `friends.list`/`friend_log`; mutual edges from `GET /users/{id}/mutuals/
friends` (opt-in, rate-limited). BFS shortest-path "how you're connected", each
hop justified by world+timestamp or confirmed mutual. New IPC computed in core.
Replace the `SocialGraph.tsx` leaderboard with a real graph view.

---

## Track P — Presence reach: Discord RP + desktop toasts (close VRCX parity gaps)

- **P1 Discord Rich Presence** — show current world/instance + join button +
  media (when L1 video is active). VRCX headline feature we lack entirely. New
  `src/core` Discord IPC client (named-pipe), opt-in in Settings, privacy-scoped
  (hide on private/invite instances by default).
- **P2 Desktop tray toasts** — friend-online / invite / request (BEAT-VRCX B5).
  Windows toast, permission-scoped, opt-in.

---

## Track X — Extensibility & compatibility leverage (already ahead — widen it)

- **X1 Lean into the sandboxed plugin system** (we have manifest+permissions+
  market+SHA-256 verify; VRCX only has `vrcx://` + external URLs). Expose a
  stable plugin event-subscription + IPC surface so community can add log atoms,
  lookup providers, OSC modules, chatbox sources without forking. This is how we
  out-extend VRCX structurally.
- **X2 OSC router/multiplexer** (borrow VRCOSC) — VRChat binds one OSC port;
  a built-in router lets VRCSM + other OSC apps coexist. Plus OSCQuery advertise
  (ref: oyasumivr_oscquery Rust port) so params self-discover.
- **X3 Chatbox engine** (borrow VRCOSC/MagicChatbox) — now-playing (L1 video),
  HR, clock, perf; world-blacklist safety.
- **X4 Standardized HR ingestion** (borrow HRtoVRChat naming) — Pulsoid/HypeRate/
  BLE → standard avatar params, via OSC Studio.
- **X5 i18n to 10 langs** (add FR/RU/PL or whichever 3 close the VRCX gap).
- **X6 Import/export + DB merge** — audit current state; match VRCX export
  (friends/avatars/notes/favorites) + a DB-merge tool. Beat them with a stable,
  documented schema others can read (ecosystem interop, à la VRChatActivityTools).
- **X7 Rate-limit governor** — central token-bucket in `VrcApi`; VRCX is opaque
  here, we can be transparent + safer (visible budget, backoff, batching).

---

## Execution order (highest value × lowest risk first)

1. **L1–L5 log atoms** — pure additive parsing, flows through existing feed,
   closes VRCX's biggest moat. Start here.
2. **M1+M2 local avatar DB + Amplitude/log ID sourcing** — leans on assets we own.
3. **G (relationship path)** — headline differentiator; needs B-track DB joins.
4. **P1 Discord RP** — closes the most-visible VRCX parity gap.
5. **X2/X3/X4 OSC router + chatbox + HR** — extend our OSC lead.
6. **M4 param profiles, M5 visual search graduation, P2 toasts, X5/X6 i18n+export.**
7. **X1 plugin event API, X7 rate governor** — structural, ongoing.

Each landed slice keeps the release build green, adds focused tests, and updates
`NEXT-AGENT-HANDOFF.md`.

## The one-line pitch (why a VRCX user switches)

VRCSM already does what VRCX can't (cache management, 3D avatar preview, bundle
sniff, persisted virtualized feed, real OSC). Once log coverage reaches parity
and we ship the relationship-path graph + native local avatar DB + Discord RP,
there is no feature left that VRCX does better — and several it can't do at all.
