import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, GripVertical, Loader2, Pause, Play, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OSC_CARD_GROUPS, type OscStudioCard } from "@/lib/osc-studio";

interface MessageCardProps {
  card: OscStudioCard;
  active: boolean;
  autoActive: boolean;
  sending: boolean;
  preview: string;
  outgoing: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  dragging: boolean;
  onSelect: () => void;
  onToggleEnabled: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSend: () => void;
  onToggleAuto: () => void;
  onDragStart: () => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

function groupLabel(group: string): string {
  return OSC_CARD_GROUPS.find((g) => g.id === group)?.label ?? group;
}

/**
 * One OSC message in the list. This is the primary object users manipulate.
 * Clicking selects it for editing; the row shows the resolved preview and a
 * send / auto toggle so common actions never require opening the editor.
 */
export function MessageCard({
  card,
  active,
  autoActive,
  sending,
  preview,
  outgoing,
  canMoveUp,
  canMoveDown,
  dragging,
  onSelect,
  onToggleEnabled,
  onMoveUp,
  onMoveDown,
  onSend,
  onToggleAuto,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: MessageCardProps) {
  const { t } = useTranslation();
  return (
    <div
      draggable
      role="button"
      tabIndex={0}
      aria-pressed={active}
      className={`group rounded-[var(--radius-sm)] border bg-[hsl(var(--surface-raised))] p-2 transition-opacity ${
        active
          ? "border-[hsl(var(--primary))] ring-1 ring-[hsl(var(--primary)/0.4)]"
          : "border-[hsl(var(--border))]"
      } ${dragging ? "opacity-45" : ""} ${card.enabled ? "" : "opacity-70"}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragOver={onDragOver}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
    >
      <div className="flex items-center gap-2">
        <GripVertical className="size-3.5 shrink-0 cursor-grab text-[hsl(var(--muted-foreground))]" aria-hidden />
        <Badge variant={card.enabled ? "success" : "muted"} className="h-4 shrink-0 px-1.5 text-[9px]">
          {groupLabel(card.group)}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium" title={card.title}>
          {card.title}
        </span>
        {autoActive ? (
          <Badge variant="warning" className="h-4 shrink-0 px-1.5 text-[9px]">
            {t("osc.auto.badge", { defaultValue: "AUTO" })}
          </Badge>
        ) : null}
      </div>

      <div
        className="mt-1.5 line-clamp-2 min-h-[2rem] rounded-[var(--radius-sm)] bg-[hsl(var(--canvas))] px-2 py-1 font-mono text-[10px] text-[hsl(var(--muted-foreground))]"
        title={preview}
      >
        {preview || t("osc.card.emptyPreview", { defaultValue: "(no output)" })}
      </div>
      <div className="mt-1 truncate font-mono text-[9px] text-[hsl(var(--muted-foreground))]" title={outgoing}>
        {outgoing}
      </div>

      <div className="mt-2 flex items-center gap-1">
        <Button
          size="sm"
          className="h-7 flex-1 gap-1"
          onClick={(e) => { e.stopPropagation(); onSend(); }}
          disabled={sending || !card.enabled}
        >
          {sending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
          {t("osc.card.send", { defaultValue: "Send" })}
        </Button>
        <Button
          variant={autoActive ? "default" : "outline"}
          size="sm"
          className="h-7 gap-1"
          onClick={(e) => { e.stopPropagation(); onToggleAuto(); }}
          disabled={!card.enabled}
          title={t("osc.card.autoTitle", { defaultValue: "Send automatically on an interval" })}
        >
          {autoActive ? <Pause className="size-3" /> : <Play className="size-3" />}
          {autoActive
            ? t("osc.card.autoStop", { defaultValue: "Stop" })
            : t("osc.card.autoStart", { defaultValue: "Auto" })}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(e) => { e.stopPropagation(); onToggleEnabled(); }}
          title={card.enabled
            ? t("osc.card.disable", { defaultValue: "Disable" })
            : t("osc.card.enable", { defaultValue: "Enable" })}
        >
          <span className={`size-2.5 rounded-full ${card.enabled ? "bg-[hsl(var(--success))]" : "bg-[hsl(var(--muted-foreground))]"}`} />
        </Button>
        <Button variant="ghost" size="icon-sm" disabled={!canMoveUp} onClick={(e) => { e.stopPropagation(); onMoveUp(); }} title={t("osc.card.moveUp", { defaultValue: "Move up" })}>
          <ChevronUp className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" disabled={!canMoveDown} onClick={(e) => { e.stopPropagation(); onMoveDown(); }} title={t("osc.card.moveDown", { defaultValue: "Move down" })}>
          <ChevronDown className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
