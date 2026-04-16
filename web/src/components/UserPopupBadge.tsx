import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IdBadge } from "./IdBadge";
import { ProfileCard, type VrcUserProfile } from "./ProfileCard";
import { useIpcQuery } from "@/hooks/useIpcQuery";
import { trustRank, trustColorClass, trustLabelKey } from "@/lib/vrcFriends";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogTitle,
} from "@/components/ui/dialog";

export function UserPopupBadge({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const { data, isLoading } = useIpcQuery<{ userId: string }, { profile: VrcUserProfile | null }>(
    "user.getProfile",
    { userId },
    { staleTime: 120_000, enabled: !!userId && userId.startsWith("usr_") },
  );
  const profile = data?.profile ?? null;
  const [open, setOpen] = useState(false);

  if (isLoading || !profile) {
    return <IdBadge id={userId} size="xs" />;
  }

  const rank = trustRank(profile.tags || []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
          }}
          className="flex w-fit items-center gap-2 rounded bg-[hsl(var(--surface-raised))] hover:bg-[hsl(var(--muted))] px-2 py-0.5 border border-[hsl(var(--border))] transition-colors"
        >
          <div className="relative size-5 shrink-0 overflow-hidden rounded-[calc(var(--radius-sm)-2px)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)]">
            <img
              src={profile.profilePicOverride || profile.currentAvatarThumbnailImageUrl || ""}
              className="h-full w-full object-cover"
              loading="lazy"
              alt=""
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
          <span className="text-[11.5px] font-medium text-[hsl(var(--foreground))]">
            {profile.displayName}
          </span>
          <span className={`text-[10px] font-bold tracking-tight uppercase ${trustColorClass(rank)}`}>
            {t(trustLabelKey(rank))}
          </span>
        </button>
      </DialogTrigger>
      
      <DialogContent 
        className="max-w-[380px] p-0 border-none bg-transparent shadow-none duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-top-[2%] data-[state=open]:slide-in-from-top-[2%]" 
        onClick={(e) => e.stopPropagation()}
      >
        <DialogTitle className="sr-only">
          {profile.displayName}'s Profile
        </DialogTitle>
        <ProfileCard user={profile} />
      </DialogContent>
    </Dialog>
  );
}
