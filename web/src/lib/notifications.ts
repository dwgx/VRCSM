import { useEffect } from "react";
import { ipc } from "./ipc";
import { readUiPrefBoolean } from "./ui-prefs";

// ─────────────────────────────────────────────────────────────────────────
// Desktop toast notifications — reusable domain module.
//
// The native host (src/core/ToastNotifier) raises Action Center toasts for
// friend-online / invite / friend-request Pipeline events. Whether each
// type actually shows is gated host-side by per-type flags the host cannot
// read from localStorage on its socket thread — so this module owns the
// user toggles (default OFF) and pushes them down via `notify.setPrefs`.
//
// Default OFF: nothing toasts until the user opts in under Settings.
// ─────────────────────────────────────────────────────────────────────────

export const NOTIFY_PREF_FRIEND_ONLINE = "vrcsm.notify.toast.friendOnline";
export const NOTIFY_PREF_INVITE = "vrcsm.notify.toast.invite";
export const NOTIFY_PREF_FRIEND_REQUEST = "vrcsm.notify.toast.friendRequest";
// Master toggle: also mirror the enabled toast events into the headset via an
// SteamVR overlay (XSOverlay). Layered on top of the per-event toggles above —
// an event reaches VR only when its toast type is on AND this is on.
export const NOTIFY_PREF_VR_OVERLAY = "vrcsm.notify.vrOverlay";

export interface ToastPrefs {
  friendOnline: boolean;
  invite: boolean;
  friendRequest: boolean;
  vrOverlay: boolean;
}

/** Read all toggles from local UI prefs (default OFF). */
export function readToastPrefs(): ToastPrefs {
  return {
    friendOnline: readUiPrefBoolean(NOTIFY_PREF_FRIEND_ONLINE, false),
    invite: readUiPrefBoolean(NOTIFY_PREF_INVITE, false),
    friendRequest: readUiPrefBoolean(NOTIFY_PREF_FRIEND_REQUEST, false),
    vrOverlay: readUiPrefBoolean(NOTIFY_PREF_VR_OVERLAY, false),
  };
}

/** Push the current toggles to the native host. Best-effort. */
export function pushToastPrefs(prefs: ToastPrefs = readToastPrefs()): void {
  void ipc.notifySetPrefs(prefs).catch((err) => {
    console.warn("[notify] notify.setPrefs failed", err);
  });
}

const UI_PREF_CHANGED_EVENT = "vrcsm:ui-pref-changed";
const TOAST_PREF_KEYS = new Set<string>([
  NOTIFY_PREF_FRIEND_ONLINE,
  NOTIFY_PREF_INVITE,
  NOTIFY_PREF_FRIEND_REQUEST,
  NOTIFY_PREF_VR_OVERLAY,
]);

/**
 * Mount once at the app shell. Pushes the saved toast toggles to the host
 * on startup, then re-pushes whenever any of the three prefs change (via
 * the ui-pref custom event or cross-tab storage event). Keeps the host's
 * atomic flags in sync with what the user picked in Settings.
 */
export function useToastPrefsSync(): void {
  useEffect(() => {
    // Initial push so the host reflects saved prefs from the previous run.
    pushToastPrefs();

    const onCustom = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (detail?.key && TOAST_PREF_KEYS.has(detail.key)) {
        pushToastPrefs();
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key && TOAST_PREF_KEYS.has(event.key)) {
        pushToastPrefs();
      }
    };

    window.addEventListener(UI_PREF_CHANGED_EVENT, onCustom as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(UI_PREF_CHANGED_EVENT, onCustom as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
}
