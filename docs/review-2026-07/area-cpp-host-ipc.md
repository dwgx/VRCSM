# Review — Area cpp-host-ipc (`src/host/**`)

Date: 2026-07 (review pass)
Scope: IPC threading, WebView2 security/navigation, IPC input validation, detached-thread leaks/exceptions, Result→JSON path/token leakage.
Files read in full: `IpcBridge.cpp`, `IpcBridge.h`, `WebViewHost.cpp`, `WebViewHost.h`, `MainWindow.cpp`, `App.cpp`, plus targeted reads of `bridges/ShellBridge.cpp`, `bridges/ScreenshotBridge.cpp`, `bridges/PluginBridge.cpp`, `bridges/PipelineBridge.cpp`, `bridges/LogsBridge.cpp`, `bridges/ApiBridge.cpp`, and `src/core/plugins/PluginRegistry.cpp`.

---

## CRITICAL

None found.

The two highest-impact subsystems — worker→UI marshaling and the plugin origin gate — are sound. Worker results never touch WebView2 COM off-thread: `WebViewHost::PostMessageToWeb` unconditionally `PostMessageW`s a heap payload to the UI thread and the real `PostWebMessageAsString` only runs in `DeliverWebMessage` on the UI thread (`WebViewHost.cpp:57-115`, `MainWindow.cpp:152-167`). Origin classification rejects any non-`app.vrcsm`, non-plugin origin before dispatch and forces plugin frames through `plugin.rpc` (`IpcBridge.cpp:441-465`).

---

## HIGH

### H1. No `NewWindowRequested` / `NavigationStarting` gating — popups and top-level navigation are unrestricted
`WebViewHost::ConfigureWebView` (`WebViewHost.cpp:228-366`) registers `WebMessageReceived`, `FrameCreated`, and `NavigationCompleted`, but never `add_NewWindowRequested` or `add_NavigationStarting`. Confirmed absent via grep across `src/host/` (no occurrences of either handler name).

Problem: any script running in the trusted `app.vrcsm` frame, in a plugin iframe, or injected via a compromised bundled/plugin asset can `window.open(...)` / `target="_blank"` to spawn a new WebView2 window pointed at an arbitrary remote origin (the SPA already uses `target="_blank"`, e.g. `web/src/components/ImageZoom.tsx:82-96`), and can navigate the top-level frame away from `https://app.vrcsm/` to an attacker origin that renders inside the app's own window chrome.

Impact: navigation/popup surface is the primary containment boundary for an embedded WebView2 app and it is currently open. Medium likelihood (needs script execution), high impact (uncontrolled new browser window, top-frame takeover of app chrome for phishing).

