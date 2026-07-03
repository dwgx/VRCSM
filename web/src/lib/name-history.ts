/**
 * Derive a friend's display-name change history from their friend-log events.
 *
 * The pipeline records `displayName.changed` rows with `old_value` (the name
 * before the change) and `new_value` (the name after). We turn that raw event
 * stream into a deduped, chronologically-ordered list of "former names" for the
 * FriendDetailDialog — a VRCX-parity feature (VRCX shows "previous display
 * names"), surfaced from data we already collect.
 */

export interface NameLogEvent {
  event_type: string;
  old_value: string | null;
  new_value: string | null;
  occurred_at: string;
}

export interface NameHistoryEntry {
  /** A name the friend used at some point. */
  name: string;
  /** ISO timestamp we last observed them under this name (most recent wins). */
  lastSeen: string;
}

/**
 * Build the list of *former* names (excluding the current one). Newest change
 * first. De-dupes repeated names (someone toggling back and forth keeps only
 * the most recent occurrence). Pure — safe to call in render.
 *
 * @param events   friend-log rows for one user (any event types; we filter)
 * @param currentName the friend's current display name, excluded from output
 */
export function deriveNameHistory(
  events: readonly NameLogEvent[],
  currentName?: string | null,
): NameHistoryEntry[] {
  const changes = events
    .filter((e) => e.event_type === "displayName.changed")
    .slice()
    // Newest first so the first occurrence of each name is its latest sighting.
    .sort((a, b) => (b.occurred_at ?? "").localeCompare(a.occurred_at ?? ""));

  const current = (currentName ?? "").trim();
  const seen = new Set<string>();
  const out: NameHistoryEntry[] = [];

  for (const e of changes) {
    // The old_value of each change is a name the friend previously held.
    const name = (e.old_value ?? "").trim();
    if (!name) continue;
    if (name === current) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, lastSeen: e.occurred_at });
  }

  return out;
}
