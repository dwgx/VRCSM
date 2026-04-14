import { useEffect, useState } from "react";
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
import { ipc } from "@/lib/ipc";
import { formatBytes, formatDate } from "@/lib/utils";
import type { Report } from "@/lib/types";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const palette = [
  "#60a5fa",
  "#a78bfa",
  "#34d399",
  "#fbbf24",
  "#f87171",
  "#22d3ee",
  "#f472b6",
  "#94a3b8",
];

interface StatCardProps {
  title: string;
  value: string;
  hint?: string;
}

function StatCard({ title, value, hint }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      {hint ? (
        <CardContent className="pt-0 text-xs text-muted-foreground">{hint}</CardContent>
      ) : null}
    </Card>
  );
}

function SkeletonCard() {
  return (
    <Card>
      <CardHeader>
        <div className="h-3 w-24 animate-pulse rounded bg-muted/60" />
        <div className="mt-2 h-7 w-32 animate-pulse rounded bg-muted/60" />
      </CardHeader>
    </Card>
  );
}

function Dashboard() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    ipc
      .scan()
      .then((r) => setReport(r))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
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
          <CardTitle>Scan failed</CardTitle>
          <CardDescription>{error ?? "Unknown error"}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={load}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  const pieData = report.category_summaries
    .filter((c) => c.bytes > 0)
    .map((c) => ({ name: c.name, value: c.bytes }));

  const top = report.cache_windows_player.largest_entries.slice(0, 8);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {report.base_dir}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          Rescan
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total cache size"
          value={report.total_bytes_human}
          hint={`across ${report.existing_category_count} categories`}
        />
        <StatCard
          title="Categories"
          value={String(report.category_summaries.length)}
          hint={`${report.existing_category_count} present`}
        />
        <StatCard
          title="Broken junctions"
          value={String(report.broken_links.length)}
          hint={report.broken_links.length > 0 ? "needs attention" : "all clear"}
        />
        <StatCard
          title="Logs"
          value={String(report.logs.log_count)}
          hint={`${report.logs.world_event_count} world joins`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Storage by category</CardTitle>
            <CardDescription>Bytes across present categories</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  innerRadius={48}
                  outerRadius={92}
                  dataKey="value"
                  paddingAngle={2}
                  stroke="hsl(var(--background))"
                  strokeWidth={2}
                >
                  {pieData.map((_, idx) => (
                    <Cell key={idx} fill={palette[idx % palette.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => formatBytes(value)}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                  }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top bundle entries</CardTitle>
            <CardDescription>Largest items in Cache-WindowsPlayer</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entry</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Modified</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {top.map((e) => (
                  <TableRow key={e.entry}>
                    <TableCell className="font-mono text-xs">{e.entry}</TableCell>
                    <TableCell>{e.bytes_human}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
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
        <Card>
          <CardHeader>
            <CardTitle>Broken junctions</CardTitle>
            <CardDescription>
              These categories point at missing targets — repair from Migrate.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 pt-0">
            {report.broken_links.map((b) => (
              <Badge key={b.category} variant="destructive">
                {b.category}: {b.reason}
              </Badge>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default Dashboard;