Fix: in `ConfigureWebView`, add `m_webview->add_NewWindowRequested(...)` that calls `args->put_Handled(TRUE)` and routes external `https`/`vrchat` URLs through the vetted `shell.openUrl` scheme allow-list (`ShellBridge.cpp:151-158`), denying the rest. Add `add_NavigationStarting(...)` (and `ICoreWebView2Frame::add_NavigationStarting` for plugin frames) that `put_Cancel(TRUE)` for any top-level navigation whose URI is not `https://app.vrcsm/...` (and, for iframe navigations, not the frame's own `plugin.<id>.vrcsm` host).

### H2. `shell.openUrl` is reachable by plugins and turns `vrchat://launch` into an authenticated `inviteSelf` account action
`HandleShellOpenUrl` (`ShellBridge.cpp:143-214`) accepts `http(s)://` and `vrchat://`. The permission table grants `shell.openUrl` to both `ipc:shell:openUrl` and the legacy broad `ipc:shell` token (`PluginRegistry.cpp:43,49`). For `vrchat://launch?id=...` while VRChat is running, the handler calls `VrcApi::inviteSelf(location)` (`ShellBridge.cpp:164-195`) — an authenticated VRChat API call that teleports the signed-in user into a plugin-supplied instance.

Problem: a plugin holding the common `ipc:shell` token can move the user's account between instances, or `ShellExecuteW` arbitrary `http(s)`/`vrchat` URLs (`ShellBridge.cpp:198-205`). A method named "open URL" silently performing an account mutation is also a surprising side effect.

Impact: plugin-driven account action (instance join/teleport) plus arbitrary protocol-handler launches, with only a coarse manifest permission as the gate.

Fix: split the `vrchat://launch`→`inviteSelf` behavior out of `shell.openUrl` into a dedicated method gated by a narrower permission, or restrict that branch to the `app.vrcsm` SPA by checking the caller. At minimum, drop `shell.openUrl` from the broad `ipc:shell` compatibility token so only an explicit `ipc:shell:openUrl` grant enables it, and document that the method can trigger an authenticated join.

### H3. `~IpcBridge` never stops `m_logTailer`; its still-running thread locks member mutexes that are destroyed first → shutdown use-after-free
The destructor (`IpcBridge.cpp:387-417`) explicitly stops `m_pipeline` (`:400-403`), `m_discordRpc` (`:404-407`), `m_osc` (`:408-411`), and `m_screenshotWatcher` (`:412-415`), then `Database::Instance().Close()` (`:416`) — but it never calls `m_logTailer->Stop()` (verified: only those four `Stop()`/`StopListen()` calls in the dtor body). `m_logTailer` therefore stops only via its own destructor (`~LogTailer`→`Stop()`, `LogTailer.cpp:60-62`), which joins its worker thread (`LogTailer.cpp:72,83-85`).

Problem: the tailer callback (`LogsBridge.cpp:170-360`) runs on that worker thread, has **no `*m_alive` guard** (verified: zero `alive` references in the callback body), and locks `m_currentWorldMutex` (`LogsBridge.cpp:250,270`) and `m_playerIdMutex` (`:294,312`) while mutating `m_currentWorldId`/`m_playerNameToUserId`. Members destruct in reverse declaration order, and `m_logTailer` is declared at `IpcBridge.h:322` — *before* `m_currentWorldMutex` (`:355`), `m_playerIdMutex` (`:362`), and `m_audioDeviceMutex` (`:369`). So those mutexes and maps are destroyed **before** `m_logTailer`'s destructor joins the thread. During that gap a live log line drives the callback to lock an already-destroyed mutex and write a destroyed map → use-after-free. (Note: this directly contradicts the "Verified-clean" claim in the original pass; see correction below — the declaration order is the bug, not the safeguard.)

Impact: shutdown-time data race / use-after-free; non-deterministic crash on exit whenever VRChat is actively writing its log as the app closes.

Fix: in `~IpcBridge`, add `if (m_logTailer) m_logTailer->Stop();` early in the body (alongside `ProcessGuard::StopWatcher()` at `:394`), so the tailer thread is joined while every IpcBridge member is still alive. As defense-in-depth, add an early `if (!*m_alive) return;` at the top of the tailer callback (`LogsBridge.cpp:172`).

---

## MEDIUM

### M1. Non-string `id` strands the frontend promise instead of returning a routable error
`ExtractId` (`IpcBridge.cpp:306-313`) calls `envelope.at("id").get<std::string>()`. If `id` is present but non-string (number/array/bool), `nlohmann::json` throws `type_error`, which is caught by the outer handler at `IpcBridge.cpp:555-558` and reported as `invalid_request` — but with **no `id`** in the error envelope (`id` was never extracted). The frontend `IpcClient` resolves pending promises by `id`, so that call's promise never settles.

Problem: a malformed/hostile `id` type produces an id-less error reply, leaving the caller's pending promise dangling rather than rejected. Self-inflicted hang / minor DoS, not memory safety.

Impact: low-to-medium robustness issue; one bad envelope leaks a pending promise on the web side.

Fix: in `ExtractId`, tolerate non-string ids by coercing with `.dump()` or rejecting early with a best-effort id echo. Better: parse `id` defensively (accept string or number, stringify), and ensure the catch-all at `IpcBridge.cpp:555-561` includes whatever id could be salvaged.

### M2. `fs.listDir` exposes full drive/volume enumeration and arbitrary-directory listing to plugins
`HandleFsListDir` (`ShellBridge.cpp:216-322`) enumerates every logical drive (`GetLogicalDrives`, lines 228-247) and lists the contents of any directory the caller supplies, with no base-path containment — `weakly_canonical` is used only to resolve, not to confine (lines 262-278). It is granted to plugins via `ipc:fs:listDir` (`PluginRegistry.cpp:44`).

Problem: a plugin with `ipc:fs:listDir` can walk the entire filesystem (drive labels, directory trees, hidden/system flags when `includeHidden` is set), which is a meaningful information-disclosure surface for an untrusted extension. The handler is intentionally a directory picker backend, but it has no root restriction.

Impact: filesystem reconnaissance by plugins (path/username disclosure, presence of other apps). Read-only, so no integrity impact, but broader than the AutoUploader use case implies.

Fix: if the picker backend genuinely needs whole-disk browsing, keep it but document the trust implication and consider gating `ipc:fs:listDir` behind an explicit install-time consent string. If not, confine listing under an allow-listed set of roots (appDataRoot, VRChat dirs, user-picked folder) via `ensureWithinBase`, as `fs.appDataDir` already does (`ShellBridge.cpp:421-429`).

### M3. `fs.writePlan` containment relies on caller-supplied `rootPath` with no base restriction
`HandleFsWritePlan` (`ShellBridge.cpp:330-398`) writes `.vrcsm-upload-plan.json` into any existing directory named by `rootPath` (lines 366-391). Content is JSON-validated and size-capped (good), and the filename is fixed (good), but the target directory is entirely caller-controlled and not confined to any base. Granted to plugins via `ipc:fs:writePlan` (`PluginRegistry.cpp:45`).

Problem: a plugin with `ipc:fs:writePlan` can drop a fixed-name 1MB JSON file into any writable directory on disk (e.g. a Startup folder won't execute JSON, but it can clobber an existing `.vrcsm-upload-plan.json` elsewhere or litter arbitrary dirs). The fixed filename and JSON validation limit weaponization, so impact is bounded.

Impact: bounded write primitive (fixed name, JSON only, ≤1MB) into arbitrary existing directories. Low-to-medium.

Fix: confine writes under an allow-listed base (the user-picked upload folder or appDataRoot) using `ensureWithinBase`, mirroring `fs.appDataDir`.

---

## LOW

### L1. `app.vrcsm` mapping uses `ALLOW` (allows cross-origin) rather than `DENY_CORS`
`WebViewHost.cpp:246-249` maps `app.vrcsm` with `COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW`. Plugin hosts correctly use `DENY_CORS` (`WebViewHost.cpp:575-578`, with the rationale comment at 537-540), but the main SPA and the four asset hosts (`preview.local`, `thumb.local`, `screenshots.local`, `screenshot-thumbs.local` — lines 273-320) all use `ALLOW`.

Problem: `ALLOW` permits cross-origin access to those virtual hosts. Since plugin frames are `DENY_CORS` on their own host, they cannot fetch `app.vrcsm` resources cross-origin anyway, so real exposure is limited — but `ALLOW` on the asset hosts is broader than necessary.

Impact: minor; defense-in-depth gap, not an active vuln given the plugin-side `DENY_CORS`.

Fix: use `DENY_CORS` for the asset hosts (`preview.local`, `thumb.local`, `screenshots.local`, `screenshot-thumbs.local`) unless the SPA genuinely needs cross-origin reads; keep `app.vrcsm` as needed for the SPA's own same-origin loads.

### L2. `handler_error` responses echo `ex.what()` to the renderer, which can embed filesystem paths
Both async and sync handler catch blocks send `ex.what()` straight into the error message (`IpcBridge.cpp:486,525,548`). Many handlers build exceptions containing absolute paths, e.g. `fs.listDir`/`fs.writePlan` error strings include `WideToUtf8(target.wstring())` (`ShellBridge.cpp:275-276,377-378,387-388`) and `screenshots.*` ShellExecute failures. These go to the SPA (trusted) but also to plugin iframes for plugin-reachable methods.

Problem: error text routed back to a plugin can disclose absolute local paths (username, directory layout). No token/secret leakage was found — auth tokens live in `AuthStore`/cookies and are not interpolated into error messages (verified across the bridges read). Path disclosure only.

Impact: low; path/username disclosure to plugins via error strings.

Fix: for plugin-targeted error responses, return the structured `code` plus a generic message and log the detailed `ex.what()` host-side only. Avoid embedding canonicalized absolute paths in messages destined for untrusted frames.

### L3. `PluginIdFromOrigin` runs a fallback substring match that could mis-attribute frames with dash/dot-colliding ids
`PluginIdFromOrigin` (`PluginRegistry.cpp:77-115`) reverses the dash↔dot host sanitization and matches against installed plugins by comparing `SanitiseForHostLabel(id)`. The comment (lines 100-114) acknowledges the id-in-label ambiguity and "prefers an exact match if one exists," but the loop returns the **first** plugin whose sanitized label matches, not necessarily an exact-id match.

Problem: two installed plugins whose ids differ only by `.` vs `-` (e.g. `acme.tool` and `acme-tool`) sanitize to the same host label, so a message from one could be attributed to the other and evaluated against the wrong permission set. Requires an attacker to get a colliding-id plugin installed alongside a more-privileged one.

Impact: low; narrow precondition (installed colliding ids), but it is a permission-attribution correctness bug.

Fix: reject or disambiguate at install time (forbid ids that collide under `SanitiseForHostLabel`), or carry the real plugin id in the frame mapping rather than reversing the label heuristically.

---

## Verified-clean (checked, no finding)

- Detached-thread lifetime: async handlers run on a shared `IpcThreadPool` (`IpcBridge.cpp:30-90`); `EnqueueAsync` increments `m_activeAsyncTasks` and the dtor drains to zero under `m_asyncCv` before tearing down owned workers (`IpcBridge.cpp:387-417, 904-934`). The pool worker wraps every task in try/catch (`IpcBridge.cpp:79-82`) and each task body has full IpcException/std::exception/`...` catch arms (`IpcBridge.cpp:475-491, 514-530`), so no exception escapes a detached thread.
- `m_alive` shared_atomic is checked inside the enqueued lambda (`IpcBridge.cpp:918`) and in every Post* helper (`IpcBridge.cpp:845,861,873,892`), guarding against window teardown after enqueue.
- Background callbacks (`ProcessGuard`, `Pipeline`) capture `this`/`m_host`; their threads are joined in the dtor before `this` dies — `ProcessGuard::StopWatcher` at line 394, `m_pipeline->Stop()` at 402. **Correction (supersedes earlier note):** `LogTailer` is the exception — it is *not* stopped in the dtor body, and its declaration position (`IpcBridge.h:322`, before the mutexes it locks) makes the synchronous `~LogTailer` join happen *after* those mutexes are destroyed, which is exactly the H3 use-after-free. `Database` access from callbacks is itself mutex-guarded (`Database.cpp:998-1006, 1020-1054, 1179-1183`), but that does not save the destroyed-mutex window in H3.
- Path-traversal containment in `screenshots.open/folder/delete` (`ScreenshotBridge.cpp:197-306`) and `fs.appDataDir` (`ShellBridge.cpp:400-451`) correctly uses `ensureWithinBase` + `weakly_canonical` + extension allow-list + `SafeRelativeSubdir` (`ShellBridge.cpp:23-54`).
- No host-object exposure: no `AddHostObjectToScript` / `put_AreHostObjectsAllowed` anywhere in `src/host/` (grep clean). IPC is postMessage-only.
- Plugin origin gate: plugin frames can only reach `plugin.rpc` (`IpcBridge.cpp:458-465`, `PluginReachableMethods` at 298-304); `plugin.rpc` enforces `CanInvoke` and blocks `plugin.*` recursion (`PluginBridge.cpp:296-335`, `PluginRegistry.cpp:153-175`).
- DevTools/context menus disabled in release builds (`WebViewHost.cpp:233-238`).

---

## Area health (3 bullets)

- Threading marshaling is genuinely solid (uniformly UI-thread-correct worker→UI hops, race-safe async drain, full exception containment on every detached path), but the lifetime story has one real hole: `m_logTailer` is left running through dtor member-teardown (H3), a shutdown-time use-after-free that the prior pass mis-cleared.
- The WebView2 containment edge is the other weak area: missing `NewWindowRequested`/`NavigationStarting` handlers (H1) leave navigation/popups ungated, and `shell.openUrl` (H2) gives plugins a coarse-grained authenticated account action plus arbitrary protocol launches.
- Input validation is mostly robust (defensive `JsonStringField`/`value()` patterns dominate, no host-object exposure, no token/secret leakage), but plugin-reachable `fs.*` methods lack base-path confinement (M2/M3) and error strings echo absolute paths back to untrusted frames (L2).
