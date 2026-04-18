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
  ExternalLink,
  Github,
  Heart,
  MessageCircle,
  Users,
} from "lucide-react";
import { APP_ICON_URL, SPECIAL_THANKS_1033484989_URL } from "@/lib/assets";
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
    ipc.version().then((v) => {
      if (alive) setVersion(v);
    }).catch(() => {
      if (alive) setVersion(null);
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
      <DialogContent className="max-w-[520px] overflow-hidden p-0">
        <div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-6 py-5">
          <DialogHeader className="gap-3">
            <div className="flex items-start gap-4">
              <div className="overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
                <img
                  src={APP_ICON_URL}
                  alt="VRCSM"
                  width={48}
                  height={48}
                  className="block size-12 object-cover"
                  draggable={false}
                />
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-[18px] font-semibold tracking-tight">
                  VRCSM
                </DialogTitle>
                <p className="mt-1 text-[12px] text-[hsl(var(--muted-foreground))]">
                  {t("about.subtitle", { defaultValue: "VRChat Settings Manager" })}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {version ? (
                    <>
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        v{version.version}
                      </Badge>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {version.build}
                      </Badge>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-4">
              <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                {t("about.developer", { defaultValue: "Developer" })}
              </div>
              <div className="mt-1 text-[15px] font-semibold text-[hsl(var(--foreground))]">
                dwgx
              </div>
              <div className="mt-2 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                {t("about.developerBody", {
                  defaultValue: "Product direction, native host, frontend shell, and packaging are maintained in one codebase.",
                })}
              </div>
            </div>

            <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-4">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                <Heart className="size-3 text-[#C25B5B]" />
                {t("about.specialThanks", { defaultValue: "Special Thanks" })}
              </div>
              <div className="mt-3 flex items-center gap-3">
                <img
                  src={SPECIAL_THANKS_1033484989_URL}
                  alt="嗯呐！！"
                  width={44}
                  height={44}
                  className="size-11 rounded-full border border-[hsl(var(--border))] object-cover"
                  draggable={false}
                />
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-[hsl(var(--foreground))]">
                    嗯呐！！
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                    QQ 1033484989
                  </div>
                </div>
              </div>
              <div className="mt-2 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                {t("about.specialThanksBody", {
                  defaultValue: "The first friend met in VRChat, and still part of the project's story.",
                })}
              </div>
            </div>
          </div>

          <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
            <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
              {t("about.links", { defaultValue: "Links" })}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => openUrl("https://github.com/dwgx")}
                className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2 text-left text-[12px] hover:bg-[hsl(var(--surface-raised))]"
              >
                <Github className="size-4 text-[hsl(var(--muted-foreground))]" />
                GitHub
              </button>
              <button
                type="button"
                onClick={() => openUrl("https://space.bilibili.com")}
                className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2 text-left text-[12px] hover:bg-[hsl(var(--surface-raised))]"
              >
                <ExternalLink className="size-4 text-[hsl(var(--muted-foreground))]" />
                Bilibili
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-4">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                <MessageCircle className="size-3" />
                QQ
              </div>
              <div className="mt-1 font-mono text-[14px] text-[hsl(var(--foreground))]">
                136666451
              </div>
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-4">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                <Users className="size-3" />
                QQ Group
              </div>
              <div className="mt-1 font-mono text-[14px] text-[hsl(var(--foreground))]">
                901738883
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-[hsl(var(--border))] pt-4">
            <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
              {t("about.footer", {
                defaultValue: "Built for local-first VRChat account, cache, and session management.",
              })}
            </div>
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.close")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
