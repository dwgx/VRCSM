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
  LogStreamChunk,
  VrcSettingsReport,
  VrcSettingsWriteRequest,
  VrcSettingsWriteResult,
  VrcSettingsExportResult,
  VrcSettingValueSnapshot,
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
  const entries = Array.from({ length: 32 }).map(() => {
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
      environment: {
        vrchat_build: "2026.2.2p3-1621--Release",
        store: "Steam",
        platform: "Windows",
        device_model: "MOCK-PC",
        processor: "AMD Ryzen 9 (Mock)",
        system_memory: "32678 MB",
        operating_system: "Windows 11 Pro (Mock)",
        gpu_name: "NVIDIA RTX 4080 (Mock)",
        gpu_api: "Direct3D 11",
        gpu_memory: "16384 MB",
        xr_device: null,
      },
      settings_sections: [
        {
          name: "General Settings",
          entries: [
            ["Cache Directory", "default"],
            ["Cache Size (MB)", "20480"],
            ["Clear Cache On Start", "False"],
          ],
        },
        {
          name: "Graphics Settings",
          entries: [
            ["Quality Level", "Ultra"],
            ["Target Frame Rate", "90"],
          ],
        },
      ],
      local_user_name: "mock_user",
      local_user_id: "usr_mock-1234-5678",
      recent_world_ids: [
        "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "wrld_11111111-2222-3333-4444-555555555555",
      ],
      recent_avatar_ids: ["avtr_99999999-8888-7777-6666-555555555555"],
      avatar_names: {
        "avtr_99999999-8888-7777-6666-555555555555": {
          name: "Mock Avatar",
          author: "VRCSM",
        },
      },
      world_names: {
        "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee": "Mock World A",
        "wrld_11111111-2222-3333-4444-555555555555": "Mock World B",
      },
      world_event_count: 12,
      avatar_event_count: 5,
    },
  };
}

function buildMockSettingsReport(): VrcSettingsReport {
  const mk = (
    key: string,
    group: string,
    description: string,
    value: VrcSettingValueSnapshot,
  ) => ({
    encodedKey: `${key}_h123456`,
    key,
    group,
    description,
    ...value,
  });

  const entries = [
    mk("VRC_INPUT_MIC_ENABLED", "audio", "Microphone enabled on launch", {
      type: "bool",
      boolValue: true,
    }),
    mk("VRC_VOICE_VOLUME", "audio", "Voice mix level (0.0–1.0)", {
      type: "float",
      floatValue: 0.85,
    }),
    mk("VRC_WORLD_VOLUME", "audio", "World sound mix level", {
      type: "float",
      floatValue: 0.7,
    }),
    mk("VRC_GRAPHICS_QUALITY", "graphics", "Unity quality preset (0–5)", {
      type: "int",
      intValue: 3,
    }),
    mk(
      "VRC_TARGET_FPS",
      "graphics",
      "Target frame rate when not VR (-1 = uncapped)",
      { type: "int", intValue: 90 },
    ),
    mk("VRC_PERFORMANCE_UI", "graphics", "Show FPS / perf overlay", {
      type: "bool",
      boolValue: false,
    }),
    mk(
      "VRC_NETWORK_DOWNLOAD_LIMIT",
      "network",
      "Concurrent asset downloads cap",
      { type: "int", intValue: 4 },
    ),
    mk(
      "VRC_ALLOW_UNTRUSTED_URL",
      "network",
      "Allow video players to load untrusted URLs",
      { type: "bool", boolValue: false },
    ),
    mk(
      "VRC_AVATAR_HIDE_UNKNOWN",
      "avatars",
      "Default: hide avatars from users outside your friends list",
      { type: "bool", boolValue: false },
    ),
    mk(
      "VRC_AVATAR_MAX_DOWNLOAD_MB",
      "avatars",
      "Largest avatar bundle to auto-download",
      { type: "int", intValue: 200 },
    ),
    mk("VRC_OSC_ENABLED", "osc", "Expose OSC endpoints on launch", {
      type: "bool",
      boolValue: false,
    }),
    mk("VRC_OSC_IN_PORT", "osc", "Incoming OSC UDP port", {
      type: "int",
      intValue: 9000,
    }),
    mk("VRC_OSC_OUT_PORT", "osc", "Outgoing OSC UDP port", {
      type: "int",
      intValue: 9001,
    }),
  ];

  const groups: Record<string, number[]> = {
    audio: [],
    graphics: [],
    network: [],
    avatars: [],
    osc: [],
    comfort: [],
    ui: [],
    privacy: [],
    other: [],
  };
  entries.forEach((entry, index) => {
    const bucket = groups[entry.group];
    if (bucket) bucket.push(index);
    else groups.other.push(index);
  });

  return { entries, count: entries.length, groups };
}

