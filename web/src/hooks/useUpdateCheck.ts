import { useCallback, useEffect, useState } from "react";
import { checkUpdate, type UpdateCheckResult } from "@/lib/update";

export interface UseUpdateCheckResult {
  /** Latest release when an update is available and not skipped. null otherwise. */
  updateAvailable: UpdateCheckResult | null;
  /** Full check result, available even for up-to-date responses. */
  result: UpdateCheckResult | null;
  checking: boolean;
  error: string | null;
  /** Trigger a fresh check, bypassing the 5-minute host cache. */
  recheck: () => Promise<UpdateCheckResult | null>;
}

/**
 * Thin wrapper over the C++ updater: performs one background check on
 * mount, exposes the result plus a re-check trigger. The host side
 * already caches the GitHub response for 5 minutes, so calling this
 * multiple times is cheap.
 */
export function useUpdateCheck(): UseUpdateCheckResult {
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (force: boolean): Promise<UpdateCheckResult | null> => {
    setChecking(true);
    setError(null);
    try {
      const info = await checkUpdate(force);
      setResult(info);
      return info;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void run(false);
  }, [run]);

  const updateAvailable = result && result.available && !result.skipped ? result : null;

  return {
    updateAvailable,
    result,
    checking,
    error,
    recheck: () => run(true),
  };
}
