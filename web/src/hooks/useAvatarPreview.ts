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
}

/* ── Public types ──────────────────────────────────────────────────── */

export type PreviewState =
  | { kind: "loading" }
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
): { state: PreviewState; retry: () => void } {
  const [state, setState] = useState<PreviewState>({ kind: "loading" });
  const prevRef = useRef<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });

    // Abort previous extraction when user switches avatars
    if (prevRef.current && prevRef.current !== avatarId) {
      ipc
        .call("avatar.preview.abort", { avatarId: prevRef.current })
        .catch(() => {});
    }
    prevRef.current = avatarId;

    ipc
      .call<{ avatarId: string; assetUrl?: string }, PreviewResponse>(
        "avatar.preview",
        { avatarId, assetUrl },
      )
      .then((resp) => {
        if (cancelled) return;
        if (resp.ok && resp.glbUrl) {
          setState({
            kind: "ready",
            url: resp.glbUrl,
            cached: resp.cached ?? false,
          });
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

    return () => {
      cancelled = true;
      ipc
        .call("avatar.preview.abort", { avatarId })
        .catch(() => {});
    };
  }, [avatarId, assetUrl, retryKey]);

  return {
    state,
    retry: () => setRetryKey((k) => k + 1),
  };
}
