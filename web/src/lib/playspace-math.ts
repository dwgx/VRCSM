export const PLAYSPACE_NUDGE_LIMIT_M = 0.25;
export const PLAYSPACE_SESSION_LIMIT_M = 5;
export const PLAYSPACE_STICK_DEADZONE = 0.15;
export const PLAYSPACE_DEFAULT_SPEED_MPS = 1.5;
export const PLAYSPACE_KEY_NUDGE_M = 0.05;

export type PlayspaceVec3 = { x: number; y: number; z: number };
export type PlayspaceLocks = { lockX: boolean; lockY: boolean; lockZ: boolean };

export const DEFAULT_PLAYSPACE_LOCKS: PlayspaceLocks = {
  lockX: false,
  lockY: true,
  lockZ: false,
};

export type PlayspaceState =
  | "idle"
  | "ready"
  | "active"
  | "steamvr_not_running"
  | "error";

export interface PlayspaceStatus {
  state: PlayspaceState;
  error?: string;
  offset: PlayspaceVec3;
  locks: PlayspaceLocks;
  steamVrRuntime?: string;
  gripHeld?: boolean;
  offsetLimitHit?: boolean;
}

export function applyLocks(v: PlayspaceVec3, locks: PlayspaceLocks): PlayspaceVec3 {
  return {
    x: locks.lockX ? 0 : v.x,
    y: locks.lockY ? 0 : v.y,
    z: locks.lockZ ? 0 : v.z,
  };
}

export function clampNudge(v: PlayspaceVec3): { ok: true; value: PlayspaceVec3 } | { ok: false; code: "invalid_params" } {
  if (Math.abs(v.x) > PLAYSPACE_NUDGE_LIMIT_M || Math.abs(v.y) > PLAYSPACE_NUDGE_LIMIT_M || Math.abs(v.z) > PLAYSPACE_NUDGE_LIMIT_M) {
    return { ok: false, code: "invalid_params" };
  }
  return { ok: true, value: v };
}

export function clampSession(
  current: PlayspaceVec3,
  delta: PlayspaceVec3,
): { ok: true; value: PlayspaceVec3 } | { ok: false; code: "offset_limit" } {
  const proposed = { x: current.x + delta.x, y: current.y + delta.y, z: current.z + delta.z };
  const mag = Math.hypot(proposed.x, proposed.y, proposed.z);
  if (mag > PLAYSPACE_SESSION_LIMIT_M) {
    return { ok: false, code: "offset_limit" };
  }
  return { ok: true, value: proposed };
}

export function stickDelta(
  stickX: number,
  stickY: number,
  dtSeconds: number,
  speedMps = PLAYSPACE_DEFAULT_SPEED_MPS,
  deadzone = PLAYSPACE_STICK_DEADZONE,
): PlayspaceVec3 {
  const mag = Math.hypot(stickX, stickY);
  if (mag < deadzone || dtSeconds <= 0 || speedMps <= 0) {
    return { x: 0, y: 0, z: 0 };
  }
  return {
    x: stickX * speedMps * dtSeconds,
    y: 0,
    z: stickY * speedMps * dtSeconds,
  };
}

/** Arrow keys = XZ, PageUp/PageDown = Y. Returns null when the key is unused or locked. */
export function keyToNudge(key: string, locks: PlayspaceLocks, step = PLAYSPACE_KEY_NUDGE_M): PlayspaceVec3 | null {
  let delta: PlayspaceVec3 | null = null;
  switch (key) {
    case "ArrowLeft":
      delta = { x: -step, y: 0, z: 0 };
      break;
    case "ArrowRight":
      delta = { x: step, y: 0, z: 0 };
      break;
    case "ArrowUp":
      delta = { x: 0, y: 0, z: step };
      break;
    case "ArrowDown":
      delta = { x: 0, y: 0, z: -step };
      break;
    case "PageUp":
      delta = { x: 0, y: step, z: 0 };
      break;
    case "PageDown":
      delta = { x: 0, y: -step, z: 0 };
      break;
    default:
      return null;
  }
  const locked = applyLocks(delta, locks);
  if (locked.x === 0 && locked.y === 0 && locked.z === 0) return null;
  return locked;
}

export function formatOffsetMeters(v: PlayspaceVec3): string {
  const n = (x: number) => (Math.abs(x) < 1e-4 ? "0.00" : x.toFixed(2));
  return `${n(v.x)} / ${n(v.y)} / ${n(v.z)} m`;
}

export function controlsDisabled(state: PlayspaceState | undefined): boolean {
  return state !== "ready" && state !== "active";
}
