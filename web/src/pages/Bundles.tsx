import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
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
import { Input } from "@/components/ui/input";
import { FileCode2, FolderTree, Search, Globe2, User, Package } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { useReport } from "@/lib/report-context";
import { formatBytes, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import type { BundleEntry, BundlePreview } from "@/lib/types";
import { AvatarPreview3D } from "@/components/AvatarPreview3D";

/** Extract asset type and ID from a VRChat cache __info URL */
function parseInfoUrl(url: string): { type: "avatar" | "world" | "unknown"; id: string | null } {
  if (!url) return { type: "unknown", id: null };
  const avtrMatch = url.match(/(avtr_[0-9a-f-]{36})/i);
  if (avtrMatch) return { type: "avatar", id: avtrMatch[1] };
  const wrldMatch = url.match(/(wrld_[0-9a-f-]{36})/i);
  if (wrldMatch) return { type: "world", id: wrldMatch[1] };
  return { type: "unknown", id: null };
}

/**
 * Parse the key=value lines VRChat stores inside `__info`. The file is
 * a plain-text manifest (Unity's cache entry metadata), so a simple
 * split handles it without pulling in a real parser.
 */
function parseInfoText(infoText: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of infoText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const eq = line.indexOf("=");
    const colon = line.indexOf(":");
    const sep =
      eq >= 0 && (colon < 0 || eq < colon) ? eq : colon >= 0 ? colon : -1;
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

function syntheticAvatarId(entry: BundleEntry): string {
  return `cache:${entry.entry}`;
}

interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
  isFile: boolean;
}

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = {
    name: "",
    children: new Map(),
    isFile: false,
  };
  for (const p of paths) {
    const parts = p.split(/[\\/]/).filter(Boolean);
    let cur = root;
    parts.forEach((part, idx) => {
      let child = cur.children.get(part);
      if (!child) {
        child = {
          name: part,
          children: new Map(),
          isFile: idx === parts.length - 1,
        };
        cur.children.set(part, child);
      }
      cur = child;
    });
  }
  return root;
}

