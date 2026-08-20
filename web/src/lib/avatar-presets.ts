/**
 * Named OSC / LocalAvatarData parameter presets.
 * Own JSON only — not AvatarSaver / ASM share codes, and not a VRChat file write.
 */

export const AVATAR_PRESET_SCHEMA = "vrcsm.avatar-preset.v1";
export const AVATAR_PRESETS_STORAGE_KEY = "vrcsm.avatar.presets.v1";

export const MAX_PRESET_PARAMS = 256;
export const MAX_PRESETS = 200;
export const MAX_PRESET_NAME = 80;

export type AvatarPresetValue = number | boolean | string;

export interface AvatarPreset {
  id: string;
  name: string;
  avatarId: string;
  params: Record<string, AvatarPresetValue>;
  savedAt: string;
}

export interface AvatarPresetStore {
  schema: typeof AVATAR_PRESET_SCHEMA;
  presets: AvatarPreset[];
}

export type OscPresetArg =
  | number
  | string
  | boolean
  | { t: "f" | "i" | "s" | "b"; v: number | string | boolean };

export interface LocalAvatarParamInput {
  name: string;
  value_type?: string;
  default_value?: unknown;
  value?: unknown;
}

export interface OscParamMessage {
  address: string;
  args?: readonly unknown[];
}

export interface OscPresetSend {
  address: string;
  args: OscPresetArg[];
}

export interface ApplyPresetResult {
  sent: number;
  skipped: number;
  failed: number;
}

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const AVTR_PREFIX = "avtr_";
const OSC_PARAM_PREFIX = "/avatar/parameters/";

export function isAvatarPresetValue(value: unknown): value is AvatarPresetValue {
  if (typeof value === "boolean" || typeof value === "string") return true;
  return typeof value === "number" && Number.isFinite(value);
}

export function looksLikeAvatarId(id: string): boolean {
  return id.startsWith(AVTR_PREFIX) && id.length > AVTR_PREFIX.length;
}

export function normalizeParamName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.toLowerCase().startsWith(OSC_PARAM_PREFIX)) {
    return trimmed.slice(OSC_PARAM_PREFIX.length).trim();
  }
  return trimmed;
}

export function oscAddressForParam(name: string): string {
  const n = normalizeParamName(name);
  return `${OSC_PARAM_PREFIX}${n}`;
}

export function isAvatarMismatch(
  preset: Pick<AvatarPreset, "avatarId">,
  currentAvatarId: string | null | undefined,
): boolean {
  const current = (currentAvatarId ?? "").trim();
  const saved = preset.avatarId.trim();
  if (!looksLikeAvatarId(saved) || !looksLikeAvatarId(current)) return false;
  return saved !== current;
}

export function looksLikeForeignShareCode(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  return trimmed[0] !== "{" && trimmed[0] !== "[";
}

