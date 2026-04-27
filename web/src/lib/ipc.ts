import type {
  AppVersion,
  AvatarSearchResult,
  AuthStatus,
  AuthUserDetailsResult,
  BundlePreview,
  DeleteResult,
  DryRunResult,
  FavoriteItem,
  FavoriteListSummary,
  FavoritesSyncResult,
  InstalledPluginDto,
  IpcEnvelopeEvent,
  IpcEnvelopeRequest,
  IpcEnvelopeResponse,
  MarketFeedDto,
  MigratePlan,
  PluginInstallResult,
  ProcessStatus,
  Report,
  LogStreamChunk,
  VrcSettingsReport,
  VrcSettingsWriteRequest,
  VrcSettingsWriteResult,
  VrcSettingsExportResult,
  SteamVrConfig,
  SteamVrLinkBackupList,
  SteamVrLinkDiagnostic,
  SteamVrLinkRepairResult,
  VrcSettingValueSnapshot,
  MemoryStatus,
  RadarSnapshot,
  UserSearchResult,
} from "./types";

const FAVORITES_COMPAT_STORAGE_KEY = "vrcsm:favorites-compat";

export interface CalendarEvent {
  id?: string;
  name?: string;
  description?: string;
  starts_at?: string;
  ends_at?: string;
  startsAt?: string;
  endsAt?: string;
  world_id?: string;
  worldId?: string;
  image_url?: string;
  imageUrl?: string;
  thumbnailImageUrl?: string;
  region?: string;
  [key: string]: unknown;
}

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
  timerId: number | null;
};

// Default 60-second ceiling for any IPC call. If the host handler hangs
// (e.g. a worker thread deadlocks inside radar.poll), the Promise used to
// leak forever and the pending Map grew without bound. With this ceiling
// the call rejects with `IpcError("timeout", ...)` and the slot is freed.
const DEFAULT_IPC_TIMEOUT_MS = 60_000;

// Methods that legitimately take longer than the default ceiling. Cache
// migration copies tens of GB; avatar extraction shells out to AssetRipper;
// favorites.syncOfficial round-trips the full VRChat favorites graph.
// For these we disable the timer — callers own their own cancellation.
const LONG_RUNNING_METHODS = new Set<string>([
  "migrate.execute",
  "scan",
  "avatar.bundle.download",
  "avatar.preview",
  "avatar.preview.prefetch",
  "favorites.syncOfficial",
  "favorites.export",
  "favorites.import",
  // thumbnails.fetch removed: a batch of ~50 ids parallel-fetches in ~6s,
  // a stuck call should not pin the pending map forever — let the default
  // 60s timeout reject it so memo entries can clear and retry.
]);

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

// Lazy-load mock data — only pulled in when running in browser dev mode
// (bridge === null). In production WebView2 builds, mockCall is never
// reached, so Vite code-splits this into a chunk that is never fetched,
// saving ~14 KB from the main bundle.
type MockModule = typeof import("./__mocks__/ipc-mock-data");
let _mockModule: MockModule | null = null;
async function getMockModule(): Promise<MockModule> {
  if (!_mockModule) {
    _mockModule = await import("./__mocks__/ipc-mock-data");
  }
  return _mockModule;
}


function readCompatFavorites(): FavoriteItem[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(FAVORITES_COMPAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is FavoriteItem => {
      return (
        item &&
        typeof item === "object" &&
        typeof item.target_id === "string" &&
        typeof item.list_name === "string"
      );
    });
  } catch {
    return [];
  }
}

function writeCompatFavorites(items: FavoriteItem[]): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  window.localStorage.setItem(
    FAVORITES_COMPAT_STORAGE_KEY,
    JSON.stringify(items),
  );
}

