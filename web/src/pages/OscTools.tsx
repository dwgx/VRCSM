import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Send, Square, Play, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ipc } from "@/lib/ipc";

type OscType = "int" | "float" | "string" | "bool";

interface OscMessageEvent {
  address: string;
  args: (number | string | boolean)[];
}

interface OscLogEntry {
  ts: string;
  address: string;
  args: (number | string | boolean)[];
}

const MAX_LOG_ENTRIES = 200;

/**
 * OSC tools page — direct send/listen surface against VRChat's OSC port
 * (`127.0.0.1:9000` out, `:9001` in by default). Useful for debugging
 * avatar parameters, ChatBox messages, and verifying that VRChat is
 * actually emitting expected events.
 *
 * Send: pick a type, type the OSC address (e.g. `/avatar/parameters/Foo`)
 * and a value, hit Send. Listen: start a UDP receiver on the chosen
 * port and watch the rolling log of incoming messages.
 */
export default function OscTools() {
  const { t } = useTranslation();
  const [address, setAddress] = useState("/avatar/parameters/MuteSelf");
  const [valueType, setValueType] = useState<OscType>("bool");
  const [valueText, setValueText] = useState("true");
  const [host, setHost] = useState("127.0.0.1");
  const [sendPort, setSendPort] = useState(9000);
  const [sending, setSending] = useState(false);

  const [listenPort, setListenPort] = useState(9001);
  const [listening, setListening] = useState(false);
  const [log, setLog] = useState<OscLogEntry[]>([]);
  const logRef = useRef<HTMLDivElement | null>(null);

  // Sub to incoming OSC messages once on mount; the frontend toggles
  // the listener via the start/stop buttons. The subscription stays
  // live regardless so a previous-session listen kept on the host
  // keeps populating the log.
  useEffect(() => {
    const unsub = ipc.on<OscMessageEvent>("osc.message", (msg) => {
      setLog((prev) => {
        const entry: OscLogEntry = {
          ts: new Date().toISOString().slice(11, 23),
          address: msg.address,
          args: msg.args,
        };
        const next = [entry, ...prev];
        return next.length > MAX_LOG_ENTRIES ? next.slice(0, MAX_LOG_ENTRIES) : next;
      });
    });
    return unsub;
  }, []);

  function coerceValue(): number | string | boolean | null {
    switch (valueType) {
      case "int": {
        const n = parseInt(valueText, 10);
        return Number.isFinite(n) ? n : null;
      }
      case "float": {
        const n = parseFloat(valueText);
        return Number.isFinite(n) ? n : null;
      }
      case "bool":
        return valueText.toLowerCase() === "true" || valueText === "1";
      case "string":
      default:
        return valueText;
    }
  }

  async function send() {
    const value = coerceValue();
    if (value === null) {
      toast.error(t("osc.invalidValue", { defaultValue: "Value can't be parsed" }));
      return;
    }
    if (!address.startsWith("/")) {
      toast.error(t("osc.invalidAddress", { defaultValue: "Address must start with /" }));
      return;
    }
    try {
      setSending(true);
      await ipc.oscSend(address, [value], { host, port: sendPort });
      toast.success(t("osc.sent", { defaultValue: "Sent" }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function toggleListen() {
    try {
      if (listening) {
        await ipc.oscListenStop();
        setListening(false);
      } else {
        await ipc.oscListenStart(listenPort);
        setListening(true);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-[16px] font-semibold tracking-tight">
          {t("osc.title", { defaultValue: "OSC Tools" })}
        </h1>
        <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
          {t("osc.subtitle", {
            defaultValue:
              "Send and receive Open Sound Control messages against VRChat. Out → :9000, In ← :9001 by default.",
          })}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("osc.send", { defaultValue: "Send" })}</CardTitle>
          <CardDescription>
            {t("osc.sendDesc", {
              defaultValue:
                "Fire a single OSC message. Use addresses like /avatar/parameters/Foo for avatar parameters or /chatbox/input for ChatBox.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="/avatar/parameters/MuteSelf"
              className="h-8 font-mono text-[12px]"
            />
            <select
              value={valueType}
              onChange={(e) => setValueType(e.target.value as OscType)}
              className="h-8 rounded-[var(--radius-sm)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface-bright))] px-2 text-[12px]"
            >
              <option value="int">int</option>
              <option value="float">float</option>
              <option value="string">string</option>
              <option value="bool">bool</option>
            </select>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_120px_120px_120px]">
            <Input
              value={valueText}
              onChange={(e) => setValueText(e.target.value)}
              placeholder={
                valueType === "bool"
                  ? "true / false"
                  : valueType === "string"
                    ? "Hello"
                    : "0"
              }
              className="h-8 font-mono text-[12px]"
            />
            <Input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className="h-8 font-mono text-[12px]"
            />
            <Input
              type="number"
              value={sendPort}
              onChange={(e) => setSendPort(parseInt(e.target.value, 10) || 9000)}
              className="h-8 font-mono text-[12px]"
            />
            <Button
              variant="default"
              size="sm"
              onClick={() => void send()}
              disabled={sending}
              className="h-8 gap-1"
            >
              <Send className="size-3.5" />
              {t("osc.sendButton", { defaultValue: "Send" })}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {t("osc.listen", { defaultValue: "Listen" })}
            {listening ? (
              <Badge variant="default" className="rounded-[var(--radius-sm)] px-2 text-[10px]">
                {t("osc.listening", { defaultValue: "Listening" })}
              </Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            {t("osc.listenDesc", {
              defaultValue:
                "Bind a UDP socket and log every OSC message VRChat (or any sender) emits.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={listenPort}
              onChange={(e) => setListenPort(parseInt(e.target.value, 10) || 9001)}
              disabled={listening}
              className="h-8 w-24 font-mono text-[12px]"
            />
            <Button
              variant={listening ? "outline" : "default"}
              size="sm"
              onClick={() => void toggleListen()}
              className="h-8 gap-1"
            >
              {listening ? (
                <>
                  <Square className="size-3.5" />
                  {t("osc.stop", { defaultValue: "Stop" })}
                </>
              ) : (
                <>
                  <Play className="size-3.5" />
                  {t("osc.start", { defaultValue: "Start" })}
                </>
              )}
            </Button>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLog([])}
              disabled={log.length === 0}
              className="h-8 gap-1"
            >
              <Trash2 className="size-3.5" />
              {t("osc.clear", { defaultValue: "Clear log" })}
            </Button>
          </div>

          <ScrollArea className="h-[320px] rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
            <div ref={logRef} className="p-2 text-[11px] font-mono">
              {log.length === 0 ? (
                <div className="p-4 text-center text-[hsl(var(--muted-foreground))]">
                  {listening
                    ? t("osc.empty", { defaultValue: "Waiting for messages…" })
                    : t("osc.notListening", { defaultValue: "Listener stopped" })}
                </div>
              ) : (
                log.map((entry, i) => (
                  <div
                    key={`${entry.ts}-${i}`}
                    className="flex items-start gap-2 border-b border-[hsl(var(--border)/0.5)] py-1 last:border-0"
                  >
                    <span className="text-[hsl(var(--muted-foreground))]">{entry.ts}</span>
                    <span className="text-[hsl(var(--primary))]">{entry.address}</span>
                    <span className="text-[hsl(var(--foreground))]">
                      {entry.args.map((a) => JSON.stringify(a)).join(" ")}
                    </span>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
      {/* Chatbox Quick Send */}
      <ChatboxPanel />
    </div>
  );
}

function ChatboxPanel() {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const lastSent = useRef(0);

  async function sendChatbox() {
    if (!message.trim()) return;
    const now = Date.now();
    if (now - lastSent.current < 2000) {
      toast.error(t("osc.chatbox.rateLimit", { defaultValue: "Wait 2 seconds between messages (VRChat rate limit)" }));
      return;
    }
    setSending(true);
    try {
      await ipc.oscSend("/chatbox/input", [message.trim(), true, true]);
      lastSent.current = Date.now();
      toast.success(t("osc.chatbox.sent", { defaultValue: "Chatbox sent" }));
      setMessage("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="unity-panel">
      <CardHeader>
        <CardTitle className="text-[12px] font-mono uppercase tracking-wider">
          {t("osc.chatbox.title", { defaultValue: "Chatbox Quick Send" })}
        </CardTitle>
        <CardDescription className="text-[11px]">
          {t("osc.chatbox.desc", { defaultValue: "Send text to VRChat chatbox via OSC. Max 144 chars, 2-second cooldown." })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 144))}
            onKeyDown={(e) => { if (e.key === "Enter") void sendChatbox(); }}
            placeholder={t("osc.chatbox.placeholder", { defaultValue: "Type a message..." })}
            className="h-7 text-[12px] flex-1"
          />
          <Button size="sm" onClick={() => void sendChatbox()} disabled={sending || !message.trim()}>
            <Send className="size-3" />
            {t("osc.chatbox.send", { defaultValue: "Send" })}
          </Button>
        </div>
        <div className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono">
          {message.length}/144
        </div>
      </CardContent>
    </Card>
  );
}
