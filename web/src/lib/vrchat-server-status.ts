import { useEffect, useState } from "react";

/**
 * VRChat server-status indicator (VRCX parity). VRChat hosts a standard
 * Atlassian Statuspage at status.vrchat.com, which exposes a CORS-open JSON
 * summary at /api/v2/status.json:
 *
 *   { "status": { "indicator": "none|minor|major|critical",
 *                  "description": "All Systems Operational" }, ... }
 *
 * We poll it on a slow interval and surface a compact badge so users can tell
 * at a glance whether a connection problem is VRChat's outage rather than their
 * own. Purely a client-side fetch — no C++/IPC surface, no auth.
 */

export type ServerStatusLevel = "operational" | "minor" | "major" | "critical" | "unknown";

export interface VrchatServerStatus {
  level: ServerStatusLevel;
  description: string;
}

const STATUS_URL = "https://status.vrchat.com/api/v2/status.json";
const POLL_MS = 5 * 60 * 1000; // 5 minutes — outages don't need tighter polling.

/**
 * Map a Statuspage `indicator` string to our level enum. Pure & total:
 * unknown / missing indicators fall back to "unknown" so the UI can hide the
 * badge rather than imply a healthy state.
 */
export function levelFromIndicator(indicator: unknown): ServerStatusLevel {
  switch (indicator) {
    case "none":
      return "operational";
    case "minor":
      return "minor";
    case "major":
      return "major";
    case "critical":
      return "critical";
    default:
      return "unknown";
  }
}

/** Parse the Statuspage summary payload into our status shape. Never throws. */
export function parseServerStatus(payload: unknown): VrchatServerStatus {
  if (!payload || typeof payload !== "object") {
    return { level: "unknown", description: "" };
  }
  const status = (payload as Record<string, unknown>).status;
  if (!status || typeof status !== "object") {
    return { level: "unknown", description: "" };
  }
  const rec = status as Record<string, unknown>;
  const level = levelFromIndicator(rec.indicator);
  const description = typeof rec.description === "string" ? rec.description : "";
  return { level, description };
}

export function useVrchatServerStatus(enabled = true): VrchatServerStatus | null {
  const [status, setStatus] = useState<VrchatServerStatus | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const poll = async () => {
      try {
        const res = await fetch(STATUS_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setStatus(parseServerStatus(json));
      } catch {
        // Network failure (offline, blocked) — leave prior value, don't claim
        // an outage. A null/stale badge is better than a false alarm.
        if (!cancelled) setStatus((prev) => prev);
      }
    };

    void poll();
    timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [enabled]);

  return status;
}
