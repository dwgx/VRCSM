# IPC Contract Drift Report — 2026-07

Scope: full sweep of host-emitted IPC/event payload keys versus the keys the
React SPA actually reads, across every method dispatched by `IpcBridge` and its
per-domain bridges. Goal: find latent white-screens like the historical Hardware
`snake_case` bug (fixed in `e12f4e8`) before they ship.

## 1. Summary

| Metric | Count |
| --- | --- |
| Contract surfaces swept (methods + events) | ~101 |
| Clean (emitted keys match TS reads) | 99 |
| Drifted (confirmed mismatch) | 2 |
| Crash-risk / latent white-screen | 0 |
| Silent-wrong-value | 1 |
| Cosmetic / low | 1 |
| Refuted / already-fixed | 1 (`hw.recommend` `report.*`, fixed in `e12f4e8`) |

Headline: no live contract in the app currently produces a white-screen. Both
confirmed drifts are behind truthy guards on the TS side, so they degrade
gracefully rather than throwing. The one that matters is `plugin.marketFeed`,
because the graceful degradation is a **security-relevant understatement** of
requested plugin permissions, not a cosmetic gap.

## 2. Crash-risk (latent white-screen) — NONE

No confirmed drift dereferences an undefined value in a way that throws. Every
mismatch below is read through a guard (`?`, `??`, or a truthiness check), so an
absent key yields a fallback instead of a `TypeError`. This table is
intentionally empty; the drifts live in sections 3 and 4.

## 3. Silent-wrong-value

| Method | Emitted key | TS reads | Host file:line | TS file:line | Fix | Side to change |
| --- | --- | --- | --- | --- | --- | --- |
| `plugin.marketFeed` | `permissions` is **never emitted** | `entry.permissions` / `confirmEntry?.permissions` / `installed?.permissions ?? entry.permissions` | `src/core/plugins/PluginFeed.h:41-55` (no `permissions` member); `src/core/plugins/PluginFeed.cpp` (`ParseFeed` never reads it); `src/host/bridges/PluginBridge.cpp:63-80` (`MarketEntryToJson` emits 12 keys, none `permissions`) | `web/src/lib/types.ts:1254` (`permissions?: string[]`); consumed `PluginsMarket.tsx:193, :245`; `PluginDetail.tsx:233, :269` | Add `std::vector<std::string> permissions` to `MarketEntry` (`PluginFeed.h ~:54`), parse the entry's optional `permissions` array in `ParseFeed` (mirror `PluginManifest.cpp:248-254`), and emit `{"permissions", e.permissions}` in `MarketEntryToJson` (`PluginBridge.cpp:65-79`). The `plugins.json` feed must also carry per-entry permissions for real data to surface. | **Host (C++).** No TS change: `MarketPluginEntry.permissions` is already optional and both views already consume it. |

Why this is silent-wrong, not cosmetic: `permissionTokens` (`PluginsMarket.tsx:15-17`,
`PluginDetail.tsx:13-15`) returns `permissions && permissions.length > 0 ? permissions : ['none']`.
An undefined value therefore renders the literal token **`none`**. The install-confirm
dialog copy (`PluginsMarket.tsx:237`, `PluginDetail.tsx:261`) tells the user to
"review the permissions before proceeding" under a "Manifest Permissions" header
(`:242` / `:266`), yet always shows `none` pre-install. The true permission set only
appears **after** install, via `plugin.list` — `PluginManifest.cpp:304` sets
`out['permissions']=m.permissions` in `ManifestToJson`, surfaced through
`InstalledPluginToJson` (`PluginBridge.cpp:50-52`) and read by
`PluginDetail`'s `installed?.permissions` branch. So the user grants consent
against an understated `none`, and only learns the real permissions once the
plugin is already on disk.

## 4. Cosmetic / low

