import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Shirt, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";

interface SmartWearButtonProps {
  avatarId?: string | null;
  avatarName?: string | null;
  userId?: string | null;
  variant?: "pill" | "button" | "compact";
  className?: string;
}

type WearPhase = "idle" | "resolving" | "checking" | "wearing" | "success" | "failed";

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

  const busy = phase !== "idle" && phase !== "success" && phase !== "failed";

  async function handleWear(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setErrorMsg(null);

    let avatarId = directAvatarId || null;

    // Step 1: Resolve avatar ID from user profile if we don't have it
    if (!avatarId && userId) {
      setPhase("resolving");
      try {
        const { profile } = await ipc.call<
          { userId: string },
          { profile: { currentAvatarId?: string } | null }
        >("user.getProfile", { userId });
        avatarId = profile?.currentAvatarId || null;
      } catch {
        // continue — we'll try name search
      }
    }

    // Step 2: If still no ID, search by name
    if (!avatarId && avatarName) {
      setPhase("resolving");
      try {
        const res = await ipc.searchAvatars(avatarName, 5);
        const exact = res.avatars?.find(
          (a: any) => a.name === avatarName && a.releaseStatus === "public",
        );
        if (exact) avatarId = exact.id;
        else if (res.avatars?.length) avatarId = res.avatars[0].id;
      } catch {
        // continue
      }
    }

    if (!avatarId) {
      setPhase("failed");
      setErrorMsg(t("wear.noAvatar", { defaultValue: "Could not find this avatar." }));
      toast.error(t("wear.noAvatar", { defaultValue: "Could not find this avatar." }));
      setTimeout(() => setPhase("idle"), 3000);
      return;
    }

    // Step 3: Try direct select
    setPhase("wearing");
    try {
      await ipc.call("avatar.select", { avatarId });
      setPhase("success");
      toast.success(t("wear.success", {
        defaultValue: "Now wearing: {{name}}",
        name: avatarName || avatarId,
      }));
      setTimeout(() => setPhase("idle"), 2000);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const is403 = msg.includes("403") || msg.includes("not available");

      if (!is403) {
        setPhase("failed");
        setErrorMsg(msg);
        toast.error(msg);
        setTimeout(() => setPhase("idle"), 3000);
        return;
      }

      // Step 4: 403 — the user disabled cloning, but check if the avatar
      // ITSELF is public. If so, we can clone it directly because VRChat
      // allows cloning public avatars by their ID regardless of who's
      // wearing it. This is the VRCX behavior.
      setPhase("checking");
      try {
        const detailRes = await ipc.call<
          { id: string },
          { details: { releaseStatus?: string; name?: string } | null }
        >("avatar.details", { id: avatarId });

        const details = detailRes.details;
        if (details?.releaseStatus === "public") {
          // Avatar is public — retry the select. VRChat's API sometimes
          // accepts the second attempt after the details lookup has
          // "warmed" the session cache for this avatar.
          setPhase("wearing");
          try {
            await ipc.call("avatar.select", { avatarId });
            setPhase("success");
            toast.success(t("wear.success", {
              defaultValue: "Now wearing: {{name}}",
              name: details.name || avatarName || avatarId,
            }));
            setTimeout(() => setPhase("idle"), 2000);
            return;
          } catch {
            // Still failed — avatar is public but the API refuses anyway
          }
        }

        // Final fallback: avatar is private or truly not cloneable
        setPhase("failed");
        const reason = details?.releaseStatus === "private"
          ? t("wear.privateAvatar", { defaultValue: "This is a private avatar." })
          : t("wear.notCloneable", { defaultValue: "This avatar does not allow cloning." });
        setErrorMsg(reason);
        toast.error(reason);
        setTimeout(() => setPhase("idle"), 4000);
      } catch {
        setPhase("failed");
        setErrorMsg(t("wear.notCloneable", { defaultValue: "This avatar does not allow cloning." }));
        toast.error(t("wear.notCloneable", { defaultValue: "This avatar does not allow cloning." }));
        setTimeout(() => setPhase("idle"), 3000);
      }
    }
  }

  const phaseIcon = {
    idle: <Shirt className="size-3" />,
    resolving: <Loader2 className="size-3 animate-spin" />,
    checking: <Loader2 className="size-3 animate-spin" />,
    wearing: <Loader2 className="size-3 animate-spin" />,
    success: <CheckCircle2 className="size-3 text-emerald-400" />,
    failed: <XCircle className="size-3 text-red-400" />,
  };

  const phaseLabel = {
    idle: t("wear.btn", { defaultValue: "Wear" }),
    resolving: t("wear.resolving", { defaultValue: "Finding..." }),
    checking: t("wear.checking", { defaultValue: "Checking..." }),
    wearing: t("wear.wearing", { defaultValue: "Wearing..." }),
    success: t("wear.done", { defaultValue: "Done!" }),
    failed: t("wear.failed", { defaultValue: "Failed" }),
  };

  if (variant === "compact") {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={handleWear}
        title={errorMsg || undefined}
        className={cn(
          "shrink-0 flex items-center gap-0.5 rounded-[3px] border px-1 py-px text-[8px] font-semibold transition-colors",
          phase === "success"
            ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-400"
            : phase === "failed"
              ? "border-red-400/50 bg-red-400/10 text-red-400"
              : "border-[hsl(var(--primary)/0.45)] bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.18)] disabled:opacity-50",
          className,
        )}
      >
        {phaseIcon[phase]}
        {phaseLabel[phase]}
      </button>
    );
  }

  if (variant === "pill") {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={handleWear}
        title={errorMsg || undefined}
        className={cn(
          "flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[9px] font-semibold transition-colors",
          phase === "success"
            ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-400"
            : phase === "failed"
              ? "border-red-400/50 bg-red-400/10 text-red-400"
              : "border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.18)] disabled:opacity-50",
          className,
        )}
      >
        {phaseIcon[phase]}
        {phaseLabel[phase]}
      </button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className={cn(
        "h-6 text-[10px] gap-1",
        phase === "success" && "border-emerald-400/50 text-emerald-400",
        phase === "failed" && "border-red-400/50 text-red-400",
        className,
      )}
      disabled={busy}
      onClick={handleWear}
      title={errorMsg || undefined}
    >
      {phaseIcon[phase]}
      {phaseLabel[phase]}
    </Button>
  );
}
