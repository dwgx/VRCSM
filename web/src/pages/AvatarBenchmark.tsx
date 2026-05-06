import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useReport } from "@/lib/report-context";
import { useAuth } from "@/lib/auth-context";
import { ipc } from "@/lib/ipc";
import { vrcApiThrottle } from "@/lib/api-throttle";
import { prefetchThumbnails, useThumbnail } from "@/lib/thumbnails";
import {
  attachLocalUrl,
  pickProfileImage,
  readWearerReference,
  saveWearerReference,
  type WearerReference,
} from "@/lib/seenThumbnails";
import type { VrcUserProfile } from "@/components/ProfileCard";
import type { UserSearchResult } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThumbImage } from "@/components/ThumbImage";
import { ImageZoom } from "@/components/ImageZoom";
import { Gauge, AlertTriangle, CheckCircle2, Info, Copy, Clock, Eye, Lock, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2 } from "lucide-react";
import { SmartWearButton } from "@/components/SmartWearButton";
import { UserPopupBadge } from "@/components/UserPopupBadge";
import type { AvatarSwitchEvent } from "@/lib/types";

interface AvatarItem {
  avatar_id: string;
  display_name?: string;
  parameter_count: number;
  modified_at?: string;
}

interface SeenAvatar {
  avatar_id: string;
  avatar_name?: string | null;
  author_name?: string | null;
  first_seen_on?: string | null;
  first_seen_at?: string | null;
  release_status?: string | null;
  first_seen_user_id?: string | null;
  resolved_avatar_id?: string | null;
  resolved_thumbnail_url?: string | null;
  resolved_image_url?: string | null;
  resolution_source?: string | null;
  resolution_status?: string | null;
  resolved_at?: string | null;
}

interface SeenAvatarWearer {
  displayName: string;
  userId?: string | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  seenCount: number;
  worldId?: string | null;
  instanceId?: string | null;
}

interface SeenLogAvatar {
  local_id: string;
  avatar_history_id: string;
  avatar_id?: string | null;
  avatar_name: string;
  author_name?: string | null;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  seen_count: number;
  wearer_count: number;
  wearers: SeenAvatarWearer[];
  resolved_avatar_id?: string | null;
  resolved_thumbnail_url?: string | null;
  resolved_image_url?: string | null;
  resolution_source?: string | null;
  resolution_status?: string | null;
}

interface AvatarDetails {
  name?: string;
  description?: string;
  authorName?: string;
  authorId?: string;
  releaseStatus?: string;
  thumbnailImageUrl?: string;
  imageUrl?: string;
  tags?: string[];
  version?: number;
  [key: string]: unknown;
}

interface AvatarSearchResult {
  id: string;
  name: string;
  authorName: string;
  thumbnailImageUrl?: string | null;
  imageUrl?: string | null;
}

interface PerfRank {
  labelKey: string;
  labelFallback: string;
  color: string;
  bg: string;
  tier: string;
}

function perfRank(params: number): PerfRank {
  if (params <= 8)  return { labelKey: "benchmark.excellent", labelFallback: "Excellent", color: "text-emerald-400", bg: "bg-emerald-500", tier: "S" };
  if (params <= 16) return { labelKey: "benchmark.good",      labelFallback: "Good",      color: "text-green-400",   bg: "bg-green-500",   tier: "A" };
  if (params <= 32) return { labelKey: "benchmark.medium",    labelFallback: "Medium",    color: "text-yellow-400",  bg: "bg-yellow-500",  tier: "B" };
  if (params <= 64) return { labelKey: "benchmark.poor",      labelFallback: "Poor",      color: "text-orange-400",  bg: "bg-orange-500",  tier: "C" };
  return              { labelKey: "benchmark.veryPoor",  labelFallback: "Very Poor", color: "text-red-400",     bg: "bg-red-500",     tier: "D" };
}

type TabKey = "benchmark" | "seen";

const SEEN_PAGE_SIZE = 50;

function stableSeenKey(name: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `seen:${h.toString(16).padStart(8, "0")}`;
}

function normalizeAvatarName(name?: string | null): string {
  return (name ?? "")
    .normalize("NFKC")
    .replace(/[._\-‐‑‒–—―\s]+/g, "")
    .toLowerCase()
    .trim();
}

function isSameAvatarName(a?: string | null, b?: string | null): boolean {
  const left = normalizeAvatarName(a);
  const right = normalizeAvatarName(b);
  return Boolean(left && right && left === right);
}

function logOnlyAvatarKey(name: string, author?: string | null): string {
  const cleanName = name.trim();
  const cleanAuthor = author?.trim();
  return cleanAuthor ? `name:${cleanName}|author:${cleanAuthor}` : `name:${cleanName}`;
}

function historyNameKey(name?: string | null, author?: string | null): string | null {
  const normalizedName = normalizeAvatarName(name);
  if (!normalizedName) return null;
  const normalizedAuthor = normalizeAvatarName(author);
  return normalizedAuthor ? `${normalizedName}|${normalizedAuthor}` : normalizedName;
}

