/**
 * Local-first "is this me?" matching for rankings, co-presence, and
 * "seen on others" lists. Auth may be signed out while LocalAvatarData
 * still names the machine's usr_* folders, so self must be recoverable
 * without a live VRChat session.
 */

export interface SelfIdentity {
  userIds: string[];
  displayNames: string[];
}

function normalizeName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .toLowerCase()
    .trim();
}

function pushUnique(list: string[], value: string | null | undefined): void {
  const trimmed = value?.trim();
  if (!trimmed) return;
  if (!list.includes(trimmed)) list.push(trimmed);
}

export function collectSelfIdentity(input: {
  userId?: string | null;
  displayName?: string | null;
  localUserIds?: Array<string | null | undefined>;
}): SelfIdentity {
  const userIds: string[] = [];
  const displayNames: string[] = [];
  pushUnique(userIds, input.userId);
  for (const id of input.localUserIds ?? []) {
    if (id?.startsWith("usr_")) pushUnique(userIds, id);
  }
  pushUnique(displayNames, input.displayName);
  return { userIds, displayNames };
}

export function isSelfPlayer(
  self: SelfIdentity,
  userId?: string | null,
  displayName?: string | null,
): boolean {
  const id = userId?.trim() ?? "";
  if (id) {
    return self.userIds.some((mine) => mine.toLowerCase() === id.toLowerCase());
  }
  const name = normalizeName(displayName);
  if (name && self.displayNames.some((mine) => normalizeName(mine) === name)) {
    return true;
  }
  return false;
}

export function primarySelfUserId(self: SelfIdentity): string | null {
  return self.userIds[0] ?? null;
}

/** Minimal Friend row so FriendDetailDialog can fetch the live profile. */
export function friendStubFromIdentity(
  userId: string,
  displayName?: string | null,
): {
  id: string;
  displayName: string;
  currentAvatarImageUrl: null;
  currentAvatarThumbnailImageUrl: null;
  statusDescription: null;
  status: null;
  location: null;
  last_platform: null;
  bio: null;
  developerType: null;
  last_login: null;
  last_activity: null;
  profilePicOverride: null;
  userIcon: null;
  tags: [];
} | null {
  const id = userId.trim();
  if (!id.startsWith("usr_")) return null;
  return {
    id,
    displayName: displayName?.trim() || id,
    currentAvatarImageUrl: null,
    currentAvatarThumbnailImageUrl: null,
    statusDescription: null,
    status: null,
    location: null,
    last_platform: null,
    bio: null,
    developerType: null,
    last_login: null,
    last_activity: null,
    profilePicOverride: null,
    userIcon: null,
    tags: [],
  };
}
