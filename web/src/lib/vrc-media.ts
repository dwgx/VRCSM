// VRChat online-media helpers (Wave 2 / Section B).
//
// Thin wrappers over the host IPC for the VRChat "online" surfaces that
// live entirely on VRChat's servers rather than in local logs/cache:
//
//   - boop          lightweight social ping (friends only)
//   - inventory     stickers / emoji / props the account owns
//   - prints        the in-game photo feature
//   - files         VRC+ gallery / icons / emoji / stickers
//   - avatar image  re-point an owned avatar at a freshly uploaded image
//
// Uploads accept a browser File/Blob and convert to base64 here so the C++
// host can decode + multipart-POST the raw bytes. We strip the `data:` URI
// prefix because the host's base64 decoder expects bare base64.

import { ipc } from "@/lib/ipc";
import type {
  AvatarSearchResult,
  VrcFile,
  VrcImagePurpose,
  VrcInventoryItem,
  VrcPrint,
} from "@/lib/types";

export interface OkResult {
  ok: boolean;
}

// ── VRC+ supporter limits (B5/B6) ────────────────────────────────────────────
//
// VRChat gates several media surfaces behind an active VRC+ subscription and
// caps how many custom sticker/emoji slots an account may hold. We enforce
// these *before* hitting the network so the user gets a friendly, instant
// message instead of a raw API error. The server stays the source of truth:
// the upload call sites keep their error-code catch as a fallback for when
// these (volatile) limits drift.

/** The VRChat user tag that marks an *active* VRC+ subscription. VERIFIED
 *  (vrchat.community/tags/user): `system_supporter` = active VRC+. The
 *  `system_early_adopter` badge is NOT proof of an active subscription. */
export const SUPPORTER_TAG = "system_supporter";

/** True when the user tag list marks an active VRC+ subscription. */
export function isVrcPlusSupporter(tags: readonly string[] | null | undefined): boolean {
  return Array.isArray(tags) && tags.some((t) => t === SUPPORTER_TAG);
}

/**
 * Image purposes that require an active VRC+ subscription to upload. Avatar
 * images (`avatarimage`) are intentionally absent — any user may re-point
 * their own avatar's image, so C5 is NOT VRC+ gated. VERIFIED per
 * wave3-file-upload.md §2c.
 */
const SUPPORTER_ONLY_PURPOSES: ReadonlySet<VrcImagePurpose> = new Set<VrcImagePurpose>([
  "gallery",
  "sticker",
  "emoji",
  "emojianimated",
  "icon",
]);

/**
 * Per-purpose slot caps for VRC+ supporters. VOLATILE — VRChat keeps moving
 * these (18 custom sticker + 18 emoji slots as of late-2025, VERIFIED but
 * subject to change). Treated as advisory soft caps; purposes without an
 * entry (e.g. gallery, icon) have no client-side count limit and lean on the
 * server. `emojianimated` is deliberately omitted (no authoritative count
 * found — don't invent one; let the server reject).
 */
export const VRC_PLUS_SLOT_LIMITS: Partial<Record<VrcImagePurpose, number>> = {
  sticker: 18,
  emoji: 18,
};

export type ImageUploadGate =
  | { allowed: true }
  | { allowed: false; reason: "supporter_required" }
  | { allowed: false; reason: "limit_reached"; limit: number; current: number };

/**
 * Decide whether an image upload is allowed *before* firing the request.
 * Pure + side-effect free so it can be unit-tested and reused.
 *
 * @param purpose       the image tag being uploaded
 * @param isSupporter   whether the current user has an active VRC+ sub
 * @param currentCount  how many items of this purpose the account already has
 */
export function evaluateImageUploadGate(
  purpose: VrcImagePurpose,
  isSupporter: boolean,
  currentCount = 0,
): ImageUploadGate {
  // Avatar images are never VRC+ gated.
  if (!SUPPORTER_ONLY_PURPOSES.has(purpose)) {
    return { allowed: true };
  }
  if (!isSupporter) {
    return { allowed: false, reason: "supporter_required" };
  }
  const limit = VRC_PLUS_SLOT_LIMITS[purpose];
  if (typeof limit === "number" && currentCount >= limit) {
    return { allowed: false, reason: "limit_reached", limit, current: currentCount };
  }
  return { allowed: true };
}