function isMethodNotFoundError(error: unknown): boolean {
  if (!(error instanceof IpcError)) {
    return false;
  }
  return (
    error.code === "method_not_found" ||
    error.message.includes("Unknown IPC method:")
  );
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
      if (slot.timerId !== null) {
        window.clearTimeout(slot.timerId);
      }
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
    const applyTimeout = !LONG_RUNNING_METHODS.has(method);
    const promise = new Promise<TResult>((resolve, reject) => {
      let timerId: number | null = null;
      if (applyTimeout) {
        timerId = window.setTimeout(() => {
          if (!this.pending.has(id)) return;
          this.pending.delete(id);
          reject(
            new IpcError(
              "timeout",
              `IPC '${method}' did not respond within ${DEFAULT_IPC_TIMEOUT_MS}ms`,
              0,
            ),
          );
        }, DEFAULT_IPC_TIMEOUT_MS);
      }
      this.pending.set(id, {
        resolve: (v) => resolve(v as TResult),
        reject,
        timerId,
      });
    });
    this.bridge.postMessage(JSON.stringify(envelope));
    return promise;
  }

  private async mockCall<TResult>(method: string, params?: unknown): Promise<TResult> {
    const { mockFavorites, buildMockReport, buildMockSettingsReport, buildMockFriends, buildMockFavoriteLists } = await getMockModule();
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
      case "fs.listDir": {
        const p = (params ?? {}) as { path?: string };
        const roots = [
          { path: "C:\\", label: "System", type: 3 },
          { path: "D:\\", label: "Data", type: 3 },
        ];
        if (!p.path) {
          return {
            path: "",
            parent: null,
            entries: [],
            roots,
            truncated: false,
          } as unknown as TResult;
        }
        return {
          path: p.path,
          parent: null,
          entries: [
            { name: "MockProject", isDir: true, hidden: false, system: false },
            { name: "Assets", isDir: true, hidden: false, system: false },
          ],
          roots,
          truncated: false,
        } as unknown as TResult;
      }
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
              localUrl: null,
              cached: false,
              imageCached: false,
              source: "network",
              error: null,
            };
          }
          return {
            id,
            url: null,
            localUrl: null,
            cached: false,
            imageCached: false,
            source: "negative",
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
      case "avatar.preview.status":
        return {
          cached: false,
          bundleIndexed: false,
          sourceSig: null,
          cacheSource: null,
        } as unknown as TResult;
      case "avatar.preview.prefetch":
        return {
          ok: false,
          cached: false,
          queued: false,
          skipped: "browser-dev-mode",
        } as unknown as TResult;
      case "auth.user":
        return {
          authed: true,
          user: {
            id: "usr_mock-1234-5678",
            username: "mock_user",
            displayName: "mock_user",
            currentAvatarImageUrl: null,
            currentAvatarThumbnailImageUrl: null,
            status: "active",
            statusDescription: "browser dev mode",
            bio: null,
            last_platform: "standalonewindows",
            obfuscatedEmail: "mo***@example.com",
            emailVerified: true,
            steamId: "76561198000000000",
            tags: ["system_supporter", "language_eng"],
            subscriptionTier: "VRC+",
          },
        } satisfies AuthUserDetailsResult as unknown as TResult;
      case "friends.list":
        return buildMockFriends() as unknown as TResult;
      case "settings.readAll":
        return buildMockSettingsReport() as unknown as TResult;
      case "settings.writeOne":
        return { ok: true } satisfies VrcSettingsWriteResult as unknown as TResult;
      case "settings.exportReg":
        return {
          ok: true,
          path: "C:/Users/dev/AppData/Local/Temp/vrcsm-vrc-settings-mock.reg",
        } satisfies VrcSettingsExportResult as unknown as TResult;
      case "steamvr.link.diagnose":
        return {
          ok: true,
          summary: "Mock VRLink diagnosis: invalid session ID + wireless HMD not connected signature found.",
          steamPath: "D:/Steam",
          steamVrInstalled: true,
          steamVrInstallPath: "D:/Steam/steamapps/common/SteamVR",
          manifest: {
            path: "D:/Steam/steamapps/appmanifest_250820.acf",
            exists: true,
            isBeta: true,
            pendingDownload: false,
            fields: { buildid: "22769751", TargetBuildID: "0" },
            markers: ['"BetaKey"        "beta"'],
          },
          localconfigs: [
            {
              path: "D:/Steam/userdata/123/config/localconfig.vdf",
              exists: true,
              questDeviceCount: 2,
              betaMarkers: 1,
              markers: ['"DeviceName"        "Oculus Quest 3"', '"250820-beta"'],
            },
          ],
          logs: {
            counts: { invalid_session: 64, wireless_not_connected: 1, lost_master: 1, ready: 0 },
            matches: [
              { file: "driver_vrlink.txt", line: 120, kind: "invalid_session", text: "Warning: received packet with invalid session ID" },
              { file: "vrmonitor.txt", line: 24, kind: "wireless_hmd_215", text: "VR_Init failed with A wireless HMD driver is present, but the wireless HMD has not connected yet (215)" },
            ],
          },
          issues: [
            {
              id: "vrlink_session_mismatch",
              severity: "critical",
              title: "VRLink session ID mismatch",
              detail: "Quest packets reached the PC, but SteamVR rejected the wireless HMD session.",
              repairPlan: "full-vrlink-reset",
            },
            {
              id: "quest_pairing_cache",
              severity: "warning",
              title: "Quest / Steam Link pairing cache is present",
              detail: "Two Quest pairing markers were found in localconfig.vdf.",
              repairPlan: "pairing-reset",
            },
          ],
          repairPlans: [
            {
              id: "pairing-reset",
              title: "Pairing reset",
              risk: "low",
              recommended: true,
              description: "Backs up localconfig.vdf, clears Quest streaming device blocks, and clears SteamVR htmlcache.",
              actions: ["Stop SteamVR/Steam", "Back up localconfig.vdf", "Remove Quest streaming device blocks"],
            },
            {
              id: "full-vrlink-reset",
              title: "Full VRLink reset",
              risk: "medium",
              recommended: true,
              description: "Clears pairing, VRLink runtime cache, SteamVR beta markers, and archives old logs.",
              actions: ["Stop Steam/SteamVR", "Move config/vrlink", "Open steam://validate/250820"],
            },
            {
              id: "safe-streaming",
              title: "Safe streaming parameters",
              risk: "low",
              recommended: false,
              description: "Writes conservative Quest-safe streaming settings.",
              actions: ["80 Mbps auto bandwidth", "1.0x supersampling", "72 Hz"],
            },
          ],
          suggestedSettings: [
            {
              id: "low-stability",
              title: "Low performance stability",
              recommended: false,
              bandwidth: 60,
              supersampleScale: 0.8,
              refreshRate: 72,
              note: "Use when the link connects but jitters or black-screens.",
              updates: {
                driver_vrlink: { targetBandwidth: 60, automaticBandwidth: true },
                steamvr: {
                  supersampleScale: 0.8,
                  supersampleManualOverride: true,
                  preferredRefreshRate: 72,
                  motionSmoothing: false,
                  allowSupersampleFiltering: true,
                },
              },
            },
          ],
          recommendations: [
            "Reset Steam Link / Quest pairing cache and re-pair from the headset.",
            "Remove SteamVR BetaKey and validate AppID 250820 to return to the stable branch.",
          ],
        } satisfies SteamVrLinkDiagnostic as unknown as TResult;
      case "steamvr.link.repair": {
        const p = (params ?? {}) as { dryRun?: boolean };
        return {
          ok: true,
          dryRun: p.dryRun ?? true,
          planId: (params as { planId?: string } | undefined)?.planId ?? "full-vrlink-reset",
          backupDir: "D:/Steam/config/vrcsm-vrlink-reset-mock",
          actions: [
            "Stop process vrserver.exe (1234)",
            "Remove BetaKey lines from D:/Steam/steamapps/appmanifest_250820.acf",
            "Remove Quest / Steam Link streaming device blocks from localconfig.vdf",
            "Open steam://validate/250820 after repair",
          ],
          backups: [],
          stopped: [],
          failures: [],
          manifestBetaLinesRemoved: p.dryRun ? 0 : 2,
          localconfigDeviceBlocksRemoved: p.dryRun ? 0 : 2,
          localconfigBetaBlocksRemoved: p.dryRun ? 0 : 1,
        } satisfies SteamVrLinkRepairResult as unknown as TResult;
      }
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
      case "groups.list": {
        return {
          groups: [
            {
              id: "grp_mock_0001",
              name: "VRCSM Test Group",
              shortCode: "VRCSM",
              description: "Mock native group surface for browser dev mode.",
              iconUrl: null,
              bannerUrl: null,
              discriminator: "0001",
              ownerId: "usr_mock-owner-0001",
              memberCount: 128,
              onlineMemberCount: 12,
              privacy: "default",
              isVerified: false,
              isRepresenting: true,
              createdAt: "2026-01-05T10:20:00Z",
              lastPostCreatedAt: nowIso(),
              roles: ["member", "representative"],
            },
          ],
        } as unknown as TResult;
      }
      case "moderations.list": {
        return {
          items: [
            {
              id: "mod_mock_block_0001",
              type: "block",
              targetUserId: "usr_mock-blocked-0001",
              targetDisplayName: "Muted Troublemaker",
              sourceUserId: "usr_mock-1234-5678",
              created: "2026-04-15T14:10:00Z",
            },
            {
              id: "mod_mock_mute_0002",
              type: "mute",
              targetUserId: "usr_mock-muted-0002",
              targetDisplayName: "Very Loud Friend",
              sourceUserId: "usr_mock-1234-5678",
              created: "2026-04-16T09:30:00Z",
            },
          ],
        } as unknown as TResult;
      }
      case "avatar.bundle.download": {
        const p = (params ?? {}) as {
          avatarId?: string;
          outDir?: string;
          displayName?: string;
        };
        return {
          ok: true,
          path: `${p.outDir ?? "C:/Temp"}/${(p.displayName ?? "avatar").replace(/[<>:\"/\\\\|?*]/g, "_")}-${p.avatarId ?? "unknown"}.vrca`,
        } as unknown as TResult;
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
            bioLinks: ["https://github.com/vrcsm", "https://discord.gg/vrcsm"],
            tags: ["system_trust_trusted", "language_eng", "language_zho"],
            pronouns: "they/them",
            date_joined: "2022-03-15",
            ageVerificationStatus: "verified",
            steamId: "76561198012345678",
            oculusId: "",
            googleId: "",
            picoId: "",
            viveId: "",
            hasEmail: true,
            emailVerified: true,
            twoFactorAuthEnabled: true,
            allowAvatarCopying: false,
            hasLoggedInFromClient: true,
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
      case "user.search": {
        const p = (params ?? {}) as { query?: string };
        const id = `usr_mock_${encodeURIComponent(p.query ?? "user")}`;
        return {
          users: [
            {
              id,
              displayName: p.query || "Mock User",
              profilePicOverride: "",
              currentAvatarImageUrl: null,
              currentAvatarThumbnailImageUrl: null,
              status: "offline",
            },
          ],
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
      case "db.history.clear":
        return {
          cleared: {
            player_events: 0,
            player_encounters: 0,
            world_visits: 0,
            avatar_history: 0,
            friend_log: 0,
          },
          include_friend_notes: false,
        } as unknown as TResult;
      case "logs.files.clear":
        return {
          ok: true,
          deleted: 1,
          failed: [],
          skipped: [],
          vrc_running: false,
        } as unknown as TResult;
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

  async autoStartGet(): Promise<{ enabled: boolean }> {
    return this.call<undefined, { enabled: boolean }>("autoStart.get");
  }

  async autoStartSet(enabled: boolean): Promise<{ enabled: boolean }> {
    return this.call<{ enabled: boolean }, { enabled: boolean }>("autoStart.set", { enabled });
  }

  async eventStart(name: string, world_id?: string, instance_id?: string) {
    return this.call<Record<string, unknown>, { id: number }>("event.start", { name, world_id, instance_id });
  }
  async eventStop(id: number) {
    return this.call<{ id: number }, { ok: boolean }>("event.stop", { id });
  }
  async eventList() {
    return this.call<undefined, { recordings: Array<Record<string, unknown>> }>("event.list");
  }
  async eventAttendees(recording_id: number) {
    return this.call<{ recording_id: number }, { attendees: Array<Record<string, unknown>> }>("event.attendees", { recording_id });
  }
  async eventAddAttendee(recording_id: number, user_id: string, display_name: string) {
    return this.call<Record<string, unknown>, { ok: boolean }>("event.addAttendee", { recording_id, user_id, display_name });
  }

  async rulesList() {
    return this.call<undefined, { rules: Array<Record<string, unknown>> }>("rules.list");
  }
  async rulesGet(id: number) {
    return this.call<{ id: number }, Record<string, unknown>>("rules.get", { id });
  }
  async rulesCreate(name: string, dsl_yaml: string, description?: string, cooldown_seconds?: number) {
    return this.call<Record<string, unknown>, { id: number }>("rules.create", { name, dsl_yaml, description, cooldown_seconds });
  }
  async rulesUpdate(id: number, patch: Record<string, unknown>) {
    return this.call<Record<string, unknown>, Record<string, unknown>>("rules.update", { id, ...patch });
  }
  async rulesDelete(id: number) {
    return this.call<{ id: number }, { ok: boolean }>("rules.delete", { id });
  }
  async rulesSetEnabled(id: number, enabled: boolean) {
    return this.call<{ id: number; enabled: boolean }, { ok: boolean }>("rules.setEnabled", { id, enabled });
  }
  async rulesHistory(rule_id: number) {
    return this.call<{ rule_id: number }, { firings: Array<Record<string, unknown>> }>("rules.history", { rule_id });
  }

  async vrDiagnose() {
    return this.call<undefined, Record<string, unknown>>("vr.diagnose");
  }

  async vrAudioSwitch(deviceId: string, role: string) {
    return this.call<{ deviceId: string; role: string }, { ok: boolean }>("vr.audio.switch", { deviceId, role });
  }

  async calendarDiscover() {
    return this.call<undefined, { events: Array<Record<string, unknown>> }>("calendar.discover");
  }

  async calendarFeatured() {
    return this.call<undefined, { events: Array<Record<string, unknown>> }>("calendar.featured");
  }

  async jamsList() {
    return this.call<undefined, Array<Record<string, unknown>>>("jams.list");
  }

  async jamsDetail(jamId: string) {
    return this.call<{ jamId: string }, Record<string, unknown>>("jams.detail", { jamId });
  }

  async worldsSearch(query: string, sort = "relevance", n = 20, offset = 0) {
    return this.call<
      { query: string; sort: string; n: number; offset: number },
      { worlds: Array<{ id: string; name: string; description: string; authorName: string; thumbnailImageUrl: string; capacity: number; occupants: number; favorites: number; tags: string[] }> }
    >("worlds.search", { query, sort, n, offset });
  }

  async friendsUnfriend(userId: string) {
    return this.call<{ userId: string }, { ok: boolean }>("friends.unfriend", { userId });
  }

  async friendsRequest(userId: string) {
    return this.call<{ userId: string }, { ok: boolean }>("friends.request", { userId });
  }

  // Toggle which VRChat group the signed-in user currently represents.
  // Passing isRepresenting=true on any group auto-unsets the previous
  // one server-side; passing false on the current group clears it.
  async groupsSetRepresented(groupId: string, isRepresenting: boolean) {
    return this.call<{ groupId: string; isRepresenting: boolean }, { ok: boolean }>(
      "groups.setRepresented",
      { groupId, isRepresenting },
    );
  }

  async scan(): Promise<Report> {
    return this.call<undefined, Report>("scan");
  }

  async pickFolder(
    opts: { title?: string; initialDir?: string } = {},
  ): Promise<PickFolderResult> {
    // Prefer the in-app React dialog when it has been mounted — it
    // renders as a child of the WebView2 host, so the user sees it
    // regardless of focus/Z-order issues that plague the native
    // IFileOpenDialog. The host IPC is kept as a fallback for
    // headless/test contexts where no dialog host is installed.
    if (inlinePickFolderHandler) {
      return inlinePickFolderHandler(opts);
    }
    return this.call<typeof opts, PickFolderResult>("shell.pickFolder", opts);
  }

  async listDir(opts: { path?: string; includeHidden?: boolean } = {}): Promise<ListDirResult> {
    return this.call<typeof opts, ListDirResult>("fs.listDir", opts);
  }

  async downloadAvatarBundle(params: {
    avatarId: string;
    assetUrl: string;
    outDir: string;
    displayName?: string;
  }): Promise<{ ok: boolean; path: string }> {
    return this.call<typeof params, { ok: boolean; path: string }>(
      "avatar.bundle.download",
      params,
    );
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

  async writeSteamVrConfig(updates: any): Promise<{ ok: boolean }> {
    // Pass the updates through as-is. SteamVrConfig::Write iterates the top
    // level keys (driver_vrlink / steamvr / ...) and deep-merges into
    // steamvr.vrsettings. Wrapping in { config } caused the merge to create
    // a stray "config" section while leaving the real sections untouched.
    return this.call<any, { ok: boolean }>("steamvr.write", updates);
  }

  async diagnoseSteamVrLink(): Promise<SteamVrLinkDiagnostic> {
    return this.call<undefined, SteamVrLinkDiagnostic>("steamvr.link.diagnose");
  }

  async repairSteamVrLink(params: {
    planId?: string;
    dryRun?: boolean;
    clearRuntimeConfig?: boolean;
    clearHtmlCache?: boolean;
    clearPairing?: boolean;
    removeBeta?: boolean;
    stopSteam?: boolean;
    launchValidate?: boolean;
    clearVrlinkConfig?: boolean;
    clearRemoteClients?: boolean;
    archiveLogs?: boolean;
    applySafeStreamingSettings?: boolean;
    backupOnly?: boolean;
  }): Promise<SteamVrLinkRepairResult> {
    return this.call<typeof params, SteamVrLinkRepairResult>("steamvr.link.repair", params);
  }

  async listSteamVrLinkBackups(): Promise<SteamVrLinkBackupList> {
    return this.call<undefined, SteamVrLinkBackupList>("steamvr.link.backups");
  }

  async restoreSteamVrLinkBackup(params: {
    backupDir: string;
    dryRun?: boolean;
    stopSteam?: boolean;
  }): Promise<SteamVrLinkRepairResult> {
    return this.call<typeof params, SteamVrLinkRepairResult>("steamvr.link.restore", params);
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

  async inviteSelf(location: string) {
    return this.call<{ location: string }, { ok: boolean }>("user.invite", { location });
  }

  async inviteUser(userId: string, location: string, slot = 0) {
    return this.call<
      { userId: string; location: string; slot: number },
      { ok: boolean }
    >("user.inviteTo", { userId, location, slot });
  }

  async requestInvite(userId: string, slot = 0) {
    return this.call<{ userId: string; slot: number }, { ok: boolean }>(
      "user.requestInvite",
      { userId, slot },
    );
  }

  // ── Pipeline WebSocket (real-time events) ───────────────────────────
  // After login, call `pipelineStart()` once. Events arrive as
  // `pipeline.event` with shape `{type, content}` — subscribe via `on()`.
  // Connection state updates land on `pipeline.state`.

  async pipelineStart() {
    return this.call<{}, { ok: boolean; state: string; already?: boolean }>(
      "pipeline.start",
      {},
    );
  }

  async pipelineStop() {
    return this.call<{}, { ok: boolean }>("pipeline.stop", {});
  }

  // ── Notifications inbox ─────────────────────────────────────────────

  async notificationsList(count = 100) {
    return this.call<{ count: number }, { notifications: any[] }>(
      "notifications.list",
      { count },
    );
  }

  async notificationAccept(notificationId: string) {
    return this.call<{ notificationId: string }, { ok: boolean }>(
      "notifications.accept",
      { notificationId },
    );
  }

  async notificationRespond(
    notificationId: string,
    message: string,
    slot = 0,
  ) {
    return this.call<
      { notificationId: string; message: string; slot: number },
      { ok: boolean }
    >("notifications.respond", { notificationId, message, slot });
  }

  async notificationSee(notificationId: string) {
    return this.call<{ notificationId: string }, { ok: boolean }>(
      "notifications.see",
      { notificationId },
    );
  }

  async notificationHide(notificationId: string) {
    return this.call<{ notificationId: string }, { ok: boolean }>(
      "notifications.hide",
      { notificationId },
    );
  }

  async notificationsClear() {
    return this.call<{}, { ok: boolean }>("notifications.clear", {});
  }

  async sendMessage(userId: string, message: string) {
    return this.call<{ userId: string; message: string }, { ok: boolean }>(
      "message.send",
      { userId, message },
    );
  }

  // ── Discord Rich Presence ───────────────────────────────────────────

  async discordSetActivity(activity: Record<string, unknown>, clientId?: string) {
    return this.call<Record<string, unknown>, { ok: boolean; connected: boolean }>(
      "discord.setActivity",
      clientId ? { ...activity, clientId } : activity,
    );
  }

  async discordClearActivity() {
    return this.call<{}, { ok: boolean }>("discord.clearActivity", {});
  }

  async discordStatus() {
    return this.call<{}, { running: boolean; connected: boolean }>(
      "discord.status",
      {},
    );
  }

  // ── OSC bridge ──────────────────────────────────────────────────────

  async oscSend(
    address: string,
    args: (number | string | boolean)[] = [],
    opts: { host?: string; port?: number } = {},
  ) {
    return this.call<
      { address: string; args: (number | string | boolean)[]; host?: string; port?: number },
      { ok: boolean }
    >("osc.send", { address, args, ...opts });
  }

  async oscListenStart(port = 9001) {
    return this.call<{ port: number }, { ok: boolean; port: number }>(
      "osc.listen.start",
      { port },
    );
  }

  async oscListenStop() {
    return this.call<{}, { ok: boolean }>("osc.listen.stop", {});
  }

  // ── Screenshot metadata ─────────────────────────────────────────────

  async screenshotsWatcherStart(folder?: string) {
    return this.call<{ folder?: string }, { ok: boolean; folder: string }>(
      "screenshots.watcher.start",
      folder ? { folder } : {},
    );
  }

  async screenshotsWatcherStop() {
    return this.call<{}, { ok: boolean }>("screenshots.watcher.stop", {});
  }

  async screenshotsInjectMetadata(path: string, metadata: Record<string, unknown>) {
    return this.call<
      { path: string; metadata: Record<string, unknown> },
      { ok: boolean }
    >("screenshots.injectMetadata", { path, metadata });
  }

  async screenshotsReadMetadata(path: string) {
    return this.call<{ path: string }, { metadata: Record<string, string> }>(
      "screenshots.readMetadata",
      { path },
    );
  }

  async muteUser(userId: string) {
    return this.call<{ userId: string }, unknown>("user.mute", { userId });
  }

  async unmuteUser(moderationId: string) {
    return this.call<{ moderationId: string }, { ok: boolean }>("user.unmute", { moderationId });
  }

  async blockUser(userId: string) {
    return this.call<{ userId: string }, unknown>("user.block", { userId });
  }

  async unblockUser(moderationId: string) {
    return this.call<{ moderationId: string }, { ok: boolean }>("user.unblock", { moderationId });
  }

  async searchAvatars(query: string, count = 20, offset = 0) {
    return this.call<
      { query: string; count: number; offset: number },
      { avatars: AvatarSearchResult[] }
    >("avatar.search", { query, count, offset });
  }

  async searchUsers(query: string, count = 10, offset = 0) {
    return this.call<
      { query: string; count: number; offset: number },
      { users: UserSearchResult[] }
    >("user.search", { query, count, offset });
  }

  // ── Database / History ──────────────────────────────────────────────

  async dbWorldVisits(limit = 100, offset = 0) {
    return this.call<{ limit: number; offset: number }, { items: any[] }>(
      "db.worldVisits.list", { limit, offset },
    );
  }

  async dbPlayerEvents(
    limit = 100,
    offset = 0,
    options?: {
      worldId?: string;
      instanceId?: string;
      occurredAfter?: string;
      occurredBefore?: string;
    },
  ) {
    return this.call<{
      limit: number;
      offset: number;
      world_id?: string;
      instance_id?: string;
      occurred_after?: string;
      occurred_before?: string;
    }, { items: any[] }>(
      "db.playerEvents.list",
      {
        limit,
        offset,
        world_id: options?.worldId,
        instance_id: options?.instanceId,
        occurred_after: options?.occurredAfter,
        occurred_before: options?.occurredBefore,
      },
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

  async dbAvatarHistoryCount() {
    return this.call<undefined, { count: number }>("db.avatarHistory.count");
  }

  async dbAvatarHistoryResolve(params: {
    avatar_id: string;
    resolved_avatar_id?: string | null;
    resolved_thumbnail_url?: string | null;
    resolved_image_url?: string | null;
    resolution_source?: string | null;
    resolution_status: "resolved" | "miss";
    resolved_at?: string;
  }) {
    return this.call<typeof params, { ok: boolean }>("db.avatarHistory.resolve", params);
  }

  async dbStatsHeatmap(days = 30) {
    return this.call<{ days: number }, any>("db.stats.heatmap", { days });
  }

  async dbStatsOverview() {
    return this.call<undefined, any>("db.stats.overview");
  }

  async dbHistoryClear(includeFriendNotes = false) {
    return this.call<{ include_friend_notes: boolean }, any>(
      "db.history.clear",
      { include_friend_notes: includeFriendNotes },
    );
  }

  // ── Favorites ───────────────────────────────────────────────────────

  async favoriteLists() {
    try {
      return await this.call<undefined, { lists: FavoriteListSummary[] }>("favorites.lists");
    } catch (error) {
      if (!isMethodNotFoundError(error)) {
        throw error;
      }
      const { buildFavoriteLists } = await getMockModule();
      return { lists: buildFavoriteLists(readCompatFavorites()) };
    }
  }

  async favoriteItems(listName: string) {
    try {
      return await this.call<{ list_name: string }, { items: FavoriteItem[] }>(
        "favorites.items",
        { list_name: listName },
      );
    } catch (error) {
      if (!isMethodNotFoundError(error)) {
        throw error;
      }
      const { sortFavoriteItems } = await getMockModule();
      return {
        items: sortFavoriteItems(
          readCompatFavorites().filter((item) => item.list_name === listName),
        ),
      };
    }
  }

  async favoriteAdd(params: {
    type: string; target_id: string; list_name: string;
    display_name?: string; thumbnail_url?: string;
  }) {
    try {
      return await this.call<typeof params, { ok: boolean }>("favorites.add", params);
    } catch (error) {
      if (!isMethodNotFoundError(error)) {
        throw error;
      }

      const items = readCompatFavorites();
      const nextItem: FavoriteItem = {
        type: params.type,
        target_id: params.target_id,
        list_name: params.list_name,
        display_name: params.display_name ?? null,
        thumbnail_url: params.thumbnail_url ?? null,
        added_at: nowIso(),
        sort_order: 0,
        tags: [],
        note: null,
        note_updated_at: null,
      };

      const existingIndex = items.findIndex(
        (item) =>
          item.type === params.type &&
          item.target_id === params.target_id &&
          item.list_name === params.list_name,
      );

      if (existingIndex >= 0) {
        const existing = items[existingIndex];
        items.splice(existingIndex, 1, {
          ...existing,
          ...nextItem,
          tags: existing.tags ?? [],
          note: existing.note ?? null,
          note_updated_at: existing.note_updated_at ?? null,
        });
      } else {
        items.push(nextItem);
      }

      writeCompatFavorites(items);
      return { ok: true };
    }
  }

  async favoriteRemove(type: string, targetId: string, listName: string) {
    try {
      return await this.call<
        { type: string; target_id: string; list_name: string },
        { ok: boolean }
      >("favorites.remove", { type, target_id: targetId, list_name: listName });
    } catch (error) {
      if (!isMethodNotFoundError(error)) {
        throw error;
      }

      const items = readCompatFavorites().filter(
        (item) =>
          !(
            item.type === type &&
            item.target_id === targetId &&
            item.list_name === listName
          ),
      );
      writeCompatFavorites(items);
      return { ok: true };
    }
  }

  async favoriteNoteSet(params: {
    type: string;
    target_id: string;
    list_name: string;
    note: string;
  }) {
    try {
      return await this.call<typeof params, { ok: boolean; updated_at: string }>(
        "favorites.note.set",
        params,
      );
    } catch (error) {
      if (!isMethodNotFoundError(error)) {
        throw error;
      }

      const items = readCompatFavorites();
      const updatedAt = nowIso();
      const target = items.find(
        (item) =>
          item.type === params.type &&
          item.target_id === params.target_id &&
          item.list_name === params.list_name,
      );
      if (target) {
        const note = params.note.trim();
        target.note = note.length > 0 ? params.note : null;
        target.note_updated_at = note.length > 0 ? updatedAt : null;
        writeCompatFavorites(items);
      }
      return { ok: true, updated_at: updatedAt };
    }
  }

  async favoriteTagsSet(params: {
    type: string;
    target_id: string;
    list_name: string;
    tags: string[];
  }) {
    try {
      return await this.call<typeof params, { ok: boolean; updated_at: string }>(
        "favorites.tags.set",
        params,
      );
    } catch (error) {
      if (!isMethodNotFoundError(error)) {
        throw error;
      }

      const items = readCompatFavorites();
      const updatedAt = nowIso();
      const target = items.find(
        (item) =>
          item.type === params.type &&
          item.target_id === params.target_id &&
          item.list_name === params.list_name,
      );
      if (target) {
        target.tags = Array.from(
          new Map(
            params.tags
              .map((tag) => tag.trim())
              .filter(Boolean)
              .map((tag) => [tag.toLowerCase(), tag] as const),
          ).values(),
        ).sort((a, b) => a.localeCompare(b));
        writeCompatFavorites(items);
      }
      return { ok: true, updated_at: updatedAt };
    }
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

  async logFilesClear() {
    return this.call<
      undefined,
      {
        ok: boolean;
        deleted: number;
        failed: string[];
        skipped: string[];
        vrc_running: boolean;
      }
    >("logs.files.clear");
  }

  // ── Plugins ─────────────────────────────────────────────────────────

  async pluginList() {
    return this.call<undefined, { plugins: InstalledPluginDto[] }>("plugin.list");
  }

  async pluginMarketFeed(force = false) {
    return this.call<{ force: boolean }, MarketFeedDto>("plugin.marketFeed", { force });
  }

  async pluginInstall(params: { path?: string; url?: string; sha256?: string; overwrite?: boolean }) {
    return this.call<typeof params, PluginInstallResult>("plugin.install", params);
  }

  async pluginUninstall(id: string) {
    return this.call<{ id: string }, { ok: boolean; id: string }>("plugin.uninstall", { id });
  }

  async pluginEnable(id: string) {
    return this.call<{ id: string }, { ok: boolean; id: string; enabled: boolean }>(
      "plugin.enable", { id },
    );
  }

  async pluginDisable(id: string) {
    return this.call<{ id: string }, { ok: boolean; id: string; enabled: boolean }>(
      "plugin.disable", { id },
    );
  }

  // ── Calendar (VRChat events) ────────────────────────────────────────
  // Light-weight read-only list of upcoming VRChat-curated events.
  // Empty array on 401 / unauth so the Dashboard tile can hide cleanly.

  async calendarList() {
    return this.call<undefined, { events: CalendarEvent[] }>("calendar.list");
  }

  // ── Friend log insert (called from the pipeline diff reducer) ──────

  async friendLogInsert(params: {
    user_id: string;
    event_type: string;
    old_value?: string;
    new_value?: string;
    occurred_at?: string;
    display_name?: string;
  }) {
    return this.call<typeof params, { ok: boolean }>("friendLog.insert", params);
  }

  // ── Vector (experimental visual avatar search) ─────────────────────
  // All four gated behind the frontend experimental flag in Settings.
  // The host always exposes them; the UI decides when to call.

  async vectorUpsertEmbedding(params: {
    avatar_id: string;
    embedding: number[];
    model_version: string;
  }) {
    return this.call<typeof params, { ok: boolean }>("vector.upsertEmbedding", params);
  }

  async vectorSearch(embedding: number[], k = 25) {
    return this.call<{ embedding: number[]; k: number }, {
      matches: { avatar_id: string; distance: number }[];
    }>("vector.search", { embedding, k });
  }

  async vectorGetUnindexed() {
    return this.call<undefined, { avatar_ids: string[] }>("vector.getUnindexed");
  }

  async vectorRemoveEmbedding(avatar_id: string) {
    return this.call<{ avatar_id: string }, { ok: boolean }>(
      "vector.removeEmbedding", { avatar_id },
    );
  }

  async pluginRpc<TParams, TResult>(method: string, params?: TParams) {
    return this.call<{ method: string; params?: TParams }, TResult>("plugin.rpc", {
      method,
      params,
    });
  }
}

export interface PickFolderResult {
  cancelled: boolean;
  path?: string;
}

export interface ListDirEntry {
  name: string;
  isDir: boolean;
  hidden: boolean;
  system: boolean;
}

export interface ListDirRoot {
  path: string;
  label: string;
  // Win32 GetDriveType return value — 2=removable, 3=fixed, 4=remote,
  // 5=cdrom, 6=ramdisk. UI uses it to pick an appropriate icon.
  type: number;
}

export interface ListDirResult {
  path: string;
  parent: string | null;
  entries: ListDirEntry[];
  roots: ListDirRoot[];
  truncated: boolean;
}

// The FolderPickerHost React component registers itself here so
// ipc.pickFolder() resolves through the in-app dialog instead of the
// native IFileOpenDialog. A null handler means we fall back to the host.
type InlinePickFolderHandler = (
  opts: { title?: string; initialDir?: string },
) => Promise<PickFolderResult>;

let inlinePickFolderHandler: InlinePickFolderHandler | null = null;

export function registerInlinePickFolder(handler: InlinePickFolderHandler | null): void {
  inlinePickFolderHandler = handler;
}

export const ipc = new IpcClient();
