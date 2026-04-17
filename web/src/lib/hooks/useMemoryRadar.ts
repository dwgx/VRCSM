import { useState, useEffect } from "react";
import { ipc } from "../ipc";
import type { MemoryStatus } from "../types";

export function useMemoryRadar(pollingRateMs: number = 2000) {
  const [status, setStatus] = useState<MemoryStatus>({
    attached: false,
    vrcBase: 0,
    gaBase: 0,
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    let active = true;

    async function poll() {
      try {
        const result = await ipc.readMemoryStatus();
        if (active) {
          setStatus(result);
        }
      } catch (err) {
        console.error("Failed to fetch memory status:", err);
      } finally {
        if (active) {
          setLoading(false);
          timeout = setTimeout(poll, pollingRateMs);
        }
      }
    }

    poll();

    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [pollingRateMs]);

  return { status, loading };
}
