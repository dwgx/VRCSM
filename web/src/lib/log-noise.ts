/**
 * Shared detector for VRChat's own log noise — the high-volume lines that are
 * VRChat-internal and almost never useful to a VRCSM user.
 *
 * The biggest offender is the EOS (Epic Online Services) telemetry/Stomp spam:
 * when VRChat can't reach api.epicgames.dev (commonly because a local proxy on
 * 127.0.0.1 refuses the connection) it retries forever, emitting dozens of
 * `[EOSManager] [Warning][LogHttp] … libcurl error … Couldn't connect` lines a
 * minute. None of that is a VRCSM problem; it's VRChat's transport layer. We
 * fold it away by default so the real log (joins, avatars, world changes) is
 * legible, while keeping a toggle to show everything verbatim.
 *
 * This is a pure substring/marker test — no allocation per call beyond the
 * lowercase fold — so it's cheap to run on every streamed line.
 */

const NOISE_MARKERS = [
  "[eosmanager]",
  "[loghttp]",
  "[logeos]",
  "[logeosmessaging]",
  "epicgames.dev",
  "failed to connect to stomp",
  "couldn't connect to server",
  "libcurl error",
  "libcurl info message cache",
  "retry exhausted on",
  "lockout of",
  "eos_noconnection",
] as const;

/**
 * True when a raw log line is VRChat-internal EOS/telemetry noise. Matching is
 * case-insensitive and substring-based so it survives VRChat's varied prefixes
 * (timestamps, color tags, "tail" markers).
 */
export function isLogNoise(line: string | null | undefined): boolean {
  if (!line) return false;
  const lower = line.toLowerCase();
  return NOISE_MARKERS.some((marker) => lower.includes(marker));
}
