import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IdBadge } from "./IdBadge";
import { ProfileCard, type VrcUserProfile } from "./ProfileCard";
import { useIpcQuery } from "@/hooks/useIpcQuery";
import { trustRank, trustColorClass, trustLabelKey } from "@/lib/vrcFriends";

export function UserPopupBadge({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const { data, isLoading } = useIpcQuery<{ userId: string }, { profile: VrcUserProfile | null }>(
    "user.getProfile",
    { userId },
    { staleTime: 120_000, enabled: !!userId && userId.startsWith("usr_") },
  );
  const profile = data?.profile ?? null;
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  if (isLoading || !profile) {
    return <IdBadge id={userId} size="xs" />;
  }

  const rank = trustRank(profile.tags || []);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
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

      {open && (
        <>
          <div className="fixed inset-0 z-40" />
          <div
            className="absolute left-0 top-[calc(100%+6px)] z-50 w-[380px] animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <ProfileCard user={profile} />
          </div>
        </>
      )}
    </div>
  );
}
