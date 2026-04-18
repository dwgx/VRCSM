import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  User,
  Globe2,
  Edit3,
  Save,
  X,
  ExternalLink,
  Wifi,
  WifiOff,
  Clock,
  Github,
  Twitter,
  Youtube,
  Twitch,
  MessageSquare,
  Link,
  Copy,
  UserPlus,
  LogIn,
  LogOut,
  Shirt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IdBadge } from "@/components/IdBadge";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { trustRank, trustColorClass, trustLabelKey } from "@/lib/vrcFriends";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "react-i18next";

// ─── Types ──────────────────────────────────────────────────────────────────

export type VrcStatus = "active" | "join me" | "ask me" | "busy" | "offline";

export interface VrcUserProfile {
  id: string;
  displayName: string;
  bio?: string;
  bioLinks?: string[];
  tags?: string[];
  status: VrcStatus;
  statusDescription?: string;
  currentAvatarImageUrl?: string;
  currentAvatarThumbnailImageUrl?: string;
  profilePicOverride?: string;
  currentAvatarName?: string;
  currentAvatarId?: string;
  worldName?: string;
  worldId?: string;
  location?: string;
  last_login?: string;
  last_activity?: string;
  developerType?: string;
  isFriend?: boolean;
}

// ─── Status helpers ──────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: VrcStatus; key: string; color: string }[] = [
  { value: "active", key: "friends.bucket.active", color: "text-emerald-400" },
  { value: "join me", key: "friends.bucket.joinMe", color: "text-blue-400" },
  { value: "ask me", key: "friends.bucket.askMe", color: "text-yellow-400" },
  { value: "busy", key: "friends.bucket.busy", color: "text-red-400" },
  { value: "offline", key: "friends.bucket.offline", color: "text-[hsl(var(--muted-foreground))]" },
];

function statusColor(s: VrcStatus): string {
  return STATUS_OPTIONS.find((o) => o.value === s)?.color ?? "text-[hsl(var(--muted-foreground))]";
}

function statusLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  s: VrcStatus,
): string {
  const option = STATUS_OPTIONS.find((o) => o.value === s);
  return option ? t(option.key) : s;
}

function statusDot(s: VrcStatus): string {
  switch (s) {
    case "active":  return "bg-emerald-400";
    case "join me": return "bg-blue-400 animate-pulse";
    case "ask me":  return "bg-yellow-400";
    case "busy":    return "bg-red-400";
    default:        return "bg-[hsl(var(--muted-foreground))]";
  }
}

// ─── BioLinks helpers ────────────────────────────────────────────────────────

function parseBioLink(url: string) {
  try {
    const u = new URL(url);
    let label = u.hostname.replace(/^www\./, "");
    let Icon = Link;
    if (label.includes("twitter.com") || label.includes("x.com")) {
      label = "Twitter"; Icon = Twitter;
    } else if (label.includes("bilibili.com")) {
      label = "Bilibili"; Icon = ExternalLink;
    } else if (label.includes("youtube.com") || label.includes("youtu.be")) {
      label = "YouTube"; Icon = Youtube;
    } else if (label.includes("twitch.tv")) {
      label = "Twitch"; Icon = Twitch;
    } else if (label.includes("discord")) {
      label = "Discord"; Icon = MessageSquare;
    } else if (label.includes("github.com")) {
      label = "GitHub"; Icon = Github;
    }
    return { url, label, Icon };
  } catch {
    return { url, label: url, Icon: Link };
  }
}

// ─── Main ProfileCard ────────────────────────────────────────────────────────

interface ProfileCardProps {
  user: VrcUserProfile;
  /** Show edit controls (for the "My Profile" page) */
  editable?: boolean;
  /** Callback when user saves edits */
  onSave?: (patch: Partial<VrcUserProfile>) => Promise<void>;
  /** Callback when user switches avatar */
  onSelectAvatar?: () => void;
  className?: string;
}