function newPresetId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `preset-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
}

function coerceParamValue(value: unknown, valueType?: string): AvatarPresetValue | null {
  const type = (valueType ?? "").trim().toLowerCase();
  if (type === "bool" || typeof value === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === 0 || value === "0" || value === "false") return false;
    if (value === 1 || value === "1" || value === "true") return true;
    return null;
  }
  if (type === "string") {
    if (typeof value === "string") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "boolean") return value ? "true" : "false";
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (value.trim() !== "" && Number.isFinite(n)) return n;
    if (type === "float" || type === "int") return null;
    return value;
  }
  return null;
}

export function paramsFromLocalParameters(
  parameters: readonly LocalAvatarParamInput[],
  limit = MAX_PRESET_PARAMS,
): Record<string, AvatarPresetValue> {
  const out: Record<string, AvatarPresetValue> = {};
  for (const entry of parameters) {
    if (Object.keys(out).length >= limit) break;
    const name = normalizeParamName(entry.name ?? "");
    if (!name || name in out) continue;
    const raw = entry.value !== undefined ? entry.value : entry.default_value;
    const coerced = coerceParamValue(raw, entry.value_type);
    if (coerced === null) continue;
    out[name] = coerced;
  }
  return out;
}

export function mergeLiveOscParams(
  base: Record<string, AvatarPresetValue>,
  messages: readonly OscParamMessage[],
  limit = MAX_PRESET_PARAMS,
): Record<string, AvatarPresetValue> {
  const out: Record<string, AvatarPresetValue> = { ...base };
  for (const msg of messages) {
    const address = msg.address ?? "";
    if (!address.toLowerCase().startsWith(OSC_PARAM_PREFIX)) continue;
    const name = normalizeParamName(address);
    if (!name) continue;
    const raw = msg.args?.[0];
    const coerced = coerceParamValue(raw);
    if (coerced === null) continue;
    if (!(name in out) && Object.keys(out).length >= limit) continue;
    out[name] = coerced;
  }
  return out;
}

export function parseAvatarPreset(input: unknown): AvatarPreset | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const obj = input as Record<string, unknown>;
  if (typeof obj.id !== "string" || !obj.id.trim()) return null;
  if (typeof obj.name !== "string" || !obj.name.trim()) return null;
  if (typeof obj.avatarId !== "string" || !looksLikeAvatarId(obj.avatarId.trim())) return null;
  if (typeof obj.savedAt !== "string" || !obj.savedAt.trim()) return null;
  if (!obj.params || typeof obj.params !== "object" || Array.isArray(obj.params)) return null;

  const params: Record<string, AvatarPresetValue> = {};
  for (const [rawName, rawValue] of Object.entries(obj.params as Record<string, unknown>)) {
    if (Object.keys(params).length >= MAX_PRESET_PARAMS) break;
    const name = normalizeParamName(rawName);
    if (!name || name in params) continue;
    if (!isAvatarPresetValue(rawValue)) continue;
    params[name] = rawValue;
  }

  return {
    id: obj.id.trim(),
    name: obj.name.trim().slice(0, MAX_PRESET_NAME),
    avatarId: obj.avatarId.trim(),
    params,
    savedAt: obj.savedAt.trim(),
  };
}

export function serializeAvatarPreset(preset: AvatarPreset): string {
  return JSON.stringify({
    id: preset.id,
    name: preset.name,
    avatarId: preset.avatarId,
    params: preset.params,
    savedAt: preset.savedAt,
  });
}

export function deserializeAvatarPreset(raw: string): AvatarPreset | null {
  if (looksLikeForeignShareCode(raw)) return null;
  try {
    return parseAvatarPreset(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function parseAvatarPresetStore(raw: string | null | undefined): AvatarPreset[] {
  if (!raw || !raw.trim()) return [];
  if (looksLikeForeignShareCode(raw)) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map(parseAvatarPreset).filter((p): p is AvatarPreset => p !== null);
    }
    if (!parsed || typeof parsed !== "object") return [];
    const obj = parsed as {
      schema?: unknown;
      presets?: unknown;
      byAvatar?: unknown;
    };
    const collected: AvatarPreset[] = [];
    if (Array.isArray(obj.presets)) {
      for (const item of obj.presets) {
        const preset = parseAvatarPreset(item);
        if (preset) collected.push(preset);
      }
    }
    if (obj.byAvatar && typeof obj.byAvatar === "object" && !Array.isArray(obj.byAvatar)) {
      for (const [avatarId, list] of Object.entries(obj.byAvatar as Record<string, unknown>)) {
        if (!Array.isArray(list)) continue;
        for (const item of list) {
          const preset = parseAvatarPreset(
            item && typeof item === "object"
              ? { avatarId, ...(item as Record<string, unknown>) }
              : item,
          );
          if (preset) collected.push(preset);
        }
      }
    }
    return dedupePresets(collected);
  } catch {
    return [];
  }
}

export function serializeAvatarPresetStore(presets: AvatarPreset[]): string {
  const store: AvatarPresetStore = {
    schema: AVATAR_PRESET_SCHEMA,
    presets: dedupePresets(presets).slice(0, MAX_PRESETS),
  };
  return JSON.stringify(store);
}

function dedupePresets(presets: AvatarPreset[]): AvatarPreset[] {
  const seen = new Set<string>();
  const out: AvatarPreset[] = [];
  for (const preset of presets) {
    if (seen.has(preset.id)) continue;
    seen.add(preset.id);
    out.push(preset);
  }
  return out;
}

export function listPresetsForAvatar(
  presets: readonly AvatarPreset[],
  avatarId: string,
): AvatarPreset[] {
  const id = avatarId.trim();
  return presets.filter((p) => p.avatarId === id);
}

export function upsertPreset(
  presets: readonly AvatarPreset[],
  preset: AvatarPreset,
): AvatarPreset[] {
  const next = presets.filter((p) => p.id !== preset.id);
  next.push(preset);
  next.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  if (next.length <= MAX_PRESETS) return next;
  return next.slice(0, MAX_PRESETS);
}

export function deletePreset(presets: readonly AvatarPreset[], id: string): AvatarPreset[] {
  return presets.filter((p) => p.id !== id);
}

export function createPreset(input: {
  name: string;
  avatarId: string;
  params: Record<string, unknown>;
  id?: string;
  savedAt?: string;
  now?: Date;
}): AvatarPreset | null {
  const name = input.name.trim().slice(0, MAX_PRESET_NAME);
  const avatarId = input.avatarId.trim();
  if (!name || !looksLikeAvatarId(avatarId)) return null;
  const params: Record<string, AvatarPresetValue> = {};
  for (const [rawName, rawValue] of Object.entries(input.params)) {
    if (Object.keys(params).length >= MAX_PRESET_PARAMS) break;
    const key = normalizeParamName(rawName);
    if (!key || key in params) continue;
    if (!isAvatarPresetValue(rawValue)) continue;
    params[key] = rawValue;
  }
  if (Object.keys(params).length === 0) return null;
  const savedAt = input.savedAt?.trim() || (input.now ?? new Date()).toISOString();
  return {
    id: input.id?.trim() || newPresetId(),
    name,
    avatarId,
    params,
    savedAt,
  };
}

function defaultStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadAvatarPresets(storage: StorageLike | null = defaultStorage()): AvatarPreset[] {
  if (!storage) return [];
  try {
    return parseAvatarPresetStore(storage.getItem(AVATAR_PRESETS_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveAvatarPresets(
  presets: readonly AvatarPreset[],
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  storage.setItem(AVATAR_PRESETS_STORAGE_KEY, serializeAvatarPresetStore([...presets]));
}

/** Numbers go as tagged floats so VRChat animator floats keep the `,f` OSC tag. */
export function oscArgForValue(value: AvatarPresetValue): OscPresetArg | null {
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return { t: "f", v: value };
  }
  return null;
}

export function oscSendsForPreset(preset: AvatarPreset): OscPresetSend[] {
  const out: OscPresetSend[] = [];
  for (const [name, value] of Object.entries(preset.params)) {
    const arg = oscArgForValue(value);
    if (arg === null) continue;
    const address = oscAddressForParam(name);
    if (address === OSC_PARAM_PREFIX) continue;
    out.push({ address, args: [arg] });
  }
  return out;
}

export async function applyAvatarPreset(
  preset: AvatarPreset,
  send: (address: string, args: OscPresetArg[]) => Promise<{ ok: boolean }>,
): Promise<ApplyPresetResult> {
  const sends = oscSendsForPreset(preset);
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  if (sends.length === 0) return { sent, skipped: 1, failed };
  for (const item of sends) {
    try {
      const res = await send(item.address, item.args);
      if (res.ok) sent += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { sent, skipped, failed };
}
