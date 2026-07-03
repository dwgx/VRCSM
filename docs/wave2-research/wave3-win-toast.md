# Wave 3 — Native Windows Toast Notifications (win-toast) — research spec

Read-only research. No source files were edited. Date: 2026-06-29.
Ground truth consulted: `docs/wave2-research/wave3-impl-facts.md`.

Goal: raise native Windows toast notifications from VRCSM's C++ host (no Electron, no
web Notification API), fed by friend-online / invite / friend-request events that already
flow through the Pipeline. Stack stays C++20 + Win32/WinRT.

---

## 1. The hard constraint for unpackaged apps (verified)

VRCSM is an **unpackaged** Win32 app (perUser MSI / portable ZIP, no MSIX, no package
identity). For an unpackaged desktop app:

- Toasts are raised through `Windows.UI.Notifications.ToastNotificationManager`.
- You **must** call `CreateToastNotifier(aumid)` with an explicit **AppUserModelID (AUMID)**
  on every call — the parameterless `CreateToastNotifier()` is for apps with package
  identity, which we do not have.
- **A Start-menu shortcut (.lnk) carrying `System.AppUserModel.ID` set to the same AUMID
  must exist** before any toast can appear. Microsoft is explicit: *"Without a valid
  shortcut installed in the Start screen or in All Programs, you cannot raise a toast
  notification from a desktop app."*
  ([enable-desktop-toast-with-appusermodelid](https://learn.microsoft.com/en-us/windows/win32/shell/enable-desktop-toast-with-appusermodelid))
- The shortcut's AUMID and the AUMID passed to `CreateToastNotifier` must match exactly,
  or the toast silently fails to show.
  ([quickstart-sending-desktop-toast](https://learn.microsoft.com/en-us/windows/win32/shell/quickstart-sending-desktop-toast))

Sources verified:
- https://learn.microsoft.com/en-us/windows/win32/shell/enable-desktop-toast-with-appusermodelid
- https://learn.microsoft.com/en-us/windows/win32/shell/quickstart-sending-desktop-toast
- https://learn.microsoft.com/en-us/windows/apps/design/shell/tiles-and-notifications/toast-desktop-apps
- https://learn.microsoft.com/en-us/windows/apps/develop/notifications/ (notes the legacy
  `Windows.UI.Notifications` path "works in UWP apps and may work in some desktop scenarios";
  the modern Windows App SDK `AppNotificationManager` is the newer-recommended path but pulls
  in the WinAppSDK dependency — see §6 tradeoffs).

---

## 2. Three candidate approaches and the recommendation

| Approach | Identity/shortcut needed | XML/rich toast | New dependency | Verdict |
|---|---|---|---|---|
| **A. WinRT `ToastNotificationManager` + AUMID + shortcut** | Yes — `.lnk` with `System.AppUserModel.ID` | Yes (full toast XML, actions, images) | None — Windows SDK only | **Recommended primary** |
| **B. `Shell_NotifyIcon` balloon (NIF_INFO)** | No (uses the existing tray/window) | No — title + text only, deprecated look, OS may suppress | None | **Fallback only** |
| **C. Windows App SDK `AppNotificationManager`** | Yes + COM activator registration | Yes, modern | Adds WindowsAppSDK runtime (heavy, against "thin shell") | **Rejected** for VRCSM |

**Recommendation: Approach A.** It needs no third-party dependency (the WinRT
`windows.ui.notifications.h` headers ship in the installed Windows SDK — verified present at
`D:/Windows Kits/10/Include/10.0.28000.0/winrt/windows.ui.notifications.h`, with `roapi.h`,
`NotificationActivationCallback.h`, `ShObjIdl_core.h`, `propkey.h`, `propvarutil.h` all in the
same SDK). It produces real Action Center toasts that match VRCX's behaviour. The only cost is
shortcut + AUMID registration, which we already have install-time and first-run hooks for.

VRCSM does **not** currently create a tray icon via `Shell_NotifyIcon` (no existing
`NIF_*` / `Shell_NotifyIcon` usage found in `src/`), so Approach B would require standing up a
tray icon first. Keep B as a documented degraded fallback if `RoActivateInstance` / toast
creation fails (e.g. notifications disabled by group policy), surfaced as a log warning, not as
a hard error.

---

## 3. AUMID + shortcut registration (where and how)

### AUMID value
Pick a stable, reverse-DNS-ish string and reuse it everywhere: **`dwgx.VRCSM`** (matches the
WiX `Manufacturer="dwgx"` and existing registry path `Software\dwgx\VRCSM` in
`installer/vrcsm.wxs:72`). Define it once as a constant, e.g. `kVrcsmAumid = L"dwgx.VRCSM"`.

### 3a. Process AUMID at startup (required)
Call **`SetCurrentProcessExplicitAppUserModelID(L"dwgx.VRCSM")`** very early in
`wWinMain` (`src/host/main.cpp:22`, before `App app; app.Run(...)` at line 43) so the running
process is associated with the same AUMID as the shortcut. This is what lets Windows attribute
the toast (icon, app name) and route activation back. (`shobjidl_core.h`, link `shell32`.)

### 3b. The shortcut (two install paths — both must set the AUMID)

**MSI path (`installer/vrcsm.wxs`):** the Start-menu shortcut already exists
(`VRCSMStartMenuShortcut`, lines 64–69). It is currently **missing the AUMID property**. Add a
`System.AppUserModel.ID` shortcut property so toasts work for MSI installs. In WiX v4/v7 this is
a child `<ShortcutProperty>` element on the `<Shortcut>`:

```xml
<Shortcut Id="VRCSMStartMenuShortcut" Name="VRCSM" ... Icon="VRCSMIcon">
  <ShortcutProperty Key="System.AppUserModel.ID" Value="dwgx.VRCSM" />
</Shortcut>
```
> UNVERIFIED: exact WiX v7 element name `ShortcutProperty` / attribute casing — confirm against
> the WiX v4+ schema before shipping (the concept and `System.AppUserModel.ID` key are verified;
> the WiX element spelling is not). The Microsoft guidance explicitly recommends setting the
> AUMID in the installer rather than in app code.

**Portable ZIP / first-run path:** ZIP users have no installer, so the host must create the
shortcut itself on first run. Implement `EnsureStartMenuShortcut()` that, if
`%APPDATA%\Microsoft\Windows\Start Menu\Programs\VRCSM.lnk` does not exist, creates it via
`CoCreateInstance(CLSID_ShellLink)` → `IShellLink::SetPath(exePath)` →
`QueryInterface(IPropertyStore)` → `SetValue(PKEY_AppUserModel_ID, <propvariant "dwgx.VRCSM">)`
→ `Commit()` → `IPersistFile::Save(lnkPath, TRUE)`. This is the exact `InstallShortcut` pattern
from the Microsoft sample (verified, reproduced in the fetched doc). Helpers:
`InitPropVariantFromString` (propvarutil.h), `PKEY_AppUserModel_ID` (propkey.h).

> Idempotency: skip creation if the `.lnk` already exists (matches `TryCreateShortcut` in the
> MS sample). Best-effort: log a warning and continue if it fails — mirror the existing
> best-effort posture of `RegisterProtocolHandlers()` in `src/host/UrlProtocol.cpp:123`.

### 3c. Activation (clicking the toast)
For VRCSM's needs (friend online / invite / friend request), a **foreground-only** activation is
enough: when a toast is clicked while the app is running, bring the window to front and route to
a relevant view. The simplest verified path is to subscribe to the `ToastNotification.Activated`
event on the live `IToastNotification` (the toast object we created) and, in the handler, call
`SetForegroundWindow` on the main HWND and optionally navigate the SPA via the existing
`vrcsm://` route plumbing (`UriToRoute` in `UrlProtocol.cpp`).

Full **background/relaunch activation** (toast clicked when app is closed) additionally requires
a registered COM activator implementing `INotificationActivationCallback`
(`NotificationActivationCallback.h`) plus a CLSID registered under the shortcut's
`System.AppUserModel.ToastActivatorCLSID` and HKCU `Software\Classes\CLSID\{guid}\LocalServer32`.

> RECOMMENDATION: ship Phase 1 with **foreground activation only** (no COM activator). Mark
> background-relaunch activation as a follow-up, flag-gated-dark, with a TODO — it is materially
> more code (COM server registration + class factory) and not required for the online/invite use
> case where the app is typically already running. Do NOT invent the activator registration; if
> built later, verify the CLSID/registry shape against the live MS sample first.

---

## 4. Toast XML template (verified)

`ToastNotificationManager.GetTemplateContent(ToastTemplateType.<T>)` returns an `XmlDocument`
you fill in. For text-only friend/invite/request toasts use **`ToastText02`** (one bold heading
line + one wrapped body line). The resulting XML is:

```xml
<toast>
  <visual>
    <binding template="ToastText02">
      <text id="1">{title}</text>
      <text id="2">{body}</text>
    </binding>
  </visual>
</toast>
```

To carry a click payload, add a `launch` attribute on `<toast launch="vrcsm://user/usr_abc">`
(an activation arg string; consumed in the `Activated` handler). For an avatar/user thumbnail,
`ToastImageAndText04` works but **only local absolute image paths** are allowed (`file:///...`)
— web image URLs are NOT supported for desktop toasts (verified). Friend thumbnails are remote,
so either (a) skip the image, or (b) reuse the existing image-cache to resolve a local file path
first. Phase 1: text-only (`ToastText02`), no image.

Modern alternative: hand-build a `ToastGeneric` XML string and load it via
`XmlDocument::LoadXml` instead of `GetTemplateContent` — gives richer layouts/buttons. Either
works through the same `ToastNotification(xmlDoc)` constructor.

---

## 5. Where it lives + C++ sketch

### Location
New core module: **`src/core/ToastNotifier.{h,cpp}`**.
- Add `ToastNotifier.cpp` to the `vrcsm_core` source list in `src/core/CMakeLists.txt`
  (alongside `DiscordRpc.cpp`, line ~30).
- This module touches Win32/WinRT (`RoActivateInstance`, `IShellLink`), which is allowed: the
  CLAUDE.md core rule says core has "zero Win32 deps **except** junction/process modules" — this
  is an OS-integration module in the same spirit as `ProcessGuard`/`Migrator`/`DiscordRpc`
  (`DiscordRpc.cpp` already includes `<Windows.h>` — verified at `DiscordRpc.cpp:11`). It is a
  fire-and-forget side channel exactly like `DiscordRpc`.
- Link libs (host or core target): `runtimeobject.lib` (RoActivateInstance/RoGetActivationFactory),
  `shell32.lib` / `shlwapi.lib`, `ole32.lib`. `propsys` for the property store. Confirm against
  whatever the host already links (WebView2/wil pull most of these in).

### Public API
```cpp
// src/core/ToastNotifier.h
#pragma once
#include <string>
#include <optional>

namespace vrcsm::core {

// Fire-and-forget native Windows toast. No-throw; logs+returns false on any
// failure (notifications disabled, RoActivateInstance fail, missing shortcut).
// Requires SetCurrentProcessExplicitAppUserModelID + a Start-menu shortcut
// carrying the same AUMID to have run first (see ToastNotifier::EnsureSetup).
class ToastNotifier {
public:
    // Idempotent setup: sets the process AUMID and creates the Start-menu
    // .lnk with System.AppUserModel.ID if it does not already exist.
    // Call once at startup. Best-effort; returns false on failure.
    static bool EnsureSetup();

    // Show a text toast. launchArg (optional) is placed on the toast's
    // `launch` attribute so the Activated handler can route (e.g.
    // "vrcsm://user/usr_abc"). Returns false if the toast could not be shown.
    static bool ShowToast(const std::wstring& title,
                          const std::wstring& body,
                          const std::optional<std::wstring>& launchArg = std::nullopt);
};

} // namespace vrcsm::core
```

### Implementation sketch (WRL + WinRT activation factories)
```cpp
// src/core/ToastNotifier.cpp  (sketch — verify every interface/IID before shipping)
#include "ToastNotifier.h"
#include <Windows.h>
#include <wrl/client.h>
#include <wrl/wrappers/corewrappers.h>
#include <windows.ui.notifications.h>   // SDK WinRT header (verified present)
#include <windows.data.xml.dom.h>
#include <roapi.h>
#include <shobjidl_core.h>
#include <propkey.h>
#include <propvarutil.h>
#include <spdlog/spdlog.h>

using namespace Microsoft::WRL;
using namespace Microsoft::WRL::Wrappers;
using namespace ABI::Windows::UI::Notifications;
using namespace ABI::Windows::Data::Xml::Dom;

namespace {
constexpr wchar_t kAumid[] = L"dwgx.VRCSM";

HRESULT FillText(IXmlDocument* xml, const std::wstring& title, const std::wstring& body);
HRESULT CreateShortcutIfMissing();  // IShellLink + IPropertyStore(PKEY_AppUserModel_ID)
}

bool vrcsm::core::ToastNotifier::EnsureSetup() {
    HRESULT hr = SetCurrentProcessExplicitAppUserModelID(kAumid);  // shell32
    if (FAILED(hr)) spdlog::warn("[toast] SetAUMID failed: {:#x}", (unsigned)hr);
    hr = CreateShortcutIfMissing();   // best-effort, idempotent
    return SUCCEEDED(hr);
}

bool vrcsm::core::ToastNotifier::ShowToast(const std::wstring& title,
                                           const std::wstring& body,
                                           const std::optional<std::wstring>& launchArg) {
    // RoInitialize once per thread (or rely on existing OleInitialize/COM apartment).
    // 1. Get IToastNotificationManagerStatics activation factory:
    ComPtr<IToastNotificationManagerStatics> mgr;
    HRESULT hr = RoGetActivationFactory(
        HStringReference(RuntimeClass_Windows_UI_Notifications_ToastNotificationManager).Get(),
        IID_PPV_ARGS(&mgr));
    if (FAILED(hr)) { spdlog::warn("[toast] no manager: {:#x}", (unsigned)hr); return false; }

    // 2. Template -> XmlDocument
    ComPtr<IXmlDocument> xml;
    hr = mgr->GetTemplateContent(ToastTemplateType_ToastText02, &xml);
    if (FAILED(hr)) return false;
    FillText(xml.Get(), title, body);                 // set <text id=1/2>
    // if (launchArg) set <toast launch="..."> attribute on the root element.

    // 3. Build IToastNotification from a IToastNotificationFactory
    ComPtr<IToastNotificationFactory> factory;
    hr = RoGetActivationFactory(
        HStringReference(RuntimeClass_Windows_UI_Notifications_ToastNotification).Get(),
        IID_PPV_ARGS(&factory));
    if (FAILED(hr)) return false;
    ComPtr<IToastNotification> toast;
    hr = factory->CreateToastNotification(xml.Get(), &toast);
    if (FAILED(hr)) return false;

    // (optional) toast->add_Activated(...) -> SetForegroundWindow + route via vrcsm://

    // 4. CreateToastNotifier(AUMID) — AUMID is REQUIRED for unpackaged apps
    ComPtr<IToastNotifier> notifier;
    hr = mgr->CreateToastNotifierWithId(HStringReference(kAumid).Get(), &notifier);
    if (FAILED(hr)) { spdlog::warn("[toast] CreateToastNotifier: {:#x}", (unsigned)hr); return false; }

    hr = notifier->Show(toast.Get());
    return SUCCEEDED(hr);
}
```

> UNVERIFIED specifics to confirm during implementation (do NOT guess — check the SDK header
> `windows.ui.notifications.h` and the MS WRL sample):
> - Exact method name `CreateToastNotifierWithId` vs `CreateToastNotifier` in the ABI vtable
>   (WinRT overloads get suffixed `WithId` in C ABI — verify in the header).
> - The `RuntimeClass_Windows_UI_Notifications_*` macro names (from `windows.ui.notifications.h`).
> - Whether the host already initializes COM as MTA/STA: `main.cpp:30` calls `OleInitialize`
>   (STA). WinRT toast creation works from STA; confirm no `RoInitialize` apartment clash. If a
>   dedicated thread is used, `RoInitialize(RO_INIT_MULTITHREADED)` there instead.
> - XML text insertion: `GetElementsByTagName(L"text")` → per-node `AppendChild(CreateTextNode())`
>   (verified pattern in MS sample, but the ABI `IXmlDocument`/`IXmlNodeList` calls are verbose —
>   reproduce from the WRL sample rather than improvising).

---

## 6. Tradeoffs (Approach A)

- **Pro:** no new dependency; uses the in-box Windows SDK WinRT projection; real Action Center
  toasts; matches VRCX UX; works on the locked stack.
- **Con / cost:** requires the AUMID shortcut to exist (one-time install/first-run setup); if the
  user deletes the Start-menu shortcut, toasts silently stop (degrade to log warning). The ABI
  WRL code is verbose and easy to get wrong — copy the verified MS sample shapes, don't improvise
  IIDs.
- **Why not Windows App SDK (C):** `AppNotificationManager` is the newer Microsoft-recommended
  API, but it drags in the Windows App SDK runtime — a heavyweight redistributable that conflicts
  with VRCSM's "thin shell, no extra runtimes" posture and the locked-stack philosophy. Reject.
- **Why not balloon (B):** `Shell_NotifyIcon` balloons are visually dated, the OS frequently
  routes them into Action Center or suppresses them under Focus Assist, and VRCSM has no tray
  icon today. Keep only as a last-resort fallback.

---

## 7. Wiring: feeding it friend-online / invite / friend-request

The events already arrive in the host on the Pipeline thread and are forwarded to the UI via
`PostEventToUi("pipeline.event", {type, content})` (`src/host/bridges/PipelineBridge.cpp:59-69`,
verified). Two viable wiring designs:

### Design 1 (recommended): host-side, in the Pipeline event lambda
In `HandlePipelineStart`'s `onEvent` lambda (`PipelineBridge.cpp:60`), after the existing
`PostEventToUi`, inspect `type` and call `ToastNotifier::ShowToast(...)` for the toast-worthy
types. This keeps the native side self-contained and works even if the WebView is backgrounded.

Toast-worthy Pipeline types (from `web/src/lib/pipeline-events.ts:20`, verified):
- `friend-online` → title = display name, body = "is now online" (+ world if present in content).
- `notification` / `notification-v2` where inner `content.type == "invite"` → "Invite from X".
- `notification` / `notification-v2` where inner `content.type == "friendRequest"` → "Friend request from X".

Extract the display name / message from the parsed `content` JSON (already an object, not a
string — the bridge unwraps it). Build `std::wstring` via the existing `Utf8ToWide` helper
(`src/host/StringUtil.h`). Set `launchArg` to `vrcsm://user/<userId>` so a click routes to the
profile (reuses `UriToRoute`).

> Respect the user toggle (below) and the API/rate posture: these are push events (no polling),
> so the ≤1/60s API rule is not engaged. Do not poll to synthesize toasts.

### Design 2: new IPC method `notify.show` (frontend-triggered)
If product wants the React layer to decide when to toast (e.g. honour in-app mute/DND state),
add a sync IPC `notify.show {title, body, launch?}` following the wave3-impl-facts 5-step
pattern: allowlist string in `IpcBridge.cpp` (~line 142–187 block), register in
`RegisterHandlers()` (`IpcBridge.cpp:586`), declare `HandleNotifyShow` in `IpcBridge.h`, implement
in a bridge (ShellBridge.cpp is the natural home for an OS call), and expose a typed wrapper from a
`web/src/lib` domain module (e.g. a new `notifications.ts` or existing `pipeline-events`-adjacent
module) — NOT in a page. The frontend already has all event reducers
(`useFriendsPipelineSync.ts`, `NotificationsInbox.tsx`), so it can call `ipc.notifyShow(...)`
from its existing subscribers.

**Recommendation:** ship **Design 1** for reliability (fires even when WebView is idle), and add a
user-facing on/off toggle. Optionally layer Design 2 later for fine-grained per-type control.

### User toggle (privacy / preference)
Gate toasts behind a preference. Two existing patterns:
- `web/src/lib/ui-prefs.ts` (localStorage UI prefs) for a simple "Desktop notifications" on/off
  in Settings — but a localStorage flag is not visible to the C++ Pipeline lambda (Design 1).
- For Design 1, the cleanest is a host-readable setting: persist the toggle to a small store the
  host can read (e.g. via an existing settings bridge / IPC that pushes the bool into IpcBridge),
  OR keep the toast decision in the frontend (Design 2). Simplest correct v1: default ON, with the
  toggle pushed host-side via a tiny `notify.setEnabled {enabled}` IPC, stored as an atomic bool
  on IpcBridge that the Pipeline lambda checks before calling ShowToast.

> Default ON is acceptable for desktop social notifications, but make the toggle reachable in
> Settings and document it. Windows itself also lets the user disable VRCSM toasts in OS settings
> once the AUMID is registered.

---

## 8. Verification checklist (for the impl agent — must end GREEN)

- C++ build target `vrcsm` + `VRCSM_Tests` via vcvars64 → cmake --build (release).
- Run `build/x64-release/tests/VRCSM_Tests.exe`. No new log-atom touchpoints here (this is host
  integration, not a log atom), so no golden-line test is required — but if any text parsing of
  Pipeline content is added to core, cover it.
- Web: `cd web && npx tsc --noEmit && npx vitest run && npx vite build` (needed if Design 2 IPC
  wrapper or a Settings toggle is added).
- Manual smoke (cannot be unit-tested): trigger a `friend-online` and confirm an Action Center
  toast appears; confirm it does NOT appear if the Start-menu shortcut/AUMID is absent (proves
  the registration requirement).

---

## 9. Open / UNVERIFIED items (do not invent)

1. WiX v7 `ShortcutProperty` element spelling — verify against the installed WiX v7 schema.
2. ABI method name `CreateToastNotifierWithId` and `RuntimeClass_*` macros — read from
   `D:/Windows Kits/10/Include/10.0.28000.0/winrt/windows.ui.notifications.h`.
3. Exact link libraries the host needs to add (most COM/shell libs are already pulled by wil /
   WebView2; only `runtimeobject.lib` is likely new).
4. COM activator (`INotificationActivationCallback`) for closed-app relaunch — deliberately left
   out of Phase 1; flag-gated-dark + TODO if pursued.
5. The friend-online `content` JSON shape (does it carry world/instance for the body line?) —
   confirm against a live Pipeline payload or `VrcApi`/pipeline-events typing before formatting
   the body text; do not assume fields.
