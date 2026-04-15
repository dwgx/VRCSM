import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useReport } from "@/lib/report-context";
import { formatBytes, formatDate } from "@/lib/utils";
import { Wrench } from "lucide-react";
import { AlertTriangle, Database, FolderTree, ScrollText } from "lucide-react";

// Unity editor-ish categorical palette — muted, no purple, no neon glow.
// Ordered so the first few slots read as distinct tonal blocks against
// the --surface-raised backdrop rather than fighting for attention.
const palette = [
  "#3B8FD6", // unity blue (primary)
  "#6FB35C", // unity green
  "#D99447", // amber
  "#C25B5B", // brick red
  "#4EA5A5", // teal
  "#8F8F8F", // neutral grey
  "#B8A04D", // olive
  "#6C7EC4", // steel blue
];

interface StatCardProps {
  title: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  tone?: "default" | "warning" | "success";
}

function StatCard({ title, value, hint, icon, tone = "default" }: StatCardProps) {
  const toneRing =
    tone === "warning"
      ? "shadow-[inset_0_0_0_1px_hsl(var(--warning)/0.45)]"
      : tone === "success"
        ? "shadow-[inset_0_0_0_1px_hsl(var(--success)/0.35)]"
        : "";
  const iconBg =
    tone === "warning"
      ? "bg-[hsl(var(--warning)/0.14)] text-[hsl(var(--warning))]"
      : tone === "success"
        ? "bg-[hsl(var(--success)/0.14)] text-[hsl(var(--success))]"
        : "bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]";
  return (
    <Card className={`${toneRing} p-0`}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 p-3 pb-2">
        <div className="flex min-w-0 flex-col gap-1">
          <CardDescription className="text-[10px] uppercase tracking-wider">
            {title}
          </CardDescription>
          <div className="text-[22px] font-semibold leading-none tracking-tight tabular-nums">
            {value}
          </div>
        </div>
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] ${iconBg}`}
        >
          {icon}
        </div>
      </CardHeader>
      {hint ? (
        <CardContent className="px-3 pt-0 pb-2 text-[11px] text-[hsl(var(--muted-foreground))]">
          {hint}
        </CardContent>
      ) : null}
    </Card>
  );
}

function SkeletonCard() {
  return (
    <Card>
      <CardHeader>
        <div className="h-3 w-24 animate-pulse rounded bg-[hsl(var(--muted))]" />
        <div className="mt-2 h-8 w-32 animate-pulse rounded bg-[hsl(var(--muted))]" />
      </CardHeader>
    </Card>
  );
}

function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { report, loading, error, refresh } = useReport();
  const load = refresh;

  // "Repair" is just a shortcut to the Migrate wizard with the category
  // preselected — recreating a dangling junction needs a fresh target
  // path from the user, which that wizard already handles.
  const repairJunction = (category: string) => {
    navigate(`/migrate?category=${encodeURIComponent(category)}`);
  };

  if (loading && !report) {
    return (
      <div className="grid gap-3">
        <div className="flex items-center gap-2 text-[13px] font-semibold tracking-tight">
          {t("dashboard.title")}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.scanFailed")}</CardTitle>
          <CardDescription>{error ?? t("common.unknownError")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={load}>{t("common.retry")}</Button>
        </CardContent>
      </Card>
    );
  }

  // Sorted + filtered slice data for the storage card. The pie chart was
  // replaced with a segmented horizontal bar + ranked list — pies with
  // 5-8 slices are hard to read at a glance and don't scale when a
  // category has near-zero bytes.
  const ranked = report.category_summaries
    .filter((c) => c.bytes > 0)
    .map((c) => ({ name: c.name, value: c.bytes }))
    .sort((a, b) => b.value - a.value);
  const rankedTotal = ranked.reduce((sum, c) => sum + c.value, 0);

  const top = report.cache_windows_player.largest_entries.slice(0, 8);

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold tracking-tight text-[hsl(var(--foreground))]">
              {t("dashboard.title")}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              overview
            </span>
          </div>
          <p className="truncate font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
            {report.base_dir}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          {t("common.rescan")}
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t("dashboard.totalCache")}
          value={report.total_bytes_human}
          hint={t("dashboard.totalCacheHint", {
            count: report.existing_category_count,
          })}
          icon={<Database className="size-5" />}
        />
        <StatCard
          title={t("dashboard.categories")}
          value={String(report.category_summaries.length)}
          hint={t("dashboard.categoriesHint", {
            count: report.existing_category_count,
          })}
          icon={<FolderTree className="size-5" />}
        />
        <StatCard
          title={t("dashboard.brokenJunctions")}
          value={String(report.broken_links.length)}
          hint={
            report.broken_links.length > 0
              ? t("dashboard.brokenJunctionsNeeded")
              : t("dashboard.brokenJunctionsClear")
          }
          icon={<AlertTriangle className="size-5" />}
          tone={report.broken_links.length > 0 ? "warning" : "success"}
        />
        <StatCard
          title={t("dashboard.logs")}
          value={String(report.logs.log_count)}
          hint={t("dashboard.logsHint", {
            count: report.logs.world_event_count,
          })}
          icon={<ScrollText className="size-5" />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.storageByCategory")}</CardTitle>
            <CardDescription>
              {t("dashboard.storageByCategoryDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            {/*
              Stacked horizontal bar. Each segment's width is proportional
              to that category's byte total. Hover shows the exact figure
              — no chart library, just divs.
            */}
            <div className="flex h-2.5 w-full overflow-hidden rounded-[var(--radius-sm)] bg-[hsl(var(--canvas))] shadow-[inset_0_0_0_1px_hsl(var(--border))]">
              {ranked.length === 0 ? (
                <div className="h-full w-full bg-[hsl(var(--muted))]" />
              ) : (
                ranked.map((c, idx) => (
                  <div
                    key={c.name}
                    className="h-full transition-[width] duration-300 ease-out"
                    style={{
                      width: `${(c.value / rankedTotal) * 100}%`,
                      background: palette[idx % palette.length],
                    }}
                    title={`${c.name}: ${formatBytes(c.value)}`}
                  />
                ))
              )}
            </div>
            {/*
              Ranked table — name, %, bytes — tabular-nums keeps the
              right-aligned columns locked even as values change between
              scans.
            */}
            <div className="flex flex-col divide-y divide-[hsl(var(--border)/0.6)]">
              {ranked.map((c, idx) => {
                const pct = (c.value / rankedTotal) * 100;
                return (
                  <div
                    key={c.name}
                    className="flex items-center gap-3 py-1.5"
                  >
                    <span
                      className="size-2 shrink-0 rounded-sm"
                      style={{
                        background: palette[idx % palette.length],
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[hsl(var(--foreground))]">
                      {c.name}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-[hsl(var(--muted-foreground))]">
                      {pct.toFixed(1)}%
                    </span>
                    <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-[hsl(var(--foreground))]">
                      {formatBytes(c.value)}
                    </span>
                  </div>
                );
              })}
              {ranked.length === 0 ? (
                <div className="py-3 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
                  {t("common.none")}
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.topBundles")}</CardTitle>
            <CardDescription>{t("dashboard.topBundlesDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("dashboard.entry")}</TableHead>
                  <TableHead>{t("dashboard.size")}</TableHead>
                  <TableHead>{t("dashboard.modified")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {top.map((e) => (
                  <TableRow key={e.entry}>
                    <TableCell className="font-mono text-[11px]">
                      {e.entry}
                    </TableCell>
                    <TableCell className="text-xs">{e.bytes_human}</TableCell>
                    <TableCell className="text-[11px] text-[hsl(var(--muted-foreground))]">
                      {formatDate(e.latest_mtime)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {report.broken_links.length > 0 ? (
        <Card className="shadow-[inset_0_0_0_1px_hsl(var(--destructive)/0.3)]">
          <CardHeader>
            <CardTitle>{t("dashboard.brokenTitle")}</CardTitle>
            <CardDescription>{t("dashboard.brokenDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 pt-0">
            {report.broken_links.map((b) => (
              <div
                key={b.category}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[hsl(var(--destructive)/0.35)] bg-[hsl(var(--destructive)/0.08)] px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="destructive" className="font-mono text-[10px]">
                      {b.category}
                    </Badge>
                    <span className="text-[11px] text-[hsl(var(--foreground))]">
                      {b.reason}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                    {b.resolved_path}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => repairJunction(b.category)}
                >
                  <Wrench className="size-3" />
                  {t("common.repair")}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default Dashboard;