/**
 * Read a File/Blob as bare base64 (no `data:image/...;base64,` prefix).
 * Rejects if the file can't be read.
 */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("unexpected FileReader result"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

// ── Boop ───────────────────────────────────────────────────────────────

/** Send a boop (friends only). Optional emojiId picks the boop sticker. */
export function boopUser(userId: string, emojiId?: string): Promise<OkResult> {
  return ipc.boopUser(userId, emojiId);
}

// ── Inventory ────────────────────────────────────────────────────────────

export async function listInventory(
  types?: string,
  n = 100,
  offset = 0,
): Promise<{ data: VrcInventoryItem[]; totalCount?: number }> {
  const r = await ipc.inventoryList(types, n, offset);
  return {
    data: Array.isArray(r.data) ? (r.data as VrcInventoryItem[]) : [],
    totalCount: r.totalCount,
  };
}

// ── Prints ───────────────────────────────────────────────────────────────

export async function listPrints(): Promise<VrcPrint[]> {
  const r = await ipc.printsList();
  return Array.isArray(r.prints) ? (r.prints as VrcPrint[]) : [];
}

export function getPrint(printId: string): Promise<VrcPrint> {
  return ipc.printsGet(printId) as Promise<VrcPrint>;
}

export async function uploadPrint(
  file: Blob,
  opts: { timestamp?: string; note?: string; worldId?: string; worldName?: string } = {},
): Promise<VrcPrint> {
  const imageBase64 = await fileToBase64(file);
  return ipc.printsUpload({
    imageBase64,
    timestamp: opts.timestamp ?? new Date().toISOString(),
    note: opts.note,
    worldId: opts.worldId,
    worldName: opts.worldName,
  }) as Promise<VrcPrint>;
}

/** DESTRUCTIVE — caller must double-confirm before invoking. */
export function deletePrint(printId: string): Promise<OkResult> {
  return ipc.printsDelete(printId);
}

// ── Files (VRC+ gallery / icons / stickers / emoji) ────────────────────────

export async function listFiles(tag: string): Promise<VrcFile[]> {
  const r = await ipc.filesList(tag);
  return Array.isArray(r.files) ? (r.files as VrcFile[]) : [];
}

export async function uploadImageFile(
  file: Blob,
  tag: VrcImagePurpose,
  matchingDimensions = false,
): Promise<VrcFile> {
  const imageBase64 = await fileToBase64(file);
  return ipc.filesUploadImage({
    imageBase64,
    tag,
    matchingDimensions,
  }) as Promise<VrcFile>;
}

/**
 * Upload an animated emoji. VRChat treats the image as a vertical sprite sheet
 * of `frames` cells played back at `framesOverTime` fps with `animationStyle`.
 * Always square (matchingDimensions). The host validates frames >= 1.
 */
export async function uploadAnimatedEmojiFile(
  file: Blob,
  opts: { frames: number; framesOverTime: number; animationStyle: string },
): Promise<VrcFile> {
  const imageBase64 = await fileToBase64(file);
  return ipc.filesUploadImage({
    imageBase64,
    tag: "emojianimated",
    matchingDimensions: true,
    frames: opts.frames,
    framesOverTime: opts.framesOverTime,
    animationStyle: opts.animationStyle,
  }) as Promise<VrcFile>;
}

/** DESTRUCTIVE — caller must double-confirm before invoking. */
export function deleteFile(fileId: string): Promise<OkResult> {
  return ipc.filesDelete(fileId);
}

// ── Avatar image ───────────────────────────────────────────────────────────

/** Re-point an owned avatar at a new image url (after uploadImageFile). */
export function updateAvatarImage(
  avatarId: string,
  imageUrl: string,
): Promise<unknown> {
  return ipc.avatarsUpdateImage(avatarId, imageUrl);
}

// ── Owned avatars (model-management page / Section C) ───────────────────────

export type OwnedAvatarReleaseFilter = "all" | "public" | "private" | "hidden";

/** Editable subset of an owned avatar's profile fields. */
export interface AvatarPatch {
  name?: string;
  description?: string;
  releaseStatus?: string;
  tags?: string[];
  imageUrl?: string;
}

/**
 * List the signed-in user's own avatars. Read-only / LIVE. Returns the slim
 * AvatarSearchResult shape (plus unityPackages carried on the wire) so it
 * unions cleanly with favorites/history/search in normalizeAvatarModelRecords.
 */
export async function listOwnedAvatars(
  releaseStatus: OwnedAvatarReleaseFilter = "all",
  count = 100,
  offset = 0,
): Promise<AvatarSearchResult[]> {
  const r = await ipc.avatarsListOwned({ releaseStatus, count, offset });
  return Array.isArray(r.avatars) ? r.avatars : [];
}

/**
 * Build a minimal avatar patch from the manage-dialog form state. Only fields
 * that actually changed against `original` are included, so a no-op save sends
 * nothing and a name-only edit never rewrites the description. Returns null
 * when nothing changed.
 */
export function buildAvatarPatch(
  original: { name?: string | null; description?: string | null; releaseStatus?: string | null; tags?: string[] | null },
  next: { name?: string; description?: string; releaseStatus?: string; tags?: string[] },
): AvatarPatch | null {
  const patch: AvatarPatch = {};
  const trim = (v: string | null | undefined) => (v ?? "").trim();
  if (next.name !== undefined && trim(next.name) !== trim(original.name)) {
    patch.name = next.name.trim();
  }
  if (next.description !== undefined && next.description !== (original.description ?? "")) {
    patch.description = next.description;
  }
  if (
    next.releaseStatus !== undefined &&
    trim(next.releaseStatus) !== trim(original.releaseStatus)
  ) {
    patch.releaseStatus = next.releaseStatus.trim();
  }
  if (next.tags !== undefined) {
    const a = [...(original.tags ?? [])].sort();
    const b = [...next.tags].sort();
    if (a.length !== b.length || a.some((t, i) => t !== b[i])) {
      patch.tags = next.tags;
    }
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/** WRITE — caller must gate behind an explicit user action. */
export function updateAvatar(avatarId: string, patch: AvatarPatch): Promise<unknown> {
  return ipc.avatarsUpdate(avatarId, patch);
}

/**
 * DESTRUCTIVE and irreversible (VRChat soft-deletes the avatar and reserves
 * the id permanently). The caller MUST double-confirm naming the exact avatar
 * before invoking.
 */
export function deleteAvatar(avatarId: string): Promise<OkResult> {
  return ipc.avatarsDelete(avatarId);
}

/**
 * Upload a new image file and re-point the owned avatar at it in one flow.
 * `matchingDimensions=true` makes VRChat reject images whose dimensions don't
 * match the existing avatar image, mirroring the in-game uploader.
 */
export async function replaceAvatarImageFromFile(
  avatarId: string,
  file: Blob,
  matchingDimensions = true,
): Promise<unknown> {
  const uploaded = await uploadImageFile(file, "avatarimage", matchingDimensions);
  const url = fileImageUrl(uploaded);
  if (!url) {
    throw new Error("upload_no_url");
  }
  return updateAvatarImage(avatarId, url);
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Resolve the best display url for a VRChat file record. */
export function fileImageUrl(file: VrcFile): string | null {
  const versions = file.versions ?? [];
  // Walk newest-first; skip deleted versions.
  for (let i = versions.length - 1; i >= 0; i -= 1) {
    const v = versions[i];
    if (v?.deleted) continue;
    const url = v?.file?.url;
    if (url) return url;
  }
  return null;
}

/** Resolve the best display url for a print record. */
export function printImageUrl(print: VrcPrint): string | null {
  return print.files?.image ?? print.image ?? null;
}
