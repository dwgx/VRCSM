import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ChevronRight,
  Folder,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  ipc,
  registerInlinePickFolder,
  type ListDirEntry,
  type ListDirResult,
  type ListDirRoot,
  type PickFolderResult,
} from "@/lib/ipc";

interface PickerState {
  open: boolean;
  title?: string;
  initialDir?: string;
  resolve?: (res: PickFolderResult) => void;
}

// Split a path into breadcrumb segments. Windows paths are anchored on a
// drive letter ("C:\"), so the first segment is the root and each
// subsequent segment maps to a descent level. We keep the trailing
// backslash on the root so `path.join` stays sane.
function splitBreadcrumbs(path: string): { label: string; full: string }[] {
  if (!path) return [];
  const sep = path.includes("\\") ? "\\" : "/";
  const parts = path.split(sep).filter(Boolean);
  if (parts.length === 0) return [];
  const crumbs: { label: string; full: string }[] = [];
  let acc = "";
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (i === 0) {
      acc = part.endsWith(":") ? `${part}${sep}` : part;
    } else {
      acc = acc.endsWith(sep) ? `${acc}${part}` : `${acc}${sep}${part}`;
    }
    crumbs.push({ label: part, full: acc });
  }
  return crumbs;
}

function joinPath(base: string, name: string): string {
  if (!base) return name;
  const sep = base.includes("\\") ? "\\" : "/";
  return base.endsWith(sep) ? `${base}${name}` : `${base}${sep}${name}`;
}

interface FolderPickerDialogProps {
  open: boolean;
  title?: string;
  initialDir?: string;
  onPick: (path: string) => void;
  onCancel: () => void;
}

