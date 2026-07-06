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
  DbStatsOverview,
  DbStatsHeatmapMatrix,
  DbHistoryClearResult,
  MigratePlan,
  PluginInstallResult,
  ProcessStatus,
  Report,
  SearchGlobalRequest,
  SearchGlobalResponse,
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

const MOCK_SIGNED_OUT: AuthStatus = {
  authed: false,
  userId: null,
  displayName: null,
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildMockSteamVrConfig(): SteamVrConfig {
  return {
    ok: true,
    path: "D:/Steam/config/steamvr.vrsettings",
    steamvr_running: false,
    knownDevices: ["Quest 3"],
    hardware: {
      gpuVendor: "NVIDIA",
      gpuHorsepower: 14,
      hmdModel: "Quest 3",
      hmdSerial: "MOCK-HMD",
      hmdManufacturer: "Meta",
      hmdDriver: "driver_vrlink",
    },
    driver_vrlink: {
      automaticBandwidth: true,
      automaticStreamFormatWidth: true,
      targetBandwidth: 90,
    },
    steamvr: {
      supersampleScale: 1.0,
      supersampleManualOverride: true,
      preferredRefreshRate: 72,
      motionSmoothing: false,
      allowSupersampleFiltering: true,
    },
  };
}

const MOCK_MARKET_PLUGINS: MarketFeedDto["plugins"] = [
  {
    id: "dev.vrcsm.autouploader",
    name: "VRChat Auto-Uploader",
    version: "0.9.2",
    hostMin: "0.9.2",
    shape: "panel",
    description: "Batch helper for preparing avatar upload folders.",
    homepage: "https://github.com/dwgx/VRCSM",
    authorName: "VRCSM",
    permissions: ["ipc:shell", "ipc:fs:listDir", "ipc:fs:writePlan"],
    download: "https://example.invalid/vrcsm-autouploader.zip",
    sha256: "mock-autouploader-sha256",
  },
  {
    id: "dev.vrcsm.hello",
    name: "Hello Panel",
    version: "0.1.0",
    hostMin: "0.8.0",
    shape: "panel",
    description: "Minimal panel used by browser-dev mock mode.",
    authorName: "VRCSM",
    permissions: [],
    download: "https://example.invalid/vrcsm-hello.zip",
    sha256: "mock-hello-sha256",
  },
];

function marketEntryToInstalled(
  entry: MarketFeedDto["plugins"][number],
  bundled = false,
): InstalledPluginDto {
  const hostLabel = entry.id.replace(/\./g, "-");
  return {
    id: entry.id,
    name: entry.name,
    version: entry.version,
    hostMin: entry.hostMin,
    shape: entry.shape,
    entry: { panel: "index.html" },
    permissions: entry.permissions ?? [],
    author: entry.authorName ? { name: entry.authorName, url: entry.authorUrl } : undefined,
    homepage: entry.homepage,
    icon: entry.iconUrl,
    description: entry.description,
    enabled: true,
    bundled,
    installDir: bundled
      ? `D:/Project/VRCSM/plugins/${entry.id}`
      : `C:/Users/dev/AppData/Roaming/VRCSM/plugins/${entry.id}`,
    dataDir: `C:/Users/dev/AppData/Roaming/VRCSM/plugin-data/${entry.id}`,
    virtualHost: `plugin.${hostLabel}.vrcsm`,
  };
}

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

// ── Track B1: durable presence events + unified feed read model ──────

export interface FriendPresenceEventDto {
  id: number;
  user_id: string | null;
  display_name: string | null;
  event_type: string | null;
  world_id: string | null;
  instance_id: string | null;
  location: string | null;
  status: string | null;
  old_value: string | null;
  new_value: string | null;
  source: string | null;
  occurred_at: string | null;
}

// Output of the friendPresence.predict analytic (no VRCX equivalent). Predicts
// when a friend tends to be online from their observed presence history. See
// docs/wave2-research/own-overlap-algorithm-design.md §4.
export interface OnlineWindowDto {
  day_of_week: number; // 0=Sun .. 6=Sat (local)
  start_hour: number; // local, inclusive
  end_hour: number; // local, exclusive
  score: number; // normalized 0..1 (peak window = 1)
  observation_days: number;
  label_key: string;
}

export interface FriendOnlinePredictionDto {
  user_id: string;
  status: "ok" | "insufficient_data";
  timezone_offset_minutes: number;
  total_online_minutes: number;
  observation_days: number;
  half_life_weeks: number;
  heatmap: number[]; // 168 normalized buckets, index = dayOfWeek*24 + hour
  top_windows: OnlineWindowDto[];
}

// ─── Co-presence ego-network (Track 4 relationship graph) ──────────────
// Built in C++ (Database::CoPresenceEgoNetwork) from raw player_events:
// per-user presence intervals are reconstructed inside each
// (world_id, instance_id) session and an edge is emitted when two users
// overlap by >= min_overlap_sec.
export interface CoPresenceNode {
  user_id: string;
  display_name: string;
  sessions: number;        // # of instance sessions the user appeared in
  total_seconds: number;   // summed in-session presence seconds
  last_seen: number;       // epoch seconds of latest presence end
  is_center: boolean;
}

export interface CoPresenceEdge {
  source: string;          // ordered pair (source < target)
  target: string;
  // "confirmed" = edge touches the center (we logged it from our own
  // instance). "co_presence" = inference between two non-center users;
  // never a confirmed-friendship claim.
  kind: "confirmed" | "co_presence";
  overlap_count: number;   // # of sessions the pair overlapped in
  overlap_seconds: number; // summed overlap seconds
  last_overlap: number;    // epoch seconds of latest overlap end
}

export interface CoPresenceGraph {
  center: string;
  since_days: number;
  min_overlap_sec: number;
  nodes: CoPresenceNode[];
  edges: CoPresenceEdge[];
}

// Persisted parameter-count snapshot for an avatar measured during a cache
// scan. Survives VRChat evicting the live LocalAvatarData file so the
// benchmark page can still show it. Backed by the avatar_benchmark table.
export interface AvatarBenchmarkRow {
  avatar_id: string;
  user_id: string | null;
  parameter_count: number;
  eye_height: number | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
}

// Discriminator emitted by the C++ UnifiedFeed read model. Each value maps to
// one of the UNION ALL'd source tables.
export type FeedSourceKind =
  | "friend_log"
  | "presence"
  | "player_event"
  | "avatar"
  | "log_event";

export interface FeedEntryDto {
  source_kind: FeedSourceKind | null;
  event_id: number;
  user_id: string | null;
  display_name: string | null;
  event_type: string | null;
  world_id: string | null;
  instance_id: string | null;
  detail: string | null;
  occurred_at: string | null;
}

// ── Unified data management (data.usage / data.clear) ──────────────────

// Whitelisted cleanup targets accepted by data.clear. Unknown keys are
// skipped host-side and flagged in the response.
export type DataClearTarget =
  // disk caches
  | "cache.thumbnails"
  | "cache.previews"
  | "cache.screenshotThumbs"
  | "cache.updates"
  | "cache.pluginFeed"
  | "cache.index"
  // rebuildable cache tables
  | "cache.assetCache"
  | "cache.benchmark"
  | "cache.onlineMirror"
  // history tables
  | "history.worldVisits"
  | "history.playerEvents"
  | "history.avatarHistory"
  | "history.friendLog"
  | "history.sessions"
  | "history.logEvents"
  // experimental
  | "experimental.embeddings"
  // user assets (dangerous)
  | "assets.favorites";

export interface DataUsage {
  /** Bytes per disk-cache key (recursive; missing dir = 0). */
  disk: Record<string, number>;
  /** COUNT(*) per DB table (absent tables omitted). */
  tables: Record<string, number>;
  /** vrcsm.db file size in bytes. */
  dbFileBytes: number;
}

export interface DataClearTargetResult {
  ok: boolean;
  kind?: "disk" | "table";
  /** disk targets: files + dirs removed. */
  removed?: number;
  /** table targets: rows deleted per table. */
  cleared?: Record<string, number>;
  /** set when an unknown target was skipped. */
  skipped?: boolean;
  reason?: string;
  error?: { code: string; message: string };
}

export interface DataClearResponse {
  results: Record<string, DataClearTargetResult>;
}

interface WebViewBridge {
  postMessage: (message: string) => void;
  addEventListener: (type: "message", listener: (event: { data: string }) => void) => void;
  removeEventListener?: (type: "message", listener: (event: { data: string }) => void) => void;
}

interface ChromeShim {
  webview?: WebViewBridge;
}

/**
 * Dev-only smoke-tap record. Emitted for EVERY ipc.call when
 * `window.__SMOKE_TAP__` is truthy so the real-browser UI smoke suite can
 * detect dead interactions (mock-unimplemented) and mock/host drift. Zero cost
 * in production: the flag is never set, so the tap branch is never taken.
 */
export interface SmokeIpcEvent {
  method: string;
  params: unknown;
  ok: boolean;
  error?: string;
  isMock: boolean;
  unimplemented: boolean;
  ts: number;
}

declare global {
  interface Window {
    chrome?: ChromeShim;
    __VRCSM_MOCK__?: boolean;
    /** Set true by the UI smoke harness (before app boot) to enable the tap. */
    __SMOKE_TAP__?: boolean;
    /** Append-only sink the smoke harness reads back. */
    __SMOKE_EVENTS__?: SmokeIpcEvent[];
  }
}

// Shallow-redact obviously-sensitive params before recording them into the
// smoke event log. Keeps the tap useful without leaking credentials/tokens.
const SMOKE_REDACT_KEY = /pass(word)?|token|secret|cookie|auth|credential|otp|2fa/i;
function smokeRedactParams(params: unknown): unknown {
  if (!params || typeof params !== "object" || Array.isArray(params)) return params;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    out[k] = SMOKE_REDACT_KEY.test(k) ? "[redacted]" : v;
  }
  return out;
}

