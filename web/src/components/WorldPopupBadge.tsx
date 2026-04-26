import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { IdBadge } from "./IdBadge";
import { ipc } from "@/lib/ipc";
import { useIpcQuery } from "@/hooks/useIpcQuery";
import type { WorldDetails } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogTitle,
} from "@/components/ui/dialog";
import { ThumbImage } from "@/components/ThumbImage";
import { Users, Globe2, Play } from "lucide-react";

export const WorldPopupBadge = memo(function WorldPopupBadge({ worldId }: { worldId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // Defer world.details fetch until the dialog opens. See AvatarPopupBadge.
  const { data, isLoading } = useIpcQuery<{ id: string }, { details: WorldDetails | null }>(
    "world.details",
    { id: worldId },
    { staleTime: 120_000, enabled: open && !!worldId && worldId.startsWith("wrld_") },
  );
  const details = data?.details ?? null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
          }}
          className="flex w-fit items-center gap-1.5 rounded bg-[hsl(var(--surface-raised))] hover:bg-[hsl(var(--primary)/0.1)] px-2 py-0.5 border border-[hsl(var(--border))] transition-colors group"
        >
          <div className="relative size-[18px] shrink-0 overflow-hidden rounded-[2px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)]">
            {details?.thumbnailImageUrl ? (
                <ThumbImage
                  src={details.thumbnailImageUrl}
                  seedKey={worldId}
                  label={details.name}
                  alt=""
                  className="h-full w-full border-0"
                  aspect=""
                  rounded=""
                />
            ) : (
                <Globe2 className="size-full text-[hsl(var(--muted-foreground))]" />
            )}
          </div>
          <span className="text-[10px] uppercase font-bold text-[hsl(var(--primary))] opacity-80 group-hover:opacity-100">
             WRLD
          </span>
          <span className="text-[11.5px] font-medium text-[hsl(var(--foreground))]">
            {details?.name || `${worldId.slice(0, 12)}…`}
          </span>
        </button>
      </DialogTrigger>
      
      <DialogContent
        className="max-w-[420px] p-0 border-none bg-transparent shadow-none duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogTitle className="sr-only">
          {details?.name ?? worldId} World Record
        </DialogTitle>

        {!details ? (
          <div className="rounded-[calc(var(--radius-sm)+4px)] border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--surface))] p-12 text-center text-[12px] text-[hsl(var(--muted-foreground))] shadow-lg backdrop-blur-md">
            {isLoading ? t("common.loading") : t("worlds.unavailable", { defaultValue: "World unavailable." })}
          </div>
        ) : (
        <div className="group flex flex-col gap-0 overflow-hidden rounded-[calc(var(--radius-sm)+4px)] border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--surface))] shadow-lg backdrop-blur-md">
            {/* Banner Area */}
            <div className="relative h-[200px] w-full shrink-0 bg-[hsl(var(--muted))] overflow-hidden">
               {details.imageUrl ? (
                  <img
                    src={details.imageUrl}
                    className="absolute inset-0 w-full h-full object-cover select-none animate-in fade-in duration-500"
                    alt=""
                    loading="lazy"
                  />
               ) : null}
               <div className="absolute inset-0 bg-gradient-to-t from-[hsl(var(--surface))] via-transparent to-black/30" />
               
               <div className="absolute top-2 right-2 flex gap-1">
                 <div className="flex items-center gap-1 rounded-full bg-black/50 backdrop-blur-sm px-2 py-0.5 text-[9px] font-bold text-white shadow-sm tracking-widest uppercase">
                   <Users className="size-2.5" />
                   {details.capacity} MAX
                 </div>
               </div>
            </div>

            <div className="relative px-4 pb-4 -mt-10 flex flex-col pt-0 z-10">
               <h1 className="text-xl font-bold text-white drop-shadow-md leading-tight">
                 {details.name}
               </h1>
               <div className="flex items-center gap-1.5 mt-2 opacity-90">
                 <span className="text-[11px] text-[hsl(var(--muted-foreground))]">By</span>
                 <span className="text-[12px] font-medium text-[hsl(var(--foreground))]">
                   {details.authorName}
                 </span>
               </div>
               
               {/* Body Stats */}
               <div className="grid grid-cols-2 gap-2 mt-4 text-[11px]">
                  <div className="flex flex-col bg-[hsl(var(--muted)/0.3)] border border-[hsl(var(--border)/0.4)] rounded-md px-3 py-2">
                     <span className="text-[9px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{t("world.popup.visits", { defaultValue: "VISITS" })}</span>
                     <span className="font-mono text-[hsl(var(--foreground))] font-semibold">{details.visits || 0}</span>
                  </div>
                  <div className="flex flex-col bg-[hsl(var(--muted)/0.3)] border border-[hsl(var(--border)/0.4)] rounded-md px-3 py-2">
                     <span className="text-[9px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{t("world.popup.favorites", { defaultValue: "FAVORITES" })}</span>
                     <span className="font-mono text-[hsl(var(--foreground))] font-semibold">{details.favorites || 0}</span>
                  </div>
               </div>

               {/* Description */}
               <div className="mt-4 px-1 pb-1">
                 {details.description ? (
                   <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-[hsl(var(--foreground)/0.8)] selection:bg-[hsl(var(--primary)/0.2)] line-clamp-4">
                     {details.description}
                   </p>
                 ) : (
                   <p className="text-[11px] italic text-[hsl(var(--muted-foreground)/0.5)]">{t("common.noDescription", { defaultValue: "No description..." })}</p>
                 )}
               </div>

               {/* Actions */}
               <div className="flex flex-col gap-2 mt-2 pt-4 border-t border-[hsl(var(--border)/0.4)]">
                  <IdBadge id={worldId} size="xs" className="mb-1" />
                  <div className="flex gap-2">
                     <button
                       className="flex flex-1 items-center justify-center gap-2 rounded bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.9)] text-primary-foreground h-8 text-[11.5px] font-semibold transition-colors"
                       onClick={() => ipc.call("shell.openUrl", { url: `https://vrchat.com/home/world/${worldId}` })}
                     >
                        <Play className="size-3.5 fill-current" />
                        {t("common.openInBrowser", { defaultValue: "Open in browser" })}
                     </button>
                  </div>
               </div>
            </div>
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
});