| Method | Emitted key | TS reads | Host file:line | TS file:line | Fix | Side to change |
| --- | --- | --- | --- | --- | --- | --- |
| `hw.recommend` | `fromCommunity` / `communityAuthor` never emitted (`RecommendationToJson` emits exactly 14 keys: `tier, score, cpu_score, gpu_score, gpu_vram_multiplier, ram_bonus, hmd_profile_name, target_bandwidth, supersample_scale, preferred_refresh_rate, motion_smoothing, allow_filtering, ffr_level, rationale`) | `rec.fromCommunity` (badge guard), `rec.communityAuthor` | `src/host/bridges/HwBridge.cpp:34-52` (`RecommendationToJson`); `HwBridge.cpp:161-198` `HandleHwRecommend` (both base and community overwrite at `:179-180` use the same emitter — no provenance field either way) | declared optional `TabHardware.tsx:48-49`; read `TabHardware.tsx:187-192` (badge `rec.fromCommunity ? (...) : null`) | Optional / by design. To make the community badge render: add a bool + author field to `PresetRecommendation` (`HwProfiler.h`) and emit them snake_case in `RecommendationToJson`, OR inject `fromCommunity:true` / `communityAuthor` into `result["recommendation"]` when the community override at `HwBridge.cpp:177-181` applies. | **Host (C++)**, only if the feature is wanted. |

This is explicitly documented forward-compat: the TS comment at
`TabHardware.tsx:46-47` states the fields are "Not emitted by the host today;
pre-existing always-undefined reads kept for forward-compat." The badge guard
(`rec.fromCommunity ? ... : null`) makes an undefined value falsy, so the badge
simply never renders — no error, no crash. Leaving it as-is is acceptable.

## 5. Refuted / already-fixed appendix

| Contract | Prior concern | Status | Evidence |
| --- | --- | --- | --- |
| `hw.recommend` `report.*` | `HwReportToJson` emits snake_case (`cpu_name, cpu_cores, cpu_threads, cpu_clock_mhz, gpu_name, gpu_vram_bytes, gpu_driver, ram_bytes, hmd_model, hmd_manufacturer, os_build`) while TS once read camelCase — the original white-screen | **FIXED in `e12f4e8`** | Host `HwBridge.cpp:13-32`; TS now reads snake_case in `TabHardware.tsx:17-29` and `HwRecommendResponse.report` at `useOscStudio.ts:58-75`. Match. |
| `hw.recommend` `recommendation.*` core keys | camelCase drift suspected | Clean | `RecommendationToJson` snake_case matches `HwRecommendation` (`TabHardware.tsx:31-45`); `rec.supersample_scale.toFixed`, `rec.target_bandwidth`, `rec.ffr_level` all resolve. |

### Clean-contract coverage (99 surfaces, no drift)

Verified match on both sides; grouped by bridge. Listed for audit completeness.

