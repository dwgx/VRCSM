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

export interface LogReport {
  log_files: string[];
  log_count: number;
  settings: LogSettings;
  recent_world_ids: string[];
  recent_avatar_ids: string[];
  world_names: Record<string, string>;
  world_event_count: number;
  avatar_event_count: number;
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
