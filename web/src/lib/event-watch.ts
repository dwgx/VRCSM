export type WatchAccess = "any" | "public" | "group" | "group+" | "friends" | "invite";

export interface EventWatchDraft {
  id?: string;
  enabled?: boolean;
  label?: string;
  worldId?: string;
  groupId?: string;
  region?: string;
  access?: string;
  minUsers?: number;
  maxUsers?: number;
  nameContains?: string;
  notify?: boolean;
  autoJoin?: boolean;
}

export function validateWatchDraft(watch: EventWatchDraft): string | null {
  const worldId = (watch.worldId ?? "").trim();
  const groupId = (watch.groupId ?? "").trim();
  if (!worldId && !groupId) {
    return "worldId or groupId is required";
  }
  if (watch.autoJoin && watch.notify === false) {
    return "autoJoin requires notify";
  }
  const access = watch.access ?? "any";
  const allowed: WatchAccess[] = ["any", "public", "group", "group+", "friends", "invite"];
  if (!allowed.includes(access as WatchAccess)) {
    return "unknown access filter";
  }
  return null;
}

export function emptyWatchDraft(): EventWatchDraft {
  return {
    enabled: false,
    label: "",
    worldId: "",
    groupId: "",
    region: "",
    access: "any",
    minUsers: 0,
    maxUsers: 0,
    nameContains: "",
    notify: true,
    autoJoin: false,
  };
}
