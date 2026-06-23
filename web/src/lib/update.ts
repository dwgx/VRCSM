import { ipc } from "./ipc";

export interface UpdateCheckResult {
  available: boolean;
  current: string;
  currentVersion?: string;
  latest?: string;
  latestVersion?: string;
  fileName?: string | null;
  downloadUrl?: string;
  size?: number;
  downloadSize?: number;
  sha256?: string | null;
  releaseNotes?: string;
  releaseNotesMarkdown?: string;
  releaseUrl?: string;
  skipped: boolean;
  currentMsiPath?: string;
}

export interface UpdateState {
  autoCheck: boolean;
  checkIntervalHours: number;
  skippedVersions: string[];
  lastChecked?: string;
}

export type UpdateProgressPhase = "download" | "verify" | "done";

export interface UpdateProgressEvent {
  taskId?: string;
  done: number;
  total: number;
  phase: UpdateProgressPhase;
}

export type UpdateProgressListener = (event: UpdateProgressEvent) => void;

const listeners = new Set<UpdateProgressListener>();

export function onUpdateProgress(listener: UpdateProgressListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Register as soon as the module loads so the global IPC event-bus has a
// subscriber before check/install is ever called. The ipc client debounces
// duplicate subscribes.
ipc.on<UpdateProgressEvent>("update.progress", (data) => {
  for (const listener of listeners) {
    try {
      listener(data);
    } catch {
      // swallow listener errors — one buggy subscriber must not break others
    }
  }
});

export async function checkUpdate(force = false): Promise<UpdateCheckResult> {
  return ipc.call<{ force: boolean }, UpdateCheckResult>("update.check", { force });
}

export async function downloadUpdate(params: {
  url: string;
  size: number;
  sha256?: string | null;
  version: string;
  fileName?: string | null;
}): Promise<{ path: string }> {
  return ipc.call<typeof params, { path: string }>("update.download", params);
}

export async function installUpdate(params: {
  path: string;
  version: string;
  size: number;
  sha256?: string | null;
  fileName?: string | null;
}): Promise<{ ok: boolean }> {
  return ipc.call<typeof params, { ok: boolean }>("update.install", params);
}

export async function skipVersion(version: string): Promise<UpdateState> {
  return ipc.call<{ version: string }, UpdateState>("update.skipVersion", { version });
}

export async function unskipVersion(version: string): Promise<UpdateState> {
  return ipc.call<{ version: string }, UpdateState>("update.unskipVersion", { version });
}

export async function getUpdateState(): Promise<UpdateState> {
  return ipc.call<undefined, UpdateState>("update.getState", undefined);
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[u]}`;
}
