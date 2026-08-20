import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { subscribePipelineEvent } from "./pipeline-events";
import { useAuth } from "./auth-context";
import { ipc } from "./ipc";
import { readUiPrefBoolean, readUiPrefString } from "./ui-prefs";

// ─────────────────────────────────────────────────────────────────────────
// Text-to-speech announcements — reusable domain module.
//
// Host SAPI (`tts.speak` / Pipeline callback) is the primary engine so
// announcements still work when the SPA is minimized to tray. Web Speech
// remains the fallback when `tts.status.engine` is `"none"`.
//
// Default OFF: nothing is spoken until the user opts in under Settings.
// Pref keys `vrcsm.notify.tts.enabled` / `.scope` are unchanged.
// ─────────────────────────────────────────────────────────────────────────

export const TTS_PREF_ENABLED = "vrcsm.notify.tts.enabled";
export const TTS_PREF_SCOPE = "vrcsm.notify.tts.scope";
export const TTS_PREF_CHATBOX = "vrcsm.notify.tts.chatbox";

export type TtsScope = "all" | "friends";
export type TtsEngine = "sapi" | "none" | "unknown";
export type TtsPhraseKind = "friendOnline" | "invite" | "friendRequest";

export interface TtsVoiceInfo {
  id: string;
  name: string;
  lang: string;
}

export interface TtsPhraseFields {
  displayName?: string | null;
  senderUsername?: string | null;
  userId?: string | null;
}

/** Host engine cache. `unknown` until the first `tts.status` probe. */
let hostEngine: TtsEngine = "unknown";

export function getHostTtsEngine(): TtsEngine {
  return hostEngine;
}

export function setHostTtsEngine(engine: TtsEngine): void {
  hostEngine = engine;
}

/** True when SAPI or the Web Speech API can produce audio. */
export function isTtsSupported(): boolean {
  if (hostEngine === "sapi") return true;
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Page-side Web Speech is skipped when the host already owns the engine. */
export function shouldSpeakInPage(engine: TtsEngine = hostEngine): boolean {
  return engine !== "sapi";
}

export function formatTtsPhrase(
  kind: TtsPhraseKind,
  fields: TtsPhraseFields,
): string | null {
  // Never interpolate userId — phrases are display names only.
  if (kind === "friendOnline") {
    const name = fields.displayName?.trim();
    if (!name) return null;
    return `${name} is now online`;
  }
  const who = fields.senderUsername?.trim() || "Someone";
  if (kind === "invite") return `Invite from ${who}`;
  if (kind === "friendRequest") return `Friend request from ${who}`;
  return null;
}

/**
 * Speak a phrase, best-effort. No-ops when unsupported. Cancels any in-flight
 * utterance first so a burst of events (mass friend-online on login) doesn't
 * queue a minute of backlogged speech — the latest event wins.
 *
 * When the host engine is SAPI this is a no-op: the Pipeline callback already
 * spoke. Tests pin this gate via `setHostTtsEngine("sapi")`.
 */
export function speak(text: string, lang?: string): void {
  if (!text) return;
  if (!shouldSpeakInPage()) return;
  if (!isTtsSupported()) return;
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
  chatbox: boolean;
}

function readTtsPrefs(): TtsPrefs {
  const scope = readUiPrefString(TTS_PREF_SCOPE, "friends");
  return {
    enabled: readUiPrefBoolean(TTS_PREF_ENABLED, false),
    scope: scope === "all" ? "all" : "friends",
    chatbox: readUiPrefBoolean(TTS_PREF_CHATBOX, false),
  };
}

function pushTtsHostPrefs(prefs: TtsPrefs = readTtsPrefs()): void {
  void ipc
    .notifySetPrefs({
      ttsEnabled: prefs.enabled,
      ttsScope: prefs.scope,
      ttsChatbox: prefs.chatbox,
    })
    .catch((err) => {
      console.warn("[tts] notify.setPrefs failed", err);
    });
}

const UI_PREF_CHANGED_EVENT = "vrcsm:ui-pref-changed";
const TTS_PREF_KEYS = new Set<string>([TTS_PREF_ENABLED, TTS_PREF_SCOPE, TTS_PREF_CHATBOX]);

/**
 * Mount once at the app shell, next to useStrangerAlert(). Subscribes to the
 * pipeline bus and speaks friend-online and incoming-notification events when
 * enabled AND the host engine is not SAPI (host already spoke). Prefs are read
 * live so toggling in Settings takes effect without a remount.
 */
export function useTtsAnnounce(): void {
  const { t, i18n } = useTranslation();
  const { status } = useAuth();
  const prefsRef = useRef<TtsPrefs>(readTtsPrefs());
  const engineRef = useRef<TtsEngine>(hostEngine);

  useEffect(() => {
    const refresh = () => {
      prefsRef.current = readTtsPrefs();
      pushTtsHostPrefs(prefsRef.current);
    };
    refresh();
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
    let cancelled = false;
    void ipc
      .ttsStatus()
      .then((s) => {
        if (cancelled) return;
        const next: TtsEngine = s.engine === "sapi" ? "sapi" : "none";
        setHostTtsEngine(next);
        engineRef.current = next;
      })
      .catch(() => {
        if (cancelled) return;
        setHostTtsEngine("none");
        engineRef.current = "none";
      });
    return () => {
      cancelled = true;
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
      // Skip while probing (`unknown`) so we never double-speak with SAPI.
      if (engineRef.current === "unknown" || !shouldSpeakInPage(engineRef.current)) return;
      const name = content?.user?.displayName;
      if (!name) return;
      if (!formatTtsPhrase("friendOnline", { displayName: name, userId: content?.userId })) return;
      speak(t("tts.friendOnline", { name, defaultValue: "{{name}} is now online" }), lang);
    });

    const speakNotification = (content: {
      type?: string;
      senderUsername?: string;
      senderUserId?: string;
    } | null) => {
      if (!prefsRef.current.enabled || prefsRef.current.scope !== "all") return;
      if (engineRef.current === "unknown" || !shouldSpeakInPage(engineRef.current)) return;
      if (!content?.type) return;
      if (content.type === "invite" || content.type === "requestInvite") {
        const who = content.senderUsername ?? t("tts.someone", { defaultValue: "Someone" });
        if (!formatTtsPhrase("invite", { senderUsername: who, userId: content.senderUserId })) return;
        speak(t("tts.invite", { who, defaultValue: "Invite from {{who}}" }), lang);
      } else if (content.type === "friendRequest") {
        const who = content.senderUsername ?? t("tts.someone", { defaultValue: "Someone" });
        if (!formatTtsPhrase("friendRequest", { senderUsername: who, userId: content.senderUserId })) return;
        speak(
          t("tts.friendRequest", { who, defaultValue: "Friend request from {{who}}" }),
          lang,
        );
      }
    };
    const unsubNotif = subscribePipelineEvent<{
      type?: string;
      senderUsername?: string;
      senderUserId?: string;
    }>("notification", speakNotification);
    const unsubNotifV2 = subscribePipelineEvent<{
      type?: string;
      senderUsername?: string;
      senderUserId?: string;
    }>("notification-v2", speakNotification);

    return () => {
      unsubOnline();
      unsubNotif();
      unsubNotifV2();
    };
  }, [status.authed, i18n.language, t]);
}
