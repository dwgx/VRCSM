import { useCallback, useSyncExternalStore } from "react";
import { readUiPrefString, writeUiPrefString } from "@/lib/ui-prefs";
import type { VrcStatus } from "@/lib/types";

/**
 * Social status presets — a VRCX-parity quality-of-life feature. Users save
 * named combinations of {status, statusDescription} (e.g. "Grinding" = busy +
 * "in the lab", "Open" = join me + "come hang") and apply them in one click
 * instead of re-typing the description every session.
 *
 * Stored purely client-side as a JSON array under one localStorage key; no C++
 * or VRChat API surface is involved beyond the existing profile-save path the
 * caller already owns. We reuse the ui-prefs change-event bus so the presets
 * list stays in sync across tabs / components.
 */
export interface StatusPreset {
  /** Stable id (timestamp-based) so React keys and deletes are unambiguous. */
  id: string;
  /** User-facing label for the preset chip. */
  label: string;
  status: VrcStatus;
  statusDescription: string;
}

const STORAGE_KEY = "vrcsm.profile.statusPresets";
export const MAX_PRESETS = 12;
export const MAX_LABEL_LEN = 24;
export const MAX_DESC_LEN = 32;

/** Parse the stored JSON into a validated preset array. Never throws. */
export function parsePresets(raw: string): StatusPreset[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: StatusPreset[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id : "";
    const label = typeof rec.label === "string" ? rec.label : "";
    const status = rec.status as VrcStatus;
    const statusDescription =
      typeof rec.statusDescription === "string" ? rec.statusDescription : "";
    // A preset is only usable with a non-empty id + label and a known status.
    if (!id || !label) continue;
    if (!isVrcStatus(status)) continue;
    out.push({ id, label, status, statusDescription });
  }
  return out.slice(0, MAX_PRESETS);
}

const KNOWN_STATUSES: readonly VrcStatus[] = [
  "active",
  "join me",
  "ask me",
  "busy",
  "offline",
];

export function isVrcStatus(value: unknown): value is VrcStatus {
  return typeof value === "string" && (KNOWN_STATUSES as readonly string[]).includes(value);
}

/**
 * Append a preset to a list, enforcing the cap and trimming overlong fields.
 * Pure — returns a new array. De-dupes by identical {label,status,description}
 * so spamming "save" doesn't pile up copies.
 */
export function addPreset(
  existing: StatusPreset[],
  preset: Omit<StatusPreset, "id"> & { id?: string },
): StatusPreset[] {
  const label = preset.label.trim().slice(0, MAX_LABEL_LEN);
  const statusDescription = preset.statusDescription.trim().slice(0, MAX_DESC_LEN);
  if (!label) return existing;
  const dupe = existing.some(
    (p) =>
      p.label === label &&
      p.status === preset.status &&
      p.statusDescription === statusDescription,
  );
  if (dupe) return existing;
  const id = preset.id ?? `sp_${Date.now().toString(36)}_${existing.length}`;
  return [...existing, { id, label, status: preset.status, statusDescription }].slice(
    0,
    MAX_PRESETS,
  );
}

/** Remove a preset by id. Pure. */
export function removePreset(existing: StatusPreset[], id: string): StatusPreset[] {
  return existing.filter((p) => p.id !== id);
}

function serialize(presets: StatusPreset[]): string {
  return JSON.stringify(presets.slice(0, MAX_PRESETS));
}

// ─── React binding ───────────────────────────────────────────────────────────

const CHANGE_EVENT = "vrcsm:ui-pref-changed";

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback();
  window.addEventListener("storage", handler);
  window.addEventListener(CHANGE_EVENT, handler as EventListener);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(CHANGE_EVENT, handler as EventListener);
  };
}

/**
 * React hook exposing the persisted presets plus add/remove mutators.
 * Backed by useSyncExternalStore so every mounted consumer re-renders when the
 * list changes (including from another tab).
 */
export function useStatusPresets() {
  const raw = useSyncExternalStore(
    subscribe,
    () => readUiPrefString(STORAGE_KEY, "[]"),
    () => "[]",
  );
  const presets = parsePresets(raw);

  const add = useCallback((preset: Omit<StatusPreset, "id">) => {
    const current = parsePresets(readUiPrefString(STORAGE_KEY, "[]"));
    writeUiPrefString(STORAGE_KEY, serialize(addPreset(current, preset)));
  }, []);

  const remove = useCallback((id: string) => {
    const current = parsePresets(readUiPrefString(STORAGE_KEY, "[]"));
    writeUiPrefString(STORAGE_KEY, serialize(removePreset(current, id)));
  }, []);

  return { presets, add, remove } as const;
}
