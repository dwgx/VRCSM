import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Ear,
  Loader2,
  Send,
  Square,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { OscValueType } from "@/lib/osc-studio";
import type { OscLogEntry, OscStudioApi } from "@/lib/useOscStudio";

const VALUE_TYPES: OscValueType[] = ["bool", "float", "int", "string"];

interface LoopPanelProps {
  studio: OscStudioApi;
}

/**
 * The send/receive loop in one view: a quick raw sender on top, the live
 * listener log below. Outbound sends are echoed into the same log (direction
 * "out") so users see the full round trip in one place.
 */
export function LoopPanel({ studio }: LoopPanelProps) {
  const { t } = useTranslation();
  const { sendRaw, setLog, listenPort, setListenPort, listening, log, clearLog, toggleListen } = studio;

  const [address, setAddress] = useState("/avatar/parameters/MuteSelf");
  const [valueType, setValueType] = useState<OscValueType>("bool");
  const [valueText, setValueText] = useState("true");
  const [sending, setSending] = useState(false);

  async function fireRaw() {
    setSending(true);
    try {
      const ok = await sendRaw(address, valueType, valueText);
      if (ok) {
        const entry: OscLogEntry = {
          ts: new Date().toISOString().slice(11, 23),
          address,
          args: [valueText],
          direction: "out",
        };
        setLog((prev) => [entry, ...prev].slice(0, 200));
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <Card elevation="flat" className="overflow-hidden p-0">
      <div className="unity-panel-header flex items-center justify-between gap-2">
        <span>{t("osc.loop.title", { defaultValue: "Send & receive" })}</span>
        {listening ? (
          <Badge variant="success" className="h-4 px-1.5 text-[9px]">
            {t("osc.loop.listening", { defaultValue: "Listening" })}
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-3 p-3">
        {/* Quick raw send */}
        <div className="grid gap-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            <ArrowUpRight className="size-3" />
            {t("osc.loop.quickSend", { defaultValue: "Quick send" })}
          </div>
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="h-8 font-mono text-[12px]"
            placeholder="/avatar/parameters/..."
            aria-label={t("osc.loop.address", { defaultValue: "Address" })}
          />
          <div className="grid grid-cols-[100px_1fr_auto] gap-2">
            <select
              value={valueType}
              onChange={(e) => setValueType(e.target.value as OscValueType)}
              className="h-8 rounded-[var(--radius-sm)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface-bright))] px-2 text-[12px]"
              aria-label={t("osc.loop.type", { defaultValue: "Value type" })}
            >
              {VALUE_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
            <Input
              value={valueText}
              onChange={(e) => setValueText(e.target.value)}
              className="h-8 font-mono text-[12px]"
              aria-label={t("osc.loop.value", { defaultValue: "Value" })}
            />
            <Button size="sm" className="h-8 gap-1.5" onClick={() => void fireRaw()} disabled={sending}>
              {sending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
              {t("osc.loop.send", { defaultValue: "Send" })}
            </Button>
          </div>
        </div>

        {/* Listener controls */}
        <div className="flex items-center gap-2 border-t border-[hsl(var(--border))] pt-3">
          <Ear className="size-3.5 text-[hsl(var(--muted-foreground))]" />
          <Input
            type="number"
            value={listenPort}
            onChange={(e) => setListenPort(parseInt(e.target.value, 10) || 9001)}
            disabled={listening}
            className="h-8 w-24 font-mono text-[12px]"
            aria-label={t("osc.loop.listenPort", { defaultValue: "Listen port" })}
          />
          <Button variant={listening ? "outline" : "default"} size="sm" className="h-8 gap-1.5" onClick={() => void toggleListen()}>
            {listening ? <Square className="size-3.5" /> : <Ear className="size-3.5" />}
            {listening ? t("osc.loop.stop", { defaultValue: "Stop" }) : t("osc.loop.start", { defaultValue: "Listen" })}
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={clearLog} disabled={log.length === 0}>
            <Trash2 className="size-3.5" />
            {t("osc.loop.clear", { defaultValue: "Clear" })}
          </Button>
        </div>

        {/* Unified in/out log */}
        <ScrollArea className="h-[260px] rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
          <div className="p-2 font-mono text-[11px]">
            {log.length === 0 ? (
              <div className="p-4 text-center text-[hsl(var(--muted-foreground))]">
                {listening
                  ? t("osc.loop.waiting", { defaultValue: "Waiting for messages..." })
                  : t("osc.loop.idle", { defaultValue: "Send a message or start the listener." })}
              </div>
            ) : (
              log.map((entry, i) => {
                const out = entry.direction === "out";
                return (
                  <div key={`${entry.ts}-${i}`} className="flex items-start gap-2 border-b border-[hsl(var(--border)/0.5)] py-1 last:border-0">
                    {out ? (
                      <ArrowUpRight className="mt-0.5 size-3 shrink-0 text-[hsl(var(--warning))]" aria-label={t("osc.loop.out", { defaultValue: "out" })} />
                    ) : (
                      <ArrowDownLeft className="mt-0.5 size-3 shrink-0 text-[hsl(var(--success))]" aria-label={t("osc.loop.in", { defaultValue: "in" })} />
                    )}
                    <span className="text-[hsl(var(--muted-foreground))]">{entry.ts}</span>
                    <span className="text-[hsl(var(--primary))]">{entry.address}</span>
                    <span className="min-w-0 break-all">{entry.args.map((a) => JSON.stringify(a)).join(" ")}</span>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>
    </Card>
  );
}
