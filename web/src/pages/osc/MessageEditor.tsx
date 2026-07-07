import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Info, Loader2, Pause, Play, Send, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { VariablePicker } from "./VariablePicker";
import {
  OSC_CARD_GROUPS,
  type HardwareSnapshot,
  type OscCardGroup,
  type OscStudioCard,
  type OscValueType,
} from "@/lib/osc-studio";
import type { AutoSendStatus } from "@/lib/useOscStudio";
import { isTemplateCard, outgoingSpecForCard, type TemplateExtras } from "./shared";

const VALUE_TYPES: OscValueType[] = ["int", "float", "string", "bool"];

interface MessageEditorProps {
  card: OscStudioCard | null;
  hardware: HardwareSnapshot | null;
  now: Date;
  musicExtras?: TemplateExtras;
  sending: boolean;
  autoActive: boolean;
  autoStatus: AutoSendStatus | null;
  nowMs: number;
  onPatch: (patch: Partial<OscStudioCard>) => void;
  onRemove: () => void;
  onSend: () => void;
  onStartAuto: () => void;
  onStopAuto: () => void;
}

/**
 * Single editor for the selected message. Template cards get one text field
 * plus an "insert variable" picker and a live preview of both the rendered
 * text and the exact OSC address/type that will be sent. Value cards get an
 * address + type + value form. No competing drag-block vs raw-text inputs.
 */
