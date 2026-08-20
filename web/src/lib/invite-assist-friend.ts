import { ipc } from "@/lib/ipc";

export interface InviteAssistAllowlistEntry {
  userId: string;
  displayName?: string;
}

export interface InviteAssistSnapshot {
  enabled: boolean;
  confirmedAt: string | null;
  allowlist: InviteAssistAllowlistEntry[];
}

export type InviteAssistToggleResult = "added" | "removed" | "confirmRequired";

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function parseInviteAssistGet(raw: unknown): InviteAssistSnapshot {
  const obj = asRecord(raw);
  const confirmedAt =
    typeof obj.confirmedAt === "string" && obj.confirmedAt.trim() !== ""
      ? obj.confirmedAt
      : null;
  const allowlist: InviteAssistAllowlistEntry[] = [];
  if (Array.isArray(obj.allowlist)) {
    for (const row of obj.allowlist) {
      const rec = asRecord(row);
      if (typeof rec.userId === "string" && rec.userId.length > 0) {
        allowlist.push({
          userId: rec.userId,
          displayName: typeof rec.displayName === "string" ? rec.displayName : undefined,
        });
      }
    }
  }
  return {
    enabled: obj.enabled === true,
    confirmedAt,
    allowlist,
  };
}

export function isOnInviteAssistAllowlist(
  allowlist: ReadonlyArray<InviteAssistAllowlistEntry | { userId?: string | null } | null | undefined> | undefined,
  userId: string | null | undefined,
): boolean {
  if (!userId) return false;
  return (allowlist ?? []).some((row) => row?.userId === userId);
}

/** Add/remove this friend. Does not call setEnabled. Unconfirmed Add is a no-op. */
export async function toggleInviteAssistMembership(opts: {
  userId: string;
  displayName?: string | null;
  allowlist: ReadonlyArray<InviteAssistAllowlistEntry | { userId?: string | null }>;
  confirmedAt: string | null | undefined;
}): Promise<InviteAssistToggleResult> {
  if (isOnInviteAssistAllowlist(opts.allowlist, opts.userId)) {
    await ipc.call("inviteAssist.allowRemove", { userId: opts.userId });
    return "removed";
  }
  if (!opts.confirmedAt) {
    return "confirmRequired";
  }
  const params: { userId: string; displayName?: string } = { userId: opts.userId };
  const name = opts.displayName?.trim();
  if (name) params.displayName = name;
  await ipc.call("inviteAssist.allowAdd", params);
  return "added";
}
