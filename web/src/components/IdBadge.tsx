import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Check, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ipc } from "@/lib/ipc";

/**
 * VRChat ID 类型前缀 → 显示颜色 + 标签
 */
const ID_META: Record<
  string,
  { color: string; bg: string; border: string; label: string; urlBase?: string }
> = {
  wrld: {
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    label: "wrld",
    urlBase: "https://vrchat.com/home/world/",
  },
  avtr: {
    color: "text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/30",
    label: "avtr",
    urlBase: "https://vrchat.com/home/avatar/",
  },
  usr: {
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    label: "usr",
    urlBase: "https://vrchat.com/home/user/",
  },
  grp: {
    color: "text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
    label: "grp",
    urlBase: "https://vrchat.com/home/group/",
  },
};

function truncateId(id: string): string {
  // "wrld_e8db4bf4-9da9-4dd4-9dc3-1cd56820f038" → "e8db…f038"
  const parts = id.split("_");
  if (parts.length < 2) return id;
  const uuid = parts.slice(1).join("_");
  if (uuid.length <= 12) return uuid;
  return `${uuid.slice(0, 4)}…${uuid.slice(-4)}`;
}

function detectPrefix(id: string): string | null {
  for (const prefix of Object.keys(ID_META)) {
    if (id.startsWith(`${prefix}_`)) return prefix;
  }
  return null;
}

interface IdBadgeProps {
  id: string;
  /** Optional human-readable name shown before the badge */
  name?: string;
  className?: string;
  size?: "xs" | "sm";
}

/**
 * Smart VRChat ID badge.
 * - Shows colored prefix tag + truncated ID by default.
 * - Click → expand to show full ID with copy + open-on-VRChat buttons.
 * - If no known prefix, falls back to a plain monospace display.
 */
export function IdBadge({ id, name, className, size = "xs" }: IdBadgeProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const prefix = detectPrefix(id);
  const meta = prefix ? ID_META[prefix] : null;
  const truncated = truncateId(id);

  const textSize = size === "xs" ? "text-[10px]" : "text-[11px]";

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success(t("common.copied", { defaultValue: "Copied" }));
    } catch {
      toast.error(t("common.copyFailed", { defaultValue: "Copy failed" }));
    }
  }

  function handleOpen(e: React.MouseEvent) {
    e.stopPropagation();
    if (meta?.urlBase) {
      void ipc.call("shell.openUrl", { url: `${meta.urlBase}${id}` });
    }
  }

  if (!meta) {
    // Unknown ID format — plain monospace fallback
    return (
      <span
        className={cn("font-mono text-[10px] text-[hsl(var(--muted-foreground))]", className)}
      >
        {id}
      </span>
    );
  }

  return (
    <span className={cn("inline-flex flex-col gap-0.5", className)}>
      {name && (
        <span className="text-[11px] font-medium text-[hsl(var(--foreground))]">{name}</span>
      )}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5",
          "transition-all duration-150 hover:brightness-110",
          meta.bg,
          meta.border,
          textSize,
        )}
        title={id}
      >
        <span className={cn("font-bold uppercase tracking-wider", meta.color, textSize)}>
          {meta.label}
        </span>
        <span className="font-mono text-[hsl(var(--muted-foreground))]">{truncated}</span>
      </button>

      {expanded && (
        <div
          className={cn(
            "flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1",
            meta.bg,
            meta.border,
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <span className={cn("flex-1 break-all font-mono text-[9.5px] text-[hsl(var(--muted-foreground))]")}>
            {id}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
            title={t("common.copyId", { defaultValue: "Copy ID" })}
          >
            {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
          </button>
          {meta.urlBase && (
            <button
              type="button"
              onClick={handleOpen}
              className="shrink-0 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
              title={t("common.openOnVrchat", { defaultValue: "Open on VRChat website" })}
            >
              <ExternalLink className="size-3" />
            </button>
          )}
        </div>
      )}
    </span>
  );
}
