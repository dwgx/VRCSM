import { ipc } from "@/lib/ipc";

export interface ShellOpenResult {
  ok: boolean;
}

export function buildVrchatWorldLaunchUrl(worldId: string): string {
  return `vrchat://launch?id=${encodeURIComponent(worldId)}`;
}

export function buildVrchatLocationLaunchUrl(location: string): string {
  return `vrchat://launch?ref=vrchat.com&id=${encodeURIComponent(location)}`;
}

/**
 * Compose a full VRChat location tag (`wrld_xxx:instance~region(...)`) from a
 * stored visit's `world_id` + `instance_id`. The log parser stores
 * `instance_id` as the full `world:instance` tag, but older rows (or other code
 * paths) may store just the bare instance portion — so we normalize: if the
 * instance string already starts with the world id we use it verbatim,
 * otherwise we join them with ":". Returns null when we can't form a rejoinable
 * location (private/closed instances have no world_id, etc.).
 */
export function rejoinLocationFromVisit(
  worldId: string | undefined | null,
  instanceId: string | undefined | null,
): string | null {
  const world = (worldId ?? "").trim();
  const instance = (instanceId ?? "").trim();
  if (!world || !world.startsWith("wrld_")) return null;
  if (!instance) return null;
  // Already a full location tag (contains the world id) — use as-is.
  if (instance.startsWith(world)) return instance;
  // Bare instance portion — compose the canonical tag.
  return `${world}:${instance}`;
}

export function vrchatUserUrl(userId: string): string {
  return `https://vrchat.com/home/user/${encodeURIComponent(userId)}`;
}

export function vrchatWorldUrl(worldId: string): string {
  return `https://vrchat.com/home/world/${encodeURIComponent(worldId)}`;
}

export function vrchatAvatarUrl(avatarId: string): string {
  return `https://vrchat.com/home/avatar/${encodeURIComponent(avatarId)}`;
}

export async function openExternalUrl(url: string): Promise<ShellOpenResult> {
  return ipc.call<{ url: string }, ShellOpenResult>("shell.openUrl", { url });
}

export function openExternalUrlQuietly(url: string): void {
  void openExternalUrl(url).catch(() => undefined);
}

export function openVrchatWorld(worldId: string): Promise<ShellOpenResult> {
  return openExternalUrl(buildVrchatWorldLaunchUrl(worldId));
}

export function openVrchatLocation(location: string): Promise<ShellOpenResult> {
  return openExternalUrl(buildVrchatLocationLaunchUrl(location));
}

export function openVrchatUserProfile(userId: string): Promise<ShellOpenResult> {
  return openExternalUrl(vrchatUserUrl(userId));
}

export function openVrchatWorldPage(worldId: string): Promise<ShellOpenResult> {
  return openExternalUrl(vrchatWorldUrl(worldId));
}