- **hw / vr / settings (18):** `hw.recommend` `report.*`, `hw.recommend` `recommendation.*`, `hw.detect` (no live TS consumer), `hw.telemetry`, `hw.applyPreset`, `vr.diagnose`, `vr.audio.switch`, `settings.readAll`, `settings.writeOne`, `settings.exportReg`, `config.read`, `config.write`, `steamvr.read`, `steamvr.write`, `steamvr.link.diagnose`, `steamvr.link.repair`, `steamvr.link.backups`, `steamvr.link.restore`.
- **db / api (20):** `db.stats.overview`, `db.stats.heatmap`, `data.usage` (`dbFileBytes` intentional camelCase both sides), `db.coPresenceGraph`, `db.playerEncounters`, `db.avatarHistory.list`, `db.avatarBenchmarks.list`, `friendLog.recent`/`forUser`, `friendPresence.predict`, `favorites.syncOfficial`, `instance.details`, `avatar.preview`/`avatar.preview.status`, `avatar.preview.progress` (event), `worlds.search`, `avatar.parameters.local`, `friends.list`, `groups.list`, `moderations.list`, `user.me`/`user.getProfile`, `visits.list` (raw VRChat schema).
- **cache / migrate / logs (17):** `scan`, `bundle.preview`, `delete.dryRun`, `delete.execute`, `migrate.preflight`, `migrate.execute`, `migrate.progress` (event), `migrate.done` (event), `junction.repair`, `logs.stream.start`/`stop`, `logs.files.clear`, `logs.stream` (event), `logs.stream.event` (event), `screenshots.list`, `screenshots.open`, `screenshots.folder`, `screenshots.delete`.
- **radar / pipeline / event (13):** `radar.poll`, `memory.status`, `search.global`, `event.list`, `event.attendees`, `event.start`/`stop`/`delete`/`addAttendee`, `pipeline.start`/`stop`, `pipeline.state`/`pipeline.event` (events), `notify.setPrefs`, `discord.status`/`setActivity`/`clearActivity`, `osc.message` (event)/`osc.send`/`listen.*`, `notifications.list`, `screenshots.watcher.start`/`readMetadata`/`injectMetadata`.
- **plugin / rule / update / vector / auth / shell (31):** `auth.status`, `auth.login`, `auth.verify2FA`, `auth.logout`, `auth.user`, `rules.list`, `rules.get`, `rules.create`, `rules.update`, `rules.delete`, `rules.setEnabled`, `rules.history`, `update.check`, `update.download`, `update.install`, `update.getState`/`skipVersion`/`unskipVersion`, `vector.upsertEmbedding`, `vector.search`, `vector.getUnindexed`, `vector.removeEmbedding`, `plugin.list`, `plugin.install`, `plugin.uninstall`, `plugin.enable`/`disable`, `fs.listDir`, `shell.pickFolder`, `shell.openUrl`, `app.version`, `app.factoryReset`, `autoStart.get`/`set`, `fs.writePlan`/`fs.appDataDir`.

## 6. Systemic cause and long-term fix

**Root cause.** The IPC boundary applies **no key transform**. Verified at
`web/src/lib/ipc.ts:687` — `slot.resolve(resp.result)` passes the host JSON
through verbatim; there is no snake_case→camelCase step. As a result the naming
convention is negotiated *per key, per method, by hand*: the C++ emitter and the
TS interface must agree on casing character-for-character. Some domains emit
snake_case (`report.*`, `event.*`, cache `scan`), others camelCase (`vr.diagnose`,
`migrate.*`, radar player rows), and a few are deliberately mixed
(`data.usage.dbFileBytes`, `friends.list`). Correctness rests entirely on both
authors remembering the local convention. The historical Hardware white-screen
(`e12f4e8`) was exactly this: the host emitted snake_case and the TS read
camelCase.

**Would a boundary transform be better?** A blanket snake↔camel transform at
`ipc.ts:687` is **not** a safe drop-in here, precisely because the codebase
already relies on snake_case reaching the SPA unchanged. Many clean contracts —
all of `event.*`, the radar player passthrough, `rules.*`, the DB analytics
payloads — are clean *only because TS deliberately reads snake_case*. Auto-camelizing
would silently break every one of those (e.g. `event_type` → `eventType`,
`world_id` → `worldId`) and turn ~40 currently-clean surfaces into new drifts.
It would also mangle raw-passthrough payloads (`visits.list`, `notifications.list`,
`auth.user`) that carry VRChat's own upstream keys the app does not own.

The two drifts found here are also **not casing mismatches** — they are *missing
keys* (`permissions`, `fromCommunity`), which no casing transform would fix. The
higher-leverage long-term fix is a **shared schema / codegen** approach: generate
the TS payload interfaces from the C++ `*ToJson` emitters (or validate one against
the other in CI), so an emitted-vs-read key divergence is a build failure rather
than a runtime white-screen. That catches both missing keys *and* casing drift,
without retroactively breaking the intentional snake_case contracts. Per-page
alignment (the current practice) is fine tactically but leaves the class of bug
open; schema pinning closes it.

## 7. Recommended action order

1. **`plugin.marketFeed` permissions** (security-relevant, silent-wrong): emit
   `permissions` from the host so the install-confirm dialog stops understating
   requested permissions as `none`.
2. `hw.recommend` provenance fields — only if the community badge is a wanted
   feature; otherwise leave per the documented forward-compat comment.
3. Consider host→TS schema codegen/CI validation to prevent the next
   emitted-vs-read divergence structurally.