function pickHistoryForLogAvatar(
  item: SeenLogAvatar,
  byId: Map<string, SeenAvatar>,
  byName: Map<string, SeenAvatar | null>,
): SeenAvatar | null {
  const exactId = logOnlyAvatarKey(item.avatar_name, item.author_name);
  const legacyId = logOnlyAvatarKey(item.avatar_name);
  return (
    byId.get(exactId) ??
    byId.get(legacyId) ??
    (historyNameKey(item.avatar_name, item.author_name)
      ? byName.get(historyNameKey(item.avatar_name, item.author_name)!) ?? undefined
      : undefined) ??
    (historyNameKey(item.avatar_name)
      ? byName.get(historyNameKey(item.avatar_name)!) ?? undefined
      : undefined) ??
    null
  );
}

function compareIsoish(a?: string | null, b?: string | null): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a.localeCompare(b);
}

function buildSeenLogAvatars(events: AvatarSwitchEvent[], historyRows: SeenAvatar[]): SeenLogAvatar[] {
  const byName = new Map<string, SeenLogAvatar>();
  const historyById = new Map<string, SeenAvatar>();
  const historyByName = new Map<string, SeenAvatar | null>();

  for (const row of historyRows) {
    historyById.set(row.avatar_id, row);
    for (const key of [
      historyNameKey(row.avatar_name, row.author_name),
      historyNameKey(row.avatar_name),
    ]) {
      if (!key) continue;
      if (!historyByName.has(key)) {
        historyByName.set(key, row);
      } else if (historyByName.get(key)?.avatar_id !== row.avatar_id) {
        historyByName.set(key, null);
      }
    }
  }

  for (const ev of events) {
    const name = ev.avatar_name?.trim();
    const actor = ev.actor?.trim();
    if (!name || !actor) continue;
    const author = ev.author_name?.trim() || null;

    const itemKey = logOnlyAvatarKey(name, author);
    let item = byName.get(itemKey);
    if (!item) {
      item = {
        local_id: stableSeenKey(itemKey),
        avatar_history_id: itemKey,
        avatar_name: name,
        author_name: author,
        first_seen_at: ev.iso_time,
        last_seen_at: ev.iso_time,
        seen_count: 0,
        wearer_count: 0,
        wearers: [],
      };
      byName.set(itemKey, item);
    }

    item.seen_count += 1;
    if (compareIsoish(ev.iso_time, item.first_seen_at) < 0) item.first_seen_at = ev.iso_time;
    if (compareIsoish(ev.iso_time, item.last_seen_at) > 0) item.last_seen_at = ev.iso_time;

    let wearer = item.wearers.find((w) => w.displayName === actor);
    if (!wearer) {
      wearer = {
        displayName: actor,
        userId: ev.actor_user_id,
        firstSeenAt: ev.iso_time,
        lastSeenAt: ev.iso_time,
        seenCount: 0,
        worldId: ev.world_id,
        instanceId: ev.instance_id,
      };
      item.wearers.push(wearer);
    }
    wearer.seenCount += 1;
    if (ev.actor_user_id && !wearer.userId) wearer.userId = ev.actor_user_id;
    if (compareIsoish(ev.iso_time, wearer.firstSeenAt) < 0) wearer.firstSeenAt = ev.iso_time;
    if (compareIsoish(ev.iso_time, wearer.lastSeenAt) > 0) {
      wearer.lastSeenAt = ev.iso_time;
      wearer.worldId = ev.world_id;
      wearer.instanceId = ev.instance_id;
    }
  }

  return [...byName.values()]
    .map((item) => {
      const history = pickHistoryForLogAvatar(item, historyById, historyByName);
      const resolvedAvatarId = history?.resolved_avatar_id?.startsWith("avtr_")
        ? history.resolved_avatar_id
        : history?.avatar_id?.startsWith("avtr_")
          ? history.avatar_id
          : null;
      return {
        ...item,
        avatar_id: resolvedAvatarId,
        avatar_history_id: history?.avatar_id ?? item.avatar_history_id,
        author_name: item.author_name ?? history?.author_name ?? null,
        resolved_avatar_id: resolvedAvatarId,
        resolved_thumbnail_url: history?.resolved_thumbnail_url ?? null,
        resolved_image_url: history?.resolved_image_url ?? null,
        resolution_source: history?.resolution_source ?? null,
        resolution_status: history?.resolution_status ?? null,
        wearer_count: item.wearers.length,
        wearers: item.wearers.sort((a, b) => compareIsoish(b.lastSeenAt, a.lastSeenAt)),
      };
    })
    .sort((a, b) => compareIsoish(b.last_seen_at, a.last_seen_at));
}

