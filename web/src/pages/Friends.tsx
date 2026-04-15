import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
import { ipc } from "@/lib/ipc";
import { useAuth } from "@/lib/auth-context";
import type { Friend, FriendsListResult } from "@/lib/types";
import {
  instanceTypeLabel,
  parseLocation,
  regionLabel,
  relativeTime,
  STATUS_BUCKET_ORDER,
  statusBucket,
  trustColorClass,
  trustLabelKey,
  trustRank,
  type StatusBucket,
} from "@/lib/vrcFriends";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  LogIn,
  RefreshCcw,
  Search,
  Shield,
  Users,
  Globe2,
  Monitor,
  Smartphone,
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
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
      {thumb ? (
        <img
          src={thumb}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <Users className="size-5 text-[hsl(var(--muted-foreground))]" />
      )}
    </div>
  );
}

/**
 * Copy-to-clipboard with a toast confirmation — used for user id and
 * location strings so power users can paste into DMs / VRCX / scripts
 * without hunting through the raw JSON.
 */
async function copyValue(value: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Clipboard unavailable");
  }
}

function FriendRow({ friend }: { friend: Friend }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

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
      return pieces.length > 0 ? pieces.join(" · ") : "In world";
    }
    return t(`friends.location.${loc.kind}`);
  })();

  const lastSeen = relativeTime(friend.last_login || friend.last_activity);

  return (
    <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] hover:border-[hsl(var(--border-strong))]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left"
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
              {friend.status ?? "unknown"}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
            <PlatformIcon className="size-3 shrink-0" />
            <span className="truncate">{locCell}</span>
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
      </button>
      {expanded ? (
        <div className="border-t border-[hsl(var(--border))] px-3 py-2.5">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
            <span className="text-[hsl(var(--muted-foreground))]">
              {t("friends.fields.userId")}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="truncate font-mono text-[10.5px]">
                {friend.id}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void copyValue(friend.id, t("friends.fields.userId"));
                }}
                className="shrink-0 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                aria-label={t("common.copy", { defaultValue: "Copy" })}
              >
                <Copy className="size-3" />
              </button>
            </div>

            <span className="text-[hsl(var(--muted-foreground))]">
              {t("friends.fields.trust")}
            </span>
            <span className={trustColorClass(rank)}>
              {t(trustLabelKey(rank))}
            </span>

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
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-mono text-[10.5px]">
                    {loc.worldId}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void copyValue(
                        friend.location ?? "",
                        t("friends.fields.location"),
                      );
                    }}
                    className="shrink-0 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                    aria-label={t("common.copy", { defaultValue: "Copy" })}
                  >
                    <Copy className="size-3" />
                  </button>
                </div>
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
        </div>
      ) : null}
    </div>
  );
}

export default function Friends() {
  const { t } = useTranslation();
  const { status, openLogin, error: authError } = useAuth();
  const [data, setData] = useState<FriendsListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [showOffline, setShowOffline] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [collapsedBuckets, setCollapsedBuckets] = useState<Set<StatusBucket>>(
    new Set(),
  );

  const handleOpenLogin = async () => {
    setLaunching(true);
    try {
      const result = await openLogin();
      if (!result.ok && result.error) {
        toast.error(
          t("auth.loginWindowFailed", {
            error: result.error,
            defaultValue: `Login window failed: ${result.error}`,
          }),
        );
      }
    } finally {
      setLaunching(false);
    }
  };

  const refresh = () => {
    if (!status.authed) return;
    setLoading(true);
    setError(null);
    ipc
      .call<{ offline: boolean }, FriendsListResult>("friends.list", {
        offline: showOffline,
      })
      .then((result) => setData(result))
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

  // Filter first, then group — doing filter-post-group wastes work rebuilding
  // every bucket when the query changes, and it also breaks the "total count"
  // on the header which expects the filtered view.
  const filtered = useMemo(() => {
    if (!data) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return data.friends;
    return data.friends.filter(
      (f) =>
        f.displayName.toLowerCase().includes(q) ||
        (f.statusDescription?.toLowerCase().includes(q) ?? false) ||
        (f.bio?.toLowerCase().includes(q) ?? false),
    );
  }, [data, filter]);

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

  // Not signed in — show a single "Sign in with VRChat" button. The
  // host spawns a second WebView2 pointing at vrchat.com/home/login so
  // VRChat's own web frontend handles every login permutation
  // (password + 2FA + Steam OAuth + captcha + email verify). VRCSM
  // never sees the password — we just harvest the session cookie out
  // of the WebView2 cookie jar once the user lands back on /home.
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
              {t("auth.loginWindowHint", {
                defaultValue:
                  "VRCSM will open a secure login window so VRChat's own site handles password, 2FA, Steam, and captcha. Your password never touches VRCSM.",
              })}
            </p>
            <Button
              type="button"
              variant="tonal"
              onClick={handleOpenLogin}
              disabled={launching}
            >
              <LogIn />
              {launching
                ? t("auth.opening", { defaultValue: "Opening…" })
                : t("auth.signInWithVrchat", {
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

      <Card elevation="flat" className="flex flex-col overflow-hidden p-0">
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
                      <span className="font-mono text-[10px] normal-case tracking-normal">
                        {rows.length}
                      </span>
                    </button>
                    {!collapsed ? (
                      <div className="flex flex-col gap-1.5">
                        {rows.map((f) => (
                          <FriendRow key={f.id} friend={f} />
                        ))}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
