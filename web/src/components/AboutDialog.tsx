import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Heart } from "lucide-react";
import { ipc } from "@/lib/ipc";
import type { AppVersion } from "@/lib/types";

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  const { t } = useTranslation();
  const [version, setVersion] = useState<AppVersion | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    ipc
      .version()
      .then((v) => {
        if (alive) setVersion(v);
      })
      .catch(() => {
        if (alive) setVersion({ version: "0.1.1", build: "dev" });
      });
    return () => {
      alive = false;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))]">
              <Heart className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle>{t("about.title")}</DialogTitle>
              <DialogDescription>{t("about.subtitle")}</DialogDescription>
            </div>
            {version ? (
              <Badge variant="muted" className="font-mono">
                v{version.version}
              </Badge>
            ) : null}
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-3 pt-2">
          <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-4 py-3 text-[13px] leading-relaxed text-[hsl(var(--foreground))]">
            {t("about.body")}
          </div>

          {version ? (
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  {t("about.version")}
                </div>
                <div className="mt-1 font-mono text-[12px] text-[hsl(var(--foreground))]">
                  {version.version}
                </div>
              </div>
              <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  {t("about.build")}
                </div>
                <div className="mt-1 font-mono text-[12px] text-[hsl(var(--foreground))]">
                  {version.build}
                </div>
              </div>
            </div>
          ) : null}

          <div className="flex justify-end pt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.close")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
