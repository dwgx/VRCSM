export interface CategorySummary {
  key: string;
  name: string;
  kind: "dir" | "file";
  logical_path: string;
  exists: boolean;
  lexists: boolean;
  is_dir: boolean;
  is_file: boolean;
  resolved_path: string;
  bytes: number;
  bytes_human: string;
  file_count: number;
  latest_mtime: string | null;
  oldest_mtime: string | null;
}

export interface BundleEntry {
  entry: string;
  path: string;
  bytes: number;
  bytes_human: string;
  file_count: number;
  latest_mtime: string | null;
  oldest_mtime: string | null;
  bundle_format: string;
}

export interface CacheWindowsPlayer {
  entry_count: number;
  entries: BundleEntry[];
  largest_entries: BundleEntry[];
}

export interface LocalAvatarItem {
  user_id: string;
  avatar_id: string;
  path: string;
  eye_height: number | null;
  parameter_count: number;
  modified_at: string | null;
}

export interface LocalAvatarData {
  item_count: number;
  recent_items: LocalAvatarItem[];
  parameter_count_histogram: Record<string, number>;
}

export interface LogSettings {
  cache_directory: string | null;
  cache_size_mb: number | null;
  clear_cache_on_start: boolean | null;
}

export interface LogEnvironment {
  vrchat_build: string | null;
  store: string | null;
  platform: string | null;
  device_model: string | null;
  processor: string | null;
  system_memory: string | null;
  operating_system: string | null;
  gpu_name: string | null;
  gpu_api: string | null;
  gpu_memory: string | null;
  xr_device: string | null;
}

export interface LogSettingsSection {
  name: string;
  entries: Array<[string, string]>;
}

export interface AvatarNameInfo {
  name: string;
  author: string | null;
}

/** `[Behaviour] OnPlayerJoined` / `OnPlayerLeft` — one row per line. */
export interface PlayerEvent {
  kind: "joined" | "left";
  iso_time: string | null;
  display_name: string;
  /** Only present on newer client builds; older ones omit the `(usr_…)`. */
  user_id: string | null;
}

/** `[Behaviour] Switching <actor> to avatar <name>` — local or remote. */
export interface AvatarSwitchEvent {
  iso_time: string | null;
  actor: string;
  avatar_name: string;
}

export interface ScreenshotEvent {
  iso_time: string | null;
  path: string;
}

/** `[Behaviour] Joining wrld_...:port~tags` — detailed map instance connection streams. */
export interface WorldSwitchEvent {
  iso_time: string | null;
  world_id: string;
  instance_id: string;
  access_type: string;
  owner_id: string | null;
  region: string | null;
}

export interface LogReport {
  log_files: string[];
  log_count: number;
  /** Legacy cache-only fields kept for backwards compat. */
  settings: LogSettings;
  /** Parsed `[UserInfoLogger] Environment Info:` block. */
  environment: LogEnvironment;
  /** Parsed `[UserInfoLogger] User Settings Info:` block — ordered by file. */
  settings_sections: LogSettingsSection[];
  local_user_name: string | null;
  local_user_id: string | null;
  recent_world_ids: string[];
  recent_avatar_ids: string[];
  world_names: Record<string, string>;
  /** avtr_* → pretty name + author pulled from output_log_*.txt pairing. */
  avatar_names: Record<string, AvatarNameInfo>;
  world_event_count: number;
  avatar_event_count: number;
  player_events: PlayerEvent[];
  avatar_switches: AvatarSwitchEvent[];
  screenshots: ScreenshotEvent[];
  world_switches: WorldSwitchEvent[];
}

export interface BrokenLink {
  category: string;
  logical_path: string;
  resolved_path: string;
  reason: string;
}

export interface Report {
  generated_at: string;
  base_dir: string;
  category_summaries: CategorySummary[];
  total_bytes: number;
  total_bytes_human: string;
  existing_category_count: number;
  broken_links: BrokenLink[];
  cache_windows_player: CacheWindowsPlayer;
  local_avatar_data: LocalAvatarData;
  logs: LogReport;
}

export type MigratePhase =
  | "idle"
  | "preflight"
  | "copy"
  | "verify"
  | "remove"
  | "junction"
  | "done"
  | "error";

export interface MigratePlan {
  source: string;
  target: string;
  sourceBytes: number;
  targetFreeBytes: number;
  sourceIsJunction: boolean;
  vrcRunning: boolean;
  blockers: string[];
}

export interface MigrateProgress {
  phase: MigratePhase;
  bytesDone: number;
  bytesTotal: number;
  filesDone: number;
  filesTotal: number;
  message?: string;
}

export interface AppVersion {
  version: string;
  build: string;
}

export interface BundlePreview {
  infoText: string;
  magic: string;
  fileTree: string[];
}

export interface DryRunResult {
  targets: string[];
}

