# Wave 3 — Discord Rich Presence over raw IPC (spec + status)

Research date 2026-06-29. Read-only. No source edited.

> **STATUS: ALREADY SHIPPED.** A dependency-free Discord Rich Presence client
> already exists end-to-end in this repo and matches the spec below. This
> document is therefore a *verification + spec* of the existing code, not a
> greenfield plan. Where the shipped code diverges from the fullest possible
> activity schema (buttons, secrets/join, instance flag), that is called out
> under "Gaps".

Protocol facts below were web-verified against Discord's own RPC docs and a
raw shell reference implementation (sources at the end). Repo facts are cited
as `file:line` from current on-disk source.

---

## 1. Verdict: no third-party SDK needed (and none is used)

The client is implemented with raw Win32 named-pipe calls (`CreateFileW`,
`WriteFile`, `ReadFile`) plus `nlohmann::json` for payloads. No `discord-rpc`,
no `discord-game-sdk`, no vendored C lib. This satisfies the stack lock.

Code: `src/core/DiscordRpc.h:32` (class `DiscordRpc`), `src/core/DiscordRpc.cpp`
(404 lines, full impl), registered in `src/core/CMakeLists.txt:32`
(`DiscordRpc.cpp` in `vrcsm_core`).

---

## 2. Named pipe path family (VERIFIED)

Discord exposes a Windows named pipe `\\?\pipe\discord-ipc-{n}` for `n` in
`0..9`. A client probes the lowest-numbered pipe first; Discord binds the
lowest free one, and additional concurrent Discord instances take the next.
So a client must try `discord-ipc-0` then `-1` … `-9` and use the first that
`CreateFile` succeeds on.

- Source: Discord RPC docs (transport section).
- Repo impl: `src/core/DiscordRpc.cpp:164-187` loops `i = 0..9`, building
  `\\.\pipe\discord-ipc-{i}` via `fmt::format` + `toWide`, calling
  `CreateFileW(..., GENERIC_READ | GENERIC_WRITE, 0, OPEN_EXISTING, ...)`,
  returning the first non-`INVALID_HANDLE_VALUE`.
- Note: the repo uses the `\\.\pipe\...` prefix; the docs show `\\?\pipe\...`.
  Both resolve to the same named-pipe namespace on Windows for client
  `CreateFile` opens — `\\.\pipe\name` is the canonical client form and is
  what the shipped code uses and is the conventional form in every reference
  RPC client. (Verified consistent with the raw shell reference, which uses
  the analogous `$XDG_RUNTIME_DIR/discord-ipc-0` socket on Linux.)

---

## 3. Frame framing (VERIFIED)

Every IPC frame is two little-endian `uint32` headers followed by a UTF-8 JSON
body:

```
[ opcode : uint32 LE ][ length : uint32 LE ][ JSON payload : `length` bytes ]
```

Docs' own handshake example:

```
[00 00 00 00]                              // opcode 0 (HANDSHAKE)
[2D 00 00 00]                              // length 45 (0x2D)
{"v":1,"client_id":"123456789012345678"}   // 45-byte JSON body
```

- Repo impl: `src/core/DiscordRpc.cpp:64-78` (`WriteLe32`/`ReadLe32`),
  `:204-206` writes an 8-byte header (`opcode`, then `payload.size()`),
  `:232-239` reads the 8-byte header back. Frame size capped at 64 KiB
  (`kMaxFrame`, `:50`).

### Opcode enum (VERIFIED)

| Opcode | Name      | Role                                  |
|--------|-----------|---------------------------------------|
| 0      | HANDSHAKE | initiate connection                   |
| 1      | FRAME     | all standard RPC commands and events  |
| 2      | CLOSE     | close connection                      |
| 3      | PING      | liveness check                        |
| 4      | PONG      | reply to PING                         |

Repo: `src/core/DiscordRpc.cpp:44-48` (`kOpHandshake=0 … kOpPong=4`).

---

## 4. Handshake (VERIFIED)

First frame after connect is opcode `0` carrying `{"v":1,"client_id":"<app>"}`.
`v` is the RPC version (currently `1`). On success Discord replies with an
opcode-`1` FRAME whose JSON is a `DISPATCH` of `evt:"READY"`; a rejected
handshake (bad/blocked client_id) comes back as `evt:"ERROR"` — do not retry on
the same pipe in that case.

