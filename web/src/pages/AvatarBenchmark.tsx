import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useReport } from "@/lib/report-context";
import { ipc } from "@/lib/ipc";
import { vrcApiThrottle } from "@/lib/api-throttle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThumbImage } from "@/components/ThumbImage";
import { Gauge, AlertTriangle, CheckCircle2, Info, Copy, Clock, Eye, Lock } from "lucide-react";
import { SmartWearButton } from "@/components/SmartWearButton";

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

function perfRank(params: number): { label: string; color: string; bg: string; tier: string } {
  if (params <= 8) return { label: "Excellent", color: "text-emerald-400", bg: "bg-emerald-500", tier: "S" };
  if (params <= 16) return { label: "Good", color: "text-green-400", bg: "bg-green-500", tier: "A" };
  if (params <= 32) return { label: "Medium", color: "text-yellow-400", bg: "bg-yellow-500", tier: "B" };
  if (params <= 64) return { label: "Poor", color: "text-orange-400", bg: "bg-orange-500", tier: "C" };
  return { label: "Very Poor", color: "text-red-400", bg: "bg-red-500", tier: "D" };
}

type TabKey = "benchmark" | "seen";

const SEEN_PAGE_SIZE = 30;

export default function AvatarBenchmark() {
  const { t } = useTranslation();
  const { report } = useReport();
  const [tab, setTab] = useState<TabKey>("benchmark");
  const [seenLimit, setSeenLimit] = useState(SEEN_PAGE_SIZE);

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

  const seenQuery = useQuery({
    queryKey: ["db.avatarHistory.list", 500],
    queryFn: () => ipc.dbAvatarHistory(500, 0),
    staleTime: 5 * 60_000,
    enabled: tab === "seen",
  });
  const seenAvatars = (seenQuery.data?.items ?? []) as SeenAvatar[];
  const visibleSeen = seenAvatars.slice(0, seenLimit);

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
          {seenAvatars.length > 0 && <Badge variant="secondary" className="ml-1">{seenAvatars.length}</Badge>}
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
                    <div className="text-[10px] text-[hsl(var(--muted-foreground))]">{r.label}</div>
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
              {avatars.map((a) => {
                const r = perfRank(a.parameter_count);
                const barPct = Math.min(100, Math.round((a.parameter_count / maxParams) * 100));
                return (
                  <div key={a.avatar_id} className="flex items-center gap-2 text-[11px] py-1.5 border-b border-[hsl(var(--border)/0.3)]">
                    <Badge variant="outline" className={`w-8 justify-center text-[9px] ${r.color} shrink-0`}>
                      {r.tier}
                    </Badge>
                    <ThumbImage
                      seedKey={a.avatar_id}
                      label={a.display_name ?? a.avatar_id}
                      className="size-8 shrink-0"
                      aspect=""
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{a.display_name || a.avatar_id}</span>
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
                        toast.success("Avatar ID copied");
                      }}
                      className="shrink-0 p-1 rounded hover:bg-[hsl(var(--muted)/0.3)] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                      title="Copy avatar ID"
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
              })}
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
              <Badge variant="secondary">{seenAvatars.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 max-h-[640px] overflow-y-auto">
            {seenQuery.isPending && (
              <div className="py-8 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
                {t("common.loading")}
              </div>
            )}
            {!seenQuery.isPending && seenAvatars.length === 0 && (
              <div className="py-8 text-center">
                <Eye className="size-8 mx-auto mb-2 text-[hsl(var(--muted-foreground)/0.3)]" />
                <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                  {t("benchmark.noSeen", { defaultValue: "No avatars recorded yet. VRCSM records avatars seen on other players from VRChat logs and friend activity." })}
                </p>
              </div>
            )}
            {visibleSeen.map((a) => (
              <SeenAvatarRow key={a.avatar_id} a={a} />
            ))}
            {seenLimit < seenAvatars.length && (
              <div className="flex justify-center pt-2 pb-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => setSeenLimit((n) => n + SEEN_PAGE_SIZE)}
                >
                  {t("common.loadMore", { defaultValue: "Load more" })} ({seenAvatars.length - seenLimit})
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Per-row enrichment — for public avatars missing name/thumbnail/author,
// hit `/avatars/{id}` once and cache for an hour. React Query dedupes,
// so re-renders are free. Private avatars short-circuit (VRChat 401s them
// for anyone other than the owner), so we only fire for release=public.
function SeenAvatarRow({ a }: { a: SeenAvatar }) {
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

  const displayName = a.avatar_name || details?.name || a.avatar_id;
  const authorName = a.author_name || details?.authorName;
  const thumbUrl = details?.thumbnailImageUrl || details?.imageUrl;

  return (
    <div className="flex items-center gap-2.5 text-[11px] py-1.5 border-b border-[hsl(var(--border)/0.3)]">
      <ThumbImage
        src={thumbUrl}
        seedKey={a.avatar_id}
        label={a.avatar_name ?? a.avatar_id}
        className="size-10 shrink-0"
        aspect=""
      />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="font-medium truncate">{displayName}</span>
          {isPublic && <Badge variant="default" className="h-4 text-[9px] bg-emerald-500/20 text-emerald-400 border-emerald-500/30">PUBLIC</Badge>}
          {isPrivate && <Badge variant="outline" className="h-4 text-[9px] gap-0.5"><Lock className="size-2" />PRIVATE</Badge>}
          {isUnknown && <Badge variant="outline" className="h-4 text-[9px] text-[hsl(var(--muted-foreground))]">LOG-ONLY</Badge>}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[hsl(var(--muted-foreground))]">
          {authorName && <span className="truncate">by {authorName}</span>}
          {a.first_seen_on && <span>· worn by {a.first_seen_on}</span>}
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
              toast.success("Avatar ID copied");
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
              toast.success("Avatar link copied");
            }}
          >
            Link
          </Button>
        </>
      )}
    </div>
  );
}
