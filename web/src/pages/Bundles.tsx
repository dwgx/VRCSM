import { useEffect, useMemo, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ipc } from "@/lib/ipc";
import { formatDate } from "@/lib/utils";
import { toast } from "sonner";
import type { BundleEntry, BundlePreview, Report } from "@/lib/types";

function Bundles() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [preview, setPreview] = useState<{ entry: BundleEntry; data: BundlePreview } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    ipc
      .scan()
      .then((r) => {
        if (alive) setReport(r);
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(`Scan failed: ${msg}`);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!report) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return report.cache_windows_player.entries;
    return report.cache_windows_player.entries.filter((e) =>
      e.entry.toLowerCase().includes(q),
    );
  }, [report, filter]);

  const openPreview = async (entry: BundleEntry) => {
    setPreviewLoading(true);
    try {
      const data = await ipc.call<{ entry: string }, BundlePreview>("bundle.preview", {
        entry: entry.entry,
      });
      setPreview({ entry, data });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Preview failed: ${msg}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  const dryRunDelete = async (entry: BundleEntry) => {
    try {
      const res = await ipc.call<
        { category: string; entry: string },
        { targets: string[] }
      >("delete.dryRun", { category: "cache_windows_player", entry: entry.entry });
      toast.success(`Dry run: ${res.targets.length} target(s) would be removed`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Dry run failed: ${msg}`);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Bundles</h1>
        <p className="text-sm text-muted-foreground">
          UnityFS asset bundles cached by VRChat.
        </p>
      </header>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
          <div>
            <CardTitle>Cache-WindowsPlayer</CardTitle>
            <CardDescription>
              {report ? `${report.cache_windows_player.entry_count} entries` : "Loading…"}
            </CardDescription>
          </div>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by hash…"
            className="h-9 w-64 rounded-md border border-border/60 bg-background/50 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Scanning cache…
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entry hash</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Files</TableHead>
                  <TableHead>Latest mtime</TableHead>
                  <TableHead>Format</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((entry) => (
                  <TableRow key={entry.entry}>
                    <TableCell className="font-mono text-xs">{entry.entry}</TableCell>
                    <TableCell>{entry.bytes_human}</TableCell>
                    <TableCell>{entry.file_count}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(entry.latest_mtime)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{entry.bundle_format || "unknown"}</Badge>
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openPreview(entry)}
                        disabled={previewLoading}
                      >
                        Preview
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => dryRunDelete(entry)}
                      >
                        Delete (dry-run)
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      No entries match the filter.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Bundle preview</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {preview?.entry.entry}
            </DialogDescription>
          </DialogHeader>
          {preview ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">magic: {preview.data.magic}</Badge>
                <Badge variant="outline">{preview.entry.bundle_format}</Badge>
              </div>
              <pre className="max-h-72 overflow-auto rounded-md border border-border/60 bg-background/40 p-3 text-xs">
                {preview.data.infoText}
              </pre>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default Bundles;
