import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { subscribePipelineEvent } from "./pipeline-events";
import { useAuth } from "./auth-context";
import { readUiPrefBoolean, readUiPrefString } from "./ui-prefs";

// ─────────────────────────────────────────────────────────────────────────
// Text-to-speech announcements — reusable domain module.
//
// VRCX speaks live social events ("X is now online") through the OS voice so
// you hear them while immersed in VR without reading a toast. We do the same
// with the browser-native Web Speech API (`window.speechSynthesis`) — no C++,
// no host IPC, since WebView2 ships the same SpeechSynthesis the page can use
// directly. The host already raises Action Center toasts for these events
// (see notifications.ts); TTS is a parallel, independently-gated channel.
//
// Default OFF: nothing is spoken until the user opts in under Settings.
// ─────────────────────────────────────────────────────────────────────────

export const TTS_PREF_ENABLED = "vrcsm.notify.tts.enabled";
// Which event classes to speak. Stored as a single string the Settings UI
// cycles through, mirroring how the toast toggles gate per-type. Kept coarse
// (all / friends-only) on purpose — finer per-type control already exists for
// the toast channel and speaking every notification would be noise.
export const TTS_PREF_SCOPE = "vrcsm.notify.tts.scope";

export type TtsScope = "all" | "friends";

/** True when the running WebView/browser exposes the Web Speech API. */
export function isTtsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Speak a phrase, best-effort. No-ops when unsupported. Cancels any in-flight
 * utterance first so a burst of events (mass friend-online on login) doesn't
 * queue a minute of backlogged speech — the latest event wins.
 */
export function speak(text: string, lang?: string): void {
  if (!isTtsSupported() || !text) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (lang) u.lang = lang;
    synth.speak(u);
  } catch (err) {
    console.warn("[tts] speak failed", err);
  }
}

interface TtsPrefs {
  enabled: boolean;
  scope: TtsScope;
}

function readTtsPrefs(): TtsPrefs {
  const scope = readUiPrefString(TTS_PREF_SCOPE, "friends");
  return {
    enabled: readUiPrefBoolean(TTS_PREF_ENABLED, false),
    scope: scope === "all" ? "all" : "friends",
  };
}

const UI_PREF_CHANGED_EVENT = "vrcsm:ui-pref-changed";
const TTS_PREF_KEYS = new Set<string>([TTS_PREF_ENABLED, TTS_PREF_SCOPE]);

/**
 * Mount once at the app shell, next to useStrangerAlert(). Subscribes to the
 * pipeline bus and speaks friend-online and incoming-notification events when
 * enabled. Prefs are read live (held in a ref, refreshed on the ui-pref change
 * event) so toggling in Settings takes effect without a remount.
 */
export function useTtsAnnounce(): void {
  const { t, i18n } = useTranslation();
  const { status } = useAuth();
  const prefsRef = useRef<TtsPrefs>(readTtsPrefs());

  // Keep prefs fresh without re-subscribing the pipeline handlers.
  useEffect(() => {
    const refresh = () => {
      prefsRef.current = readTtsPrefs();
    };
    const onCustom = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (detail?.key && TTS_PREF_KEYS.has(detail.key)) refresh();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key && TTS_PREF_KEYS.has(event.key)) refresh();
    };
    window.addEventListener(UI_PREF_CHANGED_EVENT, onCustom as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(UI_PREF_CHANGED_EVENT, onCustom as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!status.authed) return;
    const lang = i18n.language;

    const unsubOnline = subscribePipelineEvent<{
      userId?: string;
      user?: { displayName?: string };
    }>("friend-online", (content) => {
      if (!prefsRef.current.enabled) return;
      const name = content?.user?.displayName;
      if (!name) return;
      speak(t("tts.friendOnline", { name, defaultValue: "{{name}} is now online" }), lang);
    });

    // Notifications (invites, friend requests). Only spoken in "all" scope —
    // "friends" scope is presence-only to stay quiet.
    const speakNotification = (content: {
      type?: string;
      senderUsername?: string;
    } | null) => {
      if (!prefsRef.current.enabled || prefsRef.current.scope !== "all") return;
      if (!content?.type) return;
      const who = content.senderUsername ?? t("tts.someone", { defaultValue: "Someone" });
      if (content.type === "invite" || content.type === "requestInvite") {
        speak(t("tts.invite", { who, defaultValue: "Invite from {{who}}" }), lang);
      } else if (content.type === "friendRequest") {
        speak(
          t("tts.friendRequest", { who, defaultValue: "Friend request from {{who}}" }),
          lang,
        );
      }
    };
    const unsubNotif = subscribePipelineEvent<{ type?: string; senderUsername?: string }>(
      "notification",
      speakNotification,
    );
    const unsubNotifV2 = subscribePipelineEvent<{ type?: string; senderUsername?: string }>(
      "notification-v2",
      speakNotification,
    );

    return () => {
      unsubOnline();
      unsubNotif();
      unsubNotifV2();
    };
  }, [status.authed, i18n.language, t]);
}
