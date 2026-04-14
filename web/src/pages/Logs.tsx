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
import { Badge } from "@/components/ui/badge";
import { ipc } from "@/lib/ipc";
import type { LogReport, Report } from "@/lib/types";

function Logs() {
  const [logs, setLogs] = useState<LogReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    ipc
      .scan()
      .then((r: Report) => {
        if (alive) setLogs(r.logs);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Scanning logs…
        </CardContent>
      </Card>
    );
  }

  if (error || !logs) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Failed to read logs</CardTitle>
          <CardDescription>{error ?? "Unknown error"}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
        <p className="text-sm text-muted-foreground">
          Parsed from {logs.log_count} VRChat output_log_*.txt
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent worlds</CardTitle>
            <CardDescription>{logs.world_event_count} join events</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 pt-0">
            {logs.recent_world_ids.length === 0 ? (
              <span className="text-xs text-muted-foreground">No recent worlds</span>
            ) : (
              logs.recent_world_ids.map((id) => (
                <Badge key={id} variant="secondary" className="font-mono text-[10px]">
                  {logs.world_names[id] ?? id}
                </Badge>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent avatars</CardTitle>
            <CardDescription>{logs.avatar_event_count} avatar events</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 pt-0">
            {logs.recent_avatar_ids.length === 0 ? (
              <span className="text-xs text-muted-foreground">No recent avatars</span>
            ) : (
              logs.recent_avatar_ids.map((id) => (
                <Badge key={id} variant="outline" className="font-mono text-[10px]">
                  {id}
                </Badge>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Settings detected</CardTitle>
          <CardDescription>Parsed from VRChat log output</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>cache_directory</TableCell>
                <TableCell>{logs.settings.cache_directory ?? "—"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>cache_size_mb</TableCell>
                <TableCell>{logs.settings.cache_size_mb ?? "—"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>clear_cache_on_start</TableCell>
                <TableCell>
                  {logs.settings.clear_cache_on_start === null
                    ? "—"
                    : String(logs.settings.clear_cache_on_start)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Log files</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {logs.log_files.length === 0 ? (
            <p className="text-sm text-muted-foreground">No log files found.</p>
          ) : (
            <ul className="space-y-1 text-xs font-mono text-muted-foreground">
              {logs.log_files.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default Logs;
