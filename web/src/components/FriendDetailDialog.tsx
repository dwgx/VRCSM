import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Ban,
  Copy,
  ExternalLink,
  Loader2,
  MessageSquare,
  Play,
  Shirt,
  VolumeX,
  Wifi,
  History,
  StickyNote,
  Save,
  Users,
  MapPin,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SmartWearButton } from "@/components/SmartWearButton";
import { useIpcQuery } from "@/hooks/useIpcQuery";
import { ipc } from "@/lib/ipc";
import type { Friend, WorldDetails } from "@/lib/types";
import type { VrcUserProfile } from "@/components/ProfileCard";
import {
  trustRank,
  trustColorClass,
  trustLabelKey,
  trustDotColor,
  parseLocation,
  instanceTypeLabel,
  regionLabel,
  relativeTime,
} from "@/lib/vrcFriends";
import { cn } from "@/lib/utils";

// ---- Bio link parser (mirrors ProfileCard) ------------------------------------

function parseBioLink(url: string) {
  try {
    const u = new URL(url);
    let label = u.hostname.replace(/^www\./, "");
    if (label.includes("twitter.com") || label.includes("x.com")) label = "Twitter";
    else if (label.includes("bilibili.com")) label = "Bilibili";
    else if (label.includes("youtube.com") || label.includes("youtu.be")) label = "YouTube";
    else if (label.includes("discord")) label = "Discord";
    else if (label.includes("github.com")) label = "GitHub";
    return { url, label };
  } catch {
    return { url, label: url };
  }
}

// ---- Status helpers -----------------------------------------------------------

function statusDot(s: string | null): string {
  switch (s) {
    case "active":  return "bg-emerald-400";
    case "join me": return "bg-blue-400 animate-pulse";
    case "ask me":  return "bg-yellow-400";
    case "busy":    return "bg-red-400";
    default:        return "bg-[hsl(var(--muted-foreground))]";
  }
}

// ---- Activity log types -------------------------------------------------------

interface FriendLogItem {
  id: number;
  user_id: string;
  event_type: string;
  old_value: string | null;
  new_value: string | null;
  occurred_at: string;
}

const EVENT_ICONS: Record<string, typeof History> = {
  "friend.added":     Users,
  "friend.removed":   Users,
  "status.changed":   Wifi,
  "location.changed": MapPin,
  "avatar.changed":   Shirt,
};

function eventDescription(e: FriendLogItem): string {
  switch (e.event_type) {
    case "friend.added":     return "Became friends";
    case "friend.removed":   return "Unfriended";
    case "status.changed":   return `Status: ${e.old_value ?? "?"} \u2192 ${e.new_value ?? "?"}`;
    case "location.changed": return `Moved to ${e.new_value === "offline" ? "offline" : e.new_value ?? "unknown"}`;
    case "avatar.changed":   return `Avatar \u2192 ${e.new_value ?? "unknown"}`;
    default:                 return e.event_type;
  }
}

// ---- Main component -----------------------------------------------------------

interface FriendDetailDialogProps {
  friend: Friend | null;
  onClose: () => void;
}

