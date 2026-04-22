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
  Send,
  Users,
  MapPin,
  UserMinus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";


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

const SOCIAL_ICONS: Record<string, string> = {
  Twitter: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  Bilibili: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373z"/></svg>',
  YouTube: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
  Discord: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286z"/></svg>',
  GitHub: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>',
  Twitch: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>',
};

function parseBioLink(url: string): { url: string; label: string; iconSvg: string | null } {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host.includes("twitter.com") || host.includes("x.com")) return { url, label: "Twitter", iconSvg: SOCIAL_ICONS.Twitter };
    if (host.includes("bilibili.com")) return { url, label: "Bilibili", iconSvg: SOCIAL_ICONS.Bilibili };
    if (host.includes("youtube.com") || host.includes("youtu.be")) return { url, label: "YouTube", iconSvg: SOCIAL_ICONS.YouTube };
    if (host.includes("discord")) return { url, label: "Discord", iconSvg: SOCIAL_ICONS.Discord };
    if (host.includes("github.com")) return { url, label: "GitHub", iconSvg: SOCIAL_ICONS.GitHub };
    if (host.includes("twitch.tv")) return { url, label: "Twitch", iconSvg: SOCIAL_ICONS.Twitch };
    if (host.includes("booth.pm")) return { url, label: "BOOTH", iconSvg: null };
    if (host.includes("gumroad.com")) return { url, label: "Gumroad", iconSvg: null };
    if (host.includes("patreon.com")) return { url, label: "Patreon", iconSvg: null };
    if (host.includes("ko-fi.com")) return { url, label: "Ko-fi", iconSvg: null };
    if (host.includes("pixiv.net")) return { url, label: "Pixiv", iconSvg: null };
    if (host.includes("instagram.com")) return { url, label: "Instagram", iconSvg: null };
    return { url, label: host, iconSvg: null };
  } catch {
    return { url, label: url, iconSvg: null };
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

  // --- DM compose --------------------------------------------------------------
  const [messageText, setMessageText] = useState("");
  const [messageSending, setMessageSending] = useState(false);
  const sendMessage = useCallback(async () => {
    if (!friend?.id || !messageText.trim()) return;
    try {
      setMessageSending(true);
      await ipc.sendMessage(friend.id, messageText.trim());
      setMessageText("");
      toast.success(t("friendDetail.messageSent", { defaultValue: "Message sent" }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setMessageSending(false);
    }
  }, [friend?.id, messageText, t]);

  // Reset compose when switching between friends so an in-progress
  // message doesn't leak into the next dialog open.
  useEffect(() => {
    setMessageText("");
  }, [friend?.id]);

  // --- Derived data ------------------------------------------------------------
  const rank = trustRank(friend?.tags ?? []);
  const dotColor = trustDotColor(rank);
  const avatarUrl =
    profile?.profilePicOverride
    || profile?.currentAvatarImageUrl
    || profile?.currentAvatarThumbnailImageUrl
    || friend?.profilePicOverride
    || friend?.currentAvatarThumbnailImageUrl
    || friend?.currentAvatarImageUrl
    || null;
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
              <div className="relative size-20 shrink-0">
                <div
                  className="size-full overflow-hidden rounded-full"
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
                </div>
                <span className={cn(
                  "absolute bottom-1 right-1 size-3.5 rounded-full border-[2.5px] border-[hsl(var(--surface))]",
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
                  const { label, iconSvg } = parseBioLink(url);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => void ipc.call("shell.openUrl", { url })}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--border)/0.6)] bg-[hsl(var(--canvas))] px-2.5 py-1 text-[10px] font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--border-strong))] transition-colors"
                    >
                      {iconSvg ? (
                        <span className="size-3 shrink-0 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: iconSvg }} />
                      ) : (
                        <ExternalLink className="size-3 shrink-0" />
                      )}
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

              {!blockConfirmOpen ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] gap-1.5 text-red-400 border-red-400/40 hover:bg-red-400/10"
                  onClick={() => setBlockConfirmOpen(true)}
                >
                  <Ban className="size-3.5" />
                  {t("friendDetail.block", { defaultValue: "Block" })}
                </Button>
              ) : (
                <div className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-red-400/40 bg-red-400/5 px-2 py-1">
                  <span className="text-[10px] text-red-400">
                    {t("friendDetail.blockConfirmShort", { defaultValue: "Block {{name}}?", name: friend?.displayName })}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-2 text-[9px]"
                    onClick={() => setBlockConfirmOpen(false)}
                  >
                    {t("common.cancel", { defaultValue: "Cancel" })}
                  </Button>
                  <Button
                    size="sm"
                    className="h-5 px-2 text-[9px] bg-red-600 hover:bg-red-700 text-white"
                    onClick={async () => {
                      try {
                        await ipc.call("user.block", { userId: friend?.id });
                        toast.success(t("friendDetail.blocked", { defaultValue: "User blocked" }));
                        setBlockConfirmOpen(false);
                        onClose();
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    {t("friendDetail.block", { defaultValue: "Block" })}
                  </Button>
                </div>
              )}

              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px] gap-1.5 text-orange-400 border-orange-400/40 hover:bg-orange-400/10"
                onClick={async () => {
                  try {
                    await ipc.friendsUnfriend(friend!.id);
                    toast.success(t("friendDetail.unfriended", { defaultValue: "Unfriended {{name}}", name: friend?.displayName }));
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                <UserMinus className="size-3.5" />
                {t("friendDetail.unfriend", { defaultValue: "Unfriend" })}
              </Button>

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

          {/* ========== 5b. Send Message ========== */}
          <div className="px-5 py-4 border-t border-[hsl(var(--border)/0.4)]">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-[hsl(var(--muted-foreground))] mb-2 flex items-center gap-1.5">
              <Send className="size-3" />
              {t("friendDetail.sendMessage", { defaultValue: "Send a message" })}
            </div>
            <textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value.slice(0, 2000))}
              placeholder={t("friendDetail.messagePlaceholder", {
                defaultValue: "Hi! Want to hop into a world?",
              })}
              className={cn(
                "w-full resize-none rounded-[var(--radius-sm)] border border-[hsl(var(--border)/0.5)]",
                "bg-[hsl(var(--canvas))] px-2.5 py-1.5 text-[11px] text-[hsl(var(--foreground))]",
                "placeholder:text-[hsl(var(--muted-foreground)/0.5)] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))] transition-all",
              )}
              rows={2}
              maxLength={2000}
              onKeyDown={(e) => {
                // Ctrl/⌘+Enter sends — matches Discord's muscle memory.
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !messageSending) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
            />
            <div className="flex items-center justify-between mt-1.5">
              <div className="text-[10px] text-[hsl(var(--muted-foreground))]">
                {messageText.length > 0 ? `${messageText.length} / 2000` : ""}
                {/* VRChat silently drops DMs to non-friends — surface it
                   inline so the user understands a missing reply isn't
                   our bug. */}
                {messageText.length === 0 ? (
                  <span>
                    {t("friendDetail.messageHint", {
                      defaultValue: "Ctrl+Enter to send. VRChat drops DMs from non-friends.",
                    })}
                  </span>
                ) : null}
              </div>
              <Button
                variant="default"
                size="sm"
                className="h-7 text-[11px] gap-1"
                disabled={messageSending || messageText.trim().length === 0}
                onClick={() => void sendMessage()}
              >
                {messageSending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
                {t("friendDetail.send", { defaultValue: "Send" })}
              </Button>
            </div>
          </div>

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