export interface DeleteResult {
  deleted: number;
}

export interface ProcessStatus {
  running: boolean;
  pid?: number;
}

export type LogStreamLevel = "info" | "warn" | "error";

export interface LogStreamChunk {
  line?: string;
  message?: string;
  text?: string;
  level?: LogStreamLevel;
  timestamp?: string;
  source?: string;
}

export type VrcSettingType = "int" | "float" | "string" | "bool" | "raw";

export interface VrcSettingValueSnapshot {
  type: VrcSettingType;
  intValue?: number;
  floatValue?: number;
  stringValue?: string;
  boolValue?: boolean;
  raw?: number[];
}

export interface VrcSettingEntry extends VrcSettingValueSnapshot {
  encodedKey: string;
  key: string;
  group: string;
  description: string;
}

export interface VrcSettingsReport {
  entries: VrcSettingEntry[];
  count: number;
  /** group name → indices into entries[] */
  groups: Record<string, number[]>;
}

export interface VrcSettingsWriteRequest {
  encodedKey: string;
  value: VrcSettingValueSnapshot;
}

export interface VrcSettingsWriteResult {
  ok: boolean;
}

export interface VrcSettingsExportResult {
  ok: boolean;
  path: string;
}

export interface IpcEnvelopeRequest<T = unknown> {
  id: string;
  method: string;
  params?: T;
}

export interface IpcEnvelopeError {
  code: string;
  message: string;
  httpStatus?: number;
}

export interface IpcEnvelopeResponse<T = unknown> {
  id: string;
  result?: T;
  error?: IpcEnvelopeError;
}

export interface IpcEnvelopeEvent<T = unknown> {
  event: string;
  data: T;
}

// ─── Auth (v0.2.0) ──────────────────────────────────────────────────────
// AuthStatus is the cheap "are we logged in" probe used by the TitleBar
// and router guards. The full user JSON flows separately via `auth.user`
// so the status poll stays light.

export interface AuthStatus {
  authed: boolean;
  userId: string | null;
  displayName: string | null;
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  currentAvatarImageUrl: string | null;
  currentAvatarThumbnailImageUrl: string | null;
  status: string | null;
  statusDescription: string | null;
  bio: string | null;
  last_platform: string | null;
}

// ─── Friends (v0.2.0) ───────────────────────────────────────────────────
// Friend = the lightweight list row returned by /auth/user/friends. Full
// instance / location info is lazily expanded on row hover if we ever
// add it; for v0.2.0 we just render what the list endpoint gives us.

export interface Friend {
  id: string;
  username?: string | null;
  displayName: string;
  currentAvatarImageUrl: string | null;
  currentAvatarThumbnailImageUrl: string | null;
  statusDescription: string | null;
  status: string | null;
  location: string | null;
  last_platform: string | null;
  /** Short free-form bio from the user's profile. Empty when missing. */
  bio: string | null;
  /** `none` | `trusted` | `internal` | `moderator`. Empty when not a developer. */
  developerType: string | null;
  /** ISO timestamp of last login. Empty for currently-online users. */
  last_login: string | null;
  /** ISO timestamp of most recent activity (online or off). */
  last_activity: string | null;
  /** User's chosen "use instead of avatar image" URL. */
  profilePicOverride: string | null;
  /** Upgraded profile icon URL (supporters get it). */
  userIcon: string | null;
  /** Curated subset: `system_trust_*` ranks + `admin_*` flags only. */
  tags: string[];
}

export interface FriendsListResult {
  friends: Friend[];
}

// ─── Avatar Details (v0.5.0) ──────────────────────────────────────────
// Full avatar record from /api/1/avatars/{id}. Used by AvatarPopupBadge
// and the Avatars page inspector.

export interface UnityPackage {
  id: string;
  assetUrl: string | null;
  assetVersion: number;
  platform: "standalonewindows" | "android" | string;
  unityVersion: string | null;
  unitySortNumber: number;
  created_at: string | null;
}

export interface AvatarDetails {
  id: string;
  name: string;
  description: string | null;
  authorId: string;
  authorName: string;
  imageUrl: string | null;
  thumbnailImageUrl: string | null;
  releaseStatus: "public" | "private" | string;
  version: number;
  unityPackages: UnityPackage[];
  created_at: string | null;
  updated_at: string | null;
  tags: string[];
  assetUrl: string | null;
}

// ─── World Details (v0.5.0) ───────────────────────────────────────────

export interface WorldDetails {
  id: string;
  name: string;
  description: string | null;
  authorId: string;
  authorName: string;
  imageUrl: string | null;
  thumbnailImageUrl: string | null;
  releaseStatus: string;
  capacity: number;
  visits: number;
  favorites: number;
  tags: string[];
  created_at: string | null;
  updated_at: string | null;
}
