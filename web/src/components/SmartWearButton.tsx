import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Shirt, Loader2, CheckCircle2, XCircle, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogTitle,
} from "@/components/ui/dialog";
import { ThumbImage } from "@/components/ThumbImage";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";

interface SmartWearButtonProps {
  avatarId?: string | null;
  avatarName?: string | null;
  userId?: string | null;
  variant?: "pill" | "button" | "compact";
  className?: string;
}

interface AvatarAlternative {
  id: string;
  name: string;
  authorName: string;
  thumbnailImageUrl: string;
}

type WearPhase =
  | "idle" | "resolving" | "checking" | "wearing"
  | "success" | "failed" | "alternatives";

export function SmartWearButton({
  avatarId: directAvatarId,
  avatarName,
  userId,
  variant = "pill",
  className,
}: SmartWearButtonProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<WearPhase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<AvatarAlternative[]>([]);
  const [altOpen, setAltOpen] = useState(false);
  const lastWornRef = useRef<{ id: string; name: string } | null>(null);

  const busy = phase !== "idle" && phase !== "success" && phase !== "failed" && phase !== "alternatives";

  async function doWear(avatarId: string, name?: string | null) {
    setPhase("wearing");
    try {
      await ipc.call("avatar.select", { avatarId });
      lastWornRef.current = { id: avatarId, name: name || avatarId };
      setPhase("success");
      toast.success(t("wear.success", {
        defaultValue: "Now wearing: {{name}}",
        name: name || avatarId,
      }), {
        action: {
          label: t("wear.saveToLib", { defaultValue: "Save to Library" }),
          onClick: () => saveToLibrary(avatarId, name),
        },
      });
      setTimeout(() => setPhase("idle"), 3000);
      return true;
    } catch {
      return false;
    }
  }

  async function saveToLibrary(avatarId: string, name?: string | null) {
    try {
      await ipc.call("favorites.add", {
        type: "avatar",
        target_id: avatarId,
        list_name: "default",
        display_name: name || avatarId,
      });
      toast.success(t("wear.saved", { defaultValue: "Saved to Library!" }));
    } catch {
      toast.error(t("wear.saveFailed", { defaultValue: "Could not save to library." }));
    }
  }

  async function searchAlternatives(name: string, authorName?: string) {
    const alts: AvatarAlternative[] = [];

    // Search by exact name
    try {
      const res = await ipc.searchAvatars(name, 10);
      for (const a of res.avatars ?? []) {
        if (a.releaseStatus === "public") {
          alts.push({
            id: a.id,
            name: a.name,
            authorName: a.authorName,
            thumbnailImageUrl: a.thumbnailImageUrl,
          });
        }
      }
    } catch { /* ignore */ }

    // If we got the author name, also search by author
    if (authorName && alts.length < 5) {
      try {
        const res = await ipc.searchAvatars(authorName, 10);
        for (const a of res.avatars ?? []) {
          if (a.releaseStatus === "public" && !alts.some(x => x.id === a.id)) {
            alts.push({
              id: a.id,
              name: a.name,
              authorName: a.authorName,
              thumbnailImageUrl: a.thumbnailImageUrl,
            });
          }
        }
      } catch { /* ignore */ }
    }

    return alts.slice(0, 8);
  }

  async function handleWear(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setErrorMsg(null);
    setAlternatives([]);

    let avatarId = directAvatarId || null;
    let detailName: string | null = null;
    let detailAuthor: string | null = null;

    // Step 1: Resolve avatar ID
    if (!avatarId && userId) {
      setPhase("resolving");
      try {
        const { profile } = await ipc.call<
          { userId: string },
          { profile: { currentAvatarId?: string } | null }
        >("user.getProfile", { userId });
        avatarId = profile?.currentAvatarId || null;
      } catch { /* continue */ }
    }

    if (!avatarId && avatarName) {
      setPhase("resolving");
      try {
        const res = await ipc.searchAvatars(avatarName, 5);
        const exact = res.avatars?.find(
          (a: any) => a.name === avatarName && a.releaseStatus === "public",
        );
        if (exact) avatarId = exact.id;
        else if (res.avatars?.length) avatarId = res.avatars[0].id;
      } catch { /* continue */ }
    }

    if (!avatarId) {
      setPhase("failed");
      setErrorMsg(t("wear.noAvatar", { defaultValue: "Could not find this avatar." }));
      toast.error(t("wear.noAvatar", { defaultValue: "Could not find this avatar." }));
      setTimeout(() => setPhase("idle"), 3000);
      return;
    }

    // Step 2: Direct select
    if (await doWear(avatarId, avatarName)) return;

    // Step 3: 403 fallback — check avatar details
    setPhase("checking");
    try {
      const detailRes = await ipc.call<
        { id: string },
        { details: { releaseStatus?: string; name?: string; authorName?: string; description?: string } | null }
      >("avatar.details", { id: avatarId });

      const details = detailRes.details;
      detailName = details?.name || avatarName || null;
      detailAuthor = details?.authorName || null;

      if (details?.releaseStatus === "public") {
        if (await doWear(avatarId, detailName)) return;
      }
    } catch { /* continue to alternatives */ }

    // Step 4: BEYOND VRCX — Clone Chain: search for public alternatives
    // by the same name or same author
    setPhase("resolving");
    const searchName = detailName || avatarName;
    if (searchName) {
      const alts = await searchAlternatives(searchName, detailAuthor || undefined);
      if (alts.length > 0) {
        setAlternatives(alts);
        setPhase("alternatives");
        setAltOpen(true);
        return;
      }
    }

    // No alternatives found
    setPhase("failed");
    setErrorMsg(t("wear.notCloneable", { defaultValue: "This avatar does not allow cloning." }));
    toast.error(t("wear.notCloneable", { defaultValue: "This avatar does not allow cloning. No public alternatives found." }));
    setTimeout(() => setPhase("idle"), 4000);
  }

  const phaseIcon: Record<WearPhase, React.ReactNode> = {
    idle: <Shirt className="size-3" />,
    resolving: <Loader2 className="size-3 animate-spin" />,
    checking: <Loader2 className="size-3 animate-spin" />,
    wearing: <Loader2 className="size-3 animate-spin" />,
    success: <CheckCircle2 className="size-3 text-emerald-400" />,
    failed: <XCircle className="size-3 text-red-400" />,
    alternatives: <Search className="size-3 text-yellow-400" />,
  };

  const phaseLabel: Record<WearPhase, string> = {
    idle: t("wear.btn", { defaultValue: "Wear" }),
    resolving: t("wear.resolving", { defaultValue: "Finding..." }),
    checking: t("wear.checking", { defaultValue: "Checking..." }),
    wearing: t("wear.wearing", { defaultValue: "Wearing..." }),
    success: t("wear.done", { defaultValue: "Done!" }),
    failed: t("wear.failed", { defaultValue: "Failed" }),
    alternatives: t("wear.alternatives", { defaultValue: "Alternatives" }),
  };

  const btnContent = (
    <>
      {phaseIcon[phase]}
      {phaseLabel[phase]}
    </>
  );

  const colorClass =
    phase === "success" ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-400"
    : phase === "failed" ? "border-red-400/50 bg-red-400/10 text-red-400"
    : phase === "alternatives" ? "border-yellow-400/50 bg-yellow-400/10 text-yellow-400"
    : "border-[hsl(var(--primary)/0.45)] bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.18)] disabled:opacity-50";

  const sizeClass =
    variant === "compact" ? "px-1 py-px text-[8px] rounded-[3px]"
    : variant === "pill" ? "px-1.5 py-0.5 text-[9px] rounded-[var(--radius-sm)]"
    : "";

  const btn = variant === "button" ? (
    <Button
      variant="outline"
      size="sm"
      className={cn("h-6 text-[10px] gap-1", phase !== "idle" && colorClass, className)}
      disabled={busy}
      onClick={handleWear}
      title={errorMsg || undefined}
    >
      {btnContent}
    </Button>
  ) : (
    <button
      type="button"
      disabled={busy}
      onClick={handleWear}
      title={errorMsg || undefined}
      className={cn(
        "shrink-0 flex items-center gap-1 border font-semibold transition-colors",
        sizeClass, colorClass, className,
      )}
    >
      {btnContent}
    </button>
  );

  return (
    <>
      {btn}

      {/* ── Alternatives Dialog ─────────────────────────────────────── */}
      <Dialog open={altOpen} onOpenChange={(open) => {
        setAltOpen(open);
        if (!open) setPhase("idle");
      }}>
        <DialogContent className="max-w-lg">
          <DialogTitle className="flex items-center gap-2 text-[14px]">
            <Search className="size-4 text-yellow-400" />
            {t("wear.altTitle", { defaultValue: "Public Alternatives Found" })}
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            {t("wear.altDesc", {
              defaultValue: "The original avatar can't be cloned. Here are similar public avatars you can wear instead:",
            })}
          </DialogDescription>

          <div className="mt-2 flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto">
            {alternatives.map((alt) => (
              <div
                key={alt.id}
                className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--surface-raised))] px-3 py-2 hover:bg-[hsl(var(--surface))] transition-colors"
              >
                {alt.thumbnailImageUrl ? (
                  <div className="size-10 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))]">
                    <ThumbImage
                      src={alt.thumbnailImageUrl}
                      seedKey={alt.id}
                      label={alt.name}
                      alt=""
                      className="h-full w-full border-0"
                      aspect=""
                      rounded=""
                    />
                  </div>
                ) : (
                  <div className="flex size-10 items-center justify-center rounded-[var(--radius-sm)] bg-[hsl(var(--muted))]">
                    <Shirt className="size-4 text-[hsl(var(--muted-foreground))]" />
                  </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[12px] font-medium">{alt.name}</span>
                  <span className="truncate text-[10px] text-[hsl(var(--muted-foreground))]">{alt.authorName}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px] gap-1 shrink-0"
                  onClick={async () => {
                    if (await doWear(alt.id, alt.name)) {
                      setAltOpen(false);
                    }
                  }}
                >
                  <Shirt className="size-3" />
                  {t("wear.btn", { defaultValue: "Wear" })}
                </Button>
              </div>
            ))}
          </div>

          {alternatives.length === 0 ? (
            <div className="py-6 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("wear.noAlternatives", { defaultValue: "No public alternatives found." })}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
