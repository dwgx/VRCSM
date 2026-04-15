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

/** `[VRC Camera] Took screenshot to:` — absolute path, unmodified. */
export interface ScreenshotEvent {
  iso_time: string | null;
  path: string;
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
  /** VRCX-parity event streams, capped at 500 each to keep IPC sane. */
  player_events: PlayerEvent[];
  avatar_switches: AvatarSwitchEvent[];
  screenshots: ScreenshotEvent[];
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
