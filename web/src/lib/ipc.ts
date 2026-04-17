import type {
  AppVersion,
  AuthStatus,
  AuthUser,
  BundlePreview,
  DeleteResult,
  DryRunResult,
  FavoriteItem,
  FavoriteListSummary,
  FavoritesSyncResult,
  Friend,
  FriendsListResult,
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
  SteamVrConfig,
  VrcSettingValueSnapshot,
  MemoryStatus,
  RadarSnapshot,
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

/**
 * Structured IPC error — mirrors the C++ `Error` struct's JSON shape.
 * Every IPC rejection now carries a machine-readable `code` that callers
 * can switch on instead of parsing exception message strings.
 */
export class IpcError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 0) {
    super(message);
    this.name = "IpcError";
    this.code = code;
    this.httpStatus = httpStatus;
  }

  /** True when the backend reports a stale/missing session cookie. */
  get isAuthExpired(): boolean {
    return this.code === "auth_expired" || this.httpStatus === 401;
  }
}

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

const mockFavorites: FavoriteItem[] = [
  {
    type: "world",
    target_id: "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    list_name: "Library",
    display_name: "Mock World A",
    thumbnail_url: "https://picsum.photos/seed/mock-world-a/512/288",
    added_at: "2026-04-16T13:20:00Z",
    sort_order: 0,
    tags: ["scenic", "sleep"],
    note: "Good ambient world for screenshot sessions and low-key late-night chill.",
    note_updated_at: "2026-04-16T14:00:00Z",
  },
  {
    type: "avatar",
    target_id: "avtr_99999999-8888-7777-6666-555555555555",
    list_name: "Library",
    display_name: "Mock Avatar",
    thumbnail_url: null,
    added_at: "2026-04-17T08:40:00Z",
    sort_order: 0,
    tags: ["meme", "flashy"],
    note: null,
    note_updated_at: null,
  },
];

