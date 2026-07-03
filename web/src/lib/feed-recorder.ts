import { ipc } from "./ipc";
import { parseLocation } from "./vrcFriends";
import type { Friend } from "./types";

/**
 * Central pipeline → `friend_presence_events` recorder.
 *
 * Before this module, presence/location/status flips were either lost or
 * scattered as page-local logic. The research doc calls for a single
 * "coordinator" that all pipeline callers funnel through, so the unified
 * feed (B1 `feed.unified`) sees a consistent, deduplicated stream.
 *
 * This is intentionally a thin, side-effect-only layer: it never throws into
 * the caller's render path (every insert is fire-and-forget with a warn), and
 * it derives `world_id` / `instance_id` from the raw VRChat location string so
 * the feed can group a friend's session without a second lookup.
 *
 * `friend_log` (online/offline/name flips on confirmed friendships) stays as
 * is — this is the superset that also captures per-instance location moves.
 */

/** Map a VRChat pipeline event type to a presence `event_type` discriminator. */
const PRESENCE_EVENT_TYPE: Record<string, string> = {
  "friend-online": "online",
  "friend-offline": "offline",
  "friend-active": "status",
  "friend-location": "location",
  "friend-update": "status",
};

/** Pipeline events we persist as presence rows. friend-add/delete stay in friend_log. */
export const PRESENCE_PIPELINE_EVENT_TYPES = [
  "friend-online",
  "friend-offline",
  "friend-active",
  "friend-location",
] as const;

export interface PresenceRecordInput {
  /** Raw VRChat pipeline event type, e.g. "friend-location". */
  pipelineType: string;
  /** usr_xxx of the friend whose presence changed. */
  userId: string;
  /** Display name for denormalized rendering in the feed. */
  displayName?: string | null;
  /** Raw VRChat location string when the event carries one. */
  location?: string | null;
  /** Friend status (join me / active / busy / ask me) when present. */
  status?: string | null;
  /** Previous value for status flips (feeds the feed's "X → Y" rendering). */
  oldValue?: string | null;
  /** New value for status flips. */
  newValue?: string | null;
  /** ISO timestamp; defaults to now. */
  occurredAt?: string;
}

function isMeaningfulLocation(loc: string | null | undefined): loc is string {
  return (
    typeof loc === "string" &&
    loc.length > 0 &&
    loc !== "offline" &&
    loc !== "private" &&
    loc !== "traveling"
  );
}

/**
 * Persist one presence event. Fire-and-forget: failures are logged, never
 * propagated, so a flaky DB write can't break the pipeline reducer.
 */
export function recordPresenceEvent(input: PresenceRecordInput): void {
  const eventType = PRESENCE_EVENT_TYPE[input.pipelineType];
  if (!eventType) return;
  if (!input.userId) return;

  let worldId: string | undefined;
  let instanceId: string | undefined;
  if (isMeaningfulLocation(input.location)) {
    const parsed = parseLocation(input.location);
    if (parsed.kind === "world") {
      worldId = parsed.worldId;
      instanceId = parsed.instanceId;
    }
  }

  void ipc
    .friendPresenceRecord({
      user_id: input.userId,
      event_type: eventType,
      display_name: input.displayName ?? undefined,
      world_id: worldId,
      instance_id: instanceId,
      location: isMeaningfulLocation(input.location) ? input.location : undefined,
      status: input.status ?? undefined,
      old_value: input.oldValue ?? undefined,
      new_value: input.newValue ?? undefined,
      source: "pipeline",
      occurred_at: input.occurredAt ?? new Date().toISOString(),
    })
    .catch((e) => {
      console.warn(
        "[feed-recorder] presence insert failed",
        e instanceof Error ? e.message : String(e),
      );
    });
}

/**
 * Derive a `PresenceRecordInput` from a raw pipeline payload + the friend's
 * prior cached row, then record it. Centralizes the field-plucking that used
 * to live inline in `useFriendsPipelineSync`.
 */
export function recordPresenceFromPipeline(
  pipelineType: string,
  content: unknown,
  prev: Friend | undefined,
): void {
  if (typeof content !== "object" || content === null) return;
  const c = content as {
    userId?: string;
    location?: string;
    user?: Partial<Friend>;
  };
  const patch = c.user && typeof c.user === "object" ? c.user : undefined;
  const userId = c.userId ?? patch?.id;
  if (!userId) return;

  const location =
    typeof c.location === "string"
      ? c.location
      : (patch?.location as string | undefined) ?? null;

  const nextStatus = (patch?.status as string | undefined) ?? null;
  const prevStatus = (prev?.status as string | undefined) ?? null;

  recordPresenceEvent({
    pipelineType,
    userId,
    displayName: patch?.displayName ?? prev?.displayName ?? null,
    location,
    status: nextStatus,
    oldValue: prevStatus,
    newValue: nextStatus,
  });
}
