// Experimental feature flags — opt-in toggles for in-progress or
// resource-intensive features that shouldn't burden every user.
//
// Flags persist in localStorage (via ui-prefs). They're read on the
// frontend only; the C++ host always loads the underlying infrastructure
// (sqlite-vec, etc.) so toggling is purely a UI gate — no restart needed,
// no host-side state churn.

import { useUiPrefBoolean } from "./ui-prefs";

export interface ExperimentalFlag {
  key: string;
  nameKey: string;
  descriptionKey: string;
  warningKey?: string;
  defaultValue: boolean;
}

// ── Flag registry ─────────────────────────────────────────────────────
// Add new experimental features here. Every flag must have a stable
// localStorage key prefixed with `vrcsm:experimental:` so it's easy to
// grep and so factoryReset can sweep them. name/description/warning live
// in the i18n bundle under settings.experimental.flags.<id>.

export const EXPERIMENTAL_FLAGS: readonly ExperimentalFlag[] = [
  {
    key: "vrcsm:experimental:avatarVisualSearch",
    nameKey: "settings.experimental.flags.avatarVisualSearch.name",
    descriptionKey: "settings.experimental.flags.avatarVisualSearch.description",
    warningKey: "settings.experimental.flags.avatarVisualSearch.warning",
    defaultValue: false,
  },
] as const;

export const FLAG_AVATAR_VISUAL_SEARCH = EXPERIMENTAL_FLAGS[0].key;

/**
 * Hook for reading/writing an experimental flag. Thin wrapper over
 * useUiPrefBoolean that enforces the flag registry — passing an unknown
 * key will console.warn in development so we don't silently drop flags.
 */
export function useExperimentalFlag(key: string) {
  const flag = EXPERIMENTAL_FLAGS.find((f) => f.key === key);
  const fallback = flag?.defaultValue ?? false;
  if (!flag && import.meta.env.DEV) {
    console.warn(`[experimental] unknown flag key: ${key}`);
  }
  return useUiPrefBoolean(key, fallback);
}
