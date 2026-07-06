# Now-Playing Music → VRChat OSC Chatbox

Design for a module that detects the user's currently-playing media (any player)
and renders it into the VRChat chatbox through the existing OSC Studio.

## 1. Data source: GSMTC (system-level)

Use Windows **`GlobalSystemMediaTransportControlsSessionManager`** (GSMTC,
namespace `Windows.Media.Control`). It surfaces whatever any app registers with
the System Media Transport Controls — Spotify, browser YouTube, Apple Music,
foobar2000, Deezer, etc. — with **no API key, no OAuth, no per-service code**.

This matches the entire mature open-source ecosystem
(VRCWizard/TTS-Voice-Wizard, cyberkitsune/vrc-osc-scripts, YAMI, VolcanicArts/
VRCOSC, sillyosc), which all converge on GSMTC / the "MediaManager API".

**Zero new dependencies.** WinRT is already used in `src/core/ToastNotifier.cpp`
(via the `ABI::Windows::*` / WRL flavor) and `wil` is a vcpkg dep. GSMTC ships
in the Windows SDK. Reuse the same ABI/WRL pattern for consistency.

## 2. Core module: `src/core/NowPlaying.{h,cpp}`

Platform-agnostic-facing API (Win32/WinRT confined to the .cpp), returning a
plain snapshot struct — no exceptions, `Result<T>` on failure, like the rest of
`src/core`.

```cpp
namespace vrcsm::core {
struct NowPlayingSnapshot {
    bool        active = false;      // is any media session present
    std::string title;
    std::string artist;
    std::string album;
    std::string status;              // "playing" | "paused" | "stopped"
    std::string appId;               // source AUMID, e.g. Spotify.exe / msedge
    std::string appName;             // friendly ("Spotify", "Microsoft Edge")
    long long   positionMs = 0;      // last-known playback position
    long long   durationMs = 0;      // track length (0 if unknown)
    long long   positionAtMs = 0;    // epoch ms when position was sampled
    double      playbackRate = 1.0;  // for client-side progress extrapolation
    bool        hasThumbnail = false;// availability only (image out of scope)
};
Result<NowPlayingSnapshot> ReadNowPlaying();
}
```

- `ReadNowPlaying()` gets `GetCurrentSession()` from the session manager, then
  `TryGetMediaPropertiesAsync()` (title/artist/album/thumbnail) and
  `GetTimelineProperties()` / `GetPlaybackInfo()` (position/duration/status/
  rate). WinRT async is resolved synchronously (bounded wait) — the call is
  cheap and the host polls it off the UI thread.
- No session → `active=false` (not an error). Errors (WinRT init failure) →
  `Error{"nowplaying_unavailable", ...}`.
- COM/WinRT init: mirror `ToastNotifier` (RoInitialize/apartment as needed);
  guard against double-init.

## 3. IPC contract

Emitted keys are **snake_case** to match the app-wide bridge convention
(the contract-drift sweep confirmed snake_case is the norm; TS reads snake_case).

- **`music.nowPlaying`** (poll method, async): returns the snapshot as JSON:
  `{ active, title, artist, album, status, app_id, app_name, position_ms,
  duration_ms, position_at_ms, playback_rate, has_thumbnail }`.
- **`music.nowPlaying` event** (push): same shape, emitted when the host detects
  a track/status change, so the UI updates without polling hard. (Poll remains
  the fallback / initial fetch.)

Bridge: a small handler in an existing bridge (Pipeline/Hw-adjacent) or a new
`MusicBridge.cpp` following the 19-bridge pattern. Method registered in
`AsyncMethodSet()` (WinRT call → worker thread).

## 4. Web: template tokens (`web/src/lib/osc-studio.ts`)

New variable group "Music" in `OSC_VARIABLE_GROUPS`, tokens:

| Token | Renders |
| --- | --- |
| `{music.title}` | track title |
| `{music.artist}` | artist |
| `{music.album}` | album |
| `{music.status}` | ▶ / ⏸ (configurable glyphs) |
| `{music.position}` | `1:23` (mm:ss) |
| `{music.duration}` | `3:45` |
| `{music.progressBar}` | `▬▬▬▬▭▭▭▭` (configurable width + filled/empty glyphs) |
| `{music.percent}` | `37%` |
| `{music.appName}` | source app |

Rendering helpers (pure, testable, in osc-studio.ts):
- `mmss(ms)` → `m:ss`.
- `progressBar(pos,dur,width,fill,empty)` → clamped bar string.
- `marquee(text, width, tick)` → windowed scroll; `tick` derived from send count
  / wall-clock so long titles scroll across successive 1s sends.
- **Client-side progress extrapolation**: given `position_ms`, `position_at_ms`,
  `playback_rate`, and `status`, compute the *current* position at render time so
  the bar advances smoothly at the 1s send cadence without re-hitting GSMTC each
  tick. Paused → frozen.

## 5. Preset templates ("好看的模板")

Shipped as default/insertable OSC Studio cards (`kind: "chatbox-template"`,
`address:/chatbox/input`, `autoIntervalSec: 1`):

1. **Simple** — `♪ {music.title} — {music.artist}`
2. **Progress** — `{music.status} {music.title} [{music.progressBar}] {music.position}/{music.duration}`
3. **Marquee** — long title auto-scrolls within a fixed width across sends
4. **Compact** — `♪ {music.title}` (144-char fallback)

## 6. Web panel: `web/src/pages/osc/NowPlayingPanel.tsx`

- Live preview of the current track + the rendered chatbox line (updates from the
  `music.nowPlaying` event).
- Template picker (the 4 presets) + editable template feeding the existing editor.
- Progress-bar width / glyph controls; marquee width control.
- Optional **ASCII-fold toggle** (see §7).
- Source display (which app GSMTC is reading). Source *selection* is future work
  (GSMTC exposes the current session; multi-session pick is a later enhancement).

## 7. Robustness decisions

- **Unicode**: send UTF-8 as-is. VRChat's chatbox handles more Unicode than when
  the old tools bolted on romaji conversion. Provide an **optional ASCII-fold
  toggle** (strip/transliterate to ASCII) for users whose fonts still mangle CJK
  — off by default, never forced.
- **No media playing** → all `{music.*}` render empty and the card **auto-skips**
  the send (reuse the OSC skip-toast ownership rule so it doesn't spam "sent").
- **144-char cap**: the existing `renderOscCardValue` already `.slice(0,144)`.
  Templates are ordered so title survives truncation (title first, bar/times
  trimmed).
- **Poll cadence**: host detects changes via GSMTC session/property changed
  events where possible; otherwise a modest poll (e.g. 1–2s). The 1s *send* loop
  uses client-side extrapolation, so GSMTC is not hit every send.
- **Thumbnail**: capture `has_thumbnail` now; actual image display is out of
  chatbox scope (noted for a future avatar-parameter / HUD-overlay use).
- **Privacy**: nothing leaves the machine; GSMTC is local. The chatbox line is
  only sent when the user enables the card.

## 8. Verification & live test

- C++: unit test for the render/extrapolation helpers and a smoke of
  `ReadNowPlaying()` (guarded — CI has no media session, so assert it returns
  `active=false` cleanly rather than requiring a track). Build + ctest green.
- Web: tsc + build + UI smoke 54/54; unit-test the pure render helpers
  (mmss/progressBar/marquee/extrapolation) with fixed inputs.
- **Live**: build a fresh `VRCSM.exe`, launch it, play Spotify/YouTube/etc., and
  watch the now-playing card render live in OSC Studio's preview; tune templates.