function buildMockFavoriteLists(): FavoriteListSummary[] {
  const map = new Map<string, FavoriteListSummary>();
  for (const item of mockFavorites) {
    const key = `${item.list_name}::${item.type ?? ""}`;
    const row = map.get(key);
    if (row) {
      row.item_count += 1;
      if ((item.added_at ?? "") > (row.latest_added_at ?? "")) {
        row.latest_added_at = item.added_at;
      }
      continue;
    }
    map.set(key, {
      list_name: item.list_name,
      name: item.list_name,
      type: item.type,
      item_count: 1,
      latest_added_at: item.added_at,
    });
  }
  return Array.from(map.values()).sort((a, b) =>
    (b.latest_added_at ?? "").localeCompare(a.latest_added_at ?? ""),
  );
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
      info_url: "",
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
      player_events: [
        { kind: "joined", iso_time: "2026.04.15 00:42:02", display_name: "mock_user", user_id: "usr_mock-1234-5678" },
        { kind: "left", iso_time: "2026.04.15 00:58:11", display_name: "mock_user", user_id: "usr_mock-1234-5678" },
      ],
      avatar_switches: [
        { iso_time: "2026.04.15 00:42:01", actor: "mock_user", avatar_name: "Mock Avatar" },
      ],
      screenshots: [
        { iso_time: "2026.04.15 02:18:44", path: "C:\\Users\\mock\\Pictures\\VRChat\\2026-04\\VRChat_2026-04-15_02-18-44.439_1920x1080.png" },
      ],
      world_switches: [
        {
          iso_time: "2026.04.15 00:41:48",
          world_id: "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          instance_id: "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:12345~hidden(usr_mock-1234-5678)~region(jp)",
          access_type: "hidden",
          owner_id: "usr_mock-1234-5678",
          region: "jp"
        },
        {
          iso_time: "2026.04.15 01:10:22",
          world_id: "wrld_11111111-2222-3333-4444-555555555555",
          instance_id: "wrld_11111111-2222-3333-4444-555555555555:9999~public~region(us)",
          access_type: "public",
          owner_id: null,
          region: "us"
        }
      ],
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
        const err = new IpcError(
          resp.error.code ?? "unknown",
          resp.error.message || resp.error.code || "ipc error",
          resp.error.httpStatus ?? 0,
        );

        // ── Global auth-expired interceptor ──
        // Any handler returning "auth_expired" or HTTP 401 fires a
        // window-level event so App.tsx can pop the LoginForm overlay
        // without every page needing its own auth-check logic.
        if (err.isAuthExpired) {
          window.dispatchEvent(
            new CustomEvent("vrcsm:auth-expired", { detail: err }),
          );
        }

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
        return { version: "0.5.0", build: "mock" } as unknown as TResult;
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
      case "auth.status":
        return {
          authed: false,
          userId: null,
          displayName: null,
        } satisfies AuthStatus as unknown as TResult;
      case "auth.login": {
        // Browser-only dev mode has no real WinHTTP path. Pretend the
        // call succeeded so UI flows can be exercised without the C++
        // host — but flip `auth.status` in the next poll loop by
        // hand-waving a signed-in response here. The mock Friends page
        // then renders the fake friends list from below.
        const p = (params ?? {}) as { username?: string; password?: string };
        if (!p.username || !p.password) {
          return {
            status: "error",
            error: "missing-credentials",
          } as unknown as TResult;
        }
        return {
          status: "success",
          user: {
            authed: true,
            userId: "usr_mock-1234-5678",
            displayName: p.username,
          },
        } as unknown as TResult;
      }
      case "auth.verify2FA":
        return {
          ok: true,
          user: {
            authed: true,
            userId: "usr_mock-1234-5678",
            displayName: "mock_user",
          },
        } as unknown as TResult;
      case "auth.logout":
        return { ok: true } as unknown as TResult;
      case "avatar.preview": {
        // Browser-only dev mode can't spawn AssetRipper, so always
        // return the same "extractor missing" response the host would
        // send on an un-bundled install. The React <AvatarPreview3D>
        // component uses this branch to exercise its empty-state.
        const p = (params ?? {}) as { avatarId?: string };
        return {
          avatarId: p.avatarId ?? "",
          ok: false,
          code: "extractor_missing",
          message: "browser dev mode has no extractor",
        } as unknown as TResult;
      }
      case "auth.user":
        return {
          id: "usr_mock-1234-5678",
          username: "mock_user",
          displayName: "mock_user",
          currentAvatarImageUrl: null,
          currentAvatarThumbnailImageUrl: null,
          status: "active",
          statusDescription: "browser dev mode",
          bio: null,
          last_platform: "standalonewindows",
        } satisfies AuthUser as unknown as TResult;
      case "friends.list": {
        // Emit a deterministic list so the Friends page shows something
        // in browser dev mode. IDs follow VRChat's real prefix scheme.
        const mockAvatarNames = [
          "Taihou",
          "Manuka",
          "Selestia",
          "Karin",
          null,
          "Wolferia",
          null,
          "Lime",
          "Rindo",
          null,
          "Shinra",
          "Leefa",
        ];
        const mockFriends: Friend[] = Array.from({ length: 12 }).map((_, i) => ({
          id: `usr_mock_friend_${i.toString().padStart(3, "0")}`,
          username: `friend_${i}`,
          displayName: `Mock Friend ${i + 1}`,
          currentAvatarImageUrl: null,
          currentAvatarThumbnailImageUrl: i % 3 === 0 ? `https://picsum.photos/seed/avtr${i}/128/128` : null,
          currentAvatarName: mockAvatarNames[i] ?? null,
          statusDescription: i % 3 === 0 ? "In a world" : null,
          status: i % 4 === 0 ? "busy" : i % 4 === 1 ? "join me" : "active",
          location: i % 3 === 0 ? `wrld_aaaabbbb-cccc-dddd-eeee-${i.toString().padStart(12, "0")}:12345~hidden(usr_owner)~region(jp)` : "offline",
          last_platform: i % 2 === 0 ? "standalonewindows" : "android",
          bio: i % 5 === 0 ? "Mock bio for dev mode" : null,
          developerType: null,
          last_login: null,
          last_activity: null,
          profilePicOverride: null,
          userIcon: null,
          tags:
            i % 6 === 0
              ? ["system_trust_trusted"]
              : i % 6 === 1
                ? ["system_trust_known"]
                : i % 6 === 2
                  ? ["system_trust_basic"]
                  : [],
        }));
        return {
          friends: mockFriends,
        } satisfies FriendsListResult as unknown as TResult;
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
      case "favorites.lists":
        return { lists: buildMockFavoriteLists() } as unknown as TResult;
      case "favorites.items": {
        const p = (params ?? {}) as { list_name?: string };
        const listName = p.list_name ?? "Library";
        return {
          items: mockFavorites
            .filter((item) => item.list_name === listName)
            .sort((a, b) =>
              a.sort_order !== b.sort_order
                ? a.sort_order - b.sort_order
                : (a.added_at ?? "").localeCompare(b.added_at ?? ""),
            ),
        } as unknown as TResult;
      }
      case "favorites.add": {
        const p = (params ?? {}) as {
          type?: string;
          target_id?: string;
          list_name?: string;
          display_name?: string;
          thumbnail_url?: string | null;
        };
        const type = p.type ?? "";
        const targetId = p.target_id ?? "";
        const listName = p.list_name ?? "Library";
        const existingIndex = mockFavorites.findIndex(
          (item) =>
            item.type === type &&
            item.target_id === targetId &&
            item.list_name === listName,
        );
        const next: FavoriteItem = {
          type,
          target_id: targetId,
          list_name: listName,
          display_name: p.display_name ?? null,
          thumbnail_url: p.thumbnail_url ?? null,
          added_at: nowIso(),
          sort_order: 0,
          tags: existingIndex >= 0 ? mockFavorites[existingIndex].tags : [],
          note: existingIndex >= 0 ? mockFavorites[existingIndex].note : null,
          note_updated_at: existingIndex >= 0 ? mockFavorites[existingIndex].note_updated_at : null,
        };
        if (existingIndex >= 0) {
          mockFavorites.splice(existingIndex, 1, next);
        } else {
          mockFavorites.push(next);
        }
        return { ok: true } as unknown as TResult;
      }
      case "favorites.remove": {
        const p = (params ?? {}) as {
          type?: string;
          target_id?: string;
          list_name?: string;
        };
        const existingIndex = mockFavorites.findIndex(
          (item) =>
            item.type === (p.type ?? "") &&
            item.target_id === (p.target_id ?? "") &&
            item.list_name === (p.list_name ?? "Library"),
        );
        if (existingIndex >= 0) {
          mockFavorites.splice(existingIndex, 1);
        }
        return { ok: true } as unknown as TResult;
      }
      case "favorites.note.set": {
        const p = (params ?? {}) as {
          type?: string;
          target_id?: string;
          list_name?: string;
          note?: string;
        };
        const updatedAt = nowIso();
        const item = mockFavorites.find(
          (entry) =>
            entry.type === (p.type ?? "") &&
            entry.target_id === (p.target_id ?? "") &&
            entry.list_name === (p.list_name ?? "Library"),
        );
        if (item) {
          const note = p.note?.trim() ?? "";
          item.note = note.length > 0 ? p.note ?? "" : null;
          item.note_updated_at = note.length > 0 ? updatedAt : null;
        }
        return { ok: true, updated_at: updatedAt } as unknown as TResult;
      }
      case "favorites.tags.set": {
        const p = (params ?? {}) as {
          type?: string;
          target_id?: string;
          list_name?: string;
          tags?: string[];
        };
        const updatedAt = nowIso();
        const item = mockFavorites.find(
          (entry) =>
            entry.type === (p.type ?? "") &&
            entry.target_id === (p.target_id ?? "") &&
            entry.list_name === (p.list_name ?? "Library"),
        );
        if (item) {
          item.tags = Array.from(
            new Map(
              (p.tags ?? [])
                .map((tag) => tag.trim())
                .filter(Boolean)
                .map((tag) => [tag.toLowerCase(), tag] as const),
            ).values(),
          ).sort((a, b) => a.localeCompare(b));
        }
        return { ok: true, updated_at: updatedAt } as unknown as TResult;
      }
      case "favorites.syncOfficial": {
        const listName = "VRChat Official Favorites";
        const syncedAt = nowIso();
        const officialItems: FavoriteItem[] = [
          {
            type: "world",
            target_id: "wrld_official_favorite_world_001",
            list_name: listName,
            display_name: "Official Favorite World",
            thumbnail_url: "https://picsum.photos/seed/official-world/512/288",
            added_at: syncedAt,
            sort_order: 0,
            tags: [],
            note: null,
            note_updated_at: null,
          },
          {
            type: "avatar",
            target_id: "avtr_official_favorite_avatar_001",
            list_name: listName,
            display_name: "Official Favorite Avatar",
            thumbnail_url: null,
            added_at: syncedAt,
            sort_order: 1,
            tags: [],
            note: null,
            note_updated_at: null,
          },
        ];
        for (let i = mockFavorites.length - 1; i >= 0; i -= 1) {
          if (mockFavorites[i].list_name === listName) {
            mockFavorites.splice(i, 1);
          }
        }
        mockFavorites.push(...officialItems);
        return {
          ok: true,
          list_name: listName,
          imported: officialItems.length,
          avatars: 1,
          worlds: 1,
          synced_at: syncedAt,
        } satisfies FavoritesSyncResult as unknown as TResult;
      }
      case "config.read":
        return {
          cache_directory: "D:/VRChatCache/",
          cache_size: 40,
          camera_res_height: 1080,
          camera_res_width: 1920,
          custom_load_screen_logo: "C:/Users/dev/Pictures/logo.png",
          desktop_reticle: true,
          enable_head_sync: false,
          fpv_camera_smoothing: 0.1,
          fov: 90,
          fps_limit_desktop: 144,
          fps_limit_vr: 90,
          ignore_particles: false,
        } as unknown as TResult;
      case "config.write":
        return { ok: true } as unknown as TResult;
      case "avatar.details": {
        return {
          details: {
            name: "Mock Avatar Model",
            description: "A test avatar generated in browser dev mode.",
            authorName: "VRCSM Dev",
            authorId: "usr_mock-author-0001",
            releaseStatus: "private",
            version: 3,
            thumbnailImageUrl: null,
            imageUrl: null,
            tags: ["author_tag_test", "content_horror"],
            unityPackages: [
              { platform: "standalonewindows", unityVersion: "2022.3.22f1", assetVersion: 4 },
              { platform: "android", unityVersion: "2022.3.22f1", assetVersion: 4 },
            ],
            created_at: "2025-06-01T12:00:00Z",
            updated_at: nowIso(),
          },
        } as unknown as TResult;
      }
      case "user.me": {
        return {
          profile: {
            id: "usr_mock-1234-5678",
            displayName: "mock_user",
            bio: "Browser dev mode user.\nこれはテストです。",
            status: "active",
            statusDescription: "VRCSM 開発中",
            currentAvatarImageUrl: null,
            currentAvatarThumbnailImageUrl: null,
            profilePicOverride: "",
            developerType: "none",
            last_login: nowIso(),
            last_activity: nowIso(),
            worldId: "",
            location: "",
            bioLinks: ["https://github.com/vrcsm"],
            tags: ["system_trust_trusted"],
          },
        } as unknown as TResult;
      }
      case "user.getProfile": {
        const p = (params ?? {}) as { userId?: string };
        return {
          profile: {
            id: p.userId ?? "usr_unknown",
            displayName: "Mock User Profile",
            bio: "Fetched via user.getProfile mock.",
            status: "active",
            statusDescription: "",
            currentAvatarImageUrl: null,
            currentAvatarThumbnailImageUrl: null,
            profilePicOverride: "",
            developerType: "none",
            last_login: nowIso(),
            last_activity: nowIso(),
            worldId: "",
            location: "",
            bioLinks: [],
            tags: ["system_trust_known"],
          },
        } as unknown as TResult;
      }
      case "user.updateProfile":
        return { profile: null } as unknown as TResult;
      case "screenshots.list": {
        const mockShots = Array.from({ length: 8 }).map((_, i) => {
          const d = new Date(Date.now() - i * 86400000);
          const dateStr = d.toISOString().slice(0, 10);
          const timeStr = d.toISOString().slice(11, 19).replace(/:/g, "-");
          const filename = `VRChat_2560x1440_${dateStr}_${timeStr}.png`;
          return {
            path: `C:/Users/dev/Pictures/VRChat/${dateStr.slice(0, 7)}/${filename}`,
            filename,
            created_at: d.toISOString(),
            size_bytes: 2_400_000 + Math.floor(Math.random() * 1_600_000),
            url: `https://picsum.photos/seed/vrcsm${i}/640/360`,
          };
        });
        return {
          screenshots: mockShots,
          folder: "C:/Users/dev/Pictures/VRChat",
        } as unknown as TResult;
      }
      case "screenshots.open":
      case "screenshots.folder":
        return { ok: true } as unknown as TResult;
      case "screenshots.delete": {
        const p = (params ?? {}) as { paths?: string[] };
        const paths = p.paths ?? [];
        return { deleted: paths.length, failed: [] } as unknown as TResult;
      }
      case "app.factoryReset":
        return {
          ok: true,
          removed: ["session.dat", "thumb-cache.json"],
          skipped: ["WebView2"],
        } as unknown as TResult;
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

  async readConfig(params?: { path?: string }): Promise<any> {
    return this.call<typeof params, any>("config.read", params);
  }

  async writeConfig(params: { path?: string; config: any }): Promise<{ ok: boolean }> {
    return this.call<typeof params, { ok: boolean }>("config.write", params);
  }

  async readSteamVrConfig(): Promise<SteamVrConfig> {
    return this.call<undefined, SteamVrConfig>("steamvr.read");
  }

  async writeSteamVrConfig(config: any): Promise<{ ok: boolean }> {
    return this.call<{ config: any }, { ok: boolean }>("steamvr.write", { config });
  }

  async readMemoryStatus(): Promise<MemoryStatus> {
    return this.call<{}, MemoryStatus>("memory.status", {});
  }

  async radarPoll(): Promise<RadarSnapshot> {
    return this.call<{}, RadarSnapshot>("radar.poll", {});
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

  // ── Database / History ──────────────────────────────────────────────

  async dbWorldVisits(limit = 100, offset = 0) {
    return this.call<{ limit: number; offset: number }, { items: any[] }>(
      "db.worldVisits.list", { limit, offset },
    );
  }

  async dbPlayerEvents(limit = 100, offset = 0) {
    return this.call<{ limit: number; offset: number }, { items: any[] }>(
      "db.playerEvents.list", { limit, offset },
    );
  }

  async dbPlayerEncounters(userId: string) {
    return this.call<{ user_id: string }, { items: any[] }>(
      "db.playerEncounters", { user_id: userId },
    );
  }

  async dbAvatarHistory(limit = 100, offset = 0) {
    return this.call<{ limit: number; offset: number }, { items: any[] }>(
      "db.avatarHistory.list", { limit, offset },
    );
  }

  async dbStatsHeatmap(days = 30) {
    return this.call<{ days: number }, any>("db.stats.heatmap", { days });
  }

  async dbStatsOverview() {
    return this.call<undefined, any>("db.stats.overview");
  }

  // ── Favorites ───────────────────────────────────────────────────────

  async favoriteLists() {
    return this.call<undefined, { lists: FavoriteListSummary[] }>("favorites.lists");
  }

  async favoriteItems(listName: string) {
    return this.call<{ list_name: string }, { items: FavoriteItem[] }>(
      "favorites.items", { list_name: listName },
    );
  }

  async favoriteAdd(params: {
    type: string; target_id: string; list_name: string;
    display_name?: string; thumbnail_url?: string;
  }) {
    return this.call<typeof params, { ok: boolean }>("favorites.add", params);
  }

  async favoriteRemove(type: string, targetId: string, listName: string) {
    return this.call<
      { type: string; target_id: string; list_name: string },
      { ok: boolean }
    >("favorites.remove", { type, target_id: targetId, list_name: listName });
  }

  async favoriteNoteSet(params: {
    type: string;
    target_id: string;
    list_name: string;
    note: string;
  }) {
    return this.call<typeof params, { ok: boolean; updated_at: string }>(
      "favorites.note.set",
      params,
    );
  }

  async favoriteTagsSet(params: {
    type: string;
    target_id: string;
    list_name: string;
    tags: string[];
  }) {
    return this.call<typeof params, { ok: boolean; updated_at: string }>(
      "favorites.tags.set",
      params,
    );
  }

  async favoriteSyncOfficial() {
    return this.call<undefined, FavoritesSyncResult>("favorites.syncOfficial");
  }

  // ── Friend Log ──────────────────────────────────────────────────────

  async friendLogRecent(limit = 100, offset = 0) {
    return this.call<{ limit: number; offset: number }, { items: any[] }>(
      "friendLog.recent", { limit, offset },
    );
  }

  async friendLogForUser(userId: string, limit = 100, offset = 0) {
    return this.call<
      { user_id: string; limit: number; offset: number },
      { items: any[] }
    >("friendLog.forUser", { user_id: userId, limit, offset });
  }

  async friendNoteGet(userId: string) {
    return this.call<{ user_id: string }, { note: string | null }>(
      "friendNote.get", { user_id: userId },
    );
  }

  async friendNoteSet(userId: string, note: string) {
    return this.call<
      { user_id: string; note: string },
      { ok: boolean; updated_at: string }
    >("friendNote.set", { user_id: userId, note });
  }
}

export interface PickFolderResult {
  cancelled: boolean;
  path?: string;
}

export const ipc = new IpcClient();