function FolderPickerDialog({
  open,
  title,
  initialDir,
  onPick,
  onCancel,
}: FolderPickerDialogProps) {
  const { t } = useTranslation();
  const [currentPath, setCurrentPath] = useState<string>(initialDir ?? "");
  const [data, setData] = useState<ListDirResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  const fetchDir = useCallback(async (path: string) => {
    const myId = reqIdRef.current + 1;
    reqIdRef.current = myId;
    setLoading(true);
    setError(null);
    try {
      const res = await ipc.listDir({ path });
      if (reqIdRef.current !== myId) return;
      setData(res);
    } catch (e: unknown) {
      if (reqIdRef.current !== myId) return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setData(null);
    } finally {
      if (reqIdRef.current === myId) setLoading(false);
    }
  }, []);

  // Open/reset. We only refetch when the dialog transitions to open
  // so that clicking a different caller's trigger doesn't race with
  // the previous dialog's teardown.
  useEffect(() => {
    if (!open) return;
    const starting = initialDir ?? "";
    setCurrentPath(starting);
    void fetchDir(starting);
  }, [open, initialDir, fetchDir]);

  const navigateTo = useCallback(
    (path: string) => {
      setCurrentPath(path);
      void fetchDir(path);
    },
    [fetchDir],
  );

  const goUp = useCallback(() => {
    if (!data?.parent) {
      navigateTo("");
      return;
    }
    navigateTo(data.parent);
  }, [data?.parent, navigateTo]);

  const breadcrumbs = useMemo(() => splitBreadcrumbs(currentPath), [currentPath]);

  const directoryEntries = useMemo<ListDirEntry[]>(
    () =>
      (data?.entries ?? [])
        .filter((e) => e.isDir)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [data?.entries],
  );

  const roots = data?.roots ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="max-w-[640px] gap-3 p-5">
        <DialogHeader>
          <DialogTitle className="text-[13px]">
            {title ?? t("folderPicker.title", { defaultValue: "Choose a folder" })}
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            {t("folderPicker.hint", {
              defaultValue: "Navigate into a folder, then click Choose this folder.",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-2 py-1 text-[11px]">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={goUp}
            disabled={loading || (!currentPath && !data?.parent)}
            title={t("folderPicker.up", { defaultValue: "Up" }) as string}
          >
            <ArrowLeft className="size-3.5" />
          </Button>
          <button
            type="button"
            className="shrink-0 rounded-[var(--radius-xs)] px-1 py-0.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface))] hover:text-[hsl(var(--foreground))]"
            onClick={() => navigateTo("")}
          >
            {t("folderPicker.thisPc", { defaultValue: "This PC" })}
          </button>
          {breadcrumbs.map((crumb, idx) => (
            <span key={crumb.full} className="flex items-center gap-1">
              <ChevronRight className="size-3 text-[hsl(var(--muted-foreground))]" aria-hidden />
              <button
                type="button"
                className={cn(
                  "truncate rounded-[var(--radius-xs)] px-1 py-0.5",
                  idx === breadcrumbs.length - 1
                    ? "font-medium text-[hsl(var(--foreground))]"
                    : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface))] hover:text-[hsl(var(--foreground))]",
                )}
                onClick={() => navigateTo(crumb.full)}
              >
                {crumb.label}
              </button>
            </span>
          ))}
          <div className="ml-auto flex items-center gap-1">
            {loading ? (
              <Loader2 className="size-3.5 animate-spin text-[hsl(var(--muted-foreground))]" />
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => fetchDir(currentPath)}
                title={t("folderPicker.refresh", { defaultValue: "Refresh" }) as string}
              >
                <RefreshCw className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="h-[320px] rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))]">
          {error ? (
            <div className="p-3 text-[12px] text-[hsl(var(--destructive))]">{error}</div>
          ) : currentPath === "" ? (
            <div className="grid grid-cols-1 gap-0.5 p-1">
              {roots.length === 0 ? (
                <div className="p-3 text-[12px] text-[hsl(var(--muted-foreground))]">
                  {t("folderPicker.noDrives", { defaultValue: "No drives detected." })}
                </div>
              ) : (
                roots.map((root) => (
                  <FolderPickerRoot
                    key={root.path}
                    root={root}
                    onOpen={() => navigateTo(root.path)}
                  />
                ))
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-0.5 p-1">
              {directoryEntries.length === 0 && !loading ? (
                <div className="p-3 text-[12px] text-[hsl(var(--muted-foreground))]">
                  {t("folderPicker.empty", { defaultValue: "No subfolders here." })}
                </div>
              ) : (
                directoryEntries.map((entry) => (
                  <button
                    key={entry.name}
                    type="button"
                    className="flex items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1.5 text-left text-[12px] hover:bg-[hsl(var(--surface))]"
                    onDoubleClick={() => navigateTo(joinPath(currentPath, entry.name))}
                    onClick={(e) => {
                      if (e.detail > 1) return;
                      navigateTo(joinPath(currentPath, entry.name));
                    }}
                  >
                    <Folder className="size-3.5 shrink-0 text-[hsl(var(--primary))]" />
                    <span className="truncate">{entry.name}</span>
                  </button>
                ))
              )}
              {data?.truncated ? (
                <div className="px-2 py-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                  {t("folderPicker.truncated", {
                    defaultValue: "List truncated at 2000 entries.",
                  })}
                </div>
              ) : null}
            </div>
          )}
        </ScrollArea>

        <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-2 py-1.5 text-[11px]">
          <FolderOpen className="size-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
          <span className="truncate font-mono text-[11px]">
            {currentPath || t("folderPicker.noSelection", { defaultValue: "(nothing selected)" })}
          </span>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button
            type="button"
            onClick={() => onPick(currentPath)}
            disabled={!currentPath}
          >
            {t("folderPicker.choose", { defaultValue: "Choose this folder" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FolderPickerRoot({
  root,
  onOpen,
}: {
  root: ListDirRoot;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-2 rounded-[var(--radius-xs)] px-2 py-1.5 text-left text-[12px] hover:bg-[hsl(var(--surface))]"
    >
      <HardDrive className="size-3.5 shrink-0 text-[hsl(var(--primary))]" />
      <span className="font-mono">{root.path}</span>
      {root.label ? (
        <span className="truncate text-[11px] text-[hsl(var(--muted-foreground))]">{root.label}</span>
      ) : null}
    </button>
  );
}

export function FolderPickerHost() {
  const [state, setState] = useState<PickerState>({ open: false });

  useEffect(() => {
    const handler = (opts: { title?: string; initialDir?: string }) =>
      new Promise<PickFolderResult>((resolve) => {
        setState({
          open: true,
          title: opts.title,
          initialDir: opts.initialDir,
          resolve,
        });
      });
    registerInlinePickFolder(handler);
    return () => {
      registerInlinePickFolder(null);
    };
  }, []);

  const finish = useCallback(
    (res: PickFolderResult) => {
      if (state.resolve) state.resolve(res);
      setState({ open: false });
    },
    [state],
  );

  return (
    <FolderPickerDialog
      open={state.open}
      title={state.title}
      initialDir={state.initialDir}
      onPick={(path) => finish({ cancelled: false, path })}
      onCancel={() => finish({ cancelled: true })}
    />
  );
}