export function FriendDetailDialog({ friend, onClose }: FriendDetailDialogProps) {
  const { t } = useTranslation();

  // --- Profile query (richer than the list-row Friend object) -----------------
  const { data: profileData, isLoading: profileLoading } = useIpcQuery<
    { userId: string },
    { profile: VrcUserProfile | null }
  >("user.getProfile", { userId: friend?.id ?? "" }, { enabled: !!friend });

  const profile = profileData?.profile;

  // --- Location parse ----------------------------------------------------------
  const loc = parseLocation(friend?.location ?? null);
  const inWorld = loc.kind === "world" && !!loc.worldId;

  // --- World details -----------------------------------------------------------
  const { data: worldData } = useIpcQuery<
    { id: string },
    { details: WorldDetails | null }
  >("world.details", { id: loc.worldId ?? "" }, {
    enabled: inWorld,
    staleTime: 300_000,
  });
  const world = worldData?.details ?? null;

  // --- Activity log ------------------------------------------------------------
  const { data: logData } = useIpcQuery<
    { user_id: string; limit: number; offset: number },
    { items: FriendLogItem[] }
  >("friendLog.forUser", { user_id: friend?.id ?? "", limit: 15, offset: 0 }, {
    enabled: !!friend,
    staleTime: 60_000,
  });

  // --- Friend note -------------------------------------------------------------
  const { data: noteData, refetch: refetchNote } = useIpcQuery<
    { user_id: string },
    { note: string | null }
  >("friendNote.get", { user_id: friend?.id ?? "" }, { enabled: !!friend });

  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  useEffect(() => {
    setNoteText(noteData?.note ?? "");
  }, [noteData?.note]);

  // Reset note on friend change
  useEffect(() => {
    setNoteText("");
  }, [friend?.id]);

  const saveNote = useCallback(async () => {
    if (!friend) return;
    setNoteSaving(true);
    try {
      await ipc.call("friendNote.set", {
        user_id: friend.id,
        note: noteText,
        updated_at: new Date().toISOString(),
      });
      toast.success(t("friendDetail.noteSaved", { defaultValue: "Note saved" }));
      void refetchNote();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setNoteSaving(false);
    }
  }, [friend, noteText, t, refetchNote]);

  // --- Action states -----------------------------------------------------------
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);

  // --- Derived data ------------------------------------------------------------
  const rank = trustRank(friend?.tags ?? []);
  const dotColor = trustDotColor(rank);
  const avatarUrl =
    profile?.profilePicOverride ??
    profile?.currentAvatarImageUrl ??
    profile?.currentAvatarThumbnailImageUrl ??
    friend?.profilePicOverride ??
    friend?.currentAvatarThumbnailImageUrl ??
    friend?.currentAvatarImageUrl ??
    null;
  const isVrcPlus = (friend?.tags ?? []).some((t) => t === "system_supporter");
  const langTags = (profile?.tags ?? friend?.tags ?? [])
    .filter((t) => t.startsWith("language_"))
    .map((t) => t.replace("language_", "").toUpperCase());
  const bioLinks = profile?.bioLinks ?? [];
  const avatarId = profile?.currentAvatarId ?? friend?.currentAvatarId ?? null;
  const avatarName = profile?.currentAvatarName ?? friend?.currentAvatarName ?? null;

  return (
    <Dialog open={!!friend} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden p-0 gap-0 flex flex-col">
        {/* Accessibility title */}
        <DialogTitle className="sr-only">
          {friend?.displayName ?? "Friend Detail"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t("friendDetail.description", { defaultValue: "Detailed friend information" })}
        </DialogDescription>

        <div className="overflow-y-auto scrollbar-thin flex-1">
          {/* ========== 1. Profile Header ========== */}
          <div className="border-b border-[hsl(var(--border)/0.4)] px-5 py-4">
            {profileLoading && (
              <div className="absolute right-10 top-4">
                <Loader2 className="size-4 animate-spin text-[hsl(var(--muted-foreground))]" />
              </div>
            )}

            <div className="flex gap-4">
              {/* Avatar with trust ring */}
              <div
                className="relative size-20 shrink-0 overflow-hidden rounded-full"
                style={{ boxShadow: `0 0 0 3px ${dotColor}` }}
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[hsl(var(--muted))]">
                    <Users className="size-8 text-[hsl(var(--muted-foreground))]" />
                  </div>
                )}
                {/* Status dot */}
                <span className={cn(
                  "absolute bottom-0.5 right-0.5 size-4 rounded-full border-2 border-[hsl(var(--surface))]",
                  statusDot(friend?.status ?? null),
                )} />
              </div>

              {/* Name / status / bio */}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[18px] font-bold text-[hsl(var(--foreground))]">
                    {friend?.displayName}
                  </span>
                  {profile?.pronouns && (
                    <span className="shrink-0 rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
                      {profile.pronouns}
                    </span>
                  )}
                </div>

                {/* Status line */}
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span className={cn(
                    "font-medium",
                    friend?.status === "active" ? "text-emerald-400" :
                    friend?.status === "join me" ? "text-blue-400" :
                    friend?.status === "ask me" ? "text-yellow-400" :
                    friend?.status === "busy" ? "text-red-400" :
                    "text-[hsl(var(--muted-foreground))]",
                  )}>
                    {friend?.status ?? "offline"}
                  </span>
                  {friend?.statusDescription && (
                    <>
                      <span className="text-[hsl(var(--muted-foreground))]">&middot;</span>
                      <span className="truncate text-[hsl(var(--muted-foreground))]">
                        {friend.statusDescription}
                      </span>
                    </>
                  )}
                </div>

                {/* Trust + VRC+ badges */}
                <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                  <span className={cn(
                    "px-1.5 py-[1px] text-[9.5px] uppercase tracking-widest font-bold rounded border border-[hsl(var(--border)/0.4)]",
                    trustColorClass(rank),
                  )}>
                    {t(trustLabelKey(rank))}
                  </span>
                  {isVrcPlus && (
                    <span className="px-1.5 py-[1px] text-[9.5px] uppercase tracking-wider font-semibold rounded bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))] border border-[hsl(var(--primary)/0.4)]">
                      VRC+
                    </span>
                  )}
                  {friend?.developerType && friend.developerType !== "none" && (
                    <span className="px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.15)] rounded border border-[hsl(var(--primary)/0.4)]">
                      Dev
                    </span>
                  )}
                </div>

                {/* Language tags */}
                {langTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {langTags.map((l) => (
                      <span key={l} className="px-1.5 py-[1px] text-[9px] uppercase tracking-wider font-semibold rounded bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border border-[hsl(var(--border)/0.4)]">
                        {l}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Bio */}
            {(profile?.bio ?? friend?.bio) && (
              <p className="mt-3 whitespace-pre-wrap text-[11px] leading-relaxed text-[hsl(var(--foreground)/0.8)]">
                {profile?.bio ?? friend?.bio}
              </p>
            )}

            {/* Bio links */}
            {bioLinks.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {bioLinks.map((url, i) => {
                  const { label } = parseBioLink(url);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => void ipc.call("shell.openUrl", { url })}
                      className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--border)/0.6)] bg-[hsl(var(--canvas))] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--border-strong))] transition-colors"
                    >
                      <ExternalLink className="size-2.5" />
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ========== 2. Current World Card ========== */}
          {inWorld && (
            <div className="border-b border-[hsl(var(--border)/0.4)] px-5 py-4">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-[hsl(var(--muted-foreground))] mb-2">
                {t("friendDetail.currentWorld", { defaultValue: "Current World" })}
              </div>
              <div className="flex gap-3">
                {world?.thumbnailImageUrl && (
                  <div className="size-16 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
                    <img
                      src={world.thumbnailImageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-[13px] font-medium text-[hsl(var(--foreground))]">
                    {world?.name ?? loc.worldId}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {loc.instanceType && (
                      <Badge variant="outline" className="h-4 text-[9px]">
                        {instanceTypeLabel(loc.instanceType)}
                      </Badge>
                    )}
                    {loc.region && (
                      <Badge variant="muted" className="h-4 text-[9px]">
                        {regionLabel(loc.region)}
                      </Badge>
                    )}
                    {world?.capacity != null && (
                      <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                        <Users className="inline size-2.5 mr-0.5" />{world.capacity}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[10px] gap-1"
                      onClick={() => {
                        void ipc.call("shell.openUrl", {
                          url: `vrchat://launch?ref=vrchat.com&id=${friend?.location}`,
                        });
                      }}
                    >
                      <Play className="size-3" />
                      {t("friendDetail.launch", { defaultValue: "Launch" })}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[10px] gap-1"
                      onClick={async () => {
                        try {
                          await ipc.call("user.invite", { location: friend?.location });
                          toast.success(t("friendDetail.inviteSent", { defaultValue: "Invite sent" }));
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : String(e));
                        }
                      }}
                    >
                      <MessageSquare className="size-3" />
                      {t("friendDetail.inviteMe", { defaultValue: "Invite Me" })}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========== 3. Current Avatar ========== */}
          {avatarId && (
            <div className="border-b border-[hsl(var(--border)/0.4)] px-5 py-4">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-[hsl(var(--muted-foreground))] mb-2">
                {t("friendDetail.currentAvatar", { defaultValue: "Current Avatar" })}
              </div>
              <div className="flex items-center gap-3">
                {friend?.currentAvatarThumbnailImageUrl && (
                  <div className="size-12 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
                    <img
                      src={friend.currentAvatarThumbnailImageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-medium text-[hsl(var(--foreground))]">
                    {avatarName ?? avatarId}
                  </span>
                  <span className="truncate text-[10px] font-mono text-[hsl(var(--muted-foreground))]">
                    {avatarId}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <SmartWearButton avatarId={avatarId} avatarName={avatarName} variant="button" />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-1.5"
                    onClick={() => {
                      void navigator.clipboard.writeText(avatarId);
                      toast.success(t("friendDetail.avatarIdCopied", { defaultValue: "Avatar ID copied" }));
                    }}
                  >
                    <Copy className="size-3" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ========== 4. Actions Row ========== */}
          <div className="border-b border-[hsl(var(--border)/0.4)] px-5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px] gap-1.5"
                onClick={async () => {
                  try {
                    await ipc.call("user.mute", { userId: friend?.id });
                    toast.success(t("friendDetail.muted", { defaultValue: "User muted" }));
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                <VolumeX className="size-3.5" />
                {t("friendDetail.mute", { defaultValue: "Mute" })}
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px] gap-1.5 text-red-400 border-red-400/40 hover:bg-red-400/10"
                onClick={() => setBlockConfirmOpen(true)}
              >
                <Ban className="size-3.5" />
                {t("friendDetail.block", { defaultValue: "Block" })}
              </Button>
              <AlertDialog open={blockConfirmOpen} onOpenChange={setBlockConfirmOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("friendDetail.blockConfirmTitle", { defaultValue: "Block User" })}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("friendDetail.blockConfirm", {
                        defaultValue: "Are you sure you want to block {{name}}? This will prevent them from interacting with you in VRChat.",
                        name: friend?.displayName,
                      })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("common.cancel", { defaultValue: "Cancel" })}</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-red-600 hover:bg-red-700 text-white"
                      onClick={async () => {
                        try {
                          await ipc.call("user.block", { userId: friend?.id });
                          toast.success(t("friendDetail.blocked", { defaultValue: "User blocked" }));
                          onClose();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : String(e));
                        }
                      }}
                    >
                      {t("friendDetail.block", { defaultValue: "Block" })}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px] gap-1.5 ml-auto"
                onClick={() => {
                  void ipc.call("shell.openUrl", {
                    url: `https://vrchat.com/home/user/${friend?.id}`,
                  });
                }}
              >
                <ExternalLink className="size-3.5" />
                {t("friendDetail.vrcProfile", { defaultValue: "VRChat Profile" })}
              </Button>
            </div>
          </div>

          {/* ========== 5. Recent Activity ========== */}
          <div className="border-b border-[hsl(var(--border)/0.4)] px-5 py-4">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-[hsl(var(--muted-foreground))] mb-2 flex items-center gap-1.5">
              <History className="size-3" />
              {t("friendDetail.recentActivity", { defaultValue: "Recent Activity" })}
            </div>
            {logData?.items && logData.items.length > 0 ? (
              <div className="flex flex-col gap-1">
                {logData.items.map((item) => {
                  const Icon = EVENT_ICONS[item.event_type] ?? History;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 rounded px-2 py-1 text-[10px] hover:bg-[hsl(var(--muted)/0.5)]"
                    >
                      <Icon className="size-3 shrink-0 text-[hsl(var(--muted-foreground))]" />
                      <span className="flex-1 truncate text-[hsl(var(--foreground)/0.8)]">
                        {eventDescription(item)}
                      </span>
                      <span className="shrink-0 font-mono text-[9px] text-[hsl(var(--muted-foreground))]">
                        {relativeTime(item.occurred_at)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[10px] italic text-[hsl(var(--muted-foreground)/0.6)]">
                {t("friendDetail.noActivity", { defaultValue: "No activity recorded yet." })}
              </p>
            )}
          </div>

          {/* ========== 5b. Avatar History (BEYOND VRCX) ========== */}
          {(() => {
            const avatarEvents = (logData?.items ?? []).filter(
              (e) => e.event_type === "avatar.changed" && e.new_value,
            );
            const seen = new Set<string>();
            const unique = avatarEvents.filter((e) => {
              if (seen.has(e.new_value!)) return false;
              seen.add(e.new_value!);
              return true;
            });
            if (unique.length === 0) return null;
            return (
              <div className="border-b border-[hsl(var(--border)/0.4)] px-5 py-4">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-[hsl(var(--muted-foreground))] mb-2 flex items-center gap-1.5">
                  <Shirt className="size-3" />
                  {t("friendDetail.avatarHistory", { defaultValue: "Avatar History" })}
                  <span className="font-mono text-[hsl(var(--muted-foreground)/0.5)]">({unique.length})</span>
                </div>
                <div className="flex flex-col gap-1">
                  {unique.slice(0, 10).map((ev, i) => (
                    <div key={i} className="flex items-center gap-2 rounded px-2 py-1 text-[10px] hover:bg-[hsl(var(--muted)/0.5)]">
                      <Shirt className="size-3 shrink-0 text-purple-400" />
                      <span className="flex-1 truncate text-[hsl(var(--foreground)/0.8)]">
                        {ev.new_value}
                      </span>
                      <SmartWearButton avatarName={ev.new_value} variant="compact" />
                      <span className="shrink-0 font-mono text-[9px] text-[hsl(var(--muted-foreground))]">
                        {relativeTime(ev.occurred_at)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ========== 6. Friend Note ========== */}
          <div className="px-5 py-4">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-[hsl(var(--muted-foreground))] mb-2 flex items-center gap-1.5">
              <StickyNote className="size-3" />
              {t("friendDetail.note", { defaultValue: "Note" })}
            </div>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder={t("friendDetail.notePlaceholder", { defaultValue: "Write a private note about this friend..." })}
              className={cn(
                "w-full resize-none rounded-[var(--radius-sm)] border border-[hsl(var(--border)/0.5)]",
                "bg-[hsl(var(--canvas))] px-2.5 py-1.5 text-[11px] text-[hsl(var(--foreground))]",
                "placeholder:text-[hsl(var(--muted-foreground)/0.5)] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))] transition-all",
              )}
              rows={3}
              maxLength={1000}
            />
            <div className="flex justify-end mt-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] gap-1"
                disabled={noteSaving || noteText === (noteData?.note ?? "")}
                onClick={saveNote}
              >
                {noteSaving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
                {t("friendDetail.saveNote", { defaultValue: "Save" })}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
