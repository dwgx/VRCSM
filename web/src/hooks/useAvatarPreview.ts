import { useEffect, useRef, useState } from "react";
import { ipc } from "@/lib/ipc";

/* ── IPC contract (mirrors src/core/AvatarPreview.h) ──────────────── */

interface PreviewResponse {
  avatarId: string;
  ok: boolean;
  glbUrl?: string;
  glbPath?: string;
  cached?: boolean;
  code?: string;
  message?: string;
  sourceSig?: string;
  cacheSource?: string;
  downloaded?: boolean;
  decodeMs?: number;
  downloadMs?: number;
}

interface PreviewStatusResponse {
  avatarId?: string;
  cached: boolean;
  glbUrl?: string;
  glbPath?: string;
  bundleIndexed?: boolean;
  sourceSig?: string | null;
  cacheSource?: string | null;
  code?: string;
  message?: string;
}

interface PreviewProgressEvent {
  avatarId: string;
  phase?: string;
  message?: string;
  queuePosition?: number;
}

/* ── Public types ──────────────────────────────────────────────────── */

export type PreviewState =
  | { kind: "loading"; phase?: string; message?: string; queuePosition?: number }
  | { kind: "ready"; url: string; path?: string; cached: boolean }
  | { kind: "error"; code: string; message?: string };

/**
 * Manages the full avatar-preview lifecycle:
 *   1. Fires `avatar.preview` IPC on mount / avatarId change
 *   2. Aborts stale extractions on switch or unmount
 *   3. Exposes a `retry()` to re-trigger after failure
 *
 * The C++ side handles caching, bundle resolution, and extractor spawn.
 * This hook only manages the request/response state machine.
 */
export function useAvatarPreview(
  avatarId: string,
  assetUrl?: string,
  bundlePath?: string,
): { state: PreviewState; retry: () => void } {
  const [state, setState] = useState<PreviewState>({ kind: "loading" });
  const [retryKey, setRetryKey] = useState(0);
  // Track which (avatarId, assetUrl, bundlePath) tuple has already used its
  // one auto-retry slot. Prevents an infinite retry loop while still giving
  // each fresh input one transparent second chance.
  const autoRetriedKeyRef = useRef<string>("");
  const inputKey = `${avatarId}|${assetUrl ?? ""}|${bundlePath ?? ""}`;

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    setState({ kind: "loading" });

    const offProgress = ipc.on<PreviewProgressEvent>(
      "avatar.preview.progress",
      (event) => {
        if (cancelled || event.avatarId !== avatarId) return;
        setState((current) => {
          if (current.kind !== "loading") return current;
          return {
            kind: "loading",
            phase: event.phase,
            message: event.message,
            queuePosition: event.queuePosition,
          };
        });
      },
    );

    // When avatarId changes (or hook unmounts), the cleanup below fires
    // an abort for the *current* avatarId — so we don't need a separate
    // prevRef tracker. React guarantees the old effect's cleanup runs
    // before the new effect, which is exactly the abort ordering we
    // want: old avatar's extraction stops, then new avatar's starts.
    const cleanup = () => {
      cancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
      offProgress();
      ipc
        .call("avatar.preview.abort", { avatarId })
        .catch(() => {});
    };

    if (!assetUrl && !bundlePath) {
      // Still waiting for parent to provide URLs, stay in loading state
      // (prevents flashing red "Preview Unavailable" while switching).
      // Return cleanup so the progress listener is unsubscribed on
      // unmount — the previous `return;` here leaked listeners.
      return cleanup;
    }

    const request = { avatarId, assetUrl, bundlePath };

    const requestFullPreview = () =>
      ipc
        .call<{ avatarId: string; assetUrl?: string; bundlePath?: string }, PreviewResponse>(
          "avatar.preview",
          request,
        );

    const handleResponse = (resp: PreviewResponse) => {
        if (cancelled) return;
        if (resp.ok && resp.glbUrl) {
          setState({
            kind: "ready",
            url: resp.glbUrl,
            path: resp.glbPath,
            cached: resp.cached ?? false,
          });
        } else if (resp.code === "cancelled") {
          setState((current) =>
            current.kind === "loading" ? current : { kind: "loading" },
          );
          retryTimer = window.setTimeout(() => {
            if (!cancelled) {
              setRetryKey((value) => value + 1);
            }
          }, 150);
        } else {
          // Some failure codes are commonly transient — VRChat may still be
          // writing the bundle, the cache may have just been purged, or the
          // extractor lost a race with another preview. Give the same input
          // tuple one silent second attempt before flashing red so users
          // don't have to manually click Retry.
          const transient =
            resp.code === "bundle_not_found" ||
            resp.code === "extractor_failed";
          if (transient && autoRetriedKeyRef.current !== inputKey) {
            autoRetriedKeyRef.current = inputKey;
            retryTimer = window.setTimeout(() => {
              if (!cancelled) {
                setRetryKey((value) => value + 1);
              }
            }, 300);
            return;
          }
          setState({
            kind: "error",
            code: resp.code ?? "preview_failed",
            message: resp.message,
          });
        }
      };

    const handleFailure = (e: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          code: "preview_failed",
          message: e instanceof Error ? e.message : String(e),
        });
      };

    ipc
      .call<{ avatarId: string; assetUrl?: string; bundlePath?: string }, PreviewStatusResponse>(
        "avatar.preview.status",
        request,
      )
      .then((status) => {
        if (cancelled) return;
        if (status.cached && status.glbUrl) {
          setState({
            kind: "ready",
            url: status.glbUrl,
            path: status.glbPath,
            cached: true,
          });
          return;
        }
        requestFullPreview().then(handleResponse).catch(handleFailure);
      })
      .catch(() => {
        requestFullPreview().then(handleResponse).catch(handleFailure);
      });

    return cleanup;
  }, [avatarId, assetUrl, bundlePath, retryKey]);

  const retainedPath = state.kind === "ready" ? state.path : undefined;
  useEffect(() => {
    if (!retainedPath) return;
    ipc.call("avatar.preview.retain", { glbPath: retainedPath }).catch(() => {});
    return () => {
      ipc.call("avatar.preview.release", { glbPath: retainedPath }).catch(() => {});
    };
  }, [retainedPath]);

  return {
    state,
    retry: () => setRetryKey((k) => k + 1),
  };
}