export default function AvatarBenchmark() {
  const { t } = useTranslation();
  const { report } = useReport();
  const [tab, setTab] = useState<TabKey>("benchmark");
  const [seenPage, setSeenPage] = useState(1);

  const avatars = useMemo(() => {
    if (!report) return [];
    const items = report.local_avatar_data?.recent_items ?? [];
    return (items as AvatarItem[])
      .filter((a) => a.parameter_count > 0)
      .sort((a, b) => b.parameter_count - a.parameter_count);
  }, [report]);

  const maxParams = useMemo(() => Math.max(1, ...avatars.map((a) => a.parameter_count)), [avatars]);

  const histogram = useMemo(() => {
    const h = { S: 0, A: 0, B: 0, C: 0, D: 0 };
    for (const a of avatars) {
      const { tier } = perfRank(a.parameter_count);
      h[tier as keyof typeof h] += 1;
    }
    return h;
  }, [avatars]);

  const seenCountQuery = useQuery({
    queryKey: ["db.avatarHistory.count"],
    queryFn: () => ipc.dbAvatarHistoryCount(),
    staleTime: 10_000,
    refetchOnMount: "always",
  });
  const totalSeen = seenCountQuery.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalSeen / SEEN_PAGE_SIZE));
  const currentPage = Math.min(seenPage, totalPages);
  const offset = (currentPage - 1) * SEEN_PAGE_SIZE;

  const seenQuery = useQuery({
    queryKey: ["db.avatarHistory.list", SEEN_PAGE_SIZE, offset],
    queryFn: () => ipc.dbAvatarHistory(SEEN_PAGE_SIZE, offset),
    staleTime: 10_000,
    refetchOnMount: "always",
    placeholderData: (prev) => prev,
  });
  const seenAvatars = useMemo(
    () => (seenQuery.data?.items ?? []) as SeenAvatar[],
    [seenQuery.data?.items],
  );
  const seenLogAvatars = useMemo(
    () => buildSeenLogAvatars(report?.logs?.avatar_switches ?? [], seenAvatars),
    [report, seenAvatars],
  );
  const effectiveSeenTotal = seenLogAvatars.length || totalSeen;

  useEffect(() => {
    const ids = [
      ...seenLogAvatars
        .map((a) => a.resolved_avatar_id ?? a.avatar_id)
        .filter((id): id is string => Boolean(id?.startsWith("avtr_"))),
      ...seenAvatars
        .map((a) => a.resolved_avatar_id ?? a.avatar_id)
        .filter((id): id is string => Boolean(id?.startsWith("avtr_"))),
    ];
    if (ids.length > 0) prefetchThumbnails([...new Set(ids)]);
  }, [seenLogAvatars, seenAvatars]);

  return (
    <div className="flex flex-col gap-4 animate-fade-in max-w-5xl mx-auto w-full">
      <header className="flex items-center gap-2">
        <Gauge className="size-4" />
        <span className="text-[11px] uppercase tracking-[0.08em] font-semibold">
          {t("benchmark.title", { defaultValue: "Avatar Performance Benchmark" })}
        </span>
      </header>

      <div className="flex gap-2">
        <Button
          variant={tab === "benchmark" ? "default" : "outline"}
          size="sm"
          className="gap-1.5 text-[11px]"
          onClick={() => setTab("benchmark")}
        >
          <Gauge className="size-3" />
          {t("benchmark.myAvatars", { defaultValue: "My Avatars" })}
          <Badge variant="secondary" className="ml-1">{avatars.length}</Badge>
        </Button>
        <Button
          variant={tab === "seen" ? "default" : "outline"}
          size="sm"
          className="gap-1.5 text-[11px]"
          onClick={() => setTab("seen")}
        >
          <Eye className="size-3" />
          {t("benchmark.seenAvatars", { defaultValue: "Seen Avatars" })}
          {effectiveSeenTotal > 0 && <Badge variant="secondary" className="ml-1">{effectiveSeenTotal}</Badge>}
        </Button>
      </div>

      {tab === "benchmark" && (
        <>
          <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
            {t("benchmark.desc", {
              defaultValue: "Estimates VRChat performance rank based on synced parameter count from LocalAvatarData. Lower parameter count = better network performance.",
            })}
          </p>

          <div className="grid gap-3 md:grid-cols-5">
            {(["S", "A", "B", "C", "D"] as const).map((tier) => {
              const r = perfRank(tier === "S" ? 1 : tier === "A" ? 10 : tier === "B" ? 20 : tier === "C" ? 40 : 80);
              const total = avatars.length || 1;
              const pct = Math.round((histogram[tier] / total) * 100);
              return (
                <Card key={tier} className="unity-panel">
                  <CardContent className="p-3 text-center">
                    <div className={`text-[20px] font-bold ${r.color}`}>{tier}</div>
                    <div className="text-[10px] text-[hsl(var(--muted-foreground))]">{t(r.labelKey, { defaultValue: r.labelFallback })}</div>
                    <div className="text-[16px] font-semibold mt-1">{histogram[tier]}</div>
                    <div className="mt-1.5 h-1 rounded-full bg-[hsl(var(--muted)/0.3)] overflow-hidden">
                      <div className={`h-full rounded-full ${r.bg} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-[9px] text-[hsl(var(--muted-foreground))] mt-0.5">{pct}%</div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="unity-panel">
            <CardHeader className="pb-2">
              <CardTitle className="text-[12px] font-mono uppercase tracking-wider">
                {t("benchmark.breakdown", { defaultValue: "Avatar Breakdown" })}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-0.5 max-h-[500px] overflow-y-auto">
              {avatars.length === 0 && (
                <div className="py-8 text-center">
                  <Gauge className="size-8 mx-auto mb-2 text-[hsl(var(--muted-foreground)/0.3)]" />
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                    {t("benchmark.empty", { defaultValue: "No avatar parameter data found. Run a cache scan from Dashboard first, then revisit this page." })}
                  </p>
                </div>
              )}
              {avatars.map((a) => (
                <MyAvatarRow
                  key={a.avatar_id}
                  avatar={a}
                  maxParams={maxParams}
                />
              ))}
            </CardContent>
          </Card>
        </>
      )}

      {tab === "seen" && (
        <Card className="unity-panel">
          <CardHeader className="pb-2">
            <CardTitle className="text-[12px] font-mono uppercase tracking-wider flex items-center gap-2">
              <Eye className="size-3" />
              {t("benchmark.seenTitle", { defaultValue: "Avatars Seen on Others" })}
              <Badge variant="secondary">{effectiveSeenTotal}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 max-h-[640px] overflow-y-auto">
            {seenLogAvatars.length > 0 && (
              <div className="mb-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2 text-[11px] text-[hsl(var(--muted-foreground))]">
                {t("benchmark.localEncounterIndexHint", {
                  defaultValue: "Built from local VRChat logs. VRCSM now resolves thumbnails from saved matches, exact public search, and real avatar ids when available; ambiguous private rows keep the stable placeholder.",
                })}
              </div>
            )}
            {seenLogAvatars.length === 0 && seenQuery.isPending && seenAvatars.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-8 text-[11px] text-[hsl(var(--muted-foreground))]">
                <Loader2 className="size-3.5 animate-spin" />
                <span>{t("common.loading")}</span>
              </div>
            )}
            {seenLogAvatars.length === 0 && !seenQuery.isPending && totalSeen === 0 && (
              <div className="py-8 text-center">
                <Eye className="size-8 mx-auto mb-2 text-[hsl(var(--muted-foreground)/0.3)]" />
                <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                  {t("benchmark.noSeen", { defaultValue: "No avatars recorded yet. VRCSM records avatars seen on other players from VRChat logs and friend activity." })}
                </p>
              </div>
            )}
            {seenLogAvatars.length > 0
              ? seenLogAvatars.map((a) => (
                  <SeenLogAvatarRow key={a.local_id} a={a} />
                ))
              : seenAvatars.map((a) => (
                  <SeenAvatarRow key={a.avatar_id} a={a} />
                ))}
          </CardContent>
          {seenLogAvatars.length === 0 && totalPages > 1 && (
            <div className="border-t border-[hsl(var(--border))] px-3 py-2">
              <Pagination
                page={currentPage}
                totalPages={totalPages}
                onPageChange={setSeenPage}
              />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function MyAvatarRow({
  avatar: a,
  maxParams,
}: {
  avatar: AvatarItem;
  maxParams: number;
}) {
  const r = perfRank(a.parameter_count);
  const { t } = useTranslation();
  const barPct = Math.min(100, Math.round((a.parameter_count / maxParams) * 100));

  const hasRealId = a.avatar_id.startsWith("avtr_");
  const { url: thumbUrl } = useThumbnail(hasRealId ? a.avatar_id : null);
  const needsName = hasRealId && !a.display_name;
  const detailsQuery = useQuery({
    queryKey: ["avatar.details", a.avatar_id],
    queryFn: () =>
      vrcApiThrottle(() =>
        ipc.call<{ id: string }, { details: AvatarDetails | null }>("avatar.details", { id: a.avatar_id }),
      ),
    enabled: needsName,
    staleTime: 60 * 60_000,
    retry: 0,
  });
  const apiName = detailsQuery.data?.details?.name;
  const displayName = a.display_name || apiName || a.avatar_id;

  return (
    <div className="flex items-center gap-2 text-[11px] py-1.5 border-b border-[hsl(var(--border)/0.3)]">
      <Badge variant="outline" className={`w-8 justify-center text-[9px] ${r.color} shrink-0`}>
        {r.tier}
      </Badge>
      {thumbUrl ? (
        <ImageZoom src={thumbUrl} alt={displayName} className="size-8 shrink-0">
          <ThumbImage
            src={thumbUrl}
            seedKey={a.avatar_id}
            label={displayName}
            className="size-8 shrink-0 cursor-zoom-in"
            aspect=""
          />
        </ImageZoom>
      ) : (
        <ThumbImage
          src={thumbUrl ?? undefined}
          seedKey={a.avatar_id}
          label={displayName}
          className="size-8 shrink-0"
          aspect=""
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium font-mono text-[10.5px]">{displayName}</span>
        </div>
        <div className="mt-0.5 h-1 rounded-full bg-[hsl(var(--muted)/0.2)] overflow-hidden">
          <div className={`h-full rounded-full ${r.bg} opacity-60`} style={{ width: `${barPct}%` }} />
        </div>
      </div>
      <span className="text-[hsl(var(--muted-foreground))] font-mono shrink-0">{a.parameter_count}p</span>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(a.avatar_id);
          toast.success(t("common.copied", { defaultValue: "Avatar ID 已复制" }));
        }}
        className="shrink-0 p-1 rounded hover:bg-[hsl(var(--muted)/0.3)] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
        title={t("benchmark.copyId", { defaultValue: "复制 Avatar ID" })}
      >
        <Copy className="size-3" />
      </button>
      {a.parameter_count > 64 ? (
        <AlertTriangle className="size-3 text-red-400 shrink-0" />
      ) : a.parameter_count <= 16 ? (
        <CheckCircle2 className="size-3 text-emerald-400 shrink-0" />
      ) : (
        <Info className="size-3 text-[hsl(var(--muted-foreground))] shrink-0" />
      )}
    </div>
  );
}

// Per-row enrichment — for public avatars missing name/thumbnail/author,
// hit `/avatars/{id}` once and cache for an hour. React Query dedupes,
// so re-renders are free. Private avatars short-circuit (VRChat 401s them
// for anyone other than the owner), so we only fire for release=public.
function SeenAvatarRow({ a }: { a: SeenAvatar }) {
  const { t } = useTranslation();
  const isPublic = a.release_status === "public";
  const hasRealId = a.avatar_id.startsWith("avtr_");
  const isUnknown = !hasRealId;
  const isPrivate = hasRealId && a.release_status && a.release_status !== "public";

  const needsEnrich = hasRealId && isPublic && (!a.avatar_name || !a.author_name);
  const detailsQuery = useQuery({
    queryKey: ["avatar.details", a.avatar_id],
    queryFn: () =>
      vrcApiThrottle(() =>
        ipc.call<{ id: string }, { details: AvatarDetails | null }>("avatar.details", { id: a.avatar_id }),
      ),
    enabled: needsEnrich,
    staleTime: 60 * 60_000,
    retry: 0,
  });
  const details = detailsQuery.data?.details ?? null;
  const { url: cachedThumb } = useThumbnail(hasRealId ? a.avatar_id : null);

  const displayName = a.avatar_name || details?.name || a.avatar_id;
  const authorName = a.author_name || details?.authorName;
  const thumbUrl = cachedThumb || details?.thumbnailImageUrl || details?.imageUrl;

  return (
    <div className="flex items-center gap-2.5 text-[11px] py-1.5 border-b border-[hsl(var(--border)/0.3)]">
      {thumbUrl ? (
        <ImageZoom src={thumbUrl} alt={displayName} className="size-10 shrink-0">
          <ThumbImage
            src={thumbUrl}
            seedKey={a.avatar_id}
            label={a.avatar_name ?? a.avatar_id}
            className="size-10 shrink-0 cursor-zoom-in"
            aspect=""
          />
        </ImageZoom>
      ) : (
        <ThumbImage
          src={thumbUrl}
          seedKey={a.avatar_id}
          label={a.avatar_name ?? a.avatar_id}
          className="size-10 shrink-0"
          aspect=""
        />
      )}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="font-medium truncate">{displayName}</span>
          {isPublic && (
            <Badge variant="default" className="h-4 text-[9px] bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
              {t("benchmark.public", { defaultValue: "Public" })}
            </Badge>
          )}
          {isPrivate && (
            <Badge variant="outline" className="h-4 text-[9px] gap-0.5">
              <Lock className="size-2" />
              {t("benchmark.private", { defaultValue: "Private" })}
            </Badge>
          )}
          {isUnknown && (
            <Badge variant="outline" className="h-4 text-[9px] text-[hsl(var(--muted-foreground))]">
              {t("benchmark.logOnly", { defaultValue: "Log only" })}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[hsl(var(--muted-foreground))]">
          {authorName && (
            <span className="truncate">
              {t("benchmark.byAuthor", {
                author: authorName,
                defaultValue: "by {{author}}",
              })}
            </span>
          )}
          {a.first_seen_on && (
            <span className="flex items-center gap-1">
              <span>·</span>
              <span>{t("benchmark.wornBy", { defaultValue: "worn by" })}</span>
              {a.first_seen_user_id?.startsWith("usr_") ? (
                <UserPopupBadge
                  userId={a.first_seen_user_id}
                  displayName={a.first_seen_on}
                />
              ) : (
                <span>{a.first_seen_on}</span>
              )}
            </span>
          )}
          {a.first_seen_at && (
            <span className="flex items-center gap-0.5">
              <Clock className="size-2.5" />
              {new Date(a.first_seen_at).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>
      {hasRealId && isPublic && (
        <>
          <SmartWearButton avatarId={a.avatar_id} avatarName={displayName} variant="compact" />
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px] gap-1"
            onClick={() => {
              void navigator.clipboard.writeText(a.avatar_id);
              toast.success(t("common.copied", { defaultValue: "Copied" }));
            }}
          >
            <Copy className="size-2.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px]"
            onClick={() => {
              void navigator.clipboard.writeText(`https://vrchat.com/home/avatar/${a.avatar_id}`);
              toast.success(t("common.copied", { defaultValue: "Copied" }));
            }}
          >
            {t("common.copy", { defaultValue: "Copy" })}
          </Button>
        </>
      )}
    </div>
  );
}

function SeenLogAvatarRow({ a }: { a: SeenLogAvatar }) {
  const { t } = useTranslation();
  const { status: authStatus } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const primaryWearer = a.wearers[0];
  const rowAvatarId = a.resolved_avatar_id?.startsWith("avtr_")
    ? a.resolved_avatar_id
    : a.avatar_id?.startsWith("avtr_")
      ? a.avatar_id
      : null;
  const { url: cachedThumb } = useThumbnail(rowAvatarId);

  // Tier 1: public-search match by avatar name (+author when available).
  // Persists a real avtr_ id on success so the second visit is instant.
  const resolveQuery = useQuery({
    queryKey: ["benchmark.seen.resolveThumb", a.avatar_history_id, a.avatar_name, a.author_name],
    queryFn: async () => {
      const res = await vrcApiThrottle(() => ipc.searchAvatars(a.avatar_name, 12));
      const candidates = (res.avatars ?? []).filter((avatar: AvatarSearchResult) =>
        isSameAvatarName(avatar.name, a.avatar_name),
      );
      const authorMatched = a.author_name
        ? candidates.find((avatar) => isSameAvatarName(avatar.authorName, a.author_name))
        : undefined;
      const uniqueNameMatched = !a.author_name && candidates.length === 1 ? candidates[0] : undefined;
      const match = authorMatched ?? uniqueNameMatched;
      const url = match?.thumbnailImageUrl || match?.imageUrl || null;
      if (!match?.id?.startsWith("avtr_") || !url) {
        return null;
      }
      await ipc.dbAvatarHistoryResolve({
        avatar_id: a.avatar_history_id,
        resolved_avatar_id: match.id,
        resolved_thumbnail_url: match.thumbnailImageUrl || url,
        resolved_image_url: match.imageUrl || url,
        resolution_source: a.author_name ? "benchmark_public_search_exact" : "benchmark_public_search_name_unique",
        resolution_status: "resolved",
      }).catch(() => {});
      prefetchThumbnails([match.id]);
      return {
        avatarId: match.id,
        url,
      };
    },
    enabled:
      authStatus.authed &&
      !rowAvatarId &&
      !a.resolved_thumbnail_url &&
      a.resolution_status !== "miss",
    staleTime: 60 * 60_000,
    retry: 0,
  });
  const searchAvatarId = resolveQuery.data?.avatarId ?? null;
  const { url: searchCachedThumb } = useThumbnail(searchAvatarId);

  // Tier 2: wearer-profile fallback. The image is the wearer's *current*
  // avatar/profile picture, NOT a verified historical match — that's why
  // we surface it with a "REF" badge below. Cached in localStorage so a
  // page revisit is instant; the cache TTL drops stale wearer-current
  // images on its own (24h).
  const wearerCacheKey = useMemo(() => {
    const wearerKey = primaryWearer?.userId?.startsWith("usr_")
      ? primaryWearer.userId
      : primaryWearer?.displayName ?? "";
    return `${a.avatar_history_id}|${wearerKey}`;
  }, [a.avatar_history_id, primaryWearer?.userId, primaryWearer?.displayName]);
  const cachedWearerRef = useMemo(() => readWearerReference(wearerCacheKey), [wearerCacheKey]);
  // Fire the wearer query in parallel with the public-search resolveQuery
  // rather than serially. The two are independent — one searches by avatar
  // name, the other walks the wearer's profile — and the throttle pool
  // already serialises them inside the IPC layer. Gating wearerQuery on
  // resolveQuery.isFetched left it disabled forever in practice when the
  // resolveQuery never settled (cache cold + slow API).
  const wearerEnabled =
    authStatus.authed
    && !rowAvatarId
    && !a.resolved_thumbnail_url
    && a.resolution_status !== "miss"
    && cachedWearerRef?.status !== "miss"
    && Boolean(primaryWearer?.userId?.startsWith("usr_") || primaryWearer?.displayName);

  const wearerQuery = useQuery<WearerReference | null>({
    queryKey: ["benchmark.seen.wearerRef", wearerCacheKey],
    // initialData stays out of the options entirely when there's no cache
    // hit. Passing `initialData: undefined` makes React Query mark the
    // query as already-settled with `data: undefined`, which permanently
    // suppresses the fetch — the very bug we hit here.
    ...(cachedWearerRef ? { initialData: cachedWearerRef } : {}),
    queryFn: async () => {
      let userId = primaryWearer?.userId?.startsWith("usr_")
        ? (primaryWearer.userId as string)
        : null;
      let resolvedDisplayName = primaryWearer?.displayName ?? null;

      // Resolve the wearer to a usr_ id if we only have their display name.
      if (!userId && primaryWearer?.displayName) {
        const search = await vrcApiThrottle(() =>
          ipc.searchUsers(primaryWearer.displayName, 6),
        );
        const exact = (search.users ?? []).find(
          (u: UserSearchResult) =>
            u.id?.startsWith("usr_") && isSameAvatarName(u.displayName, primaryWearer.displayName),
        );
        if (exact) {
          userId = exact.id;
          resolvedDisplayName = exact.displayName;
        }
      }

      if (!userId) {
        const miss: WearerReference = { status: "miss" };
        saveWearerReference(wearerCacheKey, miss);
        return miss;
      }

      const profileRes = await vrcApiThrottle(() =>
        ipc.call<{ userId: string }, { profile: VrcUserProfile | null }>(
          "user.getProfile",
          { userId: userId as string },
        ),
      );
      const profile = profileRes.profile;
      const url = pickProfileImage(profile);
      if (!url) {
        const miss: WearerReference = {
          status: "miss",
          userId: userId,
          displayName: resolvedDisplayName ?? undefined,
        };
        saveWearerReference(wearerCacheKey, miss);
        return miss;
      }

      const verifiedForAvatarName = isSameAvatarName(profile?.currentAvatarName, a.avatar_name)
        ? a.avatar_name
        : undefined;

      const baseRef: WearerReference = {
        status: "resolved",
        url,
        userId: userId as string,
        displayName: profile?.displayName ?? resolvedDisplayName ?? undefined,
        avatarName: profile?.currentAvatarName ?? undefined,
        avatarId: profile?.currentAvatarId?.startsWith("avtr_")
          ? profile.currentAvatarId
          : undefined,
        verifiedForAvatarName,
      };
      // Send the URL through the host image cache so the <img> tag has a
      // same-origin local URL it can render. Cross-origin VRChat CDN URLs
      // would otherwise 401 in the browser (no auth cookies forwarded).
      const ref = await attachLocalUrl(wearerCacheKey, baseRef);
      saveWearerReference(wearerCacheKey, ref);

      // If the wearer's current avatar happens to match the logged name,
      // promote the resolution to the DB so future sessions see a verified
      // thumbnail without re-walking the wearer profile.
      if (verifiedForAvatarName && ref.avatarId) {
        await ipc
          .dbAvatarHistoryResolve({
            avatar_id: a.avatar_history_id,
            resolved_avatar_id: ref.avatarId,
            resolved_thumbnail_url: ref.url,
            resolved_image_url: ref.url,
            resolution_source: "benchmark_wearer_profile_verified",
            resolution_status: "resolved",
          })
          .catch(() => {});
        if (ref.avatarId) prefetchThumbnails([ref.avatarId]);
      }

      return ref;
    },
    enabled: wearerEnabled,
    staleTime: 60 * 60_000,
    retry: 0,
  });

  // Backfill state for entries cached before we started downloading the
  // image to a local proxy. Once attachLocalUrl resolves, we re-render
  // with the local URL so the <img> can actually load.
  const [backfilledRef, setBackfilledRef] = useState<WearerReference | null>(null);
  const liveRef = wearerQuery.data ?? cachedWearerRef ?? null;
  const wearerRef = backfilledRef ?? liveRef;

  useEffect(() => {
    if (!liveRef || liveRef.status !== "resolved") return;
    if (liveRef.localUrl) return;
    if (!liveRef.url) return;
    let cancelled = false;
    void attachLocalUrl(wearerCacheKey, liveRef).then((next) => {
      if (cancelled) return;
      if (next.localUrl && next.localUrl !== liveRef.localUrl) {
        saveWearerReference(wearerCacheKey, next);
        setBackfilledRef(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [liveRef, wearerCacheKey]);

  const wearerRefUrl = wearerRef?.status === "resolved" ? wearerRef.localUrl ?? wearerRef.url : undefined;
  const wearerCurrentAvatarMatches =
    wearerRef?.status === "resolved"
    && Boolean(wearerRef.verifiedForAvatarName)
    && isSameAvatarName(wearerRef.verifiedForAvatarName, a.avatar_name);

  // Persist DB miss when both tiers settle empty so the next session
  // skips both queries entirely. Once-per-mount via ref guard.
  const persistedMissRef = useRef(false);
  useEffect(() => {
    if (persistedMissRef.current) return;
    if (a.resolution_status === "miss") return;
    if (rowAvatarId || a.resolved_thumbnail_url) return;
    if (!resolveQuery.isFetched) return;
    if (resolveQuery.data?.url) return;
    if (wearerEnabled && !wearerQuery.isFetched) return;
    if (wearerRefUrl) return;
    persistedMissRef.current = true;
    ipc
      .dbAvatarHistoryResolve({
        avatar_id: a.avatar_history_id,
        resolved_avatar_id: null,
        resolved_thumbnail_url: null,
        resolved_image_url: null,
        resolution_source: "benchmark_search_and_wearer_miss",
        resolution_status: "miss",
      })
      .catch(() => {});
  }, [
    a.avatar_history_id,
    a.resolution_status,
    a.resolved_thumbnail_url,
    rowAvatarId,
    resolveQuery.isFetched,
    resolveQuery.data,
    wearerEnabled,
    wearerQuery.isFetched,
    wearerRefUrl,
  ]);

  const thumbUrl =
    cachedThumb ??
    a.resolved_thumbnail_url ??
    a.resolved_image_url ??
    searchCachedThumb ??
    resolveQuery.data?.url ??
    wearerRefUrl ??
    null;
  const isReference = Boolean(
    wearerRefUrl
    && !cachedThumb
    && !a.resolved_thumbnail_url
    && !a.resolved_image_url
    && !searchCachedThumb
    && !resolveQuery.data?.url,
  );

  return (
    <div className="flex flex-col gap-2 border-b border-[hsl(var(--border)/0.35)] py-2">
      <div className="flex items-center gap-2.5 text-[11px]">
        {thumbUrl ? (
          <ImageZoom src={thumbUrl} alt={a.avatar_name} className="size-10 shrink-0">
            <ThumbImage
              src={thumbUrl}
              seedKey={a.local_id}
              label={a.avatar_name}
              className="size-10 shrink-0 cursor-zoom-in"
              aspect=""
            />
          </ImageZoom>
        ) : (
          <ThumbImage
            src={thumbUrl}
            seedKey={a.local_id}
            label={a.avatar_name}
            className="size-10 shrink-0"
            aspect=""
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="font-medium truncate">{a.avatar_name}</span>
            {isReference ? (
              <Badge
                variant="outline"
                className={
                  wearerCurrentAvatarMatches
                    ? "h-4 text-[9px] gap-0.5 border-emerald-500/40 text-emerald-400"
                    : "h-4 text-[9px] gap-0.5 border-amber-500/40 text-amber-400"
                }
                title={t("benchmark.referenceImageHint", {
                  defaultValue: "Wearer's current avatar/profile image — not a verified historical match.",
                })}
              >
                {wearerCurrentAvatarMatches
                  ? t("benchmark.referenceImageVerified", { defaultValue: "REF · matched" })
                  : t("benchmark.referenceImage", { defaultValue: "REF" })}
              </Badge>
            ) : (
              <Badge variant="outline" className="h-4 text-[9px] text-[hsl(var(--muted-foreground))]">
                {thumbUrl
                  ? t("benchmark.thumbnailResolved", { defaultValue: "Thumbnail" })
                  : t("benchmark.logOnly", { defaultValue: "Log only" })}
              </Badge>
            )}
            <Badge variant="secondary" className="h-4 text-[9px]">
              {t("benchmark.wearerCount", {
                count: a.wearer_count,
                defaultValue: "{{count}} wearer",
              })}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-[hsl(var(--muted-foreground))]">
            {primaryWearer && (
              <span className="flex items-center gap-1">
                <span>{t("benchmark.wornBy", { defaultValue: "worn by" })}</span>
                {primaryWearer.userId?.startsWith("usr_") ? (
                  <UserPopupBadge
                    userId={primaryWearer.userId}
                    displayName={primaryWearer.displayName}
                  />
                ) : (
                  <span className="font-medium text-[hsl(var(--foreground))]">
                    {primaryWearer.displayName}
                  </span>
                )}
              </span>
            )}
            {a.last_seen_at && (
              <span className="flex items-center gap-0.5">
                <Clock className="size-2.5" />
                {new Date(a.last_seen_at).toLocaleDateString()}
              </span>
            )}
            <span>
              {t("benchmark.seenTimes", {
                count: a.seen_count,
                defaultValue: "seen {{count}} times",
              })}
            </span>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[10px]"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? t("common.collapse", { defaultValue: "Collapse" })
            : t("benchmark.showWearers", { defaultValue: "Wearers" })}
        </Button>
      </div>

      {expanded && (
        <div className="ml-[50px] flex flex-col gap-1 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-2">
          {a.wearers.slice(0, 12).map((w) => (
            <div
              key={`${w.displayName}-${w.lastSeenAt ?? ""}`}
              className="flex min-w-0 flex-wrap items-center gap-2 text-[10.5px]"
            >
              {w.userId?.startsWith("usr_") ? (
                <UserPopupBadge userId={w.userId} displayName={w.displayName} />
              ) : (
                <span className="font-medium text-[hsl(var(--foreground))]">{w.displayName}</span>
              )}
              <span className="text-[hsl(var(--muted-foreground))]">
                {t("benchmark.seenTimes", {
                  count: w.seenCount,
                  defaultValue: "seen {{count}} times",
                })}
              </span>
              {w.lastSeenAt && (
                <span className="font-mono text-[hsl(var(--muted-foreground))]">
                  {new Date(w.lastSeenAt).toLocaleString()}
                </span>
              )}
              {w.worldId && (
                <span className="truncate font-mono text-[hsl(var(--muted-foreground))]">
                  {w.worldId}
                </span>
              )}
            </div>
          ))}
          {a.wearers.length > 12 && (
            <div className="text-[10px] text-[hsl(var(--muted-foreground))]">
              +{a.wearers.length - 12}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (n: number) => void;
}) {
  const { t } = useTranslation();
  const [jumpInput, setJumpInput] = useState("");

  const visible = useMemo(() => {
    const pages = new Set<number>();
    pages.add(1);
    pages.add(totalPages);
    for (let i = -2; i <= 2; i++) {
      const p = page + i;
      if (p >= 1 && p <= totalPages) pages.add(p);
    }
    return [...pages].sort((a, b) => a - b);
  }, [page, totalPages]);

  const go = (n: number) => {
    const clamped = Math.min(totalPages, Math.max(1, n));
    if (clamped !== page) onPageChange(clamped);
  };

  const handleJump = () => {
    const n = parseInt(jumpInput, 10);
    if (Number.isFinite(n)) {
      go(n);
      setJumpInput("");
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-1.5"
          onClick={() => go(1)}
          disabled={page === 1}
          title={t("common.first", { defaultValue: "First" })}
        >
          <ChevronsLeft className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-1.5"
          onClick={() => go(page - 1)}
          disabled={page === 1}
          title={t("common.previous", { defaultValue: "Previous" })}
        >
          <ChevronLeft className="size-3" />
        </Button>
        {visible.map((p, i) => {
          const prev = visible[i - 1];
          const showEllipsis = prev !== undefined && p - prev > 1;
          return (
            <span key={p} className="flex items-center gap-1">
              {showEllipsis && <span className="px-1 text-[hsl(var(--muted-foreground))]">…</span>}
              <Button
                variant={p === page ? "default" : "ghost"}
                size="sm"
                className="h-7 min-w-[28px] px-2 text-[11px] font-mono"
                onClick={() => go(p)}
              >
                {p}
              </Button>
            </span>
          );
        })}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-1.5"
          onClick={() => go(page + 1)}
          disabled={page === totalPages}
          title={t("common.next", { defaultValue: "Next" })}
        >
          <ChevronRight className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-1.5"
          onClick={() => go(totalPages)}
          disabled={page === totalPages}
          title={t("common.last", { defaultValue: "Last" })}
        >
          <ChevronsRight className="size-3" />
        </Button>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
        <span>{t("common.jumpTo", { defaultValue: "Jump to" })}</span>
        <Input
          type="number"
          min={1}
          max={totalPages}
          value={jumpInput}
          onChange={(e) => setJumpInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleJump(); }}
          onBlur={handleJump}
          className="h-7 w-16 text-[11px]"
          placeholder={`${page}`}
        />
        <span>/ {totalPages}</span>
      </div>
    </div>
  );
}
