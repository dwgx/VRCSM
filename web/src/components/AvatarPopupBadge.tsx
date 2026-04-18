import { memo, useState } from "react";
import { IdBadge } from "./IdBadge";
import { AvatarPreview3D } from "./AvatarPreview3D";
import { useIpcQuery } from "@/hooks/useIpcQuery";
import type { AvatarDetails, UnityPackage } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogTitle,
} from "@/components/ui/dialog";
import { Box, User, AlertTriangle, CloudSun } from "lucide-react";
import { formatDate } from "@/lib/utils";

export const AvatarPopupBadge = memo(function AvatarPopupBadge({ avatarId }: { avatarId: string }) {
  const { data, isLoading } = useIpcQuery<{ id: string }, { details: AvatarDetails | null }>(
    "avatar.details",
    { id: avatarId },
    { staleTime: 120_000, enabled: !!avatarId && avatarId.startsWith("avtr_") },
  );
  const details = data?.details ?? null;
  const [open, setOpen] = useState(false);

  if (isLoading || !details) {
    return <IdBadge id={avatarId} size="xs" />;
  }

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
            {details.thumbnailImageUrl ? (
                <img
                  src={details.thumbnailImageUrl}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  alt=""
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
            ) : (
                <User className="size-full text-[hsl(var(--muted-foreground))]" />
            )}
          </div>
          <span className="text-[10px] uppercase font-bold text-[hsl(var(--primary))] opacity-80 group-hover:opacity-100">
             AVTR
          </span>
          <span className="text-[11.5px] font-medium text-[hsl(var(--foreground))]">
            {details.name || "Unknown Avatar"}
          </span>
        </button>
      </DialogTrigger>
      
      <DialogContent 
        className="max-w-[400px] p-0 border-none bg-transparent shadow-none duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95" 
        onClick={(e) => e.stopPropagation()}
      >
        <DialogTitle className="sr-only">
          {details.name} Avatar Record
        </DialogTitle>
        
        <div className="group flex flex-col gap-0 overflow-hidden rounded-[calc(var(--radius-sm)+4px)] border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--surface))] shadow-lg backdrop-blur-md">
            {/* Display Image */}
            <div className="relative h-[240px] w-full shrink-0 bg-[hsl(var(--muted))] overflow-hidden flex items-center justify-center">
               <AvatarPreview3D
                 avatarId={avatarId}
                 assetUrl={details.unityPackages?.find((p: UnityPackage) => p.platform === "standalonewindows")?.assetUrl ?? undefined}
                 fallbackImageUrl={details.thumbnailImageUrl ?? details.imageUrl ?? undefined}
                 size={176}
                 expandedSize={720}
               />
               {/* Fade from image to content */}
               <div className="absolute inset-0 bg-gradient-to-t from-[hsl(var(--surface))] via-[hsl(var(--surface)/0.2)] to-transparent" />
               
               <div className="absolute top-2 right-2 flex gap-1">
                 <div className={`flex items-center gap-1 rounded-full backdrop-blur-sm px-2 py-0.5 text-[9px] font-bold shadow-sm uppercase ${details.releaseStatus === "private" ? "bg-red-500/80 text-white" : "bg-emerald-500/80 text-white"}`}>
                   {details.releaseStatus || "Unknown"}
                 </div>
               </div>
            </div>

            <div className="relative px-4 pb-4 -mt-10 flex flex-col pt-0 z-10">
               <h1 className="text-lg font-bold text-white drop-shadow-md leading-tight flex items-center gap-2">
                 {details.name}
                 {details.version && (
                   <span className="opacity-70 text-[10px] font-mono bg-white/20 px-1.5 py-0.5 rounded">v{details.version}</span>
                 )}
               </h1>
               <div className="flex items-center gap-1.5 mt-2 opacity-90">
                 <span className="text-[11px] text-[hsl(var(--muted-foreground))]">By</span>
                 <span className="text-[12px] font-medium text-[hsl(var(--foreground))]">
                   {details.authorName}
                 </span>
               </div>
               
               {/* System Info */}
               <div className="grid grid-cols-2 gap-2 mt-4 text-[11px]">
                  <div className="flex flex-col bg-[hsl(var(--muted)/0.3)] border border-[hsl(var(--border)/0.4)] rounded-md px-3 py-2">
                     <span className="text-[9px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] flex items-center gap-1"><CloudSun className="size-3" />PLATFORMS</span>
                     <span className="font-mono text-[hsl(var(--foreground))] font-semibold mt-1">
                       {details.unityPackages ? details.unityPackages.map((p: UnityPackage) => p.platform).join(" / ") : "Unspecified"}
                     </span>
                  </div>
                  <div className="flex flex-col bg-[hsl(var(--muted)/0.3)] border border-[hsl(var(--border)/0.4)] rounded-md px-3 py-2">
                     <span className="text-[9px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] flex items-center gap-1"><Box className="size-3" />FILE SIZE</span>
                     <span className="font-mono text-[hsl(var(--foreground))] font-semibold mt-1 flex flex-wrap gap-1">
                        {details.unityPackages ? details.unityPackages.map((p: UnityPackage) => p.platform === "android" ? "Quest: " : "PC: " + (p.assetUrl ? "Valid" : "None")).join(" ") : "Unknown"}
                     </span>
                  </div>
               </div>
               {details.assetUrl && (
                 <div className="mt-2 text-[10px] flex gap-1.5 items-center text-amber-500/80">
                   <AlertTriangle className="size-3" /> Contains valid asset URL
                 </div>
               )}

               {/* Description */}
               <div className="mt-4 px-1 pb-1">
                 {details.description ? (
                   <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-[hsl(var(--foreground)/0.8)] selection:bg-[hsl(var(--primary)/0.2)] line-clamp-3">
                     {details.description}
                   </p>
                 ) : (
                   <p className="text-[11px] italic text-[hsl(var(--muted-foreground)/0.5)]">无介绍...</p>
                 )}
               </div>

               {/* Stats Footprint */}
               <div className="flex flex-col gap-2 mt-2 pt-4 border-t border-[hsl(var(--border)/0.4)]">
                 <IdBadge id={avatarId} size="xs" className="mb-1" />
                 <div className="flex justify-between items-center text-[10px] text-[hsl(var(--muted-foreground))] font-mono">
                    <span>CREATED: {details.created_at ? formatDate(details.created_at) : "-"}</span>
                    <span>UPDATED: {details.updated_at ? formatDate(details.updated_at) : "-"}</span>
                 </div>
               </div>
            </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});
