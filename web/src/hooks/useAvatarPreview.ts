import { useEffect, useState } from "react";
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
  | { kind: "ready"; url: string; cached: boolean }
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

    ipc
      .call<{ avatarId: string; assetUrl?: string; bundlePath?: string }, PreviewResponse>(
        "avatar.preview",
        { avatarId, assetUrl, bundlePath },
      )
      .then((resp) => {
        if (cancelled) return;
        if (resp.ok && resp.glbUrl) {
          setState({
            kind: "ready",
            url: resp.glbUrl,
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
          setState({
            kind: "error",
            code: resp.code ?? "preview_failed",
            message: resp.message,
          });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          code: "preview_failed",
          message: e instanceof Error ? e.message : String(e),
        });
      });

    return cleanup;
  }, [avatarId, assetUrl, bundlePath, retryKey]);

  return {
    state,
    retry: () => setRetryKey((k) => k + 1),
  };
}
