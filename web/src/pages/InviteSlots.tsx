import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ipc, IpcError } from "@/lib/ipc";
import { useGreyPrefs } from "@/lib/grey-prefs";
import { useSelfLocation } from "@/lib/useSelfLocation";
import { useIpcQuery } from "@/hooks/useIpcQuery";
import type { FriendsListResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  clampSlotMessage,
  insertChip,
  INVITE_SLOT_TYPES,
  isInviteSlotType,
  sendCooldownRemainingMs,
  SLOT_MESSAGE_MAX,
  slotTypeLabelKey,
  type InviteSlot,
  type InviteSlotType,
} from "@/lib/invite-slots";

interface SlotListResult {
  messages: InviteSlot[];
}

const TYPE_DEFAULTS: Record<InviteSlotType, string> = {
  invite: "Invite",
  inviteResponse: "Invite reply",
  requestInvite: "Request",
  requestInviteResponse: "Request reply",
};

function errorMessage(err: unknown): string {
  if (err instanceof IpcError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

export default function InviteSlotsPage() {
  const { t } = useTranslation();
  const { prefs, isLoading: prefsLoading, patchPrefs, isSaving } = useGreyPrefs();
  const self = useSelfLocation();
  const friendsQuery = useIpcQuery<Record<string, never>, FriendsListResult>("friends.list", {});

  const [type, setType] = useState<InviteSlotType>("invite");
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busySlot, setBusySlot] = useState<number | null>(null);
  const [selectedFriendId, setSelectedFriendId] = useState("");
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [pendingSend, setPendingSend] = useState<"invite" | "request" | null>(null);
  const [enableBusy, setEnableBusy] = useState(false);

  useEffect(() => {
    if (prefs?.inviteSlots.lastType && isInviteSlotType(prefs.inviteSlots.lastType)) {
      setType(prefs.inviteSlots.lastType);
    }
  }, [prefs?.inviteSlots.lastType]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  const listQuery = useQuery({
    queryKey: ["inviteSlots.list", type],
    queryFn: () => ipc.call<{ type: InviteSlotType }, SlotListResult>("inviteSlots.list", { type }),
    enabled: prefs?.greyEnabled === true,
  });

  const slots = useMemo(() => listQuery.data?.messages ?? [], [listQuery.data]);

  useEffect(() => {
    const next: Record<number, string> = {};
    for (const slot of slots) {
      next[slot.slot] = slot.message ?? "";
    }
    setDrafts(next);
    setSelectedSlot((current) =>
      slots.some((s) => s.slot === current) ? current : (slots[0]?.slot ?? 0),
    );
  }, [slots]);

  const friends = friendsQuery.data?.friends ?? [];
  const selectedFriend = friends.find((f) => f.id === selectedFriendId) ?? null;
  const sendRemainMs = sendCooldownRemainingMs(lastSentAt, now);
  const sendRemainSec = Math.ceil(sendRemainMs / 1000);
  const confirmBeforeSend = prefs?.inviteSlots.confirmBeforeSend !== false;
  const inWorld = self.isInWorld && !!self.raw;

  async function changeType(next: InviteSlotType) {
    setType(next);
    try {
      await patchPrefs({ inviteSlots: { lastType: next } });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function saveSlot(slot: number) {
    const draft = drafts[slot] ?? "";
    const clamp = clampSlotMessage(draft);
    if (clamp.empty || clamp.blocked) return;
    try {
      setBusySlot(slot);
      await ipc.call("inviteSlots.update", { type, slot, message: draft.trim() });
      toast.success(t("inviteSlots.saved", { defaultValue: "Slot saved." }));
      await listQuery.refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusySlot(null);
    }
  }

  async function resetSlot(slot: number) {
    try {
      setBusySlot(slot);
      await ipc.call("inviteSlots.reset", { type, slot });
      toast.success(t("inviteSlots.resetDone", { defaultValue: "Slot reset to default." }));
      await listQuery.refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusySlot(null);
    }
  }

  function applyChip(slot: number, chip: string | null | undefined) {
    if (!chip) return;
    setDrafts((prev) => ({
      ...prev,
      [slot]: insertChip(prev[slot] ?? "", chip),
    }));
  }

  async function doSend(kind: "invite" | "request") {
    if (!selectedFriendId) {
      toast.error(t("inviteSlots.pickFriend", { defaultValue: "Pick a friend first." }));
      return;
    }
    if (kind === "invite" && !self.raw) {
      toast.error(t("inviteSlots.needLocation", { defaultValue: "You are not in a world." }));
      return;
    }
    try {
      if (kind === "invite") {
        await ipc.call("inviteSlots.sendInvite", {
          userId: selectedFriendId,
          location: self.raw,
          slot: selectedSlot,
        });
      } else {
        await ipc.call("inviteSlots.sendRequest", {
          userId: selectedFriendId,
          slot: selectedSlot,
        });
      }
      setLastSentAt(Date.now());
      toast.success(
        t("inviteSlots.sent", {
          defaultValue: "Sent slot {{slot}}.",
          slot: selectedSlot,
        }),
      );
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPendingSend(null);
    }
  }

  function requestSend(kind: "invite" | "request") {
    if (confirmBeforeSend) {
      setPendingSend(kind);
      return;
    }
    void doSend(kind);
  }

  async function enableHelpers() {
    try {
      setEnableBusy(true);
      await patchPrefs({ greyEnabled: true });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setEnableBusy(false);
    }
  }

  const title = t("inviteSlots.title", { defaultValue: "Slot mail" });

  if (prefsLoading) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-[hsl(var(--muted-foreground))]">
        <Loader2 className="mr-2 size-4 animate-spin" />
        {t("common.loading", { defaultValue: "Loading" })}
      </div>
    );
  }

  if (!prefs?.greyEnabled) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
        <header className="flex items-center gap-2">
          <Mail className="size-4" />
          <h1 className="text-[16px] font-semibold">{title}</h1>
        </header>
        <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
          {t("inviteSlots.subtitle", {
            defaultValue:
              "These are VRChat’s canned invite lines (the same four slots as in-game). They are not a private messenger. VRChat rate-limits edits to once per hour per slot.",
          })}
        </p>
        <p className="text-[12px] leading-relaxed text-[hsl(var(--foreground))]">
          {t("grey.tos.inviteSlots", {
            defaultValue:
              "Slot mail uses official VRChat invite-message APIs. It is not a DM client. Spamming invites can violate VRChat’s Terms of Service. VRCSM rate-limits sends and will not auto-send from this page.",
          })}
        </p>
        <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
          {t("grey.disabled", {
            defaultValue: "Optional social/VR helpers are off. Enable them in Settings → Experimental.",
          })}
        </p>
        <div className="flex gap-2">
          <Button onClick={() => void enableHelpers()} disabled={enableBusy || isSaving}>
            {enableBusy ? <Loader2 className="size-3 animate-spin" /> : null}
            {t("grey.master.enable", { defaultValue: "Enable optional social/VR helpers" })}
          </Button>
          <Button variant="outline" asChild>
            <Link to="/settings?tab=experimental">
              {t("inviteSlots.openExperimental", { defaultValue: "Open Experimental" })}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Mail className="size-4" />
          <h1 className="text-[16px] font-semibold">{title}</h1>
        </div>
        <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
          {t("inviteSlots.subtitle", {
            defaultValue:
              "These are VRChat’s canned invite lines (the same four slots as in-game). They are not a private messenger. VRChat rate-limits edits to once per hour per slot.",
          })}
        </p>
      </header>

      <div className="flex flex-wrap gap-1 border-b border-[hsl(var(--border))] pb-0">
        {INVITE_SLOT_TYPES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => void changeType(item)}
            className={cn(
              "unity-tab px-3 py-1.5 text-[12px]",
              type === item && "unity-tab-active",
            )}
          >
            {t(slotTypeLabelKey(item), { defaultValue: TYPE_DEFAULTS[item] })}
          </button>
        ))}
      </div>

      {listQuery.isLoading ? (
        <div className="flex items-center gap-2 text-[12px] text-[hsl(var(--muted-foreground))]">
          <Loader2 className="size-3 animate-spin" />
          {t("common.loading", { defaultValue: "Loading" })}
        </div>
      ) : null}
      {listQuery.error ? (
        <p className="text-[12px] text-[hsl(var(--destructive))]">{errorMessage(listQuery.error)}</p>
      ) : null}

      <div className="flex flex-col gap-3">
        {slots.map((slot) => {
          const draft = drafts[slot.slot] ?? "";
          const clamp = clampSlotMessage(draft);
          const cooling = (slot.remainingCooldownMinutes ?? 0) > 0 || !slot.canBeUpdated;
          return (
            <div
              key={slot.slot}
              className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] p-3"
            >
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span>
                  {t("inviteSlots.slotN", { defaultValue: "Slot {{n}}", n: slot.slot })}
                </span>
                <span
                  className={cn(
                    clamp.blocked
                      ? "text-[hsl(var(--destructive))]"
                      : clamp.amber
                        ? "text-amber-500"
                        : "text-[hsl(var(--muted-foreground))]",
                  )}
                >
                  {clamp.length}/{SLOT_MESSAGE_MAX}
                </span>
              </div>
              <textarea
                value={draft}
                maxLength={SLOT_MESSAGE_MAX * 2}
                rows={2}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, [slot.slot]: e.target.value }))
                }
                className={cn(
                  "w-full resize-none rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-2 py-1.5 text-[12px]",
                  "focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]",
                )}
              />
              {cooling ? (
                <p className="text-[11px] text-amber-500">
                  {t("inviteSlots.cooldown", {
                    defaultValue: "VRChat cooldown: {{minutes}} min remaining.",
                    minutes: slot.remainingCooldownMinutes,
                  })}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!self.worldId}
                  onClick={() => applyChip(slot.slot, self.worldId)}
                >
                  {t("inviteSlots.chip.world", { defaultValue: "World" })}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!self.raw || !self.raw.startsWith("wrld_")}
                  onClick={() => applyChip(slot.slot, self.raw)}
                >
                  {t("inviteSlots.chip.location", { defaultValue: "Location" })}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!selectedFriend?.id}
                  onClick={() => applyChip(slot.slot, selectedFriend?.id)}
                >
                  {t("inviteSlots.chip.user", { defaultValue: "User" })}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!selectedFriend?.currentAvatarId}
                  onClick={() => applyChip(slot.slot, selectedFriend?.currentAvatarId)}
                >
                  {t("inviteSlots.chip.avatar", { defaultValue: "Avatar" })}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busySlot === slot.slot || clamp.empty || clamp.blocked || cooling}
                  onClick={() => void saveSlot(slot.slot)}
                >
                  {busySlot === slot.slot ? <Loader2 className="size-3 animate-spin" /> : null}
                  {t("inviteSlots.save", { defaultValue: "Save slot" })}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busySlot === slot.slot || cooling}
                  onClick={() => void resetSlot(slot.slot)}
                >
                  {t("inviteSlots.reset", { defaultValue: "Reset to default" })}
                </Button>
              </div>
            </div>
          );
        })}
        {slots.length === 0 && !listQuery.isLoading ? (
          <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("inviteSlots.empty", { defaultValue: "No slots returned for this type." })}
          </p>
        ) : null}
      </div>

      <section className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          {t("inviteSlots.sendSection", { defaultValue: "Send (user click only)" })}
        </div>
        <label className="flex flex-col gap-1 text-[12px]">
          {t("inviteSlots.friend", { defaultValue: "Friend" })}
          <select
            value={selectedFriendId}
            onChange={(e) => setSelectedFriendId(e.target.value)}
            className="h-8 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-2 text-[12px]"
          >
            <option value="">
              {t("inviteSlots.pickFriend", { defaultValue: "Pick a friend first." })}
            </option>
            {friends.map((friend) => (
              <option key={friend.id} value={friend.id}>
                {friend.displayName ?? friend.id}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px]">
          {t("inviteSlots.useSlot", { defaultValue: "Slot" })}
          <select
            value={selectedSlot}
            onChange={(e) => setSelectedSlot(Number(e.target.value))}
            className="h-8 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-2 text-[12px]"
          >
            {slots.map((slot) => (
              <option key={slot.slot} value={slot.slot}>
                {slot.slot}: {(slot.message ?? "").slice(0, 40)}
              </option>
            ))}
          </select>
        </label>
        {sendRemainMs > 0 ? (
          <p className="text-[11px] text-amber-500">
            {t("inviteSlots.sendCooldown", {
              defaultValue: "Send cooldown: {{seconds}}s",
              seconds: sendRemainSec,
            })}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!selectedFriendId || !inWorld || sendRemainMs > 0}
            onClick={() => requestSend("invite")}
          >
            {t("inviteSlots.sendInvite", { defaultValue: "Send invite" })}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!selectedFriendId || sendRemainMs > 0}
            onClick={() => requestSend("request")}
          >
            {t("inviteSlots.sendRequest", { defaultValue: "Send request" })}
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={pendingSend != null}
        onOpenChange={(open) => {
          if (!open) setPendingSend(null);
        }}
        title={t("inviteSlots.confirmSendTitle", { defaultValue: "Send slot mail?" })}
        description={t("inviteSlots.confirmSend", {
          defaultValue: "Send slot {{slot}} to {{name}}?",
          slot: selectedSlot,
          name: selectedFriend?.displayName ?? selectedFriendId,
        })}
        confirmLabel={
          pendingSend === "request"
            ? t("inviteSlots.sendRequest", { defaultValue: "Send request" })
            : t("inviteSlots.sendInvite", { defaultValue: "Send invite" })
        }
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        onConfirm={() => {
          if (pendingSend) void doSend(pendingSend);
        }}
      />
    </div>
  );
}