- Repo impl: `src/core/DiscordRpc.cpp:257-301` (`DoHandshake`) writes
  `{"v":1,"client_id":m_clientId}`, reads one frame, requires opcode == FRAME
  (`:275`), parses `evt` and returns true only on `"READY"`, false (no retry)
  on `"ERROR"`.

---

## 5. SET_ACTIVITY frame (VERIFIED)

Sent on opcode `1` (FRAME):

```json
{
  "cmd": "SET_ACTIVITY",
  "nonce": "<unique-per-request>",
  "args": {
    "pid": 9999,
    "activity": { ...activity object... }
  }
}
```

- `pid` = the calling process's PID (`GetCurrentProcessId`).
- `nonce` need not be a UUID — any per-request-unique string is fine for
  fire-and-forget; Discord uses it only to pair responses.
- Clearing presence: send the same shape with `activity` = `null` (or omitted).

Repo impl: `src/core/DiscordRpc.cpp:303-353` (`SendActivityIfDirty`):
`args.pid = GetCurrentProcessId()` (`:321`), `args.activity = <snapshot>` or
`null` when the snapshot is empty (`:322-330`), wrapped as
`{cmd:"SET_ACTIVITY", args, nonce:MakeNonce()}` (`:332-336`), written on
`kOpFrame` (`:338`). One response frame is drained as a liveness check
(`:343-351`). `MakeNonce()` (`:55-61`) = `vrcsm-<tickCount>-<counter>`.

### Rate limit (VERIFIED — important)

Discord throttles presence to **one update per 15 seconds** (extra updates
queue). The worker loop already respects this: after each send it waits
15 s (or until woken by a new `SetActivity`) before the next send —
`src/core/DiscordRpc.cpp:395-397`. This also stays well within the workflow's
"API polling <= 1/60s" budget (that rule targets VRChat API; Discord IPC is a
local pipe, but 15 s cadence is conservative regardless).

---

## 6. Activity object fields

### Confirmed by Discord docs (the RPC `activity` page)

- `state` (string), `state_url`
- `details` (string), `details_url`
- `timestamps`: `start`, `end` — **Unix seconds** (a `start` alone renders an
  "elapsed" counter; `end` renders "remaining").
- `assets`: `large_image`, `large_text`, `large_url`, `small_image`,
  `small_text`, `small_url`. `*_image` is the **asset key name** you uploaded
  under the Discord app's Rich Presence art assets (or an external URL on newer
  clients).
- `party`: `id` (string), `size` = `[current, max]` integer pair.
- `secrets`: `join`, `spectate`, `match`.
- `instance` (boolean).
- `type`: limited to Playing(`0`), Listening(`2`), Watching(`3`),
  Competing(`5`) — for presence the default (Playing) is implied; the repo
  does not set `type` (acceptable).

### `buttons` (PARTIALLY VERIFIED)

`buttons` is an array of `{ "label": "...", "url": "..." }`, **max 2 buttons**,
used by Rich Presence to show clickable link buttons. This is widely
implemented and the repo's own header documents it (`DiscordRpc.h:48-52` lists
`buttons[] (label, url)`), but I did **not** find `buttons` in the specific
Discord RPC pages I fetched (the docs link the full field reference to a
separate "activity object" page I could not load cleanly). **Treat the
2-button limit and exact shape as UNVERIFIED against primary docs** — if you
wire buttons, gate behind a flag and test against a live Discord client before
shipping. The transport layer already passes whatever JSON the caller supplies,
so adding `buttons` is a frontend-only change (see §9).

### What the shipped frontend actually sends

`web/src/lib/useDiscordPresence.ts:48-64` builds:

```ts
{
  state,                                  // e.g. "In <world>"
  details,                                // raw location string
  timestamps: { start: sessionStartRef }, // unix seconds, resets on world change
  party?: { id: <location|"vrcsm">, size: [1, capacity] },
  assets: { large_image: "vrcsm-logo", large_text: "VRCSM",
            small_image: "vrchat",    small_text: "VRChat" }
}
```

No `secrets`, no `buttons`, no `instance` are sent. See Gaps.

---

## 7. Client_id requirement (VERIFIED — and correctly handled)

A Rich Presence connection **requires a registered Discord application
snowflake** (`client_id`), created at
`https://discord.com/developers/applications`. There is **no usable default**:
the asset keys (`large_image:"vrcsm-logo"`, etc.) only resolve against the art
uploaded to *that* app, and the displayed app name comes from it.