export function ProfileCard({
  user,
  editable = false,
  onSave,
  className,
}: ProfileCardProps) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wearingAvatar, setWearingAvatar] = useState(false);

  const { status: authStatus } = useAuth();
  const isSelf = authStatus.userId === user.id;

  // Edit draft state
  const [draftBio, setDraftBio] = useState(user.bio ?? "");
  const [draftStatusDesc, setDraftStatusDesc] = useState(user.statusDescription ?? "");
  const [draftStatus, setDraftStatus] = useState<VrcStatus>(user.status);

  useEffect(() => {
    setDraftBio(user.bio ?? "");
    setDraftStatusDesc(user.statusDescription ?? "");
    setDraftStatus(user.status);
    setEditing(false);
  }, [user]);

  async function handleSave() {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave({
        bio: draftBio,
        statusDescription: draftStatusDesc,
        status: draftStatus,
      });
      setEditing(false);
      toast.success(t("profile.updated"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("profile.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setDraftBio(user.bio ?? "");
    setDraftStatusDesc(user.statusDescription ?? "");
    setDraftStatus(user.status);
    setEditing(false);
  }

  function openVrcProfile() {
    void ipc.call("shell.openUrl", { url: `https://vrchat.com/home/user/${user.id}` });
  }

  const isOnline = user.status !== "offline";

  // Assets prep
  const bannerUrl = user.currentAvatarImageUrl || user.currentAvatarThumbnailImageUrl;
  const avatarUrl = user.profilePicOverride || user.currentAvatarThumbnailImageUrl || user.currentAvatarImageUrl;
  const rank = trustRank(user.tags || []);
  
  const niceTags = (user.tags || [])
    .filter(t => t.startsWith("language_") || t.startsWith("system_supporter"))
    .map(t => {
      if (t.startsWith("language_")) return t.replace("language_", "").toUpperCase();
      if (t === "system_supporter") return "VRC+";
      return t;
    });

  return (
    <div
      className={cn(
        "group flex flex-col gap-0 overflow-hidden rounded-[calc(var(--radius-sm)+4px)] border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--surface))] shadow-lg backdrop-blur-md transition-all duration-300",
        className,
      )}
    >
      {/* ── Banner ── */}
      <div className="relative h-[90px] w-full shrink-0 bg-[hsl(var(--muted))] overflow-hidden">
        {bannerUrl ? (
          <img
            src={bannerUrl}
            className="absolute inset-0 w-full h-full object-cover blur-[6px] scale-110 opacity-70 select-none animate-in fade-in duration-500"
            alt=""
            loading="lazy"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-tr from-[hsl(var(--primary)/0.2)] to-[hsl(var(--accent)/0.2)]" />
        )}
        {/* Shine overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[hsl(var(--surface))] to-transparent" />
        
        {/* Utilities float top right */}
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1 opacity-60 hover:opacity-100 transition-opacity">
          {editable && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded bg-black/40 p-1.5 text-white/90 hover:bg-black/60 transition-colors backdrop-blur-sm shadow-sm"
              title={t("profile.editProfile")}
            >
              <Edit3 className="size-3" />
            </button>
          )}
        </div>
      </div>

      {/* ── Header ── */}
      <div className="relative px-4 pb-3 flex justify-between flex-none -mt-8 pt-0">
        <div className="flex gap-3 w-full">
          {/* Avatar Float */}
          <div className="relative size-[72px] shrink-0 rounded-full border-[3px] border-[hsl(var(--surface))] bg-[hsl(var(--surface))] overflow-hidden shadow-[0_4px_12px_rgba(0,0,0,0.15)] z-10 transition-transform duration-300 hover:scale-[1.03]">
            {avatarUrl ? (
               <img src={avatarUrl} className="h-full w-full object-cover cursor-pointer" alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            ) : (
               <div className="flex h-full w-full items-center justify-center bg-[hsl(var(--muted))]"><User className="size-8 text-[hsl(var(--muted-foreground))]" /></div>
            )}
            <div className={cn("absolute bottom-0 right-1 size-3 rounded-full border-2 border-[hsl(var(--surface))] z-20", statusDot(user.status))} />
          </div>

          {/* Name & Status Text */}
          <div className="flex min-w-0 flex-1 flex-col pt-10 pb-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-base font-bold text-[hsl(var(--foreground))] drop-shadow-sm tracking-tight">
                {user.displayName}
              </span>
              {user.developerType && user.developerType !== "none" && (
                <span className="shrink-0 rounded bg-[hsl(var(--primary)/0.15)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--primary))] shadow-sm">
                  Dev
                </span>
              )}
            </div>

            {/* Online indicator */}
            {!editing && (
              <div className="flex items-center gap-1.5 text-[11px] font-medium opacity-90 mt-0.5">
                <span className={statusColor(user.status)}>{statusLabel(t, user.status)}</span>
                {user.statusDescription && (
                  <>
                    <span className="text-[hsl(var(--muted-foreground))]">·</span>
                    <span className="truncate text-[hsl(var(--muted-foreground))] w-full">
                      {user.statusDescription}
                    </span>
                  </>
                )}
              </div>
            )}
            
            {/* Status edit fields */}
            {editing && (
               <div className="flex flex-col gap-1.5 mt-2">
                 <div className="flex flex-wrap gap-1">
                   {STATUS_OPTIONS.map((opt) => (
                     <button
                       key={opt.value}
                       type="button"
                       onClick={() => setDraftStatus(opt.value)}
                       className={cn(
                         "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer",
                         draftStatus === opt.value
                           ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.15)] shadow-sm"
                           : "border-[hsl(var(--border))] hover:border-[hsl(var(--border-strong))] bg-[hsl(var(--canvas))]",
                         opt.color,
                       )}
                     >
                       <span
                         className={cn(
                           "inline-block size-1.5 rounded-full shadow-sm",
                           draftStatus === opt.value ? statusDot(opt.value) : "bg-current opacity-50",
                         )}
                       />
                       {t(opt.key)}
                     </button>
                   ))}
                 </div>
                 <Input
                   value={draftStatusDesc}
                   onChange={(e) => setDraftStatusDesc(e.target.value)}
                   placeholder={t("profile.statusPlaceholder")}
                   className="h-7 text-[11px] bg-[hsl(var(--canvas))] border-[hsl(var(--border)/0.5)] focus:ring-[hsl(var(--primary))]"
                   maxLength={32}
                 />
               </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Tags and ID ── */}
      <div className="px-4 pb-3 flex flex-wrap items-center gap-1.5">
        <IdBadge id={user.id} size="xs" />
        <span className={cn("px-1.5 py-[1px] text-[9.5px] uppercase tracking-widest font-bold rounded shadow-sm border border-[hsl(var(--border)/0.4)]", trustColorClass(rank), "bg-current/10")}>
          {t(trustLabelKey(rank))}
        </span>
        {niceTags.map((t, i) => (
           <span key={i} className="px-1.5 py-[1px] text-[9.5px] uppercase tracking-wider font-semibold rounded bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border border-[hsl(var(--border)/0.4)]">
             {t}
           </span>
        ))}
      </div>

      {/* ── Bio ── */}
      <div className="px-4 py-2 bg-[hsl(var(--canvas)/0.4)] border-y border-[hsl(var(--border)/0.4)]">
        {editing ? (
          <textarea
            value={draftBio}
            onChange={(e) => setDraftBio(e.target.value)}
            placeholder={t("profile.bioPlaceholder")}
            className={cn(
              "w-full resize-none rounded-[calc(var(--radius-sm)-2px)] border border-[hsl(var(--border)/0.5)]",
              "bg-[hsl(var(--canvas))] px-2.5 py-1.5 text-[11px] text-[hsl(var(--foreground))]",
              "placeholder:text-[hsl(var(--muted-foreground)/0.5)] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))] transition-all shadow-inner",
            )}
            rows={3}
            maxLength={512}
          />
        ) : user.bio ? (
          <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-[hsl(var(--foreground)/0.8)] selection:bg-[hsl(var(--primary)/0.2)]">
            {user.bio}
          </p>
        ) : (
          <p className="text-[11px] italic text-[hsl(var(--muted-foreground)/0.5)] select-none">{t("profile.emptyBio")}</p>
        )}
      </div>

      {/* ── Bio Links ── */}
      {user.bioLinks && user.bioLinks.length > 0 && !editing && (
        <div className="px-4 py-2.5 flex flex-wrap gap-1.5 bg-[hsl(var(--surface))]">
          {user.bioLinks.map((url, i) => {
            const { label, Icon } = parseBioLink(url);
            return (
              <a
                key={i}
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  void ipc.call("shell.openUrl", { url });
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--border)/0.6)] bg-[hsl(var(--canvas))] px-2.5 py-1 text-[10.5px] font-medium text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--border-strong))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted)/0.5)] transition-all duration-200 shadow-sm"
              >
                <Icon className="size-3" />
                {label}
              </a>
            );
          })}
        </div>
      )}

      {/* ── Current avatar / world ── */}
      <div className="grid grid-cols-2 gap-0 border-t border-[hsl(var(--border)/0.4)] bg-[hsl(var(--canvas)/0.2)] text-[11px]">
        {user.currentAvatarName && (
          <div className="flex flex-col gap-0.5 border-r border-[hsl(var(--border)/0.4)] px-4 py-2.5">
            <span className="text-[9px] uppercase tracking-wider text-[hsl(var(--muted-foreground)/0.8)] font-semibold">
              {t("profile.currentAvatar")}
            </span>
            <span className="truncate font-medium text-[hsl(var(--foreground)/0.9)]">
              {user.currentAvatarName}
            </span>
          </div>
        )}
        {user.worldName && (
          <div className="flex flex-col gap-0.5 px-4 py-2.5 min-w-0">
            <span className="text-[9px] uppercase tracking-wider text-[hsl(var(--muted-foreground)/0.8)] font-semibold">
              {t("profile.currentWorld")}
            </span>
            <div className="flex items-center gap-1 text-[hsl(var(--foreground)/0.9)] font-medium">
              <Globe2 className="size-3 shrink-0 opacity-60" />
              <span className="truncate">{user.worldName}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Footprint ── */}
      {(user.isFriend !== undefined || user.last_activity) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border)/0.4)] bg-[hsl(var(--surface-raised))] px-4 py-2.5">
          <div className="flex items-center gap-2">
            {isOnline ? (
              <div className="flex items-center justify-center size-5 rounded-full bg-emerald-400/10">
                <Wifi className="size-3 text-emerald-400" />
              </div>
            ) : (
              <div className="flex items-center justify-center size-5 rounded-full bg-[hsl(var(--muted))]">
                 <WifiOff className="size-3 text-[hsl(var(--muted-foreground))]" />
              </div>
            )}
            <span className="text-[10px] uppercase font-bold tracking-wider text-[hsl(var(--muted-foreground))]">
              {user.isFriend
                ? t("common.friend", { defaultValue: "Friend" })
                : t("common.player", { defaultValue: "Player" })}
            </span>
          </div>
          {user.last_activity && !isOnline && (
            <div className="flex items-center gap-1.5 opacity-80">
              <Clock className="size-3 text-[hsl(var(--muted-foreground))]" />
              <span className="text-[10px] font-mono text-[hsl(var(--muted-foreground))]">
                {new Date(user.last_activity).toLocaleDateString(i18n.resolvedLanguage ?? i18n.language)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Action Buttons ── */}
      <div className="relative z-10 flex flex-wrap items-center gap-1.5 border-t border-[hsl(var(--border)/0.4)] bg-[hsl(var(--canvas)/0.3)] px-3 py-2.5">
        {/* Row 1: Navigation actions */}
        <button
          type="button"
          onClick={openVrcProfile}
          title={t("profile.viewOnVrchat")}
          className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2.5 py-1 text-[11px] font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted)/0.5)] transition-all"
        >
          <ExternalLink className="size-3" />
          {t("profileCard.home", { defaultValue: "Home" })}
        </button>

        {!isSelf && !user.isFriend && (
          <button
            type="button"
            onClick={() => void ipc.call("shell.openUrl", { url: `https://vrchat.com/home/user/${user.id}` })}
            title={t("profileCard.addFriend", { defaultValue: "Add Friend" })}
            className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2.5 py-1 text-[11px] font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] hover:border-[hsl(var(--primary)/0.5)] hover:bg-[hsl(var(--primary)/0.08)] transition-all"
          >
            <UserPlus className="size-3" />
            {t("profileCard.addFriend", { defaultValue: "Add Friend" })}
          </button>
        )}

        {!isSelf && user.location && user.location !== "offline" && user.location !== "private" && user.location !== "traveling" && (
          <button
            type="button"
            onClick={() => void ipc.call("shell.openUrl", { url: `vrchat://launch?ref=vrchat.com&id=${user.location}` })}
            title={t("profileCard.joinInstance", { defaultValue: "Join Instance" })}
            className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2.5 py-1 text-[11px] font-medium text-[hsl(var(--muted-foreground))] hover:text-emerald-400 hover:border-emerald-400/40 hover:bg-emerald-400/5 transition-all"
          >
            <LogIn className="size-3" />
            {t("profileCard.joinInstance", { defaultValue: "Join Instance" })}
          </button>
        )}

        {isSelf && authStatus.authed && (
          <button
            type="button"
            onClick={async () => {
              try {
                await ipc.call("auth.logout");
                toast.success(t("auth.signedOut"));
              } catch (e) {
                toast.error(e instanceof Error ? e.message : t("profileCard.logoutFailed", { defaultValue: "Sign out failed" }));
              }
            }}
            title={t("auth.signOut")}
            className="ml-auto flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-red-400/40 bg-red-400/5 px-2.5 py-1 text-[11px] font-medium text-red-400 hover:bg-red-400/15 hover:border-red-400/60 transition-all"
          >
            <LogOut className="size-3" />
            {t("auth.signOut")}
          </button>
        )}
      </div>

      {/* ── Avatar Actions (separate row to avoid overlap) ── */}
      {!isSelf && user.currentAvatarId && (
        <div className="relative z-10 flex items-center gap-1.5 border-t border-[hsl(var(--border)/0.4)] bg-[hsl(var(--surface-raised)/0.5)] px-3 py-2">
          <Shirt className="size-3 text-[hsl(var(--primary))] shrink-0" />
          <span className="truncate text-[10px] text-[hsl(var(--muted-foreground))]">
            {user.currentAvatarName || user.currentAvatarId}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              disabled={wearingAvatar}
              onClick={async () => {
                if (!user.currentAvatarId) return;
                setWearingAvatar(true);
                try {
                  await ipc.call("avatar.select", { avatarId: user.currentAvatarId });
                  toast.success(t("profileCard.woreAvatar", {
                    defaultValue: "Now wearing: {{name}}",
                    name: user.currentAvatarName || user.currentAvatarId,
                  }));
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : t("profileCard.wearFailed", {
                    defaultValue: "Failed to wear avatar. This avatar may not be public or available.",
                  }));
                } finally {
                  setWearingAvatar(false);
                }
              }}
              title={t("profileCard.wearAvatarTitle", {
                defaultValue: "Wear {{name}}",
                name: user.currentAvatarName || user.currentAvatarId,
              })}
              className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[hsl(var(--primary)/0.6)] bg-[hsl(var(--primary)/0.1)] px-2 py-0.5 text-[10px] font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.2)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {wearingAvatar
                ? t("profileCard.wearing", { defaultValue: "Wearing…" })
                : t("profileCard.wearAvatar", { defaultValue: "Wear" })}
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(user.currentAvatarId!);
                toast.success(t("profileCard.avatarIdCopied", { defaultValue: "Avatar ID copied" }));
              }}
              title={t("profileCard.copyAvatarId", { defaultValue: "Copy Avatar ID" })}
              className="flex items-center gap-1 rounded border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-1.5 py-0.5 text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-all"
            >
              <Copy className="size-2.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── Save / Cancel ── */}
      {editing && (
        <div className="flex items-center justify-end gap-2 border-t border-[hsl(var(--border)/0.6)] bg-[hsl(var(--surface-raised))] px-3 py-2.5 shadow-[0_-4px_12px_rgba(0,0,0,0.02)]">
          <Button variant="ghost" size="sm" onClick={handleCancel} disabled={saving} className="h-7 text-[11px] hover:bg-transparent">
            <X className="size-3.5 mr-1" /> {t("common.cancel")}
          </Button>
          <Button variant="tonal" size="sm" onClick={handleSave} disabled={saving} className="h-7 text-[11px] shadow-sm">
            <Save className="size-3.5 mr-1" /> {saving ? t("profile.saving") : t("common.save")}
          </Button>
        </div>
      )}
    </div>
  );
}
