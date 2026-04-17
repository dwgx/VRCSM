import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Heart,
  Github,
  ExternalLink,
  MessageCircle,
  Users,
  Sparkles,
  Code2,
} from "lucide-react";
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
        if (alive) setVersion({ version: "0.5.0", build: "Apr 16 2026" });
      });
    return () => {
      alive = false;
    };
  }, [open]);

  function openUrl(url: string) {
    void ipc.call("shell.openUrl", { url });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px] overflow-hidden p-0">
        {/* Hero gradient header */}
        <div className="relative overflow-hidden bg-gradient-to-br from-[hsl(var(--primary)/0.15)] via-[hsl(var(--accent)/0.1)] to-[hsl(var(--primary)/0.05)] px-6 pt-6 pb-5">
          {/* Floating decorative elements */}
          <div className="absolute -top-6 -right-6 size-24 rounded-full bg-[hsl(var(--primary)/0.08)] blur-2xl" />
          <div className="absolute -bottom-4 -left-4 size-16 rounded-full bg-[hsl(var(--accent)/0.1)] blur-xl" />

          <DialogHeader className="relative z-10">
            <div className="flex items-start gap-4">
              <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--primary)/0.2)] text-[hsl(var(--primary))] shadow-lg shadow-[hsl(var(--primary)/0.1)] backdrop-blur-sm border border-[hsl(var(--primary)/0.15)]">
                <Sparkles className="size-7" />
              </div>
              <div className="min-w-0 flex-1 pt-1">
                <DialogTitle className="text-lg font-bold tracking-tight">
                  VRCSM
                </DialogTitle>
                <p className="mt-0.5 text-[12px] text-[hsl(var(--muted-foreground))]">
                  VRChat Settings Manager
                </p>
                {version && (
                  <div className="mt-2 flex items-center gap-2">
                    <Badge variant="muted" className="font-mono text-[10px]">
                      v{version.version}
                    </Badge>
                    <span className="text-[10px] font-mono text-[hsl(var(--muted-foreground))]">
                      {version.build}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="flex flex-col gap-3 px-6 pb-6 pt-4">
          {/* Developer card */}
          <div className="rounded-xl border border-[hsl(var(--border)/0.6)] bg-gradient-to-r from-[hsl(var(--surface-raised))] to-[hsl(var(--surface))] p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]">
                <Code2 className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-[0.1em] text-[hsl(var(--muted-foreground))]">
                  Sole Developer
                </div>
                <div className="text-[14px] font-bold text-[hsl(var(--foreground))]">
                  dwgx
                </div>
              </div>
            </div>
          </div>

          {/* First friend */}
          <div className="rounded-xl border border-[hsl(var(--border)/0.6)] bg-gradient-to-r from-pink-500/5 to-rose-500/5 p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-pink-500/10 text-pink-400">
                <Heart className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-[0.1em] text-[hsl(var(--muted-foreground))]">
                  First Friend in VRC
                </div>
                <div className="text-[14px] font-bold text-[hsl(var(--foreground))]">
                  嗯呐！！
                </div>
              </div>
            </div>
          </div>

          {/* Links grid */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => openUrl("https://github.com/dwgx")}
              className="flex items-center gap-2.5 rounded-lg border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--canvas))] px-3 py-2.5 text-left transition-all hover:border-[hsl(var(--border-strong))] hover:bg-[hsl(var(--surface-raised))] hover:shadow-sm group"
            >
              <Github className="size-4 text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--foreground))] transition-colors" />
              <span className="text-[12px] font-medium text-[hsl(var(--foreground))]">
                GitHub
              </span>
            </button>
            <button
              type="button"
              onClick={() => openUrl("https://space.bilibili.com")}
              className="flex items-center gap-2.5 rounded-lg border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--canvas))] px-3 py-2.5 text-left transition-all hover:border-[hsl(var(--border-strong))] hover:bg-[hsl(var(--surface-raised))] hover:shadow-sm group"
            >
              <ExternalLink className="size-4 text-[hsl(var(--muted-foreground))] group-hover:text-sky-400 transition-colors" />
              <span className="text-[12px] font-medium text-[hsl(var(--foreground))]">
                Bilibili
              </span>
            </button>
          </div>

          {/* Contact info */}
          <div className="rounded-xl border border-[hsl(var(--border)/0.4)] bg-[hsl(var(--canvas)/0.5)] p-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <MessageCircle className="size-3.5 text-[hsl(var(--muted-foreground))]" />
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                    QQ
                  </div>
                  <div className="text-[12px] font-mono font-medium text-[hsl(var(--foreground))]">
                    136666451
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Users className="size-3.5 text-[hsl(var(--muted-foreground))]" />
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                    QQ Group
                  </div>
                  <div className="text-[12px] font-mono font-medium text-[hsl(var(--foreground))]">
                    901738883
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
              Made with <Heart className="inline size-3 text-pink-400 fill-pink-400 -mt-0.5" /> for VRChat
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-7 text-[11px]"
            >
              {t("common.close")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