The repo deliberately ships **no built-in id** and refuses to connect without
one:

- Host: `src/host/bridges/PipelineBridge.cpp:166-186` — comment explicitly says
  "intentionally no built-in default"; `HandleDiscordSetActivity` throws
  `discord_not_configured` if `params.clientId` is empty.
- Core: `src/core/DiscordRpc.cpp:159-162` — `TryConnect` returns false (never
  opens a pipe) when `m_clientId` is empty.
- Frontend: id is read from UI pref `vrcsm.discord.clientId`
  (`useDiscordPresence.ts:8,40`); feature is **opt-in / default OFF**
  (`PREF_ENABLED` default `false`, `:39`).

**TODO for VRCSM project owners:** register a VRCSM Discord app and either
ship its snowflake as a placeholder constant or keep the current
bring-your-own-id model. **Do NOT invent a snowflake** — an unregistered id
silently fails the handshake. Current design (user supplies their own) is a
valid, privacy-respecting choice; the only cost is users see their own app name
unless VRCSM publishes an official id + asset pack.

---

## 8. Privacy: join secret / instance (REQUIREMENT — currently safe by omission)

Per the workflow privacy rule and Discord semantics: `secrets.join` and a
`party.id` that encodes a joinable instance let *anyone who sees the presence*
deep-link into the session. For **private / invite / invite+ / friends**
instances this must be **omitted** — only `public` (and arguably `friends+`,
per project policy) instances should ever carry `secrets.join`/joinable party
metadata.

Current shipped state: **safe** — `useDiscordPresence.ts` sends **no
`secrets`** at all, and `party.id` is set to the raw location string only to
group the size indicator (not registered as a join secret, since no
`secrets.join` accompanies it and the app has no `ACTIVITY_JOIN` subscription).
So there is no instance-leak today.

**If join-to-session is ever added (future):** parse the instance privacy from
the VRChat location string (`wrld_…:12345~private(usr_…)`, `~friends(...)`,
`~hidden(...)`, `~group(...)`, public = bare `~region` only) and set
`secrets.join` **only** for public instances. Privacy token parsing rules are
VRChat-specific; verify against a live log/location before trusting any token
list — mark UNVERIFIED until then.

---

## 9. Where it lives & how it's fed (VERIFIED wiring)

Layering matches repo conventions (reusable IPC in `web/src/lib`, not pages):

```
React app shell
  └─ useDiscordPresence()            web/src/lib/useDiscordPresence.ts
       ├─ reads prefs vrcsm.discord.{enabled,clientId}  (ui-prefs)
       ├─ subscribes pipeline event "user-location"     (pipeline-events)
       └─ ipc.discordSetActivity(activity, clientId)     web/src/lib/ipc.ts:2156
                                       ipc.discordClearActivity()  ipc.ts:2163
                                       ipc.discordStatus()         ipc.ts:2167
            │  JSON-RPC over postMessage
            ▼
  IpcBridge::Dispatch
       ├─ allowlist  "discord.setActivity/clearActivity/status"
       │              src/host/IpcBridge.cpp:235-237
       ├─ handlers registered  IpcBridge.cpp:760-762
       ├─ decls  IpcBridge.h:179-181
       └─ impl  src/host/bridges/PipelineBridge.cpp:177-227
            └─ m_discordRpc (core)  src/core/DiscordRpc.{h,cpp}
                 └─ \\.\pipe\discord-ipc-N
```

Feed sources:

- **Current world/instance** — driven off the `user-location` pipeline event
  (`useDiscordPresence.ts:70-84`): `content.world.name` → `state`,
  `content.location` → `details`, `recommendedCapacity|capacity` →
  `party.size = [1, cap]`. `friend-location` is subscribed but a no-op for self
  presence (`:88-91`).
- **L1 video-active state — NOT YET WIRED.** The video atoms exist
  (`src/core/LogAtoms.h:32` `VideoPlay`, `:40` `AttributedVideoPlay`, `:41`
  `VideoSync`) and L1 video-play is shipped per MEMORY, but the presence hook
  does **not** consume them. To surface "watching a video" you would
  subscribe to the relevant pipeline event (the one emitting the video atom)
  in `useDiscordPresence.ts` and fold it into `details`/`small_text` (e.g.
  `small_text: "Watching video"`), then `push(...)`. This is the one
  remaining feed integration the prompt asked about. **Status: UNIMPLEMENTED —
  flag-gated-dark candidate.** Verify the exact pipeline event name that
  carries the video atom before wiring (do not assume).