function TreeView({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const sorted = useMemo(
    () =>
      [...node.children.values()].sort((a, b) => {
        if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
        return a.name.localeCompare(b.name);
      }),
    [node],
  );
  return (
    <ul className="flex flex-col">
      {sorted.map((child) => (
        <li key={child.name} className="flex flex-col">
          <div
            className="flex items-center gap-1.5 py-0.5 text-[11px]"
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
          >
            {child.isFile ? (
              <FileCode2 className="size-3 shrink-0 text-[hsl(var(--muted-foreground))]" />
            ) : (
              <FolderTree className="size-3 shrink-0 text-[hsl(var(--primary))]" />
            )}
            <span
              className={
                child.isFile
                  ? "font-mono text-[hsl(var(--foreground))]"
                  : "font-mono text-[hsl(var(--muted-foreground))]"
              }
            >
              {child.name}
            </span>
          </div>
          {child.children.size > 0 ? (
            <TreeView node={child} depth={depth + 1} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Bundles() {
  const { t } = useTranslation();
  const { report, loading, refresh } = useReport();
  const [filter, setFilter] = useState("");
  const [preview, setPreview] = useState<{
    entry: BundleEntry;
    data: BundlePreview;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // "Delete" is a two-phase flow: dry-run resolves the real filesystem
  // targets, we hand the target list to a confirm dialog, then the user
  // explicitly ok's the destructive call. Keeping the plan in state lets
  // the dialog show exactly what will be removed.
  const [deleteTarget, setDeleteTarget] = useState<{
    entry: BundleEntry;
    targets: string[];
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Name lookup maps from parsed logs
  const avatarNames = report?.logs?.avatar_names as Record<string, { name: string; author: string | null }> | undefined;
  const worldNames = report?.logs?.world_names as Record<string, string> | undefined;

  function resolveAssetName(entry: BundleEntry): { label: string; type: "avatar" | "world" | "unknown"; id: string | null } {
    const parsed = parseInfoUrl(entry.info_url);
    if (parsed.type === "avatar" && parsed.id) {
      const info = avatarNames?.[parsed.id];
      return { label: info?.name ?? parsed.id, type: "avatar", id: parsed.id };
    }
    if (parsed.type === "world" && parsed.id) {
      const name = worldNames?.[parsed.id];
      return { label: name ?? parsed.id, type: "world", id: parsed.id };
    }
    return { label: entry.entry.slice(0, 16) + "…", type: "unknown", id: null };
  }

  const filtered = useMemo(() => {
    if (!report) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return report.cache_windows_player.entries;
    return report.cache_windows_player.entries.filter((e) => {
      if (e.entry.toLowerCase().includes(q)) return true;
      // Also search by resolved name
      const resolved = resolveAssetName(e);
      if (resolved.label.toLowerCase().includes(q)) return true;
      if (resolved.id?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [report, filter, avatarNames, worldNames]);

  const infoFields = useMemo(
    () => (preview ? parseInfoText(preview.data.infoText) : {}),
    [preview],
  );
  const infoFieldList = useMemo(
    () => Object.entries(infoFields).slice(0, 24),
    [infoFields],
  );
  const tree = useMemo(
    () => (preview ? buildTree(preview.data.fileTree) : null),
    [preview],
  );

  const openPreview = async (entry: BundleEntry) => {
    setPreviewLoading(true);
    try {
      const data = await ipc.call<{ entry: string }, BundlePreview>(
        "bundle.preview",
        { entry: entry.path },
      );
      setPreview({ entry, data });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("bundles.previewFailed", { error: msg }));
    } finally {
      setPreviewLoading(false);
    }
  };

  // Step 1: user clicks Delete → we call delete.dryRun to find the real
  // on-disk targets without touching anything yet, then open the confirm
  // dialog. Dry-run failures are usually "preserved root file" type
  // guardrails in SafeDelete.cpp, so surface them as a toast instead of
  // opening an empty dialog.
  const beginDelete = async (entry: BundleEntry) => {
    try {
      const res = await ipc.call<
        { category: string; entry: string },
        { targets: string[] }
      >("delete.dryRun", {
        category: "cache_windows_player",
        entry: entry.entry,
      });
      if (!res.targets.length) {
        toast.error(t("bundles.deleteNothingToDo"));
        return;
      }
      setDeleteTarget({ entry, targets: res.targets });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("bundles.dryRunFailed", { error: msg }));
    }
  };

  // Step 2: user confirms in the dialog → call delete.execute with the
  // exact target list we showed them. We intentionally pass `targets`
  // back rather than re-resolving via {category, entry} so there's no
  // chance a race-modified directory silently adds files.
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await ipc.call<
        { targets: string[] },
        { deleted?: number; error?: { code: string; message: string } }
      >("delete.execute", { targets: deleteTarget.targets });
      if (res.error) {
        throw new Error(`${res.error.code}: ${res.error.message}`);
      }
      toast.success(
        t("bundles.deleteSucceeded", {
          entry: deleteTarget.entry.entry.slice(0, 12),
          count: res.deleted ?? 0,
        }),
      );
      setDeleteTarget(null);
      refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("bundles.deleteFailed", { error: msg }));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight">
            {t("bundles.title")}
          </h1>
          <p className="mt-1.5 text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("bundles.subtitle")}
          </p>
        </div>
      </header>

      <Card elevation="flat" className="flex flex-col overflow-hidden p-0">
        <div className="unity-panel-header flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <span>{t("bundles.cardTitle")}</span>
            <span className="font-mono text-[10px] normal-case tracking-normal">
              {report
                ? t("bundles.entryCount", {
                    count: report.cache_windows_player.entry_count,
                  })
                : t("common.loading")}
            </span>
          </div>
          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("bundles.filterPlaceholder")}
              className="h-7 pl-7 text-[12px] normal-case tracking-normal"
            />
          </div>
        </div>

        {loading && !report ? (
          <div className="py-10 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("bundles.scanning")}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("bundles.colEntry")}</TableHead>
                <TableHead>{t("bundles.colSize")}</TableHead>
                <TableHead>{t("bundles.colFiles")}</TableHead>
                <TableHead>{t("bundles.colMtime")}</TableHead>
                <TableHead>{t("bundles.colFormat")}</TableHead>
                <TableHead className="text-right">
                  {t("bundles.colActions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((entry) => {
                const resolved = resolveAssetName(entry);
                return (
                <TableRow key={entry.entry}>
                  <TableCell className="text-[11px]">
                    <div className="flex items-center gap-2 min-w-0">
                      {resolved.type === "avatar" ? (
                        <User className="size-3.5 shrink-0 text-purple-400" />
                      ) : resolved.type === "world" ? (
                        <Globe2 className="size-3.5 shrink-0 text-blue-400" />
                      ) : (
                        <Package className="size-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-medium text-[hsl(var(--foreground))]">
                          {resolved.label}
                        </div>
                        <div className="truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                          {entry.entry.slice(0, 12)}…
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-[11px]">
                    {entry.bytes_human}
                  </TableCell>
                  <TableCell className="text-[11px]">
                    {entry.file_count}
                  </TableCell>
                  <TableCell className="text-[10.5px] text-[hsl(var(--muted-foreground))]">
                    {formatDate(entry.latest_mtime)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {entry.bundle_format || "unknown"}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-1.5 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openPreview(entry)}
                      disabled={previewLoading}
                    >
                      {t("bundles.preview")}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => beginDelete(entry)}
                    >
                      {t("bundles.delete")}
                    </Button>
                  </TableCell>
                </TableRow>
                );
              })}
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-[12px] text-[hsl(var(--muted-foreground))]"
                  >
                    {t("bundles.noMatch")}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog
        open={preview !== null}
        onOpenChange={(open) => !open && setPreview(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("bundles.previewTitle")}</DialogTitle>
            <DialogDescription className="font-mono text-[11px]">
              {preview?.entry.entry}
            </DialogDescription>
          </DialogHeader>
          {preview ? (
            <div className="flex flex-col gap-3">
              <Card elevation="flat" className="p-0">
                <div className="unity-panel-header flex items-center justify-between">
                  <span>{t("bundles.local3dPreview", { defaultValue: "Local 3D preview" })}</span>
                  <span className="font-mono text-[10px] normal-case tracking-normal">
                    {preview.data.dataPath ? "__data" : t("common.unavailable", { defaultValue: "Unavailable" })}
                  </span>
                </div>
                <div className="flex flex-col gap-3 p-3 md:flex-row">
                  <AvatarPreview3D
                    avatarId={syntheticAvatarId(preview.entry)}
                    bundlePath={preview.data.dataPath || preview.data.versionPath || preview.entry.path}
                    size={260}
                    expandedSize={760}
                  />
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
                    <p>
                      {t("bundles.local3dPreviewHint", {
                        defaultValue: "Uses the cached __data bundle directly. This does not require an avatar ID; encrypted or non-avatar bundles may still fail to render.",
                      })}
                    </p>
                    <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2 font-mono text-[10.5px]">
                      <span className="text-[hsl(var(--muted-foreground))]">
                        {t("common.path", { defaultValue: "Path" })}:{" "}
                      </span>
                      <span className="break-all text-[hsl(var(--foreground))]">
                        {preview.data.dataPath || preview.data.versionPath || preview.entry.path}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Format badges — magic + sniffer classification */}
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="tonal">
                  {preview.entry.bundle_format || "unknown"}
                </Badge>
                <Badge variant="outline">
                  magic: {preview.data.magic || "—"}
                </Badge>
                <Badge variant="secondary">
                  {formatBytes(preview.entry.bytes)}
                </Badge>
                <Badge variant="secondary">
                  {preview.entry.file_count} files
                </Badge>
                {preview.entry.latest_mtime ? (
                  <Badge variant="secondary">
                    {formatDate(preview.entry.latest_mtime)}
                  </Badge>
                ) : null}
              </div>

              {/* Structured __info fields */}
              {infoFieldList.length > 0 ? (
                <Card elevation="flat" className="p-0">
                  <div className="unity-panel-header">
                    {t("bundles.infoFields")}
                  </div>
                  <div className="grid gap-0 p-0 text-[11px]">
                    {infoFieldList.map(([k, v], idx) => (
                      <div
                        key={k}
                        className={
                          "flex items-start gap-2 px-3 py-1 " +
                          (idx % 2 === 0
                            ? "bg-[hsl(var(--surface-raised))]"
                            : "bg-[hsl(var(--surface))]")
                        }
                      >
                        <span className="w-36 shrink-0 font-mono text-[hsl(var(--muted-foreground))]">
                          {k}
                        </span>
                        <span className="break-all font-mono text-[hsl(var(--foreground))]">
                          {v}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              ) : (
                <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2 text-[11px] text-[hsl(var(--muted-foreground))]">
                  {t("bundles.noInfoFields")}
                </div>
              )}

              {/* File tree */}
              <Card elevation="flat" className="p-0">
                <div className="unity-panel-header flex items-center justify-between">
                  <span>{t("bundles.fileTree")}</span>
                  <span className="font-mono text-[10px] normal-case tracking-normal">
                    {preview.data.fileTree.length}
                  </span>
                </div>
                <div className="scrollbar-thin max-h-72 overflow-auto px-2 py-2">
                  {tree && tree.children.size > 0 ? (
                    <TreeView node={tree} />
                  ) : (
                    <div className="py-4 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
                      {t("bundles.emptyTree")}
                    </div>
                  )}
                </div>
              </Card>

              {/* Path footer */}
              <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2 font-mono text-[10.5px]">
                <span className="text-[hsl(var(--muted-foreground))]">
                  {t("common.path", { defaultValue: "Path" })}:{" "}
                </span>
                <span className="break-all text-[hsl(var(--foreground))]">
                  {preview.entry.path}
                </span>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/*
        Delete confirm dialog — shows the exact filesystem targets
        returned by delete.dryRun so the user can see what's about to
        vanish before they commit. No dry-run/execute toggle; this IS
        the real delete, the dry-run is a pre-check, not a separate
        mode.
      */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("bundles.deleteConfirmTitle")}</DialogTitle>
            <DialogDescription className="font-mono text-[11px]">
              {deleteTarget?.entry.entry}
            </DialogDescription>
          </DialogHeader>
          {deleteTarget ? (
            <div className="flex flex-col gap-3">
              <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--destructive)/0.4)] bg-[hsl(var(--destructive)/0.08)] px-3 py-2 text-[12px] text-[hsl(var(--destructive))]">
                {t("bundles.deleteConfirmWarning", {
                  count: deleteTarget.targets.length,
                  size: formatBytes(deleteTarget.entry.bytes),
                })}
              </div>
              <Card elevation="flat" className="p-0">
                <div className="unity-panel-header">
                  {t("bundles.deleteTargets", {
                    count: deleteTarget.targets.length,
                  })}
                </div>
                <div className="scrollbar-thin max-h-60 overflow-auto px-3 py-2">
                  <ul className="flex flex-col gap-1 font-mono text-[10.5px]">
                    {deleteTarget.targets.map((p) => (
                      <li
                        key={p}
                        className="break-all text-[hsl(var(--foreground))]"
                      >
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleting}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={confirmDelete}
                  disabled={deleting}
                >
                  {deleting
                    ? t("bundles.deleting")
                    : t("bundles.deleteConfirmAction")}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default Bundles;
