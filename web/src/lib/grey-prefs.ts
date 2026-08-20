import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "./ipc";
import { isInviteSlotType, type InviteSlotType } from "./invite-slots";

export interface GreyInviteSlotsPrefs {
  lastType: InviteSlotType;
  confirmBeforeSend: boolean;
}

export interface GreyPrefs {
  schema: number;
  greyEnabled: boolean;
  inviteSlots: GreyInviteSlotsPrefs;
  playspace: Record<string, unknown>;
  oscTts: Record<string, unknown>;
  authOtpMail: Record<string, unknown>;
  inviteAssist: Record<string, unknown>;
  eventWatch: Record<string, unknown>;
}

const GREY_PREFS_KEY = ["grey.prefs.get"] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeGreyPrefs(raw: unknown): GreyPrefs {
  const obj = asRecord(raw);
  const invite = asRecord(obj.inviteSlots);
  const lastType = typeof invite.lastType === "string" && isInviteSlotType(invite.lastType)
    ? invite.lastType
    : "invite";
  return {
    schema: typeof obj.schema === "number" ? obj.schema : 1,
    greyEnabled: obj.greyEnabled === true,
    inviteSlots: {
      lastType,
      confirmBeforeSend: invite.confirmBeforeSend !== false,
    },
    playspace: asRecord(obj.playspace),
    oscTts: asRecord(obj.oscTts),
    authOtpMail: asRecord(obj.authOtpMail),
    inviteAssist: asRecord(obj.inviteAssist),
    eventWatch: asRecord(obj.eventWatch),
  };
}

export async function getGreyPrefs(): Promise<GreyPrefs> {
  const result = await ipc.call<Record<string, never>, { prefs?: unknown }>("grey.prefs.get", {});
  return normalizeGreyPrefs(result.prefs);
}

export async function setGreyPrefs(patch: Record<string, unknown>): Promise<GreyPrefs> {
  const result = await ipc.call<{ patch: Record<string, unknown> }, { prefs?: unknown }>(
    "grey.prefs.set",
    { patch },
  );
  return normalizeGreyPrefs(result.prefs);
}

export function useGreyPrefs() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: GREY_PREFS_KEY,
    queryFn: getGreyPrefs,
    staleTime: 15_000,
  });
  const mutation = useMutation({
    mutationFn: setGreyPrefs,
    onSuccess: (prefs) => {
      queryClient.setQueryData(GREY_PREFS_KEY, prefs);
    },
  });
  const patchPrefs = useCallback(
    (patch: Record<string, unknown>) => mutation.mutateAsync(patch),
    [mutation],
  );
  return {
    prefs: query.data,
    isLoading: query.isLoading,
    error: query.error,
    patchPrefs,
    patch: patchPrefs,
    isSaving: mutation.isPending,
    refetch: query.refetch,
    reload: query.refetch,
  };
}