---

## 10. Concrete C++ sketch (matches shipped code)

```cpp
// src/core/DiscordRpc.cpp (abridged — real code is the source of truth)

// 1. connect: try pipes 0..9
for (int i = 0; i < 10; ++i) {
    std::wstring path = toWide(fmt::format("\\\\.\\pipe\\discord-ipc-{}", i));
    HANDLE h = CreateFileW(path.c_str(), GENERIC_READ | GENERIC_WRITE,
                           0, nullptr, OPEN_EXISTING, 0, nullptr);
    if (h != INVALID_HANDLE_VALUE) { m_pipe = h; break; }
}

// 2. frame write: [op LE32][len LE32][json]
bool WriteFrame(uint32_t op, const std::string& body) {
    uint8_t hdr[8];
    WriteLe32(hdr,     op);
    WriteLe32(hdr + 4, (uint32_t)body.size());
    DWORD n;
    WriteFile(h, hdr, 8, &n, nullptr);
    WriteFile(h, body.data(), (DWORD)body.size(), &n, nullptr);
}

// 3. handshake: op 0
WriteFrame(0, json{{"v",1},{"client_id",m_clientId}}.dump());
// read back op==1, expect evt=="READY"

// 4. SetActivity(json): op 1
json frame{
  {"cmd","SET_ACTIVITY"},
  {"args", {{"pid", GetCurrentProcessId()}, {"activity", activityOrNull}}},
  {"nonce", MakeNonce()}
};
WriteFrame(1, frame.dump());
```

A fresh implementation would not differ materially — this is the canonical
minimal raw client.

---

## 11. Gaps / TODO (honest list)

1. **L1 video-active not fed into presence** — the prompt's "fed by … L1
   video-active state" is not yet implemented. UNIMPLEMENTED. (§9)
2. **No `buttons`** sent, and the 2-button limit/shape is UNVERIFIED against
   primary docs. (§6)
3. **No `secrets.join` / `instance`** — safe today (no leak), but join-to-
   session would require VRChat instance-privacy parsing, currently
   UNVERIFIED. (§8)
4. **No official VRCSM Discord app id** — bring-your-own-id only. Project
   decision needed; do not invent a snowflake. (§7)
5. **No unit/golden test** for `DiscordRpc` framing in `tests/CommonTests.cpp`
   (grep found no `DiscordRpc` reference there). The LE32 header
   pack/unpack and SET_ACTIVITY JSON shape are pure functions worth a test —
   none exists. (UNVERIFIED claim: based on the grep result that only
   `IpcBridge.h`, `CMakeLists.txt`, `CHANGELOG.md`, `PipelineBridge.cpp`, and
   the two `DiscordRpc.*` files reference the symbol.)

None of these block the shipped, opt-in, default-OFF feature.

---

## Sources

Web (verified this session):
- Discord RPC topic docs — transport/pipe path, framing, opcodes, handshake,
  SET_ACTIVITY, activity fields: https://docs.discord.com/developers/topics/rpc
- Discord Rich Presence overview: https://discord.com/developers/docs/rich-presence/overview
- Raw shell reference (LE32 header encoding, op 0 / op 1, pipe socket):
  https://gist.github.com/CoolnsX/e7bf120953703abd4e0d4507606000e9
- 15-second update throttle confirmation (Construct RP extension doc):
  https://gist.github.com/advaith1/e47500465b1bb67518a65c6fb49830b6
- C# IPC wrapper usage (pipe number selection 0..9):
  https://github.com/dcdeepesh/DiscordIPC/blob/master/Documentation/Usage.md

Repo (verified file:line, on-disk 2026-06-29):
- `src/core/DiscordRpc.h:32-85`, `src/core/DiscordRpc.cpp:44-48,55-78,159-353,355-401`
- `src/core/CMakeLists.txt:32`
- `src/host/bridges/PipelineBridge.cpp:166-227`
- `src/host/IpcBridge.cpp:235-237,760-762`, `src/host/IpcBridge.h:179-181`
- `web/src/lib/ipc.ts:676,2156-2170`, `web/src/lib/useDiscordPresence.ts:1-102`
- `src/core/LogAtoms.h:32,40,41` (video atoms, not yet fed to presence)
