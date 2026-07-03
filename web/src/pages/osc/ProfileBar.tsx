import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  Download,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { OscStudioApi } from "@/lib/useOscStudio";

interface ProfileBarProps {
  studio: OscStudioApi;
  autoRunning: boolean;
  onImported: (firstCardId: string | null) => void;
}

export function ProfileBar({ studio, autoRunning, onImported }: ProfileBarProps) {
  const { t } = useTranslation();
  const {
    profiles,
    activeProfileId,
    activeProfile,
    selectProfile,
    addProfile,
    renameProfile,
    removeProfile,
    exportActiveProfile,
    importIntoActiveProfile,
    host,
    setHost,
    sendPort,
    setSendPort,
    hardware,
    hardwareLoading,
    refreshHardware,
  } = studio;

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [ioOpen, setIoOpen] = useState(false);
  const [ioText, setIoText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function openRename() {
    setRenameValue(activeProfile.name);
    setRenameOpen(true);
  }

  function confirmRename() {
    const clean = renameValue.trim();
    if (clean) renameProfile(activeProfileId, clean);
    setRenameOpen(false);
  }

  async function copyExport() {
    const text = exportActiveProfile();
    setIoText(text);
    try {
      await navigator.clipboard?.writeText(text);
      toast.success(t("osc.io.copied", { defaultValue: "Profile copied to clipboard" }));
    } catch {
      toast.success(t("osc.io.exportReady", { defaultValue: "Profile ready to copy" }));
    }
  }

  function runImport() {
    try {
      const next = importIntoActiveProfile(ioText);
      onImported(next[0]?.id ?? null);
      setIoOpen(false);
      toast.success(t("osc.io.imported", { defaultValue: "Profile imported" }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  function onPickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    file
      .text()
      .then((text) => setIoText(text))
      .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
  }

  const hwLabel = hardware?.cpuName || hardware?.gpuName
    ? [hardware?.cpuName, hardware?.gpuName].filter(Boolean).join(" · ").slice(0, 40)
    : t("osc.conn.hardwareNone", { defaultValue: "No hardware data" });

  return (
    <div className="unity-toolbar flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--border))] px-3 py-2">
      {/* Profile switcher */}
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        {t("osc.profile.label", { defaultValue: "Profile" })}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 min-w-[150px] justify-between gap-2">
            <span className="truncate">{activeProfile.name}</span>
            <ChevronDown className="size-3 shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[220px]">
          {profiles.map((profile) => (
            <DropdownMenuItem
              key={profile.id}
              onClick={() => selectProfile(profile.id)}
              className="justify-between gap-2"
            >
              <span className="truncate">{profile.name}</span>
              <span className="flex items-center gap-1.5">
                <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                  {t("osc.profile.cardCount", { defaultValue: "{{count}} cards", count: profile.cards.length })}
                </span>
                {profile.id === activeProfileId ? <Check className="size-3 text-[hsl(var(--primary))]" /> : null}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              const created = addProfile();
              onImported(created.cards[0]?.id ?? null);
            }}
          >
            <Plus className="size-3" />
            {t("osc.profile.new", { defaultValue: "New profile" })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button variant="ghost" size="icon-sm" title={t("osc.profile.rename", { defaultValue: "Rename profile" })} onClick={openRename}>
        <Pencil className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        title={t("osc.profile.delete", { defaultValue: "Delete profile" })}
        disabled={profiles.length <= 1}
        onClick={() => setDeleteOpen(true)}
      >
        <Trash2 className="size-3.5" />
      </Button>

      <div className="hidden h-6 w-px bg-[hsl(var(--border))] sm:block" />

      {/* Connection */}
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        {t("osc.conn.label", { defaultValue: "Target" })}
      </span>
      <Input
        value={host}
        onChange={(e) => setHost(e.target.value)}
        className="h-8 w-28 font-mono text-[12px]"
        aria-label={t("osc.conn.host", { defaultValue: "OSC host" })}
      />
      <Input
        type="number"
        value={sendPort}
        onChange={(e) => setSendPort(parseInt(e.target.value, 10) || 9000)}
        className="h-8 w-20 font-mono text-[12px]"
        aria-label={t("osc.conn.sendPort", { defaultValue: "Send port" })}
      />

      <div className="flex-1" />

      {autoRunning ? (
        <Badge variant="warning" className="h-6 px-2 text-[10px]">
          {t("osc.auto.badge", { defaultValue: "AUTO" })}
        </Badge>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5"
        onClick={() => void refreshHardware()}
        disabled={hardwareLoading}
        title={hwLabel}
      >
        <RefreshCcw className={hardwareLoading ? "size-3 animate-spin" : "size-3"} />
        {t("osc.conn.hardware", { defaultValue: "Hardware" })}
      </Button>
      <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => { setIoText(""); setIoOpen(true); }}>
        <Download className="size-3" />
        {t("osc.io.button", { defaultValue: "Import / Export" })}
      </Button>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("osc.profile.renameTitle", { defaultValue: "Rename profile" })}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") confirmRename(); }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRenameOpen(false)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button size="sm" onClick={confirmRename}>
              {t("common.save", { defaultValue: "Save" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("osc.profile.deleteTitle", { defaultValue: "Delete this profile?" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("osc.profile.deleteBody", {
                defaultValue: "\"{{name}}\" and its cards will be removed. This cannot be undone.",
                name: activeProfile.name,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteOpen(false)}>{t("common.cancel", { defaultValue: "Cancel" })}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                removeProfile(activeProfileId);
                setDeleteOpen(false);
              }}
            >
              {t("common.delete", { defaultValue: "Delete" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import / Export dialog */}
      <Dialog open={ioOpen} onOpenChange={setIoOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("osc.io.title", { defaultValue: "Import / Export profile" })}</DialogTitle>
            <DialogDescription>
              {t("osc.io.desc", {
                defaultValue: "Export copies the active profile's cards as JSON. Paste JSON and import to replace this profile's cards.",
              })}
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={ioText}
            onChange={(e) => setIoText(e.target.value)}
            className="min-h-[180px] resize-y rounded-[var(--radius-sm)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface-bright))] px-2 py-1.5 font-mono text-[11px] outline-none focus:border-[hsl(var(--primary))]"
            placeholder='{"version":4,"cards":[...]}'
          />
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onPickFile} />
          <DialogFooter className="sm:justify-between">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void copyExport()}>
                <Download className="size-3" />
                {t("osc.io.export", { defaultValue: "Export" })}
              </Button>
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="size-3" />
                {t("osc.io.loadFile", { defaultValue: "Load file" })}
              </Button>
            </div>
            <Button size="sm" onClick={runImport} disabled={!ioText.trim()}>
              <Check className="size-3" />
              {t("osc.io.import", { defaultValue: "Import" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
