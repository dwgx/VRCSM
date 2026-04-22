import { useState } from "react";
import { useTranslation } from "react-i18next";
import { User } from "lucide-react";
import { ProfileCard, type VrcUserProfile } from "./ProfileCard";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIpcQuery } from "@/hooks/useIpcQuery";
import { trustRank, trustColorClass, trustLabelKey } from "@/lib/vrcFriends";

interface UserPopupBadgeProps {
  userId: string;
  displayName?: string;
}

export function UserPopupBadge({ userId, displayName }: UserPopupBadgeProps) {
  const { t } = useTranslation();
  const { data } = useIpcQuery<{ userId: string }, { profile: VrcUserProfile | null }>(
    "user.getProfile",
    { userId },
    { staleTime: 5 * 60_000, enabled: !!userId && userId.startsWith("usr_") },
  );
  const profile = data?.profile ?? null;
  const [open, setOpen] = useState(false);

  const rank = profile ? trustRank(profile.tags || []) : null;
  const name = profile?.displayName ?? displayName ?? userId.slice(0, 12) + "…";
  const thumb = profile?.profilePicOverride || profile?.currentAvatarThumbnailImageUrl;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="flex w-fit items-center gap-1.5 rounded bg-[hsl(var(--surface-raised))] hover:bg-[hsl(var(--muted))] px-2 py-0.5 border border-[hsl(var(--border))] transition-colors"
      >
        <div className="relative size-5 shrink-0 overflow-hidden rounded-[calc(var(--radius-sm)-2px)] bg-[hsl(var(--canvas))]">
          {thumb ? (
            <img
              src={thumb}
              className="h-full w-full object-cover"
              loading="lazy"
              alt=""
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <User className="size-3 m-auto text-[hsl(var(--muted-foreground))]" />
          )}
        </div>
        <span className="text-[11.5px] font-medium text-[hsl(var(--foreground))]">
          {name}
        </span>
        {rank && (
          <span className={`text-[10px] font-bold tracking-tight uppercase ${trustColorClass(rank)}`}>
            {t(trustLabelKey(rank))}
          </span>
        )}
      </button>

      <DialogContent className="max-w-[420px] p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">{name}</DialogTitle>
        {profile ? (
          <ProfileCard user={profile} />
        ) : (
          <div className="p-8 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("common.loading", { defaultValue: "Loading…" })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