function smokePush(event: SmokeIpcEvent): void {
  const sink = (window.__SMOKE_EVENTS__ ??= []);
  sink.push(event);
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timerId: number | null;
  /** Method name — used to look up an opt-in result-shape validator. */
  method: string;
};

// Default 60-second ceiling for any IPC call. If the host handler hangs
// (e.g. a worker thread deadlocks inside radar.poll), the Promise used to
// leak forever and the pending Map grew without bound. With this ceiling
// the call rejects with `IpcError("timeout", ...)` and the slot is freed.
const DEFAULT_IPC_TIMEOUT_MS = 60_000;

// Long-running methods get a generous-but-finite ceiling instead of the 60s
// default. They legitimately exceed 60s (full scans, AssetRipper extraction,
// full favorites round-trips, slow multipart uploads), but an unbounded wait
// reopens the pending-promise leak if the host never replies.
const LONG_RUNNING_IPC_TIMEOUT_MS = 15 * 60_000;

// Methods that legitimately take longer than the default ceiling. These use
// LONG_RUNNING_IPC_TIMEOUT_MS instead of the 60s default — finite, so a stuck
// host call is still eventually reaped instead of leaking forever.
const LONG_RUNNING_METHODS = new Set<string>([
  "scan",
  "avatar.bundle.download",
  "avatar.preview",
  "avatar.preview.prefetch",
  "favorites.syncOfficial",
  "favorites.export",
  "favorites.import",
  // Image/print uploads push raw bytes over IPC + multipart to VRChat —
  // a slow connection can exceed the 60s default, so exempt them.
  "prints.upload",
  "files.uploadImage",
  // thumbnails.fetch removed: a batch of ~50 ids parallel-fetches in ~6s,
  // a stuck call should not pin the pending map forever — let the default
  // 60s timeout reject it so memo entries can clear and retry.
]);

// Cache migration is different from the long-running read/upload calls above:
// the host may spend longer than 15 minutes copying and junctioning a large
// VRChat cache, and the operation is still live after the renderer gives up.
// Keep the pending request until the host responds or the session is reset.
const NO_RESPONSE_TIMEOUT_METHODS = new Set<string>([
  "migrate.execute",
]);

export function ipcResponseTimeoutMs(method: string): number | null {
  if (NO_RESPONSE_TIMEOUT_METHODS.has(method)) return null;
  if (LONG_RUNNING_METHODS.has(method)) return LONG_RUNNING_IPC_TIMEOUT_MS;
  return DEFAULT_IPC_TIMEOUT_MS;
}

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

/**
 * Opt-in result-shape validation.
 *
 * The IPC response path resolves `resp.result` by casting `unknown` to the
 * caller's `TResult` — a compile-time-only guarantee. If the C++ host ever
 * drifts from the shape the frontend expects (renamed field, wrong nesting,
 * error object returned as a success), the cast silently succeeds and the bad
 * value propagates deep into React state before failing far from the source.
 *
 * A validator returns `true` when the payload has the expected shape. It is
 * OPT-IN and INCREMENTAL: only methods registered here are checked; every
 * other method keeps its current cast-only behaviour, so this is fully
 * backward compatible. Register only hot/critical methods whose drift would be
 * expensive to debug.
 *
 * On drift the caller's Promise rejects with a structured
 * `IpcError("shape_mismatch", ...)` naming the method, so the failure surfaces
 * at the IPC boundary instead of somewhere downstream.
 */
export type IpcResultValidator = (result: unknown) => boolean;

const resultValidators = new Map<string, IpcResultValidator>();

/**
 * Register (or, with `null`, clear) a result-shape validator for one method.
 * Idempotent; a second registration replaces the first.
 */
