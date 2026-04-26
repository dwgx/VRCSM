/**
 * Small, reusable player-related UI widgets for the Radar page.
 * Extracted from the monolithic Radar.tsx to reduce file size.
 */

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Shirt, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProfileCard } from "@/components/ProfileCard";
import { ThumbImage } from "@/components/ThumbImage";
import { useIpcQuery } from "@/hooks/useIpcQuery";
import { ipc } from "@/lib/ipc";
import { trustRank, trustDotColor } from "@/lib/vrcFriends";
import type { VrcUserProfile } from "@/components/ProfileCard";

// ── Elapsed time hook ─────────────────────────────────────────────────────

/** Elapsed time as "Xh Xm Xs" from an ISO timestamp to now */
export function useElapsedTime(since: string | null): string {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (!since) { setElapsed(""); return; }

    const calc = () => {
      // Parse "2026.04.15 00:42:02" format
      let parsed: number;
      if (since.includes(".") && since.includes(" ") && !since.includes("T")) {
        const [datePart, timePart] = since.split(" ");
        const isoDate = datePart.replace(/\./g, "-");
        parsed = Date.parse(`${isoDate}T${timePart}`);
      } else {
        parsed = Date.parse(since);
      }
      if (Number.isNaN(parsed)) { setElapsed("--"); return; }
      const diffSec = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
      const h = Math.floor(diffSec / 3600);
      const m = Math.floor((diffSec % 3600) / 60);
      const s = diffSec % 60;
      if (h > 0) setElapsed(`${h}h ${m}m ${s}s`);
      else if (m > 0) setElapsed(`${m}m ${s}s`);
      else setElapsed(`${s}s`);
    };

    calc();
    const iv = setInterval(calc, 1000);
    return () => clearInterval(iv);
  }, [since]);

  return elapsed;
}

// ── Player profile dialog ─────────────────────────────────────────────────

export function PlayerProfileDialog({ userId, displayName }: { userId: string | null; displayName: string }) {
  const { t } = useTranslation();
  const { data, isLoading } = useIpcQuery<{ userId: string }, { profile: VrcUserProfile | null }>(
    "user.getProfile",
    { userId: userId ?? "" },
    { staleTime: 120_000, enabled: !!userId && userId.startsWith("usr_") },
  );
  const profile = data?.profile ?? null;

  return (
    <DialogContent
      className="max-w-[380px] p-0 border-none bg-transparent shadow-none"
      onClick={(e) => e.stopPropagation()}
    >
      <DialogTitle className="sr-only">{displayName}</DialogTitle>
      {isLoading ? (
        <div className="flex items-center justify-center h-32 text-[12px] text-[hsl(var(--muted-foreground))]">{t("common.loading", { defaultValue: "Loading..." })}</div>
      ) : profile ? (
        <ProfileCard user={profile} />
      ) : (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-6 flex flex-col gap-3">
          <p className="text-[13px] font-semibold">{displayName}</p>
          <p className="text-[11px] text-[hsl(var(--muted-foreground))]">{t("radar.idUnknown", { defaultValue: "ID unknown, cannot load profile details" })}</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(displayName);
                toast.success(t("radar.nameCopied", { defaultValue: "Name copied" }));
              }}
              className="flex items-center gap-1.5 rounded border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2.5 py-1 text-[11px] font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-all"
            >
              <Copy className="size-3" />
              {t("radar.copyName", { defaultValue: "Copy Name" })}
            </button>
          </div>
        </div>
      )}
    </DialogContent>
  );
}

// ── Player avatar thumbnail ───────────────────────────────────────────────

export function PlayerAvatar({ userId, size = 20 }: { userId: string | null; size?: number }) {
  const isRealUser = !!userId && userId.startsWith("usr_");
  const { data } = useIpcQuery<{ userId: string }, { profile: { currentAvatarThumbnailImageUrl?: string; profilePicOverride?: string } | null }>(
    "user.getProfile",
    { userId: userId! },
    { staleTime: 300_000, enabled: isRealUser },
  );
  const url = data?.profile?.profilePicOverride || data?.profile?.currentAvatarThumbnailImageUrl;
  return (
    <div
      className="shrink-0 overflow-hidden rounded-full bg-[hsl(var(--canvas))] border border-[hsl(var(--border)/0.5)]"
      style={{ width: size, height: size }}
    >
      {url ? (
        <ThumbImage
          src={url}
          seedKey={userId ?? "unknown-user"}
          label={userId}
          alt=""
          className="h-full w-full border-0"
          aspect=""
          rounded=""
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Users className="size-2.5 text-[hsl(var(--muted-foreground)/0.5)]" />
        </div>
      )}
    </div>
  );
}

// ── Trust rank color dot ──────────────────────────────────────────────────

export function TrustDot({ tags }: { tags: string[] | undefined }) {
  if (!tags || tags.length === 0) return null;
  const rank = trustRank(tags);
  const color = trustDotColor(rank);
  return (
    <span
      className="inline-block size-2 rounded-full shrink-0"
      style={{ backgroundColor: color }}
      title={rank}
    />
  );
}

// ── Wear avatar button ────────────────────────────────────────────────────

export function WearAvatarBtn({ userId, avatarName }: { userId?: string | null; avatarName?: string | null }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  if (!userId && !avatarName) return null;

  const handleWear = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setBusy(true);
    try {
      let avatarId: string | undefined;
      if (userId) {
        const { profile } = await ipc.call<{ userId: string }, { profile: { currentAvatarId?: string } | null }>(
          "user.getProfile", { userId },
        );
        avatarId = profile?.currentAvatarId || undefined;
      }
      if (!avatarId && avatarName && !avatarName.startsWith("avtr_")) {
        const res = await ipc.searchAvatars(avatarName, 1);
        const match = res.avatars?.find((a: any) => a.name === avatarName);
        if (match) avatarId = match.id;
      }
      if (avatarName?.startsWith("avtr_")) avatarId = avatarName;
      if (!avatarId) {
        toast.error(t("radar.wearNotFound", { defaultValue: "Could not find this avatar. It may be private." }));
        return;
      }
      await ipc.call("avatar.select", { avatarId });
      toast.success(t("radar.wearSuccess", { defaultValue: "Now wearing: {{name}}", name: avatarName || avatarId }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg.includes("403")
        ? t("radar.wearNotAllowed", { defaultValue: "This avatar does not allow cloning." })
        : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      onClick={handleWear}
      className="shrink-0 flex items-center gap-0.5 rounded-[3px] border border-[hsl(var(--primary)/0.45)] bg-[hsl(var(--primary)/0.08)] px-1 py-px text-[8px] font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.18)] disabled:opacity-50 transition-colors"
    >
      <Shirt className="size-2" />
      {busy ? "…" : "Wear"}
    </button>
  );
}