export function MessageEditor({
  card,
  hardware,
  now,
  musicExtras = {},
  sending,
  autoActive,
  autoStatus,
  nowMs,
  onPatch,
  onRemove,
  onSend,
  onStartAuto,
  onStopAuto,
}: MessageEditorProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  if (!card) {
    return (
      <Card elevation="flat" className="flex min-h-[220px] items-center justify-center p-6 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
        {t("osc.editor.empty", { defaultValue: "Select a message on the left, or add one to start editing." })}
      </Card>
    );
  }

  const templateCard = isTemplateCard(card);
  const templateText = card.template ?? "";
  const spec = outgoingSpecForCard(card, hardware, now, musicExtras);
  const rendered = spec.argPreview;
  const nextSendInSec = autoStatus?.nextSendAt
    ? Math.max(0, Math.ceil((autoStatus.nextSendAt - nowMs) / 1000))
    : null;

  function insertToken(token: string) {
    const el = textareaRef.current;
    const current = templateText;
    if (!el) {
      onPatch({ template: current ? `${current} ${token}` : token });
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    const next = `${current.slice(0, start)}${token}${current.slice(end)}`;
    onPatch({ template: next });
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  }

  return (
    <Card elevation="flat" className="overflow-hidden p-0">
      <div className="unity-panel-header flex items-center justify-between gap-2">
        <span className="truncate">{t("osc.editor.title", { defaultValue: "Edit message" })}</span>
        <Button variant="ghost" size="icon-sm" onClick={onRemove} title={t("osc.editor.delete", { defaultValue: "Delete message" })}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="grid min-w-0 gap-3 p-3">
        {/* Title + group */}
        <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
          <label className="grid gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              {t("osc.editor.name", { defaultValue: "Name" })}
            </span>
            <Input value={card.title} onChange={(e) => onPatch({ title: e.target.value })} className="h-8 text-[12px]" />
          </label>
          <label className="grid gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              {t("osc.editor.group", { defaultValue: "Group" })}
            </span>
            <select
              value={card.group}
              onChange={(e) => onPatch({ group: e.target.value as OscCardGroup })}
              className="h-8 rounded-[var(--radius-sm)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface-bright))] px-2 text-[12px]"
            >
              {OSC_CARD_GROUPS.map((group) => (
                <option key={group.id} value={group.id}>{group.label}</option>
              ))}
            </select>
          </label>
        </div>

        {templateCard ? (
          <div className="grid min-w-0 gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                {t("osc.editor.template", { defaultValue: "Chatbox text" })}
              </span>
              <VariablePicker hardware={hardware} now={now} musicExtras={musicExtras} onInsert={insertToken} />
            </div>
            <textarea
              ref={textareaRef}
              value={templateText}
              onChange={(e) => onPatch({ template: e.target.value })}
              wrap="soft"
              className="min-h-[96px] w-full min-w-0 resize-y whitespace-pre-wrap break-words rounded-[var(--radius-sm)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface-bright))] px-2 py-2 font-mono text-[12px] leading-relaxed outline-none focus:border-[hsl(var(--primary))]"
              placeholder={t("osc.editor.templatePlaceholder", { defaultValue: "Type text and insert {variables}. Example: CPU {cpu.loadPct} {cpu.tempC}" })}
            />
          </div>
        ) : (
          <div className="grid gap-2">
            <label className="grid gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                {t("osc.editor.address", { defaultValue: "OSC address" })}
              </span>
              <Input value={card.address} onChange={(e) => onPatch({ address: e.target.value })} className="h-8 font-mono text-[12px]" placeholder="/avatar/parameters/..." />
            </label>
            <div className="grid gap-2 sm:grid-cols-[120px_1fr]">
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  {t("osc.editor.type", { defaultValue: "Type" })}
                </span>
                <select
                  value={card.valueType}
                  onChange={(e) => onPatch({ valueType: e.target.value as OscValueType })}
                  className="h-8 rounded-[var(--radius-sm)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface-bright))] px-2 text-[12px]"
                >
                  {VALUE_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  {t("osc.editor.value", { defaultValue: "Value" })}
                </span>
                <Input value={card.value} onChange={(e) => onPatch({ value: e.target.value })} className="h-8 font-mono text-[12px]" />
              </label>
            </div>
          </div>
        )}

        {/* Live "what will be sent" preview */}
        <div className="grid gap-1.5 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            <Info className="size-3" />
            {t("osc.editor.previewLabel", { defaultValue: "Will send" })}
          </div>
          {templateCard ? (
            <>
              <div className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] break-all rounded-[var(--radius-sm)] bg-[hsl(var(--surface-bright))] px-2 py-1.5 text-[13px] leading-relaxed">
                {rendered || t("osc.editor.noOutput", { defaultValue: "(nothing — template resolves to empty)" })}
              </div>
              <div className="text-right font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                {rendered.length}/144
              </div>
            </>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 font-mono text-[10px]">
            <span className="min-w-0 break-all text-[hsl(var(--primary))]">{spec.address}</span>
            <ArrowRight className="size-3 shrink-0 text-[hsl(var(--muted-foreground))]" />
            <Badge variant="muted" className="h-4 shrink-0 px-1.5 text-[9px]">{spec.valueType}</Badge>
            <span className="min-w-0 break-all text-[hsl(var(--foreground))]" title={spec.argPreview}>{spec.argPreview || "--"}</span>
          </div>
        </div>

        {/* Auto-send status */}
        {autoStatus && autoActive ? (
          <div className="grid gap-1 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-2 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                {t("osc.auto.stats", { defaultValue: "Sent {{sent}} · skipped {{skipped}}", sent: autoStatus.sendCount, skipped: autoStatus.skipCount })}
                {nextSendInSec !== null ? ` · ${t("osc.auto.nextIn", { defaultValue: "next {{seconds}}s", seconds: nextSendInSec })}` : ""}
              </span>
              <Badge variant={autoStatus.state === "error" ? "destructive" : autoStatus.state === "skipped" ? "warning" : "success"} className="h-4 px-1.5 text-[9px]">
                {autoStatus.state.toUpperCase()}
              </Badge>
            </div>
            {autoStatus.lastError ? (
              <div className="text-[hsl(var(--warning))]">{autoStatus.lastError}</div>
            ) : null}
          </div>
        ) : null}

        {/* Interval + actions */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-2 py-1 text-[10px] text-[hsl(var(--muted-foreground))]">
            <span>{t("osc.editor.interval", { defaultValue: "Every" })}</span>
            <Input
              type="number"
              min={1}
              value={card.autoIntervalSec ?? 1}
              onChange={(e) => onPatch({ autoIntervalSec: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              className="h-6 w-14 border-0 bg-transparent px-1 font-mono text-[11px] focus-visible:ring-0"
            />
            <span>{t("common.seconds", { defaultValue: "s" })}</span>
          </label>
          <div className="flex-1" />
          <Button size="sm" className="h-8 gap-1.5" onClick={onSend} disabled={sending || !card.enabled}>
            {sending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
            {t("osc.editor.send", { defaultValue: "Send now" })}
          </Button>
          {autoActive ? (
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onStopAuto}>
              <Pause className="size-3" />
              {t("osc.editor.stopAuto", { defaultValue: "Stop auto" })}
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onStartAuto} disabled={!card.enabled}>
              <Play className="size-3" />
              {t("osc.editor.startAuto", { defaultValue: "Auto send" })}
            </Button>
          )}
        </div>
        {templateCard ? (
          <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
            {t("osc.editor.rateHint", { defaultValue: "Chatbox limit: 5 manual sends per 5s; auto send throttles to one message every 2s." })}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
