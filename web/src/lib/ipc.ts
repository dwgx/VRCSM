import type {
  AppVersion,
  BundlePreview,
  DeleteResult,
  DryRunResult,
  IpcEnvelopeEvent,
  IpcEnvelopeRequest,
  IpcEnvelopeResponse,
  MigratePlan,
  ProcessStatus,
  Report,
} from "./types";

interface WebViewBridge {
  postMessage: (message: string) => void;
  addEventListener: (type: "message", listener: (event: { data: string }) => void) => void;
  removeEventListener?: (type: "message", listener: (event: { data: string }) => void) => void;
}

interface ChromeShim {
  webview?: WebViewBridge;
}

declare global {
  interface Window {
    chrome?: ChromeShim;
    __VRCSM_MOCK__?: boolean;
  }
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildMockReport(): Report {
  const entries = Array.from({ length: 32 }).map((_, i) => {
    const bytes = Math.floor(20_000_000 + Math.random() * 380_000_000);
    return {
      entry: Math.floor(0xa0000000 + Math.random() * 0x5fffffff)
        .toString(16)
        .toUpperCase()
        .padStart(16, "0"),
      path: "C:/Users/dev/AppData/LocalLow/VRChat/VRChat/Cache-WindowsPlayer/MOCK",
      bytes,
      bytes_human: `${(bytes / 1024 / 1024).toFixed(2)} MiB`,
      file_count: 2,
      latest_mtime: nowIso(),
      oldest_mtime: nowIso(),
      bundle_format: "UnityFS",
    };
  });
  entries.sort((a, b) => b.bytes - a.bytes);
  const total = entries.reduce((s, e) => s + e.bytes, 0);
  return {
    generated_at: nowIso(),
    base_dir: "C:/Users/dev/AppData/LocalLow/VRChat/VRChat (mock)",
    category_summaries: [
      {
        key: "cache_windows_player",
        name: "Cache-WindowsPlayer",
        kind: "dir",
        logical_path: "Cache-WindowsPlayer",
        exists: true,
        lexists: true,
        is_dir: true,
        is_file: false,
        resolved_path: "C:/.../Cache-WindowsPlayer",
        bytes: total,
        bytes_human: `${(total / 1024 / 1024 / 1024).toFixed(2)} GiB`,
        file_count: entries.length * 2,
        latest_mtime: nowIso(),
        oldest_mtime: nowIso(),
      },
      {
        key: "http_cache",
        name: "HTTPCache-WindowsPlayer",
        kind: "dir",
        logical_path: "HTTPCache-WindowsPlayer",
        exists: false,
        lexists: true,
        is_dir: false,
        is_file: false,
        resolved_path: "D:/VRChatCache/HTTPCache-WindowsPlayer (broken)",
        bytes: 0,
        bytes_human: "0 B",
        file_count: 0,
        latest_mtime: null,
        oldest_mtime: null,
      },
      {
        key: "avatars",
        name: "Avatars",
        kind: "dir",
        logical_path: "Avatars",
        exists: true,
        lexists: true,
        is_dir: true,
        is_file: false,
        resolved_path: "C:/.../Avatars",
        bytes: 412_000_000,
        bytes_human: "392.91 MiB",
        file_count: 184,
        latest_mtime: nowIso(),
        oldest_mtime: nowIso(),
      },
    ],
    total_bytes: total + 412_000_000,
    total_bytes_human: `${((total + 412_000_000) / 1024 / 1024 / 1024).toFixed(2)} GiB`,
    existing_category_count: 9,
    broken_links: [
      {
        category: "http_cache",
        logical_path: "HTTPCache-WindowsPlayer",
        resolved_path: "D:/VRChatCache/HTTPCache-WindowsPlayer",
        reason: "junction target missing",
      },
      {
        category: "texture_cache",
        logical_path: "TextureCache-WindowsPlayer",
        resolved_path: "D:/VRChatCache/TextureCache-WindowsPlayer",
        reason: "junction target missing",
      },
    ],
    cache_windows_player: {
      entry_count: entries.length,
      entries,
      largest_entries: entries.slice(0, 8),
    },
    local_avatar_data: {
      item_count: 6,
      recent_items: Array.from({ length: 6 }).map((_, i) => ({
        user_id: `usr_mock_${i}`,
        avatar_id: `avtr_mock_${i}`,
        path: `LocalAvatarData/usr_mock_${i}/avtr_mock_${i}`,
        eye_height: 1.6 + i * 0.02,
        parameter_count: 24 + i,
        modified_at: nowIso(),
      })),
      parameter_count_histogram: { "0-15": 1, "16-31": 4, "32+": 1 },
    },
    logs: {
      log_files: ["output_log_2026-04-14_17-30-00.txt"],
      log_count: 1,
      settings: {
        cache_directory: "default",
        cache_size_mb: 20480,
        clear_cache_on_start: false,
      },
      recent_world_ids: [
        "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "wrld_11111111-2222-3333-4444-555555555555",
      ],
      recent_avatar_ids: ["avtr_99999999-8888-7777-6666-555555555555"],
      world_names: {
        "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee": "Mock World A",
        "wrld_11111111-2222-3333-4444-555555555555": "Mock World B",
      },
      world_event_count: 12,
      avatar_event_count: 5,
    },
  };
}

class IpcClient {
  private bridge: WebViewBridge | null;
  private pending: Map<string, Pending>;
  private events: EventTarget;
  private listenerAttached: boolean;

  constructor() {
    this.bridge = window.chrome?.webview ?? null;
    this.pending = new Map();
    this.events = new EventTarget();
    this.listenerAttached = false;
    if (!this.bridge) {
      window.__VRCSM_MOCK__ = true;
    }
    this.attach();
  }

  get isMock(): boolean {
    return this.bridge === null;
  }

  private attach(): void {
    if (this.listenerAttached || !this.bridge) return;
    this.bridge.addEventListener("message", (event) => {
      this.handle(event.data);
    });
    this.listenerAttached = true;
  }

  private handle(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    if ("event" in parsed) {
      const evt = parsed as IpcEnvelopeEvent;
      this.events.dispatchEvent(
        new CustomEvent(evt.event, { detail: evt.data }),
      );
      return;
    }
    if ("id" in parsed) {
      const resp = parsed as IpcEnvelopeResponse;
      const slot = this.pending.get(resp.id);
      if (!slot) return;
      this.pending.delete(resp.id);
      if (resp.error) {
        slot.reject(resp.error);
      } else {
        slot.resolve(resp.result);
      }
    }
  }

  on<T>(event: string, handler: (data: T) => void): () => void {
    const listener = (e: Event) => {
      const ce = e as CustomEvent<T>;
      handler(ce.detail);
    };
    this.events.addEventListener(event, listener);
    return () => this.events.removeEventListener(event, listener);
  }

  async call<TParams, TResult>(method: string, params?: TParams): Promise<TResult> {
    if (!this.bridge) {
      return this.mockCall<TResult>(method, params);
    }
    const id = uuid();
    const envelope: IpcEnvelopeRequest<TParams> = { id, method };
    if (params !== undefined) envelope.params = params;
    const promise = new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as TResult),
        reject,
      });
    });
    this.bridge.postMessage(JSON.stringify(envelope));
    return promise;
  }

  private async mockCall<TResult>(method: string, params?: unknown): Promise<TResult> {
    await new Promise((r) => setTimeout(r, 180));
    switch (method) {
      case "app.version":
        return { version: "0.1.0", build: "mock" } as unknown as TResult;
      case "scan":
        return buildMockReport() as unknown as TResult;
      case "bundle.preview":
        return {
          infoText: "1681000000\n__data\n",
          magic: "UnityFS",
          fileTree: ["__info", "__data"],
        } satisfies BundlePreview as unknown as TResult;
      case "delete.dryRun":
        return { targets: ["mock/target/1", "mock/target/2"] } satisfies DryRunResult as unknown as TResult;
      case "delete.execute":
        return { deleted: 2 } satisfies DeleteResult as unknown as TResult;
      case "process.vrcRunning":
        return { running: false } satisfies ProcessStatus as unknown as TResult;
      case "migrate.preflight": {
        const p = (params ?? {}) as { source?: string; target?: string };
        return {
          source: p.source ?? "C:/Users/dev/AppData/LocalLow/VRChat/VRChat/Cache-WindowsPlayer",
          target: p.target ?? "D:/VRChatCache/Cache-WindowsPlayer",
          sourceBytes: 9_900_000_000,
          targetFreeBytes: 215_000_000_000,
          sourceIsJunction: false,
          vrcRunning: false,
          blockers: [],
        } satisfies MigratePlan as unknown as TResult;
      }
      case "migrate.execute": {
        this.runMigrationMock();
        return { ok: true } as unknown as TResult;
      }
      default:
        return null as unknown as TResult;
    }
  }

  private runMigrationMock(): void {
    const total = 9_900_000_000;
    const totalFiles = 2048;
    let done = 0;
    let files = 0;
    const tick = () => {
      done = Math.min(total, done + 220_000_000);
      files = Math.min(totalFiles, files + 48);
      const phase: "copy" | "verify" | "done" =
        done >= total ? "done" : done < total * 0.85 ? "copy" : "verify";
      this.events.dispatchEvent(
        new CustomEvent("migrate.progress", {
          detail: {
            phase,
            bytesDone: done,
            bytesTotal: total,
            filesDone: files,
            filesTotal: totalFiles,
            message: phase === "done" ? "migration complete" : `mock ${phase}`,
          },
        }),
      );
      if (done < total) {
        window.setTimeout(tick, 240);
      }
    };
    window.setTimeout(tick, 240);
  }

  async version(): Promise<AppVersion> {
    return this.call<undefined, AppVersion>("app.version");
  }

  async scan(): Promise<Report> {
    return this.call<undefined, Report>("scan");
  }
}

export const ipc = new IpcClient();
