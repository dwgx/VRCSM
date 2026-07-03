# Wave 3 implementation facts (verified 2026-06-29) — for impl agents

Repo `D:\Project\VRCSM`. Build/test commands and hard rules in the workflow GROUND block.

## IPC handler pattern (host C++) — to add a new IPC method `foo.bar`:
1. **Allowlist**: add `"foo.bar",` to the string list in `src/host/IpcBridge.cpp` (the block around lines 142–187 — this is the async/origin method allowlist; copy a neighbor like `"avatars.listOwned"`).
2. **Register**: in `IpcBridge::RegisterHandlers()` (`IpcBridge.cpp:586+`) add
   `m_handlers.emplace("foo.bar", [this](const nlohmann::json& p, const std::optional<std::string>& id) { return HandleFooBar(p, id); });`
3. **Declare**: add `nlohmann::json HandleFooBar(const nlohmann::json& params, const std::optional<std::string>& id);` to `src/host/IpcBridge.h` (handler decl block ~line 61–145).
4. **Implement**: put `nlohmann::json IpcBridge::HandleFooBar(...)` in the most relevant `src/host/bridges/*.cpp` (ApiBridge.cpp for VRChat API calls, ShellBridge.cpp for OS/process, a new bridge file for a new domain — add new .cpp to `src/host/CMakeLists.txt`).
   - Simple sync example: `ShellBridge.cpp:71 HandleProcessVrcRunning` → `return ToJson(...)`.
   - VRChat API write example: `ApiBridge.cpp HandleAvatarsUpdate/Delete/UpdateImage`.
   - Helpers in `src/host/bridges/BridgeCommon.h`: `ToJson`, `unwrapResult`, `ParamInt`, `JsonStringField`.
5. **Frontend binding**: `web/src/lib/ipc.ts` — add a `case "foo.bar":` in the dispatch (see `avatars.listOwned` at ipc.ts:1566) + a typed method; expose reusable wrappers from a `web/src/lib` domain module (e.g. `vrc-media.ts`), never in pages.

## A10 (Amplitude harvest) facts:
- C++ module ready: `src/core/AvatarIdHarvest.{h,cpp}` (in CMake). API: `AvatarIdHarvest::Harvest()` → `std::vector<std::string>` of unique `avtr_` ids, read-only, never throws. Not yet referenced anywhere.
- Frontend flag system: `web/src/lib/experimental.ts` — add a flag to `EXPERIMENTAL_FLAGS` with `key:"vrcsm:experimental:amplitudeHarvest"`, `nameKey/descriptionKey/warningKey` (warning = TOS notice), `defaultValue:false`. Render auto-handled by `TabExperimental.tsx` ToggleRow (shows warningKey with ⚠). i18n strings under `settings.experimental.flags.<id>.*` in `web/src/i18n/locales/en.json`.
- `useExperimentalFlag(key)` reads/writes (localStorage via ui-prefs). Gate the harvest call behind it (default OFF).

## VrcPlus image-cache (task done, reference): `web/src/pages/VrcPlus.tsx` `CachedTileImage` wraps `useCachedImageUrl(id, src)` from `@/lib/image-cache` then renders `<img>`. Hook can't be in `.map()` so it's a component.

## Log atom 6-touch-point (for A4/emoji): regex in `LogAtoms.cpp`, enum in `LogAtoms.h` (currently 28 incl. Wave2 atoms), classifier case `LogEventClassifier.cpp`, `LogReport` vector + to_json `LogParser.{h,cpp}`, live persist `LogsBridge.cpp`, feed source_kind/category `Database.cpp` UnifiedFeed + `web/src/lib/feed.ts` + `Feed.tsx`, golden test `tests/CommonTests.cpp`. Mirror `StickerSpawn` exactly.

## vrc-media.ts already has: boop, inventory list, prints CRUD, files CRUD, listOwnedAvatars, updateAvatar, deleteAvatar, replaceAvatarImageFromFile, fileToBase64. supporter status: read from current user object tags (`system_supporter`/`$supporter` style) — verify against VrcApi current-user shape.
