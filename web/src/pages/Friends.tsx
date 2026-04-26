import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoginForm } from "@/components/LoginForm";
import { FriendDetailDialog } from "@/components/FriendDetailDialog";
import { SmartWearButton } from "@/components/SmartWearButton";
import { ImageZoom } from "@/components/ImageZoom";
import { IdBadge } from "@/components/IdBadge";
import { ThumbImage } from "@/components/ThumbImage";


import { ipc } from "@/lib/ipc";
import { useAuth } from "@/lib/auth-context";
import { useIpcQuery } from "@/hooks/useIpcQuery";
import { subscribePipelineEvent } from "@/lib/pipeline-events";
import {
  applyFriendPipelineEvent,
  FRIEND_PIPELINE_EVENT_TYPES,
} from "@/lib/friends-pipeline";
import type { Friend, FriendsListResult, WorldDetails } from "@/lib/types";
import {
  instanceTypeLabel,
  parseLocation,
  regionLabel,
  relativeTime,
  STATUS_BUCKET_ORDER,
  statusBucket,
  trustColorClass,
  trustDotColor,
  trustLabelKey,
  trustRank,
  type StatusBucket,
} from "@/lib/vrcFriends";
import { useSelfLocation } from "@/lib/useSelfLocation";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  ChevronRight,
  LogIn,
  MailPlus,
  MoreHorizontal,
  RefreshCcw,
  Search,
  Shield,
  Users,
  Globe2,
  Home,
  Monitor,
  Smartphone,
  UserRound,
  Play,
  UserSearch,
} from "lucide-react";

function statusColor(
  bucket: StatusBucket,
): "success" | "warning" | "muted" | "secondary" {
  switch (bucket) {
    case "active":
    case "joinMe":
      return "success";
    case "askMe":
      return "secondary";
    case "busy":
      return "warning";
    default:
      return "muted";
  }
}

function platformIcon(platform: string | null) {
  if (platform === "android") return Smartphone;
  if (platform?.includes("standalonewindows") || platform === "pc") return Monitor;
  return Globe2;
}

function FriendAvatar({ friend }: { friend: Friend }) {
  const thumb =
    friend.profilePicOverride ||
    friend.currentAvatarThumbnailImageUrl ||
    friend.currentAvatarImageUrl;
  const rank = trustRank(friend.tags);
  const dotColor = trustDotColor(rank);
  return (
    <div className="relative shrink-0">
      <div
        className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-[hsl(var(--canvas))]"
        style={{ boxShadow: `0 0 0 2px ${dotColor}` }}
      >
        {thumb ? (
          <ImageZoom src={thumb} className="h-full w-full" imgClassName="h-full w-full object-cover rounded-full" />
        ) : (
          <Users className="size-5 text-[hsl(var(--muted-foreground))]" />
        )}
      </div>
      {/* Trust rank status dot */}
      <span
        className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-[hsl(var(--surface-raised))]"
        style={{ backgroundColor: dotColor }}
        title={rank}
      />
    </div>
  );
}

// CloneAvatarButton replaced by SmartWearButton

