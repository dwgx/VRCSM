import { useEffect } from "react";
import { ipc } from "./ipc";

/**
 * VRChat Pipeline event envelope — fired by the C++ host whenever the
 * Pipeline WebSocket receives a payload from vrchat.cloud. `content`
 * is already the inner parsed object; the bridge layer unwraps the
 * stringified payload VRChat's server actually sends on the wire.
 */
export interface PipelineEvent<TContent = unknown> {
  type: PipelineEventType;
  content: TContent;
}

/**
 * Every Pipeline event type VRChat documents. Not exhaustive — the
 * server can introduce new types — but these are the ones callers are
 * likely to care about and the ones we explicitly wire into reducers.
 */
export type PipelineEventType =
  | "friend-online"
  | "friend-offline"
  | "friend-active"
  | "friend-location"
  | "friend-update"
  | "friend-add"
  | "friend-delete"
  | "notification"
  | "notification-v2"
  | "notification-v2-update"
  | "notification-v2-delete"
  | "see-notification"
  | "clear-notification"
  | "response-notification"
  | "user-update"
  | "user-location"
  | "content-refresh"
  | "group-joined"
  | "group-left"
  | "group-member-updated"
  | "group-role-updated"
  | "instance-queue-joined"
  | "instance-queue-ready";

/**
 * Subscribe to a single Pipeline event type (or all events if `type` is
 * a wildcard `"*"`). The handler is invoked on the UI thread with the
 * parsed `content` object. Returns an unsubscribe function — React
 * callers typically just return it from a `useEffect`.
 */
export function subscribePipelineEvent<T = unknown>(
  type: PipelineEventType | "*",
  handler: (content: T, fullType: PipelineEventType) => void,
): () => void {
  return ipc.on<PipelineEvent<T>>("pipeline.event", (event) => {
    if (type !== "*" && event.type !== type) return;
    try {
      handler(event.content, event.type);
    } catch (err) {
      console.warn("pipeline handler threw", err);
    }
  });
}

/**
 * React hook flavour of `subscribePipelineEvent`. Registers the handler
 * on mount, tears down on unmount. Re-binds when `type` or `handler`
 * changes — call sites should memoize the handler if they care about
 * avoiding that.
 */
export function usePipelineEvent<T = unknown>(
  type: PipelineEventType | "*",
  handler: (content: T, fullType: PipelineEventType) => void,
): void {
  useEffect(() => subscribePipelineEvent(type, handler), [type, handler]);
}