class IpcClient {
  private bridge: WebViewBridge | null;
  private pending: Map<string, Pending>;
  private events: EventTarget;
  private listenerAttached: boolean;
  private mockLogStreamTimer: number | null;

  constructor() {
    this.bridge = window.chrome?.webview ?? null;
    this.pending = new Map();
    this.events = new EventTarget();
    this.listenerAttached = false;
    this.mockLogStreamTimer = null;
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
        // The wire envelope carries `{code, message}`. Promise consumers
        // invariably do `e instanceof Error ? e.message : String(e)` — if
        // we reject with the bare object, `String({code,message})` turns
        // into `[object Object]` in every toast. Wrap in a real Error so
        // every call site gets a usable message without special casing.
        const err = new Error(resp.error.message || resp.error.code || "ipc error");
        (err as Error & { code?: string }).code = resp.error.code;
        slot.reject(err);
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
      case "logs.stream.start":
        this.startMockLogStream();
        return { ok: true } as unknown as TResult;
      case "logs.stream.stop":
        this.stopMockLogStream();
        return { ok: true } as unknown as TResult;
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
      case "shell.pickFolder":
        return { cancelled: true } as unknown as TResult;
      case "shell.openUrl":
        // Mock branch: no side effect, just echo success so the UI can be
        // exercised in browser-only dev mode without shelling out.
        return { ok: true } as unknown as TResult;
      case "junction.repair":
        return { ok: true } as unknown as TResult;
      case "thumbnails.fetch": {
        // Mock mirrors the real backend:
        //   - `wrld_*` → the public worlds endpoint works, so we fake a
        //     deterministic picsum URL so devs running without the C++
        //     host still see real-looking Worlds tiles.
        //   - `avtr_*` → VRChat rejects anonymous avatar lookups with 401
        //     even with the community API key, so the real VrcApi short-
        //     circuits and the frontend never actually reaches this branch
        //     for avatar ids. Kept here for defensive symmetry.
        const p = (params ?? {}) as { ids?: string[]; id?: string };
        const ids = p.ids ?? (p.id ? [p.id] : []);
        const results = ids.map((id) => {
          if (id.startsWith("wrld_")) {
            const seed = encodeURIComponent(id.slice(0, 16));
            return {
              id,
              url: `https://picsum.photos/seed/${seed}/256/144`,
              cached: false,
              error: null,
            };
          }
          return {
            id,
            url: null,
            cached: false,
            error: "avatar-api-requires-auth",
          };
        });
        return { results } as unknown as TResult;
      }
      case "settings.readAll":
        return buildMockSettingsReport() as unknown as TResult;
      case "settings.writeOne":
        return { ok: true } satisfies VrcSettingsWriteResult as unknown as TResult;
      case "settings.exportReg":
        return {
          ok: true,
          path: "C:/Users/dev/AppData/Local/Temp/vrcsm-vrc-settings-mock.reg",
        } satisfies VrcSettingsExportResult as unknown as TResult;
      default:
        return null as unknown as TResult;
    }
  }

  private startMockLogStream(): void {
    if (this.mockLogStreamTimer !== null) return;

    const emit = () => {
      const sample: LogStreamChunk = {
        line: "[Log] Waiting for host log stream...",
        level: "info",
        timestamp: nowIso(),
        source: "mock",
      };
      this.events.dispatchEvent(
        new CustomEvent("logs.stream", {
          detail: sample,
        }),
      );
    };

    emit();
    this.mockLogStreamTimer = window.setInterval(emit, 8000);
  }

  private stopMockLogStream(): void {
    if (this.mockLogStreamTimer === null) return;
    window.clearInterval(this.mockLogStreamTimer);
    this.mockLogStreamTimer = null;
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

  async pickFolder(
    opts: { title?: string; initialDir?: string } = {},
  ): Promise<PickFolderResult> {
    return this.call<typeof opts, PickFolderResult>("shell.pickFolder", opts);
  }

  async readVrcSettings(): Promise<VrcSettingsReport> {
    return this.call<undefined, VrcSettingsReport>("settings.readAll");
  }

  async writeVrcSetting(
    encodedKey: string,
    value: VrcSettingValueSnapshot,
  ): Promise<VrcSettingsWriteResult> {
    return this.call<VrcSettingsWriteRequest, VrcSettingsWriteResult>(
      "settings.writeOne",
      { encodedKey, value },
    );
  }

  async exportVrcSettings(outPath?: string): Promise<VrcSettingsExportResult> {
    return this.call<{ outPath?: string }, VrcSettingsExportResult>(
      "settings.exportReg",
      outPath ? { outPath } : {},
    );
  }
}

export interface PickFolderResult {
  cancelled: boolean;
  path?: string;
}

export const ipc = new IpcClient();