function useFriendActions(friend: Friend, onOpenDetail: (f: Friend) => void) {
  const { t } = useTranslation();
  const self = useSelfLocation();
  const loc = parseLocation(friend.location);

  const doJoin = useCallback(() => {
    ipc
      .call<{ url: string }, { ok: boolean }>("shell.openUrl", {
        url: `vrchat://launch?ref=vrchat.com&id=${friend.location}`,
      })
      .catch(console.error);
  }, [friend.location]);

  const doRequestInvite = useCallback(async () => {
    try {
      await ipc.requestInvite(friend.id);
      toast.success(
        t("friends.actions.requestInviteSent", {
          defaultValue: "向 {{name}} 发送了加入请求",
          name: friend.displayName,
        }),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [friend.id, friend.displayName, t]);

  const doInviteToMyRoom = useCallback(async () => {
    if (!self.raw || !self.isInWorld) return;
    try {
      await ipc.inviteUser(friend.id, self.raw);
      toast.success(
        t("friends.actions.inviteSent", {
          defaultValue: "已邀请 {{name}} 到你的房间",
          name: friend.displayName,
        }),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [friend.id, friend.displayName, self.raw, self.isInWorld, t]);

  const openDetail = useCallback(() => onOpenDetail(friend), [onOpenDetail, friend]);

  return {
    canJoin: loc.kind === "world" && !!loc.worldId,
    canRequestInvite: loc.kind === "world" && !!loc.worldId,
    canInviteToMyRoom: self.isInWorld,
    doJoin,
    doRequestInvite,
    doInviteToMyRoom,
    openDetail,
  };
}

type FriendActions = ReturnType<typeof useFriendActions>;

function FriendMenuItems({
  actions,
  MenuItem,
  MenuSeparator,
}: {
  actions: FriendActions;
  MenuItem: typeof ContextMenuItem | typeof DropdownMenuItem;
  MenuSeparator: typeof ContextMenuSeparator | typeof DropdownMenuSeparator;
}) {
  const { t } = useTranslation();
  return (
    <>
      <MenuItem onSelect={actions.openDetail}>
        <UserSearch className="size-3.5" />
        {t("friendDetail.title", { defaultValue: "好友详情" })}
      </MenuItem>
      <MenuSeparator />
      <MenuItem disabled={!actions.canJoin} onSelect={actions.canJoin ? actions.doJoin : undefined}>
        <Play className="size-3.5" />
        {t("friends.actions.joinRoom", { defaultValue: "加入房间" })}
      </MenuItem>
      <MenuItem
        disabled={!actions.canRequestInvite}
        onSelect={actions.canRequestInvite ? actions.doRequestInvite : undefined}
      >
        <MailPlus className="size-3.5" />
        {t("friends.actions.requestInvite", { defaultValue: "申请加入" })}
      </MenuItem>
      <MenuItem
        disabled={!actions.canInviteToMyRoom}
        onSelect={actions.canInviteToMyRoom ? actions.doInviteToMyRoom : undefined}
      >
        <Home className="size-3.5" />
        {t("friends.actions.inviteToMyRoom", { defaultValue: "邀请到我的房间" })}
      </MenuItem>
    </>
  );
}

const FriendRow = memo(function FriendRow({
  friend,
  colocatedFriends = [],
  onOpenDetail,
}: {
  friend: Friend;
  colocatedFriends?: Friend[];
  onOpenDetail: (friend: Friend) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const actions = useFriendActions(friend, onOpenDetail);

  const loc = parseLocation(friend.location);
  const PlatformIcon = platformIcon(friend.last_platform);
  const rank = trustRank(friend.tags);
  const isModerator = friend.tags.includes("admin_moderator");

  // Build the "where" cell: instance type + region for world cases,
  // a single translated label for offline / private / traveling.
  const locCell = (() => {
    if (loc.kind === "world") {
      const typeText = instanceTypeLabel(loc.instanceType);
      const regionText = regionLabel(loc.region);
      const pieces = [typeText, regionText].filter(Boolean);
      return pieces.length > 0
        ? pieces.join(" · ")
        : t("friends.location.world", { defaultValue: "In world" });
    }
    return t(`friends.location.${loc.kind}`);
  })();

  const { data: worldData } = useIpcQuery<{ id: string }, { details: WorldDetails | null }>(
    "world.details",
    { id: loc.worldId ?? "" },
    { enabled: loc.kind === "world" && !!loc.worldId, staleTime: 300_000 }
  );

  // World name: use worldId truncated when there's a world location
  const worldLabel = (() => {
    if (loc.kind !== "world" || !loc.worldId) return null;
    if (worldData?.details?.name) return worldData.details.name;
    // Show a truncated world ID (wrld_xxxx...)
    const wid = loc.worldId;
    return wid.length > 20 ? wid.slice(0, 18) + "..." : wid;
  })();

  const lastSeen = relativeTime(friend.last_login || friend.last_activity);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] hover:border-[hsl(var(--border-strong))]">
          <div
            role="button"
            tabIndex={0}
            onClick={() => setExpanded((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setExpanded((v) => !v);
              }
            }}
            className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left"
          >
        {expanded ? (
          <ChevronDown className="size-3 shrink-0 text-[hsl(var(--muted-foreground))]" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-[hsl(var(--muted-foreground))]" />
        )}
        <FriendAvatar friend={friend} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span
              className={`truncate text-[13px] font-medium ${trustColorClass(rank)}`}
              title={t(trustLabelKey(rank))}
            >
              {friend.displayName}
            </span>
            {isModerator ? (
              <Shield
                className="size-3 text-red-400"
                aria-label={t("friends.badges.moderator")}
              />
            ) : null}
            <Badge
              variant={statusColor(statusBucket(friend.status))}
              className="h-4 rounded-full px-1.5 text-[9.5px] uppercase"
            >
              {t(`friends.bucket.${statusBucket(friend.status)}`, {
                defaultValue: friend.status ?? "unknown",
              })}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
            <PlatformIcon className="size-3 shrink-0" />
            <span className="truncate">{locCell}</span>
            {worldLabel ? (
              <>
                <span>·</span>
                <span className="max-w-[140px] truncate font-mono text-[10px] opacity-70" title={loc.worldId}>
                  {worldLabel}
                </span>
              </>
            ) : null}
            {friend.statusDescription ? (
              <>
                <span>·</span>
                <span className="truncate">{friend.statusDescription}</span>
              </>
            ) : null}
            {lastSeen && loc.kind === "offline" ? (
              <>
                <span>·</span>
                <span className="shrink-0 font-mono text-[10px]">
                  {lastSeen}
                </span>
              </>
            ) : null}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              onClick={(e) => e.stopPropagation()}
              aria-label={t("friends.actions.menu", { defaultValue: "操作" })}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <FriendMenuItems
              actions={actions}
              MenuItem={DropdownMenuItem}
              MenuSeparator={DropdownMenuSeparator}
            />
          </DropdownMenuContent>
        </DropdownMenu>
          </div>
      {expanded ? (
        <div className="border-t border-[hsl(var(--border))] px-3 py-2.5">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
            <span className="text-[hsl(var(--muted-foreground))]">
              {t("friends.fields.userId")}
            </span>
            <IdBadge id={friend.id} size="xs" />

            <span className="text-[hsl(var(--muted-foreground))]">
              {t("friends.fields.trust")}
            </span>
            <span className={trustColorClass(rank)}>
              {t(trustLabelKey(rank))}
            </span>

            {/* Avatar preview chip + clone button */}
            {friend.currentAvatarName || friend.currentAvatarThumbnailImageUrl ? (
              <>
                <span className="text-[hsl(var(--muted-foreground))]">
                  {t("friends.fields.avatar", { defaultValue: "Avatar" })}
                </span>
                <div className="flex items-center gap-2">
                  {friend.currentAvatarThumbnailImageUrl ? (
                    <div className="size-7 shrink-0 overflow-hidden rounded border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
                      <ThumbImage
                        src={friend.currentAvatarThumbnailImageUrl}
                        seedKey={friend.currentAvatarId ?? friend.id}
                        label={friend.currentAvatarName ?? friend.displayName}
                        alt=""
                        className="h-full w-full border-0"
                        aspect=""
                        rounded=""
                      />
                    </div>
                  ) : null}
                  {friend.currentAvatarName ? (
                    <span className="truncate text-[11px]">
                      {friend.currentAvatarName}
                    </span>
                  ) : null}
                  <SmartWearButton userId={friend.id} avatarId={friend.currentAvatarId} avatarName={friend.currentAvatarName ?? undefined} variant="pill" className="ml-auto" />
                </div>
              </>
            ) : null}

            {friend.developerType && friend.developerType !== "none" ? (
              <>
                <span className="text-[hsl(var(--muted-foreground))]">
                  {t("friends.fields.developer")}
                </span>
                <span>{friend.developerType}</span>
              </>
            ) : null}

            {loc.kind === "world" && loc.worldId ? (
              <>
                <span className="text-[hsl(var(--muted-foreground))]">
                  {t("friends.fields.world")}
                </span>
                <IdBadge id={loc.worldId} size="xs" />
              </>
            ) : null}

            {loc.kind === "world" && loc.instanceId ? (
              <>
                <span className="text-[hsl(var(--muted-foreground))]">
                  {t("friends.fields.instance")}
                </span>
                <span className="font-mono text-[10.5px]">
                  {loc.instanceId}
                </span>
              </>
            ) : null}

            {lastSeen ? (
              <>
                <span className="text-[hsl(var(--muted-foreground))]">
                  {t("friends.fields.lastSeen")}
                </span>
                <span>{lastSeen}</span>
              </>
            ) : null}

            {friend.bio ? (
              <>
                <span className="text-[hsl(var(--muted-foreground))]">
                  {t("friends.fields.bio")}
                </span>
                <span className="whitespace-pre-wrap break-words">
                  {friend.bio}
                </span>
              </>
            ) : null}
          </div>

          {colocatedFriends.length > 0 && loc.kind === "world" ? (
            <div className="mt-3 flex flex-col gap-2 border-t border-[hsl(var(--border))] pt-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                {t("friends.alsoInInstance", { defaultValue: "同行好友" })} ({colocatedFriends.length})
              </span>
              <div className="flex flex-col gap-1.5 pl-1">
                {colocatedFriends.map((cf) => (
                  <button
                    key={cf.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDetail(cf);
                    }}
                    className="flex w-fit items-center gap-2 hover:bg-[hsl(var(--muted))] rounded pr-2 py-0.5"
                  >
                    <div className="relative size-4 shrink-0 overflow-hidden rounded shadow-sm">
                      <ThumbImage
                        src={
                          cf.profilePicOverride ||
                          cf.currentAvatarThumbnailImageUrl ||
                          ""
                        }
                        seedKey={cf.id}
                        label={cf.displayName}
                        alt=""
                        className="h-full w-full border-0"
                        aspect=""
                        rounded=""
                      />
                    </div>
                    <span className="text-[11px] font-medium text-[hsl(var(--foreground))]">
                      {cf.displayName}
                    </span>
                    <span className={`text-[10px] font-medium ${trustColorClass(trustRank(cf.tags))}`}>
                      {t(trustLabelKey(trustRank(cf.tags)))}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-2 flex justify-end gap-1.5">
            {loc.kind === "world" && loc.worldId && loc.instanceId ? (
              <Button
                variant="tonal"
                size="sm"
                className="bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.25)]"
                onClick={(e) => {
                  e.stopPropagation();
                  ipc.call<{ url: string }, { ok: boolean }>("shell.openUrl", {
                    url: `vrchat://launch?id=${friend.location}`,
                  }).catch(console.error);
                }}
              >
                <Play className="mr-1 size-3 shrink-0" />
                <span className="font-semibold">{t("friends.joinRoom", { defaultValue: "Join Room" })}</span>
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetail(friend);
              }}
            >
              <UserRound className="mr-1 size-3 shrink-0" />
              <span>{t("friends.detailPaneTitle", { defaultValue: "详情" })}</span>
            </Button>
          </div>
        </div>
      ) : null}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <FriendMenuItems
          actions={actions}
          MenuItem={ContextMenuItem}
          MenuSeparator={ContextMenuSeparator}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
});

const FRIENDS_CACHE_KEY = "vrcsm.friends.cache.v1";

function readFriendsCache(): FriendsListResult | null {
  try {
    const raw = localStorage.getItem(FRIENDS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.friends)) return parsed as FriendsListResult;
  } catch {
    // ignore — corrupt cache, treat as empty
  }
  return null;
}

function writeFriendsCache(data: FriendsListResult): void {
  try {
    localStorage.setItem(FRIENDS_CACHE_KEY, JSON.stringify(data));
  } catch {
    // quota exceeded / private mode — skip silently
  }
}

export default function Friends() {
  const { t } = useTranslation();
  const { status, error: authError } = useAuth();
  // Seed from localStorage so the UI has something to paint immediately
  // while the IPC round-trip to the VRChat API resolves (commonly 1-3s).
  const [data, setData] = useState<FriendsListResult | null>(() => readFriendsCache());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const debouncedFilter = useDebouncedValue(filter, 150);
  const [showOffline, setShowOffline] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [dialogFriend, setDialogFriend] = useState<Friend | null>(null);
  const [collapsedBuckets, setCollapsedBuckets] = useState<Set<StatusBucket>>(
    new Set(),
  );

  const openDetail = useCallback((friend: Friend) => {
    setDialogFriend(friend);
  }, []);

  const refresh = () => {
    if (!status.authed) return;
    setLoading(true);
    setError(null);
    ipc
      .call<{ offline: boolean }, FriendsListResult>("friends.list", {
        offline: showOffline,
      })
      .then((result) => {
        setData(result);
        writeFriendsCache(result);
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        toast.error(t("friends.loadFailed", { error: msg }));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    // `showOffline` change + auth flip are the two triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.authed, showOffline]);

  // Live Pipeline updates — friend presence/location/profile changes
  // arrive in real time and are merged in-place. Persists the cache so
  // a reload immediately reflects the latest state.
  useEffect(() => {
    if (!status.authed) return;
    const unsubs = FRIEND_PIPELINE_EVENT_TYPES.map((type) =>
      subscribePipelineEvent(type, (content) => {
        setData((prev) => {
          const next = applyFriendPipelineEvent(prev, type, content);
          if (next) writeFriendsCache(next);
          return next ?? prev;
        });
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, [status.authed]);

  // Background Live Tracker Polling
  useEffect(() => {
    if (!status.authed) return;
    let timer: number | null = null;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const live = localStorage.getItem("vrcsm.friends.liveRefresh") === "true";
      const intv = parseInt(localStorage.getItem("vrcsm.friends.refreshInterval") || "60", 10);
      
      if (live) {
        // Silently poll without triggering the main loading spinner or toasts
        ipc
          .call<{ offline: boolean }, FriendsListResult>("friends.list", {
            offline: showOffline,
          })
          .then((result) => {
            if (!cancelled) setData(result);
          })
          .catch(() => undefined);
      }
      
      const nextDelay = isNaN(intv) || intv < 10 ? 60 : intv;
      timer = window.setTimeout(tick, nextDelay * 1000);
    };

    const initialIntv = parseInt(localStorage.getItem("vrcsm.friends.refreshInterval") || "60", 10);
    timer = window.setTimeout(tick, (isNaN(initialIntv) || initialIntv < 10 ? 60 : initialIntv) * 1000);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [status.authed, showOffline]);

  // Filter first, then group — doing filter-post-group wastes work rebuilding
  // every bucket when the query changes, and it also breaks the "total count"
  // on the header which expects the filtered view.
  const filtered = useMemo(() => {
    if (!data) return [];
    const q = debouncedFilter.trim().toLowerCase();
    if (!q) return data.friends;
    return data.friends.filter((f) => {
      // Display name, status description, bio (original filters)
      if (f.displayName.toLowerCase().includes(q)) return true;
      if (f.statusDescription?.toLowerCase().includes(q)) return true;
      if (f.bio?.toLowerCase().includes(q)) return true;
      // User ID
      if (f.id.toLowerCase().includes(q)) return true;
      // Trust rank name (e.g. typing "trusted" matches Trusted Users)
      const rank = trustRank(f.tags);
      if (t(trustLabelKey(rank)).toLowerCase().includes(q)) return true;
      // World ID / location
      if (f.location && f.location !== "offline" && f.location !== "private") {
        const loc = parseLocation(f.location);
        if (loc.worldId?.toLowerCase().includes(q)) return true;
      }
      // Avatar name
      if (f.currentAvatarName?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [data, debouncedFilter, t]);

  // Group filtered friends into status buckets. Sort within each bucket by
  // display name so the order stays stable across refreshes (VRChat's list
  // comes back in last-modified order, which jumps around mid-session).
  const grouped = useMemo(() => {
    const buckets: Record<StatusBucket, Friend[]> = {
      joinMe: [],
      active: [],
      askMe: [],
      busy: [],
      offline: [],
    };
    for (const f of filtered) {
      buckets[statusBucket(f.status)].push(f);
    }
    for (const key of STATUS_BUCKET_ORDER) {
      buckets[key].sort((a, b) => a.displayName.localeCompare(b.displayName));
    }
    return buckets;
  }, [filtered]);

  const locationGroups = useMemo(() => {
    const groups: Record<string, Friend[]> = {};
    for (const f of data?.friends ?? []) {
      if (!f.location || f.location === "offline" || f.location === "private") continue;
      const loc = parseLocation(f.location);
      if (loc.kind === "world") {
        if (!groups[f.location]) groups[f.location] = [];
        groups[f.location].push(f);
      }
    }
    return groups;
  }, [data?.friends]);

  const toggleBucket = (bucket: StatusBucket) => {
    setCollapsedBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(bucket)) {
        next.delete(bucket);
      } else {
        next.add(bucket);
      }
      return next;
    });
  };

  // Not signed in — show a single "Sign in with VRChat" button that
  // spawns the native LoginForm dialog. The C++ host calls the real
  // VRChat `/api/1/auth/user` endpoint via WinHTTP, handles 2FA if
  // required, and persists the resulting cookie via DPAPI. The
  // password lives in memory only for the duration of the request.
  if (!status.authed) {
    return (
      <div className="flex flex-col gap-4 animate-fade-in">
        <header>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight">
            {t("friends.title")}
          </h1>
          <p className="mt-1.5 text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("friends.subtitle")}
          </p>
        </header>
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>{t("friends.signInRequired")}</CardTitle>
            <CardDescription>
              {t("friends.signInRequiredBody")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">
              {t("auth.nativeLoginHint", {
                defaultValue:
                  "VRCSM calls the VRChat REST API directly with WinHTTP. Your credentials never leave this machine — only the session cookie is kept, DPAPI-encrypted at %LocalAppData%\\VRCSM\\session.dat.",
              })}
            </p>
            <Button
              type="button"
              variant="tonal"
              onClick={() => setLoginOpen(true)}
            >
              <LogIn />
              {t("auth.signInWithVrchat", {
                defaultValue: "Sign in with VRChat",
              })}
            </Button>
            {authError ? (
              <div className="text-[11px] text-[hsl(var(--warn-foreground,var(--destructive)))]">
                {authError}
              </div>
            ) : null}
          </CardContent>
        </Card>
        <LoginForm open={loginOpen} onOpenChange={setLoginOpen} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight">
            {t("friends.title")}
          </h1>
          <p className="mt-1.5 text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("friends.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
          {data ? (
            <span>
              {t("friends.totalCount", { count: data.friends.length })}
            </span>
          ) : null}
        </div>
      </header>

      <div className="flex gap-3">
      <Card elevation="flat" className="flex min-w-0 flex-1 flex-col overflow-hidden p-0">
        <div className="unity-panel-header flex items-center justify-between">
          <span>{t("friends.listPaneTitle")}</span>
          <span className="font-mono text-[10px] normal-case tracking-normal">
            {filtered.length}
          </span>
        </div>
        <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 py-1.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("friends.filterPlaceholder")}
              className="h-7 pl-7 text-[12px]"
            />
          </div>
          <Button
            variant={showOffline ? "tonal" : "outline"}
            size="sm"
            onClick={() => setShowOffline((v) => !v)}
          >
            {showOffline
              ? t("friends.hideOffline")
              : t("friends.showOffline")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCcw className={loading ? "animate-spin" : undefined} />
            {t("common.refresh")}
          </Button>
        </div>
        <div className="scrollbar-thin max-h-[600px] flex-1 overflow-y-auto p-2">
          {error ? (
            <div className="py-6 text-center text-[12px] text-[hsl(var(--warn-foreground,var(--destructive)))]">
              {error}
            </div>
          ) : loading && !data ? (
            <div className="py-6 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("friends.loading")}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-6 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("friends.empty")}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {STATUS_BUCKET_ORDER.map((bucket) => {
                const rows = grouped[bucket];
                if (rows.length === 0) return null;
                const collapsed = collapsedBuckets.has(bucket);
                return (
                  <section key={bucket} className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => toggleBucket(bucket)}
                      className="flex items-center gap-1.5 px-1 text-left text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                    >
                      {collapsed ? (
                        <ChevronRight className="size-3" />
                      ) : (
                        <ChevronDown className="size-3" />
                      )}
                      <span>{t(`friends.bucket.${bucket}`)}</span>
                      <Badge
                        variant={statusColor(bucket)}
                        className="h-4 rounded-full px-1.5 text-[9px] font-mono normal-case tracking-normal"
                      >
                        {rows.length}
                      </Badge>
                    </button>
                    {!collapsed ? (
                      <div className="flex flex-col gap-1.5">
                        {rows.map((f) => {
                          const colocated = locationGroups[f.location || ""]?.filter(
                            (x) => x.id !== f.id
                          );
                          return (
                            <FriendRow
                              key={f.id}
                              friend={f}
                              colocatedFriends={colocated}
                              onOpenDetail={openDetail}
                            />
                          );
                        })}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <FriendDetailDialog friend={dialogFriend} onClose={() => setDialogFriend(null)} />
      </div>
    </div>
  );
}