export function registerResultValidator(
  method: string,
  validator: IpcResultValidator | null,
): void {
  if (validator) {
    resultValidators.set(method, validator);
  } else {
    resultValidators.delete(method);
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Built-in validators for the hot/critical methods. Kept intentionally
// lightweight — presence + primitive type of the load-bearing fields, not a
// full schema — so they catch real drift (missing/renamed key, wrong nesting)
// without rejecting benign additive changes the host may make.
registerResultValidator("auth.status", (r) => isObject(r) && typeof r.authed === "boolean");
registerResultValidator(
  "auth.user",
  (r) => isObject(r) && typeof r.authed === "boolean" && "user" in r,
);
registerResultValidator(
  "friends.list",
  (r) => isObject(r) && Array.isArray((r as { friends?: unknown }).friends),
);
registerResultValidator(
  "scan",
  (r) => isObject(r) && typeof r.base_dir === "string" && Array.isArray(r.category_summaries),
);
registerResultValidator(
  // Guards the real Database::StatsOverview shape — `total_world_visits`, not
  // the shorter `total_visits` an earlier draft checked (which would have
  // rejected every real host response).
  "db.stats.overview",
  (r) => isObject(r) && typeof r.total_world_visits === "number",
);

/**
 * Run the registered validator (if any) for `method` against `result`.
 * Returns a structured `IpcError` on drift, or `null` when there is no
 * validator or the shape is valid. Pure — the response path uses it to decide
 * whether to resolve or reject.
 */
export function checkResultShape(method: string, result: unknown): IpcError | null {
  const validator = resultValidators.get(method);
  if (validator && !validator(result)) {
    return new IpcError(
      "shape_mismatch",
      `IPC '${method}' returned an unexpected result shape`,
      0,
    );
  }
  return null;
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
  private mockAuthStatus: AuthStatus;
  private mockSteamVrConfig: SteamVrConfig;
  private mockInstalledPlugins: InstalledPluginDto[];

  constructor() {
    this.bridge = window.chrome?.webview ?? null;
    this.pending = new Map();
    this.events = new EventTarget();
    this.listenerAttached = false;
    this.mockLogStreamTimer = null;
    this.mockAuthStatus = { ...MOCK_SIGNED_OUT };
    this.mockSteamVrConfig = buildMockSteamVrConfig();
    this.mockInstalledPlugins = [marketEntryToInstalled(MOCK_MARKET_PLUGINS[0]!, true)];
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
        // Opt-in result-shape validation: only registered (hot/critical)
        // methods are checked. On drift the Promise rejects with a
        // structured shape_mismatch instead of leaking a bad value into
        // React state. Unregistered methods keep the cast-only path.
        const shapeErr = checkResultShape(slot.method, resp.result);
        if (shapeErr) {
          slot.reject(shapeErr);
        } else {
          slot.resolve(resp.result);
        }
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
    // Dev-only smoke tap: when the UI smoke harness sets window.__SMOKE_TAP__
    // before boot, record the outcome of every call (success + the
    // mock-unimplemented/reject branch) so it can flag dead interactions and
    // mock/host drift. Guarded by the flag → zero cost in production.
    if (!window.__SMOKE_TAP__) {
      return this.callInner<TParams, TResult>(method, params);
    }
    try {
      const result = await this.callInner<TParams, TResult>(method, params);
      smokePush({
        method,
        params: smokeRedactParams(params),
        ok: true,
        isMock: this.isMock,
        unimplemented: false,
        ts: Date.now(),
      });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const unimplemented =
        (err instanceof IpcError && err.code === "mock_not_implemented") ||
        msg.includes("Mock IPC method not implemented");
      smokePush({
        method,
        params: smokeRedactParams(params),
        ok: false,
        error: msg,
        isMock: this.isMock,
        unimplemented,
        ts: Date.now(),
      });
      throw err;
    }
  }

  private async callInner<TParams, TResult>(method: string, params?: TParams): Promise<TResult> {
    if (!this.bridge) {
      return this.mockCall<TResult>(method, params);
    }
    const id = uuid();
    const envelope: IpcEnvelopeRequest<TParams> = { id, method };
    if (params !== undefined) envelope.params = params;
    const timeoutMs = ipcResponseTimeoutMs(method);
    const promise = new Promise<TResult>((resolve, reject) => {
      // A uuid collision (or a caller re-using an id) must never silently
      // clobber an in-flight slot — the original awaiter would then hang
      // until timeout. Reject the duplicate instead of overwriting.
      if (this.pending.has(id)) {
        reject(
          new IpcError(
            "duplicate_request_id",
            `IPC request id '${id}' collided with an in-flight call`,
            0,
          ),
        );
        return;
      }
      const timerId =
        timeoutMs === null
          ? null
          : window.setTimeout(() => {
              if (!this.pending.has(id)) return;
              this.pending.delete(id);
              reject(
                new IpcError(
                  "timeout",
                  `IPC '${method}' did not respond within ${timeoutMs}ms`,
                  0,
                ),
              );
            }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => resolve(v as TResult),
        reject,
        timerId,
        method,
      });
    });
    this.bridge.postMessage(JSON.stringify(envelope));
    return promise;
  }

  /**
   * Reject and clear every in-flight pending call. Invoked on logout /
   * auth-expiry so stale slots (and the spinners awaiting them) don't survive
   * an account transition. Without this, a long-running call started under
   * account A would keep its slot — and any UI awaiting it — alive after the
   * session it belonged to is gone.
   */
  cancelAll(reason = "cancelled"): void {
    if (this.pending.size === 0) return;
    const slots = Array.from(this.pending.values());
    this.pending.clear();
    for (const slot of slots) {
      if (slot.timerId !== null) {
        window.clearTimeout(slot.timerId);
      }
      slot.reject(new IpcError(reason, `IPC call ${reason} (session reset)`, 0));
    }
  }

  private async mockCall<TResult>(method: string, params?: unknown): Promise<TResult> {
    const { mockFavorites, buildMockReport, buildMockSettingsReport, buildMockFriends, buildMockFavoriteLists } = await getMockModule();
    await new Promise((r) => setTimeout(r, 180));
    switch (method) {
      case "app.version":
        return { version: "0.5.0", build: "mock" } as unknown as TResult;
      case "update.check":
        return {
          available: false,
          current: "0.14.6",
          currentVersion: "0.14.6",
          latest: "0.14.6",
          latestVersion: "0.14.6",
          fileName: null,
          downloadUrl: undefined,
          size: undefined,
          downloadSize: undefined,
          sha256: null,
          releaseNotes: "",
          releaseNotesMarkdown: "",
          releaseUrl: "https://github.com/dwgx/VRCSM/releases/tag/v0.14.6",
          skipped: false,
          currentMsiPath: undefined,
        } as unknown as TResult;
      case "update.getState":
        return {
          autoCheck: true,
          checkIntervalHours: 24,
          skippedVersions: [],
          lastChecked: nowIso(),
        } as unknown as TResult;
      case "update.skipVersion":
      case "update.unskipVersion":
        return {
          autoCheck: true,
          checkIntervalHours: 24,
          skippedVersions: [],
          lastChecked: nowIso(),
        } as unknown as TResult;
      case "update.download": {
        const p = (params ?? {}) as { fileName?: string | null; version?: string };
        return {
          path: `C:/Users/dev/AppData/Local/VRCSM/updates/${p.fileName ?? `VRCSM-${p.version ?? "0.14.6"}.msi`}`,
        } as unknown as TResult;
      }
      case "update.install":
        return { ok: true } as unknown as TResult;
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
      case "hw.recommend":
        return {
          report: {
            cpu_name: "AMD Ryzen 9 9950X3D (Mock)",
            cpu_cores: 16,
            cpu_threads: 32,
            cpu_clock_mhz: 5700,
            gpu_name: "NVIDIA GeForce RTX 5090 (Mock)",
            gpu_vram_bytes: 32 * 1024 ** 3,
            gpu_driver: "mock-driver",
            ram_bytes: 64 * 1024 ** 3,
            hmd_model: "Quest 3",
            hmd_manufacturer: "Meta",
            os_build: "10.0.26200",
          },
          recommendation: {
            tier: "ultra",
            score: 205,
            cpu_score: 100,
            gpu_score: 105,
            gpu_vram_multiplier: 1.15,
            ram_bonus: 10,
            hmd_profile_name: "Quest 3",
            target_bandwidth: 200,
            supersample_scale: 1.5,
            preferred_refresh_rate: 120,
            motion_smoothing: false,
            allow_filtering: true,
            ffr_level: 1,
            rationale: "Mock hardware recommendation.",
          },
        } as unknown as TResult;
      case "hw.telemetry":
        return {
          generated_at: nowIso(),
          motherboard: {
            manufacturer: "ASUS",
            product: "ROG CROSSHAIR X870E HERO (Mock)",
            version: "Rev 1.xx",
            serial_number: "MOCK",
          },
          memory: {
            total_bytes: 64 * 1024 ** 3,
            available_bytes: 41 * 1024 ** 3,
            used_bytes: 23 * 1024 ** 3,
            used_pct: 36,
          },
          ram_modules: [
            {
              bank_label: "BANK 0",
              device_locator: "DIMM_A2",
              manufacturer: "G.Skill",
              part_number: "F5-6000J3038F16G",
              serial_number: "MOCK",
              capacity_bytes: 32 * 1024 ** 3,
              speed_mhz: 6000,
              configured_clock_mhz: 6000,
              memory_type_label: "DDR5",
              form_factor_label: "DIMM",
            },
            {
              bank_label: "BANK 1",
              device_locator: "DIMM_B2",
              manufacturer: "G.Skill",
              part_number: "F5-6000J3038F16G",
              serial_number: "MOCK",
              capacity_bytes: 32 * 1024 ** 3,
              speed_mhz: 6000,
              configured_clock_mhz: 6000,
              memory_type_label: "DDR5",
              form_factor_label: "DIMM",
            },
          ],
          cpu: {
            temperature_c: 62,
            load_pct: 21,
            power_watts: 88,
          },
          gpu: {
            name: "NVIDIA GeForce RTX 5090 (Mock)",
            temperature_c: 58,
            load_pct: 47,
            fan_speed_pct: 34,
            power_watts: 260,
            memory_used_bytes: 11 * 1024 ** 3,
            memory_total_bytes: 32 * 1024 ** 3,
            primary_source: "mock",
          },
          fans: [
            { id: "/gpu/0/fan/0", name: "GPU Fan", sensor_type: "Fan", source: "mock", unit: "RPM", value: 1240 },
            { id: "/mainboard/fan/0", name: "Chassis Fan", sensor_type: "Fan", source: "mock", unit: "RPM", value: 820 },
          ],
          power: [
            { id: "/cpu/package/power", name: "CPU Package", sensor_type: "Power", source: "mock", unit: "W", value: 88 },
            { id: "/gpu/0/power", name: "GPU Power", sensor_type: "Power", source: "mock", unit: "W", value: 260 },
          ],
          sensors: [],
          sources: [
            { name: "wmi_cimv2", available: true, message: "mock static hardware inventory" },
            { name: "nvml", available: true, message: "mock NVIDIA telemetry" },
            { name: "librehardwaremonitor_wmi", available: false, message: "not running in mock mode" },
          ],
        } as unknown as TResult;
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
      case "discord.clearActivity":
        return { ok: true } as unknown as TResult;
      case "notify.setPrefs": {
        const p = (params ?? {}) as Record<string, boolean>;
        return {
          ok: true,
          friendOnline: !!p.friendOnline,
          invite: !!p.invite,
          friendRequest: !!p.friendRequest,
          vrOverlay: !!p.vrOverlay,
        } as unknown as TResult;
      }
      case "osc.send":
      case "osc.listen.start":
      case "osc.listen.stop":
        return { ok: true } as unknown as TResult;
      case "music.nowPlaying": {
        // Browser dev mode has no GSMTC session. Return a deterministic
        // "playing" fixture so the NowPlayingPanel + {music.*} tokens render
        // real-looking output without a host attached. position_at_ms=now so
        // client-side extrapolation advances from the sampled position.
        const durationMs = 214_000;
        const positionMs = 72_000;
        return {
          active: true,
          title: "Mock Song Title",
          artist: "Mock Artist",
          album: "Mock Album",
          status: "playing",
          app_id: "Spotify.exe",
          app_name: "Spotify",
          position_ms: positionMs,
          duration_ms: durationMs,
          position_at_ms: Date.now(),
          playback_rate: 1.0,
          has_thumbnail: true,
        } as unknown as TResult;
      }
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
      case "assets.resolve":
      case "assets.prefetch": {
        const p = (params ?? {}) as {
          items?: Array<{ type?: string; id?: string; hintName?: string | null; hintImageUrl?: string | null }>;
        };
        const results = (p.items ?? []).map((item) => {
          const id = item.id ?? "";
          const type = item.type ?? (id.startsWith("wrld_") ? "world" : id.startsWith("avtr_") ? "avatar" : "user");
          const worldThumb = id.startsWith("wrld_")
            ? `https://picsum.photos/seed/${encodeURIComponent(id.slice(0, 16))}/256/144`
            : null;
          return {
            type,
            id,
            displayName: item.hintName ?? (id ? `${type} ${id.slice(0, 8)}` : null),
            subtitle: null,
            thumbnailUrl: item.hintImageUrl ?? worldThumb,
            imageUrl: item.hintImageUrl ?? worldThumb,
            localThumbnailUrl: null,
            source: "mock",
            confidence: item.hintName || item.hintImageUrl ? "reference" : "placeholder",
            fetchedAt: new Date().toISOString(),
            lastUsedAt: new Date().toISOString(),
            expiresAt: null,
            negativeUntil: null,
            stale: false,
            negative: false,
            payload: {},
          };
        });
        return { results, resolvedAt: new Date().toISOString(), ok: true } as unknown as TResult;
      }
      case "assets.invalidate":
        return { ok: true } as unknown as TResult;
      case "auth.status":
        return { ...this.mockAuthStatus } satisfies AuthStatus as unknown as TResult;
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
        this.mockAuthStatus = {
          authed: true,
          userId: "usr_mock-1234-5678",
          displayName: p.username,
        };
        return {
          status: "success",
          user: { ...this.mockAuthStatus },
        } as unknown as TResult;
      }
      case "auth.verify2FA":
        this.mockAuthStatus = {
          authed: true,
          userId: "usr_mock-1234-5678",
          displayName: "mock_user",
        };
        return {
          ok: true,
          user: { ...this.mockAuthStatus },
        } as unknown as TResult;
      case "auth.logout":
        this.mockAuthStatus = { ...MOCK_SIGNED_OUT };
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
        if (!this.mockAuthStatus.authed) {
          return { authed: false, user: null } satisfies AuthUserDetailsResult as unknown as TResult;
        }
        return {
          authed: true,
          user: {
            id: "usr_mock-1234-5678",
            username: "mock_user",
            displayName: this.mockAuthStatus.displayName ?? "mock_user",
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
      case "steamvr.read":
        return cloneJson(this.mockSteamVrConfig) as unknown as TResult;
      case "steamvr.write": {
        const updates = (params ?? {}) as Partial<SteamVrConfig>;
        this.mockSteamVrConfig = {
          ...this.mockSteamVrConfig,
          ...updates,
          driver_vrlink: {
            ...(this.mockSteamVrConfig.driver_vrlink ?? {}),
            ...(updates.driver_vrlink ?? {}),
          },
          steamvr: {
            ...(this.mockSteamVrConfig.steamvr ?? {}),
            ...(updates.steamvr ?? {}),
          },
        };
        return { ok: true } as unknown as TResult;
      }
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
      case "steamvr.link.backups":
        return {
          ok: true,
          steamPath: "D:/Steam",
          items: [
            {
              name: "vrcsm-vrlink-reset-mock",
              path: "D:/Steam/config/vrcsm-vrlink-reset-mock",
              hasMetadata: true,
              restorable: true,
              backupCount: 4,
              planId: "full-vrlink-reset",
              created: "2026-04-29T00:00:00Z",
              lastWriteTime: nowIso(),
            },
          ],
        } satisfies SteamVrLinkBackupList as unknown as TResult;
      case "steamvr.link.restore": {
        const p = (params ?? {}) as { backupDir?: string; dryRun?: boolean };
        return {
          ok: true,
          dryRun: p.dryRun ?? false,
          planId: "restore",
          backupDir: p.backupDir ?? "D:/Steam/config/vrcsm-vrlink-reset-mock",
          actions: [
            "Stop process steam.exe (4321)",
            `Restore D:/Steam/config/steamvr.vrsettings from ${p.backupDir ?? "mock backup"}`,
          ],
          backups: [],
          stopped: [],
          failures: [],
          currentBackupDir: "D:/Steam/config/vrcsm-before-restore-mock",
          currentBackups: [],
          restored: p.dryRun ? 0 : 1,
        } satisfies SteamVrLinkRepairResult as unknown as TResult;
      }
      case "plugin.list":
        return { plugins: cloneJson(this.mockInstalledPlugins) } as unknown as TResult;
      case "plugin.marketFeed":
        return {
          version: 1,
          generated: nowIso(),
          plugins: cloneJson(MOCK_MARKET_PLUGINS),
        } satisfies MarketFeedDto as unknown as TResult;
      case "plugin.install": {
        const p = (params ?? {}) as { url?: string; sha256?: string };
        const entry =
          MOCK_MARKET_PLUGINS.find((candidate) => candidate.download === p.url || candidate.sha256 === p.sha256) ??
          MOCK_MARKET_PLUGINS[1]!;
        const installed = marketEntryToInstalled(entry, false);
        const existing = this.mockInstalledPlugins.findIndex((plugin) => plugin.id === installed.id);
        if (existing >= 0) {
          this.mockInstalledPlugins.splice(existing, 1, installed);
        } else {
          this.mockInstalledPlugins.push(installed);
        }
        return {
          id: installed.id,
          version: installed.version,
          installDir: installed.installDir,
        } satisfies PluginInstallResult as unknown as TResult;
      }
      case "plugin.uninstall": {
        const p = (params ?? {}) as { id?: string };
        this.mockInstalledPlugins = this.mockInstalledPlugins.filter(
          (plugin) => plugin.id !== p.id || plugin.bundled,
        );
        return { ok: true, id: p.id ?? "" } as unknown as TResult;
      }
      case "plugin.enable": {
        const p = (params ?? {}) as { id?: string };
        this.mockInstalledPlugins = this.mockInstalledPlugins.map((plugin) =>
          plugin.id === p.id
            ? { ...plugin, enabled: true, virtualHost: plugin.virtualHost || `plugin.${plugin.id.replace(/\./g, "-")}.vrcsm` }
            : plugin,
        );
        return { ok: true, id: p.id ?? "" } as unknown as TResult;
      }
      case "plugin.disable": {
        const p = (params ?? {}) as { id?: string };
        this.mockInstalledPlugins = this.mockInstalledPlugins.map((plugin) =>
          plugin.id === p.id ? { ...plugin, enabled: false, virtualHost: "" } : plugin,
        );
        return { ok: true, id: p.id ?? "" } as unknown as TResult;
      }
      case "favorites.lists":
        return { lists: buildMockFavoriteLists() } as unknown as TResult;
      case "search.global": {
        const p = (params ?? {}) as SearchGlobalRequest;
        const normalized = (p.query ?? "").trim().toLowerCase();
        const limit = Math.min(Math.max(p.limit ?? 20, 1), 50);
        const offset = Math.max(p.offset ?? 0, 0);
        const source = mockFavorites.filter((item) => {
          if (!normalized) return true;
          return [
            item.type ?? "",
            item.target_id,
            item.display_name ?? "",
            item.list_name,
            item.note ?? "",
            ...(item.tags ?? []),
          ].join(" ").toLowerCase().includes(normalized);
        });
        const items: SearchGlobalResponse["items"] = source
          .slice(offset, offset + limit)
          .map((item) => ({
            type: (item.type === "world" || item.type === "avatar" || item.type === "user" ? item.type : "favorite"),
            id: item.target_id,
            displayName: item.display_name ?? item.target_id,
            subtitle: `Favorite in ${item.list_name}`,
            source: {
              kind: "local.favorite",
              label: "Local favorite",
              updatedAt: item.added_at,
            },
            evidence: [
              {
                kind: "favorite",
                label: "Favorite",
                detail: item.note ? `Saved in ${item.list_name} with note` : `Saved in ${item.list_name}`,
                sourceId: `mock:favorite:${item.target_id}`,
                observedAt: item.added_at ?? undefined,
                reliability: "verified",
                privacy: "local-only",
              },
            ],
            thumbnail: {
              url: item.thumbnail_url,
              kind: item.thumbnail_url ? "remote-cdn" : "placeholder",
              source: item.thumbnail_url ? "vrc-api" : "placeholder",
              verified: Boolean(item.thumbnail_url),
              alt: item.display_name ?? item.target_id,
            },
            localStatus: {
              state: "favorite",
              isFavorite: true,
              hasLocalCache: false,
              has3dPreview: false,
            },
            primaryAction: {
              kind: item.type === "avatar" ? "inspect" : "open",
              label: item.type === "world" ? "Open world" : item.type === "avatar" ? "Inspect avatar" : "Open",
              route: item.type === "world"
                ? `/worlds?select=${item.target_id}`
                : item.type === "avatar"
                  ? `/avatars?select=${item.target_id}`
                  : `/friends?select=${item.target_id}`,
              enabled: true,
            },
            confidence: 0.9,
          }));
        return {
          query: p.query ?? "",
          normalizedQuery: normalized,
          mode: "local",
          items,
          nextOffset: offset + items.length < source.length ? offset + items.length : null,
          diagnostics: {
            localSources: ["mock_favorites"],
            remoteSources: [],
            cacheHit: false,
            remoteSuppressedReason: "disabled",
          },
        } satisfies SearchGlobalResponse as unknown as TResult;
      }
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
        // Mirrors the host: each VRChat favorite group becomes its own list,
        // named after the group's displayName.
        const syncedAt = nowIso();
        const officialItems: FavoriteItem[] = [
          {
            type: "world",
            target_id: "wrld_official_favorite_world_001",
            list_name: "Chill Worlds",
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
            list_name: "Daily Drivers",
            display_name: "Official Favorite Avatar",
            thumbnail_url: null,
            added_at: syncedAt,
            sort_order: 0,
            tags: [],
            note: null,
            note_updated_at: null,
          },
          {
            type: "avatar",
            target_id: "avtr_official_favorite_avatar_002",
            list_name: "Event Fits",
            display_name: "Official Favorite Avatar 2",
            thumbnail_url: null,
            added_at: syncedAt,
            sort_order: 0,
            tags: [],
            note: null,
            note_updated_at: null,
          },
        ];
        const officialLists = ["Chill Worlds", "Daily Drivers", "Event Fits"];
        for (let i = mockFavorites.length - 1; i >= 0; i -= 1) {
          if (officialLists.includes(mockFavorites[i].list_name)) {
            mockFavorites.splice(i, 1);
          }
        }
        mockFavorites.push(...officialItems);
        const lists = [...new Set(officialItems.map((it) => it.list_name))];
        return {
          ok: true,
          lists,
          list_count: lists.length,
          grouped: true,
          imported: officialItems.length,
          avatars: officialItems.filter((it) => it.type === "avatar").length,
          worlds: officialItems.filter((it) => it.type === "world").length,
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
      case "users.boop":
        return { ok: true } as unknown as TResult;
      case "inventory.list": {
        const p = (params ?? {}) as { types?: string };
        const kinds = (p.types ?? "sticker,emoji,prop").split(",");
        const data = kinds.flatMap((kind, ki) =>
          Array.from({ length: 4 }).map((_, i) => ({
            id: `inv_${kind}_${i}`,
            name: `${kind} ${i + 1}`,
            itemType: kind,
            imageUrl: `https://picsum.photos/seed/${kind}${ki}${i}/256/256`,
            thumbnailImageUrl: `https://picsum.photos/seed/${kind}${ki}${i}/128/128`,
            isSeen: true,
            created_at: new Date(Date.now() - i * 3600_000).toISOString(),
          })),
        );
        return { data, totalCount: data.length } as unknown as TResult;
      }
      case "prints.list": {
        const prints = Array.from({ length: 6 }).map((_, i) => ({
          id: `prnt_mock_${i}`,
          authorName: "You",
          note: i % 2 === 0 ? `Print note ${i}` : "",
          image: `https://picsum.photos/seed/print${i}/512/384`,
          files: { image: `https://picsum.photos/seed/print${i}/512/384` },
          worldName: "The Black Cat",
          createdAt: new Date(Date.now() - i * 86400_000).toISOString(),
        }));
        return { prints } as unknown as TResult;
      }
      case "prints.get": {
        const p = (params ?? {}) as { printId?: string };
        return {
          id: p.printId ?? "prnt_mock_0",
          authorName: "You",
          image: "https://picsum.photos/seed/printdetail/512/384",
        } as unknown as TResult;
      }
      case "prints.upload":
        return {
          id: `prnt_mock_${Date.now()}`,
          image: "https://picsum.photos/seed/newprint/512/384",
        } as unknown as TResult;
      case "prints.delete":
      case "files.delete":
        return { ok: true } as unknown as TResult;
      case "files.list": {
        const p = (params ?? {}) as { tag?: string };
        const tag = p.tag || "gallery";
        const files = Array.from({ length: 5 }).map((_, i) => ({
          id: `file_${tag}_${i}`,
          name: `${tag}_${i}.png`,
          tags: [tag],
          mimeType: "image/png",
          versions: [
            {
              version: 1,
              status: "complete",
              file: { url: `https://picsum.photos/seed/${tag}${i}/512/512` },
            },
          ],
        }));
        return { files } as unknown as TResult;
      }
      case "files.uploadImage": {
        const p = (params ?? {}) as { tag?: string };
        return {
          id: `file_mock_${Date.now()}`,
          tags: [p.tag ?? "gallery"],
          versions: [
            {
              version: 1,
              status: "complete",
              file: { url: "https://picsum.photos/seed/upload/512/512" },
            },
          ],
        } as unknown as TResult;
      }
      case "avatars.updateImage":
        return { ok: true } as unknown as TResult;
      case "avatars.update":
        return { ok: true } as unknown as TResult;
      case "avatars.delete":
        return { ok: true } as unknown as TResult;
      case "avatars.harvestIds":
        return {
          ids: Array.from({ length: 4 }, (_, i) => `avtr_mock_harvest_${i}`),
        } as unknown as TResult;
      case "avatars.listOwned": {
        const p = (params ?? {}) as { releaseStatus?: string };
        const wanted = p.releaseStatus && p.releaseStatus !== "all" ? p.releaseStatus : null;
        const statuses = ["public", "private", "private"];
        const avatars = Array.from({ length: 6 })
          .map((_, i) => ({
            id: `avtr_mock_owned_${i}`,
            name: `My Avatar ${i}`,
            description: `Owned avatar ${i} (browser dev mode).`,
            authorId: "usr_mock-1234-5678",
            authorName: "mock_user",
            imageUrl: `https://picsum.photos/seed/owned${i}/512/512`,
            thumbnailImageUrl: `https://picsum.photos/seed/owned${i}/256/256`,
            releaseStatus: statuses[i % statuses.length],
            version: 1 + i,
            tags: i % 2 === 0 ? ["author_tag_test"] : [],
            unityPackages: [
              { platform: "standalonewindows", unityVersion: "2022.3.22f1", assetVersion: 4 },
            ],
            created_at: "2025-06-01T12:00:00Z",
            updated_at: nowIso(),
          }))
          .filter((a) => (wanted ? a.releaseStatus === wanted : true));
        return { avatars } as unknown as TResult;
      }
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
      case "screenshots.watcher.stop":
        return { ok: true } as unknown as TResult;
      case "screenshots.watcher.start":
        return {
          ok: true,
          folder: "C:/Users/dev/Pictures/VRChat",
        } as unknown as TResult;
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
      case "db.worldVisits.list": {
        const p = (params ?? {}) as { limit?: number; offset?: number };
        const limit = Math.max(0, Math.min(p.limit ?? 250, 5000));
        const offset = Math.max(0, p.offset ?? 0);
        const base = Date.now();
        const items = Array.from({ length: 18 }).map((_, i) => {
          const joined = new Date(base - (i + 1) * 3_600_000).toISOString();
          const left = new Date(base - i * 3_600_000 - 12 * 60_000).toISOString();
          return {
            id: i + 1,
            world_id: i % 2 === 0
              ? "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
              : "wrld_11111111-2222-3333-4444-555555555555",
            instance_id: i % 2 === 0
              ? "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:12345~hidden(usr_mock)~region(jp)"
              : "wrld_11111111-2222-3333-4444-555555555555:98765~friends(usr_mock)~region(us)",
            access_type: i % 2 === 0 ? "hidden" : "friends",
            owner_id: "usr_mock",
            region: i % 2 === 0 ? "jp" : "us",
            joined_at: joined,
            left_at: left,
            player_count: 3 + (i % 8),
            player_event_count: 6 + (i % 12),
            last_player_seen_at: left,
          };
        });
        return { items: items.slice(offset, offset + limit) } as unknown as TResult;
      }
      case "db.stats.heatmap": {
        // 7×24 world-visit counts (row = day-of-week Sun..Sat, col = hour).
        // Seed a plausible evening/weekend-heavy pattern so the dev chart has
        // shape instead of a flat grid.
        const grid = Array.from({ length: 7 }, (_, dow) =>
          Array.from({ length: 24 }, (_, hour) => {
            const evening = hour >= 19 && hour <= 23 ? 6 : 0;
            const afternoon = hour >= 13 && hour <= 18 ? 3 : 0;
            const weekend = dow === 0 || dow === 6 ? 4 : 0;
            const jitter = (dow * 7 + hour) % 3;
            return Math.max(0, evening + afternoon + weekend + jitter - (hour < 8 ? 5 : 0));
          }),
        );
        return grid as unknown as TResult;
      }
      case "db.coPresenceGraph": {
        // Co-presence ego-network fixture: center + a few mates, with one
        // confirmed (center-touching) and one inferred (mate↔mate) edge so the
        // dev graph renders both edge styles + the honesty label.
        const center = (params as { center_user_id?: string } | undefined)?.center_user_id
          ?? "usr_mock-self";
        const nowSec = Math.floor(Date.now() / 1000);
        return {
          center,
          since_days: 90,
          min_overlap_sec: 60,
          nodes: [
            { user_id: center, display_name: "Me", sessions: 12, total_seconds: 86_400, last_seen: nowSec, is_center: true },
            { user_id: "usr_mock-alice", display_name: "mock_alice", sessions: 8, total_seconds: 40_000, last_seen: nowSec, is_center: false },
            { user_id: "usr_mock-bob", display_name: "mock_bob", sessions: 5, total_seconds: 18_000, last_seen: nowSec, is_center: false },
            { user_id: "usr_mock-carol", display_name: "mock_carol", sessions: 3, total_seconds: 7_200, last_seen: nowSec, is_center: false },
          ],
          edges: [
            { source: center, target: "usr_mock-alice", kind: "confirmed", overlap_count: 8, overlap_seconds: 30_000, last_overlap: nowSec },
            { source: center, target: "usr_mock-bob", kind: "confirmed", overlap_count: 5, overlap_seconds: 12_000, last_overlap: nowSec },
            { source: "usr_mock-alice", target: "usr_mock-bob", kind: "co_presence", overlap_count: 3, overlap_seconds: 5_400, last_overlap: nowSec },
            { source: center, target: "usr_mock-carol", kind: "confirmed", overlap_count: 3, overlap_seconds: 6_000, last_overlap: nowSec },
          ],
        } as unknown as TResult;
      }
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
      // Event recorder — host implements these (IpcBridge HandleEventList etc.);
      // dev mock just returns a small fixture so the page renders instead of
      // throwing "method not implemented".
      case "event.list":
        return {
          recordings: [
            {
              id: 1,
              name: "Mock Meetup",
              world_id: "wrld_mock-1111-2222-3333",
              instance_id: "12345",
              started_at: nowIso(),
              ended_at: null,
              attendee_count: 2,
            },
          ],
        } as unknown as TResult;
      case "event.attendees":
        return {
          attendees: [
            { id: 1, user_id: "usr_mock-aaaa", display_name: "mock_alice", first_seen_at: nowIso() },
            { id: 2, user_id: "usr_mock-bbbb", display_name: "mock_bob", first_seen_at: nowIso() },
          ],
        } as unknown as TResult;
      case "event.start":
        return { id: 2 } as unknown as TResult;
      case "event.stop":
      case "event.addAttendee":
      case "event.delete":
        return { ok: true } as unknown as TResult;

      // ── Simple ok/void host actions (UI fire-and-forget mutations) ──────
      // These all resolve to { ok: true } in the host; the mock mirrors that
      // so click handlers (invite, friend req, mute/block, preview lifecycle,
      // rule toggles, vector upsert, audio switch, presence/log inserts …)
      // resolve cleanly instead of throwing mock_not_implemented.
      case "avatar.preview.abort":
      case "avatar.preview.release":
      case "avatar.preview.retain":
      case "avatar.select":
      case "friends.request":
      case "friends.unfriend":
      case "hw.applyPreset":
      case "pipeline.stop":
      case "friendLog.insert":
      case "friendPresence.record":
      case "db.avatarHistory.record":
      case "db.avatarHistory.resolve":
      case "notifications.clear":
      case "notifications.see":
      case "notifications.hide":
      case "notifications.accept":
      case "notifications.respond":
      case "user.block":
      case "user.unblock":
      case "user.mute":
      case "user.unmute":
      case "user.invite":
      case "user.inviteTo":
      case "user.requestInvite":
      case "message.send":
      case "groups.setRepresented":
      case "vector.upsertEmbedding":
      case "vr.audio.switch":
      case "rules.delete":
      case "rules.setEnabled":
      case "screenshots.injectMetadata":
        return { ok: true } as unknown as TResult;

      // ── Auto-start (Windows run-at-login toggle) ────────────────────────
      case "autoStart.get":
        return { enabled: false } as unknown as TResult;
      case "autoStart.set": {
        const p = (params ?? {}) as { enabled?: boolean };
        return { enabled: Boolean(p.enabled) } as unknown as TResult;
      }

      // ── Counts / empty collections consumed as arrays ───────────────────
      case "db.avatarHistory.count":
        return { count: 0 } as unknown as TResult;
      case "notifications.list":
        return { notifications: [] } as unknown as TResult;
      case "calendar.list":
        return { events: [] } as unknown as TResult;
      case "vector.getUnindexed":
        return { avatar_ids: [] } as unknown as TResult;
      case "vector.search":
        // Wrapper types the result as { matches: [...] }.
        return { matches: [] } as unknown as TResult;
      case "friendLog.recent":
      case "friendLog.forUser":
      case "db.playerEncounters":
      case "db.playerEvents.list":
      case "db.avatarHistory.list":
      case "db.avatarBenchmarks.list":
        return { items: [] } as unknown as TResult;
      case "calendar.discover":
      case "calendar.featured":
        return { events: [] } as unknown as TResult;
      case "pipeline.start":
        return { ok: true, state: "connected", already: false } as unknown as TResult;
      case "friendNote.all":
        return { items: [] } as unknown as TResult;
      case "friendNote.get":
        return { note: null } as unknown as TResult;
      case "friendNote.set":
        return { ok: true, updated_at: nowIso() } as unknown as TResult;
      case "friendPresence.recent":
        return { items: [] } as unknown as TResult;
      case "feed.unified":
        return { items: [] } as unknown as TResult;
      case "visits.list":
        return { visits: [] } as unknown as TResult;
      case "worlds.search":
        return { worlds: [] } as unknown as TResult;
      case "avatar.search":
        return { avatars: [] } as unknown as TResult;
      case "user.getSavedMessages":
        return { messages: [] } as unknown as TResult;
      case "jams.list":
        return [] as unknown as TResult;
      case "jams.detail":
        return {} as unknown as TResult;

      // ── Rules automation page ───────────────────────────────────────────
      case "rules.list":
        return { rules: [] } as unknown as TResult;
      case "rules.get":
        return {} as unknown as TResult;
      case "rules.create":
        return { id: 1 } as unknown as TResult;
      case "rules.update":
        return {} as unknown as TResult;
      case "rules.history":
        return { firings: [] } as unknown as TResult;

      // ── Discord Rich Presence status ────────────────────────────────────
      case "discord.status":
        return { running: false, connected: false } as unknown as TResult;
      case "discord.setActivity":
        return { ok: true, connected: false } as unknown as TResult;

      // ── Screenshot metadata read ────────────────────────────────────────
      case "screenshots.readMetadata":
        return { metadata: {} } as unknown as TResult;

      // ── Live memory reader / radar (no host attached in dev) ────────────
      case "memory.status":
        return { attached: false, vrcBase: 0, gaBase: 0 } as unknown as TResult;
      case "radar.poll":
        return {
          attached: false,
          vrcBase: 0,
          gaBase: 0,
          players: [],
          instanceId: "",
          worldId: "",
        } as unknown as TResult;

      // ── Friend online prediction (analytic) ─────────────────────────────
      case "friendPresence.predict": {
        const p = (params ?? {}) as { user_id?: string };
        return {
          user_id: p.user_id ?? "",
          status: "insufficient_data",
          timezone_offset_minutes: 0,
          total_online_minutes: 0,
          observation_days: 0,
          half_life_weeks: 4,
          heatmap: new Array(168).fill(0),
          top_windows: [],
        } as unknown as TResult;
      }

      // ── db.stats.overview (dashboard headline counters) ────────────────
      // Field names must mirror Database::StatsOverview's SQL aliases exactly;
      // a prior mock used a divergent `total_visits` shape the host never emits.
      case "db.stats.overview":
        return {
          total_world_visits: 0,
          total_players_encountered: 0,
          total_avatars_seen: 0,
          total_hours_in_world: 0,
        } as unknown as TResult;

      // ── data.usage (unified data-management panel, read-only) ──────────
      case "data.usage":
        return {
          disk: {
            "cache.thumbnails": 12_582_912,
            "cache.previews": 41_943_040,
            "cache.screenshotThumbs": 3_145_728,
            "cache.updates": 0,
            "cache.pluginFeed": 8_192,
            "cache.index": 65_536,
          },
          tables: {
            world_visits: 128,
            player_events: 4210,
            player_encounters: 3980,
            avatar_history: 512,
            friend_log: 340,
            sessions: 47,
            log_events: 15_003,
            friend_presence_events: 2201,
            avatar_embeddings_meta: 64,
            asset_cache: 890,
            avatar_benchmark: 33,
            owned_avatars: 12,
            online_prints: 5,
            online_inventory: 8,
            online_files: 21,
            local_favorites: 96,
          },
          dbFileBytes: 6_291_456,
        } as unknown as TResult;

      // ── data.clear (unified data-management panel, per-target cleanup) ──
      case "data.clear": {
        const p = (params ?? {}) as { targets?: string[] };
        const targets = p.targets ?? [];
        // Mirror the host: disk keys → removed, known table keys → cleared,
        // anything else → skipped/unknown_target (so the UI's skipped path is
        // exercised in dev, matching HandleDataClear's contract).
        const diskKeys = new Set([
          "cache.thumbnails", "cache.previews", "cache.screenshotThumbs",
          "cache.updates", "cache.pluginFeed", "cache.index",
        ]);
        const tableKeys = new Set([
          "cache.assetCache", "cache.benchmark", "cache.onlineMirror",
          "history.worldVisits", "history.playerEvents", "history.avatarHistory",
          "history.friendLog", "history.sessions", "history.logEvents",
          "experimental.embeddings", "assets.favorites",
        ]);
        const results: Record<string, unknown> = {};
        for (const key of targets) {
          if (diskKeys.has(key)) {
            results[key] = { ok: true, kind: "disk", removed: 42 };
          } else if (tableKeys.has(key)) {
            results[key] = { ok: true, kind: "table", cleared: {} };
          } else {
            results[key] = { ok: false, skipped: true, reason: "unknown_target" };
          }
        }
        return { results } as unknown as TResult;
      }

      // ── images.cache (mirror thumbnails.fetch row shape) ────────────────
      case "images.cache": {
        const p = (params ?? {}) as {
          id?: string;
          url?: string;
          items?: Array<{ id: string; url: string }>;
        };
        const items = p.items ?? (p.id ? [{ id: p.id, url: p.url ?? "" }] : []);
        const results = items.map(({ id, url }) => ({
          id,
          url,
          localUrl: null,
          imageCached: false,
          source: "network" as const,
          error: null,
        }));
        return { results } as unknown as TResult;
      }

      // ── VR diagnostics (network/audio/streaming health) ────────────────
      // Consumer maps over adapters/networkWarnings/vrlinkErrors unguarded,
      // so every array field must be present (empty is fine).
      case "vr.diagnose":
        return {
          adapters: [],
          networkWarnings: [],
          steamvrRunning: false,
          hmdModel: "",
          hmdDriver: "",
          preferredRefreshRate: 0,
          supersampleScale: 0,
          targetBandwidth: 0,
          motionSmoothing: false,
          allowSupersampleFiltering: false,
          preferredCodec: "",
          gpuName: "",
          gpuVramBytes: 0,
          gpuDriverVersion: "",
          defaultPlaybackDevice: "",
          defaultRecordingDevice: "",
          steamSpeakersFound: false,
          steamMicFound: false,
          vrlinkErrors: [],
          vrlinkBadLinkEvents: 0,
          vrlinkDroppedFrames: 0,
          vrlinkAvgBitrateMbps: 0,
          vrlinkMaxLatencyMs: 0,
        } as unknown as TResult;

      // ── instance.details (occupant counts for a location) ───────────────
      case "instance.details":
        return { instance: null } as unknown as TResult;

      // ── world.details (world inspector) ─────────────────────────────────
      case "world.details": {
        const p = (params ?? {}) as { id?: string };
        const id = p.id ?? "";
        if (!id) return { details: null } as unknown as TResult;
        return {
          details: {
            id,
            name: "Mock World",
            description: "A mock world for local dev.",
            authorId: "usr_mock-author",
            authorName: "mock_author",
            imageUrl: null,
            thumbnailImageUrl: `https://picsum.photos/seed/${encodeURIComponent(id.slice(0, 16))}/256/144`,
            releaseStatus: "public",
            capacity: 32,
            visits: 0,
            favorites: 0,
            tags: [],
            created_at: null,
            updated_at: null,
          },
        } as unknown as TResult;
      }

      // ── avatar.parameters.local (OSC tools parameter dump) ──────────────
      case "avatar.parameters.local": {
        const p = (params ?? {}) as { avatarId?: string; userId?: string };
        return {
          avatar_id: p.avatarId ?? "",
          user_id: p.userId ?? "",
          path: "",
          parameters: [],
        } as unknown as TResult;
      }

      default: {
        const message = `Mock IPC method not implemented: ${method}`;
        console.warn(message);
        throw new IpcError("mock_not_implemented", message);
      }
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
  async eventDelete(id: number) {
    return this.call<{ id: number }, { ok: boolean }>("event.delete", { id });
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

  async readConfig(params?: { path?: string }): Promise<Record<string, unknown>> {
    return this.call<typeof params, Record<string, unknown>>("config.read", params);
  }

  async writeConfig(params: { path?: string; config: Record<string, unknown> }): Promise<{ ok: boolean }> {
    return this.call<typeof params, { ok: boolean }>("config.write", params);
  }

  async readSteamVrConfig(): Promise<SteamVrConfig> {
    return this.call<undefined, SteamVrConfig>("steamvr.read");
  }

  async writeSteamVrConfig(updates: Record<string, unknown>): Promise<{ ok: boolean }> {
    // Pass the updates through as-is. SteamVrConfig::Write iterates the top
    // level keys (driver_vrlink / steamvr / ...) and deep-merges into
    // steamvr.vrsettings. Wrapping in { config } caused the merge to create
    // a stray "config" section while leaving the real sections untouched.
    return this.call<Record<string, unknown>, { ok: boolean }>("steamvr.write", updates);
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

  async getSavedMessages(type: "invite" | "inviteResponse" | "requestInvite" | "requestInviteResponse" = "requestInvite") {
    return this.call<{ type: string }, { messages: Array<{ id?: string; slot?: number; message?: string; messageType?: string; remainingCooldownMinutes?: number }> }>(
      "user.getSavedMessages", { type },
    );
  }

  async requestInvite(userId: string, slot = 0) {
    return this.call<{ userId: string; slot: number }, { ok: boolean }>(
      "user.requestInvite",
      { userId, slot },
    );
  }

  async visitsList() {
    return this.call<undefined, { visits: Array<{ userId?: string; displayName?: string; userIcon?: string; instanceId?: string; worldId?: string; worldName?: string; joinTime?: string; timesSeen?: number }> }>("visits.list");
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

  // ── Wave 2 / Section B: online social + VRC+ media ──────────────────

  async boopUser(userId: string, emojiId?: string) {
    return this.call<{ userId: string; emojiId?: string }, { ok: boolean }>(
      "users.boop",
      emojiId ? { userId, emojiId } : { userId },
    );
  }

  async inventoryList(types?: string, n = 100, offset = 0) {
    return this.call<
      { types?: string; n: number; offset: number },
      { data: any[]; totalCount?: number }
    >("inventory.list", types ? { types, n, offset } : { n, offset });
  }

  async printsList() {
    return this.call<{}, { prints: any[] }>("prints.list", {});
  }

  async printsGet(printId: string) {
    return this.call<{ printId: string }, any>("prints.get", { printId });
  }

  async printsUpload(params: {
    imageBase64: string;
    timestamp: string;
    note?: string;
    worldId?: string;
    worldName?: string;
  }) {
    return this.call<typeof params, any>("prints.upload", params);
  }

  async printsDelete(printId: string) {
    return this.call<{ printId: string }, { ok: boolean }>("prints.delete", {
      printId,
    });
  }

  async filesList(tag: string) {
    return this.call<{ tag: string }, { files: any[] }>("files.list", { tag });
  }

  async filesUploadImage(params: {
    imageBase64: string;
    tag: string;
    matchingDimensions?: boolean;
    // Animated-emoji sprite-sheet metadata (only read when tag === "emojianimated").
    frames?: number;
    framesOverTime?: number;
    animationStyle?: string;
  }) {
    return this.call<typeof params, any>("files.uploadImage", params);
  }

  async filesDelete(fileId: string) {
    return this.call<{ fileId: string }, { ok: boolean }>("files.delete", {
      fileId,
    });
  }

  async avatarsUpdateImage(avatarId: string, imageUrl: string) {
    return this.call<{ avatarId: string; imageUrl: string }, any>(
      "avatars.updateImage",
      { avatarId, imageUrl },
    );
  }

  async avatarsListOwned(params?: {
    releaseStatus?: "all" | "public" | "private" | "hidden";
    count?: number;
    offset?: number;
  }) {
    return this.call<typeof params, { avatars: AvatarSearchResult[] }>(
      "avatars.listOwned",
      params ?? {},
    );
  }

  async avatarsHarvestIds() {
    return this.call<Record<string, never>, { ids: string[] }>(
      "avatars.harvestIds",
      {},
    );
  }

  async avatarsUpdate(
    avatarId: string,
    patch: {
      name?: string;
      description?: string;
      releaseStatus?: string;
      tags?: string[];
      imageUrl?: string;
    },
  ) {
    return this.call<{ avatarId: string; patch: typeof patch }, any>(
      "avatars.update",
      { avatarId, patch },
    );
  }

  async avatarsDelete(avatarId: string) {
    return this.call<{ avatarId: string }, { ok: boolean }>("avatars.delete", {
      avatarId,
    });
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

  // ── Desktop toast notifications ─────────────────────────────────────
  // Push the user's per-event-type toggles (all default OFF) into the
  // host so the native Pipeline event lambda knows which Action Center
  // toasts to raise. The host echoes back the resolved flags.
  async notifySetPrefs(prefs: {
    friendOnline: boolean;
    invite: boolean;
    friendRequest: boolean;
    vrOverlay: boolean;
  }) {
    return this.call<
      typeof prefs,
      {
        ok: boolean;
        friendOnline: boolean;
        invite: boolean;
        friendRequest: boolean;
        vrOverlay: boolean;
      }
    >("notify.setPrefs", prefs);
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
  // The list methods below intentionally keep `{ items: any[] }`: each caller
  // (history-api.ts, WorldHistory, AvatarBenchmark, SocialGraph, ...) casts the
  // rows to its own local row type at the use site, so a typed row here would
  // buy nothing and force edits across out-of-scope pages. Row shapes are
  // instead pinned in web/src/lib/types.ts (DbWorldVisit, DbPlayerEvent, ...).

  async dbWorldVisits(limit = 250, offset = 0) {
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

  // Co-presence ego-network centered on `centerUserId` (normally the local
  // user). Edges touching the center are "confirmed" co-presence; edges
  // between two other users are "co_presence" inference only — never a
  // confirmed-friendship claim (VRChat exposes no friend-of-friend data).
  async dbCoPresenceGraph(centerUserId: string, sinceDays = 90, minOverlapSec = 60) {
    return this.call<
      { center_user_id: string; since_days: number; min_overlap_sec: number },
      CoPresenceGraph
    >(
      "db.coPresenceGraph",
      { center_user_id: centerUserId, since_days: sinceDays, min_overlap_sec: minOverlapSec },
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

  async dbAvatarBenchmarks(limit = 200, offset = 0) {
    return this.call<{ limit: number; offset: number }, { items: AvatarBenchmarkRow[] }>(
      "db.avatarBenchmarks.list", { limit, offset },
    );
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
    // Raw 7×24 count matrix; consumers coerce via activity-heatmap helpers.
    return this.call<{ days: number }, DbStatsHeatmapMatrix>("db.stats.heatmap", { days });
  }

  async dbStatsOverview() {
    return this.call<undefined, DbStatsOverview>("db.stats.overview");
  }

  async dbHistoryClear(includeFriendNotes = false) {
    return this.call<{ include_friend_notes: boolean }, DbHistoryClearResult>(
      "db.history.clear",
      { include_friend_notes: includeFriendNotes },
    );
  }

  // ── Unified data management (data.usage / data.clear) ────────────────

  /** Read-only usage aggregate: on-disk cache bytes + DB table counts. */
  async dataUsage() {
    return this.call<undefined, DataUsage>("data.usage");
  }

  /** Per-target cleanup. `targets` is a whitelist of DataClearTarget keys. */
  async dataClear(targets: string[]) {
    return this.call<{ targets: string[] }, DataClearResponse>("data.clear", {
      targets,
    });
  }

  async searchGlobal(params: SearchGlobalRequest) {
    return this.call<SearchGlobalRequest, SearchGlobalResponse>(
      "search.global",
      params,
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

  async friendNoteAll() {
    return this.call<
      undefined,
      { items: { user_id: string; note: string | null }[] }
    >("friendNote.all", undefined);
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

  // ── Friend presence events + unified feed (Track B1) ────────────────
  // friendPresence.* persists per-instance presence/location/status/avatar
  // flips; feed.unified reads them back joined with friend_log, player_events
  // and avatar_history as one time-ordered stream.

  async friendPresenceRecord(params: {
    user_id: string;
    event_type: string;
    display_name?: string;
    world_id?: string;
    instance_id?: string;
    location?: string;
    status?: string;
    old_value?: string;
    new_value?: string;
    source?: string;
    occurred_at?: string;
  }) {
    return this.call<typeof params, { ok: boolean }>("friendPresence.record", params);
  }

  async friendPresenceRecent(params: {
    limit?: number;
    offset?: number;
    user_id?: string;
    event_type?: string;
    occurred_after?: string;
    occurred_before?: string;
  } = {}) {
    return this.call<typeof params, { items: FriendPresenceEventDto[] }>(
      "friendPresence.recent", params,
    );
  }

  async friendPresencePredict(params: {
    user_id: string;
    top_n?: number;
    half_life_weeks?: number;
  }) {
    return this.call<typeof params, FriendOnlinePredictionDto>(
      "friendPresence.predict", params,
    );
  }

  async feedUnified(params: {
    limit?: number;
    offset?: number;
    user_id?: string;
    source_kind?: FeedSourceKind;
    occurred_after?: string;
    occurred_before?: string;
  } = {}) {
    return this.call<typeof params, { items: FeedEntryDto[] }>(
      "feed.unified", params,
    );
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
