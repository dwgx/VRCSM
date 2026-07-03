// A10 — read-only avatar-id harvest from VRChat's own local Amplitude
// analytics cache (the VRC-LOG technique). The C++ core does the actual
// read-only scan (src/core/AvatarIdHarvest); this module is the frontend
// gate + thin IPC wrapper.
//
// IMPORTANT: harvesting is gated behind the default-OFF experimental flag
// `vrcsm:experimental:amplitudeHarvest` (see web/src/lib/experimental.ts).
// Reading VRChat's analytics cache may run against VRChat's ToS, so the
// caller MUST pass the live flag value — when it's OFF this module performs
// no IPC at all and the default behavior is unchanged. The scan is strictly
// read-only: only `avtr_` ids are surfaced, nothing is written or uploaded.

import { ipc } from "@/lib/ipc";

const AVATAR_ID_RE = /^avtr_[0-9a-fA-F-]+$/;

/**
 * Pure gating predicate. Harvesting is only allowed when the experimental
 * flag is explicitly ON. Kept separate from the IPC call so it can be unit
 * tested without a host bridge.
 */
export function canHarvestAvatarIds(flagEnabled: boolean): boolean {
  return flagEnabled === true;
}

/** Keep only well-formed, unique `avtr_` ids, preserving first-seen order. */
export function sanitizeHarvestedIds(ids: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!AVATAR_ID_RE.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Harvest avatar ids from the local Amplitude cache — but only when the
 * experimental flag is ON. Returns an empty array (and performs NO IPC) when
 * the flag is OFF, so default behavior is unchanged. Never throws on a missing
 * cache; the host returns an empty list in that case.
 */
export async function harvestLocalAvatarIds(flagEnabled: boolean): Promise<string[]> {
  if (!canHarvestAvatarIds(flagEnabled)) {
    return [];
  }
  const r = await ipc.avatarsHarvestIds();
  return sanitizeHarvestedIds(Array.isArray(r?.ids) ? r.ids : []);
}

/**
 * Of the harvested ids, return those not already present in `known` (e.g. the
 * ids the account already owns), preserving harvest order. Used to decide which
 * ids are worth resolving/enriching so we don't re-fetch what we already show.
 */
export function newlyHarvestedIds(
  harvested: readonly string[],
  known: Iterable<string>,
): string[] {
  const knownSet = new Set<string>();
  for (const k of known) {
    if (typeof k === "string" && k) knownSet.add(k);
  }
  return harvested.filter((id) => !knownSet.has(id));
}
