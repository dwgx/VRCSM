import i18n from "i18next";
import type { Resource } from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// en is the fallback locale and the guaranteed first-paint locale, so it is
// bundled eagerly and registered synchronously in init(). Every other locale
// is fetched on demand via a per-code dynamic import() so rollup emits one
// chunk per locale and the main app bundle drops the ~700KB of translation
// JSON it used to inline.
import en from "./locales/en.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", native: "English" },
  { code: "ja", label: "Japanese", native: "日本語" },
  { code: "ko", label: "Korean", native: "한국어" },
  { code: "ru", label: "Russian", native: "Русский" },
  { code: "th", label: "Thai", native: "ไทย" },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
  { code: "zh-CN", label: "Simplified Chinese", native: "简体中文" },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]["code"];
type LazyLanguage = Exclude<SupportedLanguage, "en">;

const LS_KEY = "vrcsm.language";

// Literal import() per code — do NOT template the path, or rollup would bundle
// every locale back into one chunk and defeat the split.
const LOADERS: Record<LazyLanguage, () => Promise<{ default: Resource }>> = {
  ja: () => import("./locales/ja.json"),
  ko: () => import("./locales/ko.json"),
  ru: () => import("./locales/ru.json"),
  th: () => import("./locales/th.json"),
  hi: () => import("./locales/hi.json"),
  "zh-CN": () => import("./locales/zh-CN.json"),
};

const SUPPORTED_CODES = new Set<string>(SUPPORTED_LANGUAGES.map((l) => l.code));

// Guards against re-adding a bundle. en is always present after init().
const loaded = new Set<SupportedLanguage>(["en"]);
// Dedupe concurrent loads of the same locale (rapid switches).
const inflight = new Map<LazyLanguage, Promise<void>>();

const initPromise = i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
    },
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: LS_KEY,
      caches: ["localStorage"],
    },
  });

/**
 * Normalize whatever the detector resolved (which may be a regional variant
 * like "en-US" or "ja-JP", or an unsupported code) to a supported code, or
 * "en" as the fallback. zh-CN stays region-specific on purpose.
 */
export function resolveSupportedLanguage(raw: string | undefined): SupportedLanguage {
  if (!raw) return "en";
  if (SUPPORTED_CODES.has(raw)) return raw as SupportedLanguage;
  const base = raw.split("-")[0];
  const match = SUPPORTED_LANGUAGES.find((l) => l.code === base);
  return match ? (match.code as SupportedLanguage) : "en";
}

/**
 * Fetch and register a locale's resource bundle. Does NOT change the active
 * language. en (and any already-loaded code) resolves immediately.
 */
export function loadLanguage(code: SupportedLanguage): Promise<void> {
  if (code === "en" || loaded.has(code)) return Promise.resolve();
  const lazy = code as LazyLanguage;
  const pending = inflight.get(lazy);
  if (pending) return pending;

  const task = LOADERS[lazy]()
    .then((mod) => {
      if (!loaded.has(code)) {
        i18n.addResourceBundle(code, "translation", mod.default, true, true);
        loaded.add(code);
      }
    })
    .finally(() => {
      inflight.delete(lazy);
    });

  inflight.set(lazy, task);
  return task;
}

/**
 * Load the target locale's bundle (if needed) THEN switch to it, so i18next
 * emits 'languageChanged' with the resources already present — no raw-key
 * flash on switch.
 */
export function changeLanguage(lng: SupportedLanguage): Promise<unknown> {
  return loadLanguage(lng).then(() => i18n.changeLanguage(lng));
}

/**
 * Resolves once the initially detected/stored locale is ready to render.
 * en resolves fast (no fetch); a non-en stored language awaits its single
 * chunk so the first paint has real strings, not a flash of English.
 *
 * IMPORTANT: we must AWAIT the init() promise before reading
 * `i18n.resolvedLanguage`. init() is not synchronous — reading the resolved
 * language in the same tick can still see the "en" fallback before the
 * LanguageDetector has applied the stored `vrcsm.language` value, which made
 * a saved non-en locale (e.g. zh-CN) silently reset to English on every
 * launch until the user re-picked it by hand.
 */
export const i18nReady: Promise<void> = (async () => {
  await initPromise;

  // The persisted choice is the source of truth. Read vrcsm.language directly
  // rather than trusting i18n.resolvedLanguage, which can still report the "en"
  // fallback right after init() (detector timing / caching) — that mismatch is
  // what silently reset a saved locale to English on every launch.
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(LS_KEY);
  } catch {
    // localStorage may be unavailable (tests / constrained WebView); fall
    // through to whatever the detector resolved.
  }

  const detected = i18n.resolvedLanguage ?? i18n.language;
  const target = resolveSupportedLanguage(stored ?? detected);
  if (target === "en") return;
  await changeLanguage(target);
})();

export default i18n;
