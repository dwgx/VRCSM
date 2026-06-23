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
