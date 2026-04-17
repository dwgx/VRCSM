import { useState, useEffect, useRef } from "react";
import { ipc } from "../ipc";
import type { RadarSnapshot } from "../types";

const DEFAULT_SNAP: RadarSnapshot = {
  attached: false,
  vrcBase: 0,
  gaBase: 0,
  players: [],
  instanceId: "",
  worldId: "",
};

export function useRadar(pollingRateMs = 1500) {
  const [snap, setSnap] = useState<RadarSnapshot>(DEFAULT_SNAP);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    let timeout: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const result = await ipc.radarPoll();
        if (activeRef.current) {
          setSnap(result);
          setError(null);
        }
      } catch (err) {
        if (activeRef.current) {
          setError(err instanceof Error ? err.message : "Radar poll failed");
        }
      } finally {
        if (activeRef.current) {
          setLoading(false);
          timeout = setTimeout(poll, pollingRateMs);
        }
      }
    }

    poll();

    return () => {
      activeRef.current = false;
      clearTimeout(timeout);
    };
  }, [pollingRateMs]);

  return { snap, loading, error };
}
