import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Boxes,
  Cpu,
  Download,
  Gauge,
  GripVertical,
  Import,
  Layers3,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  Send,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
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
import { useReport } from "@/lib/report-context";
import {
  sendChatbox,
  sendOscMessage,
  startOscListener,
  stopOscListener,
} from "@/lib/osc-api";
import {
  OSC_CARD_GROUPS,
  OSC_STUDIO_SCENES,
  OSC_TEMPLATE_CARDS,
  appendOscScene,
  cardPreview,
  coerceOscValue,
  createAvatarParameterCard,
  exportOscStudioProfile,
  importOscStudioProfile,
  loadOscStudioCards,
  moveOscCard,
  moveOscCardToIndex,
  resetOscStudioCards,
  saveOscStudioCards,
  updateOscCard,
  type HardwareSnapshot,
  type HardwareTelemetrySnapshot,
  type RamModuleInfo,
  type OscCardGroup,
  type OscStudioCard,
  type OscTemplateComponentCard,
  type OscValueType,
  type SensorReading,
} from "@/lib/osc-studio";
import type { LocalAvatarItem } from "@/lib/types";

interface OscMessageEvent {
  address: string;
  args: (number | string | boolean)[];
}

interface OscLogEntry {
  ts: string;
  address: string;
  args: (number | string | boolean)[];
}

interface HwRecommendResponse {
  report: {
    cpu_name?: string | null;
    cpu_cores?: number | null;
    cpu_threads?: number | null;
    cpu_clock_mhz?: number | null;
    gpu_name?: string | null;
    gpu_vram_bytes?: number | null;
    gpu_driver?: string | null;
    gpu_vendor?: string | null;
    gpu_pnp_id?: string | null;
    gpu_source?: string | null;
    gpu_virtual?: boolean | null;
    ram_bytes?: number | null;
    hmd_model?: string | null;
    hmd_manufacturer?: string | null;
    os_build?: string | null;
  };
}

interface AvatarParametersResponse {
  avatar_id: string;
  user_id: string;
  path: string;
  parameters: Array<{
    name: string;
    value_type: OscValueType | string;
    default_value: unknown;
  }>;
}

const MAX_LOG_ENTRIES = 200;
const AUTO_TELEMETRY_REFRESH_MS = 5000;
const CHATBOX_MANUAL_RATE_WINDOW_MS = 5000;
const CHATBOX_MANUAL_RATE_BURST = 5;
const CHATBOX_AUTO_RATE_LIMIT_MS = 2000;

interface SendCardOptions {
  silentSuccess?: boolean;
  shouldContinue?: () => boolean;
  chatboxRateMode?: "manual" | "auto" | "none";
  chatboxNotify?: boolean;
}

type ChatboxMessageSource = string | (() => string);

interface SendOutcome {
  status: "sent" | "skipped" | "cancelled";
  message?: string;
  reason?: string;
}

interface AutoSendStatus {
  cardId: string;
  title: string;
  state: "running" | "waiting" | "sent" | "skipped" | "error";
  sendCount: number;
  skipCount: number;
  lastMessage?: string;
  lastSentAt?: number;
  lastError?: string;
  nextSendAt?: number;
}

interface OscTemplateBlock {
  id: string;
  text: string;
  kind: "component" | "text";
}

type OscTemplateComponentFilter = OscTemplateComponentCard["group"] | "recommended";

export default function OscTools() {
  const { t } = useTranslation();
  const { report } = useReport();
  const [cards, setCards] = useState<OscStudioCard[]>(() => loadOscStudioCards());
  const [selectedId, setSelectedId] = useState<string | null>(() => cards[0]?.id ?? null);
  const [hardware, setHardware] = useState<HardwareSnapshot | null>(null);
  const [hardwareLoading, setHardwareLoading] = useState(false);
  const [host, setHost] = useState("127.0.0.1");
  const [sendPort, setSendPort] = useState(9000);
  const [activeAutoId, setActiveAutoId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [draggedTemplate, setDraggedTemplate] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<OscCardGroup | "all">("all");
  const [profileText, setProfileText] = useState("");
  const [selectedSceneId, setSelectedSceneId] = useState(OSC_STUDIO_SCENES[0]?.id ?? "");
  const [avatarId, setAvatarId] = useState("");
  const [avatarParamType, setAvatarParamType] = useState<OscValueType>("bool");
  const [manualParamName, setManualParamName] = useState("MuteSelf");
  const [avatarParamsLoading, setAvatarParamsLoading] = useState(false);
  const [avatarParameters, setAvatarParameters] = useState<AvatarParametersResponse | null>(null);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const [componentFilter, setComponentFilter] = useState<OscTemplateComponentFilter>("recommended");
  const [componentSearch, setComponentSearch] = useState("");
  const [autoStatus, setAutoStatus] = useState<AutoSendStatus | null>(null);
  const [manualSendingId, setManualSendingId] = useState<string | null>(null);
  const autoTimerRef = useRef<number | null>(null);
  const autoRunIdRef = useRef(0);
  const autoStatsRef = useRef({ sendCount: 0, skipCount: 0 });
  const latestCardsRef = useRef(cards);
  const hardwareRef = useRef<HardwareSnapshot | null>(hardware);
  const hostRef = useRef(host);
  const sendPortRef = useRef(sendPort);
  const manualChatboxSentRef = useRef<number[]>([]);
  const lastChatboxAutoSentRef = useRef(0);
  const lastHardwareRefreshRef = useRef(0);

  const [address, setAddress] = useState("/avatar/parameters/MuteSelf");
  const [valueType, setValueType] = useState<OscValueType>("bool");
  const [valueText, setValueText] = useState("true");
  const [sending, setSending] = useState(false);

  const [listenPort, setListenPort] = useState(9001);
  const [listening, setListening] = useState(false);
  const [log, setLog] = useState<OscLogEntry[]>([]);

  const selectedCard = useMemo(
    () => cards.find((card) => card.id === selectedId) ?? cards[0] ?? null,
    [cards, selectedId],
  );
  const visibleCards = useMemo(
    () => activeGroup === "all" ? cards : cards.filter((card) => card.group === activeGroup),
    [activeGroup, cards],
  );
  const selectedPreview = selectedCard
    ? cardPreview(selectedCard, { hardware, now: new Date(clockTick) })
    : "";
  const localAvatars = report?.local_avatar_data.recent_items ?? [];

  useEffect(() => {
    hardwareRef.current = hardware;
  }, [hardware]);

  useEffect(() => {
    hostRef.current = host;
  }, [host]);

  useEffect(() => {
    sendPortRef.current = sendPort;
  }, [sendPort]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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

  useEffect(() => {
    void refreshHardware();
    return () => stopAutoSend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!avatarId && localAvatars[0]) {
      setAvatarId(localAvatars[0].avatar_id);
    }
  }, [avatarId, localAvatars]);

  function commitCards(nextOrUpdater: OscStudioCard[] | ((prev: OscStudioCard[]) => OscStudioCard[])) {
    setCards((prev) => {
      const next = typeof nextOrUpdater === "function"
        ? (nextOrUpdater as (prev: OscStudioCard[]) => OscStudioCard[])(prev)
        : nextOrUpdater;
      latestCardsRef.current = next;
      saveOscStudioCards(next);
      return next;
    });
  }

  function patchCard(cardId: string, patch: Partial<OscStudioCard>) {
    commitCards((prev) => updateOscCard(prev, cardId, patch));
  }

  function moveCard(cardId: string, direction: -1 | 1) {
    commitCards((prev) => moveOscCard(prev, cardId, direction));
  }

  function dragStart(cardId: string) {
    setDraggedId(cardId);
  }

  function dragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function dropOnCard(targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    const targetIndex = cards.findIndex((card) => card.id === targetId);
    commitCards((prev) => moveOscCardToIndex(prev, draggedId, targetIndex));
    setDraggedId(null);
  }

  function setSelectedTemplateText(template: string) {
    if (!selectedCard) {
      const card = createTemplateCard(template);
      commitCards((prev) => [...prev, card]);
      setSelectedId(card.id);
      return;
    }
    patchCard(selectedCard.id, templatePatchForCard(selectedCard, template));
  }

  function insertTemplateComponent(template: string) {
    const currentText = templateTextForCard(selectedCard);
    setSelectedTemplateText(appendTemplateFragment(currentText, template));
    setDraggedTemplate(null);
  }

  async function refreshHardware(silent = false) {
    const startedAt = Date.now();
    setHardwareLoading(true);
    try {
      const [recommendResult, telemetryResult] = await Promise.allSettled([
        ipc.call<undefined, HwRecommendResponse>("hw.recommend"),
        ipc.call<undefined, HardwareTelemetrySnapshot>("hw.telemetry").catch((err) => {
          console.warn("hw.telemetry unavailable", err);
          return null;
        }),
      ]);
      const recommend = recommendResult.status === "fulfilled" ? recommendResult.value : null;
      const telemetry = telemetryResult.status === "fulfilled" ? telemetryResult.value : null;
      if (!recommend && !telemetry) {
        const reason = recommendResult.status === "rejected" ? recommendResult.reason : telemetryResult.status === "rejected" ? telemetryResult.reason : null;
        throw reason instanceof Error ? reason : new Error(String(reason ?? "Hardware detection failed"));
      }
      const previous = hardwareRef.current;
      const primaryAdapter = telemetry?.gpu_adapters?.find((adapter) => adapter.primary_candidate)
        ?? telemetry?.gpu_adapters?.[0]
        ?? null;
      const snapshot = {
        cpuName: recommend?.report.cpu_name ?? previous?.cpuName,
        cpuCores: recommend?.report.cpu_cores ?? previous?.cpuCores,
        cpuThreads: recommend?.report.cpu_threads ?? previous?.cpuThreads,
        cpuClockMhz: recommend?.report.cpu_clock_mhz ?? previous?.cpuClockMhz,
        gpuName: recommend?.report.gpu_name ?? telemetry?.gpu?.name ?? primaryAdapter?.name ?? previous?.gpuName,
        gpuVramBytes: recommend?.report.gpu_vram_bytes ?? telemetry?.gpu?.memory_total_bytes ?? primaryAdapter?.dedicated_video_memory_bytes ?? primaryAdapter?.adapter_ram_bytes ?? previous?.gpuVramBytes,
        gpuDriver: recommend?.report.gpu_driver ?? primaryAdapter?.driver_version ?? previous?.gpuDriver,
        gpuVendor: recommend?.report.gpu_vendor ?? primaryAdapter?.vendor ?? previous?.gpuVendor,
        gpuPnpId: recommend?.report.gpu_pnp_id ?? primaryAdapter?.pnp_id ?? previous?.gpuPnpId,
        gpuSource: recommend?.report.gpu_source ?? telemetry?.gpu?.primary_source ?? primaryAdapter?.source ?? previous?.gpuSource,
        gpuVirtual: recommend?.report.gpu_virtual ?? primaryAdapter?.virtual ?? previous?.gpuVirtual,
        ramBytes: recommend?.report.ram_bytes ?? telemetry?.memory?.total_bytes ?? previous?.ramBytes,
        hmdModel: recommend?.report.hmd_model ?? previous?.hmdModel,
        hmdManufacturer: recommend?.report.hmd_manufacturer ?? previous?.hmdManufacturer,
        osBuild: recommend?.report.os_build ?? previous?.osBuild,
        telemetry,
      };
      if (!recommend || !telemetry) {
        console.warn("Partial OSC hardware snapshot", {
          recommend: recommendResult.status,
          telemetry: telemetryResult.status,
        });
      }
      hardwareRef.current = snapshot;
      lastHardwareRefreshRef.current = startedAt;
      setHardware(snapshot);
    } catch (err) {
      if (!silent) {
        toast.error(err instanceof Error ? err.message : String(err));
      } else {
        console.warn("hw refresh failed during OSC auto send", err);
      }
    } finally {
      setHardwareLoading(false);
    }
  }

  async function sendCard(card: OscStudioCard, options: SendCardOptions = {}): Promise<SendOutcome> {
    if (!card.enabled) {
      return { status: "skipped", reason: t("osc.studio.cardDisabled", { defaultValue: "Card is disabled" }) };
    }
    if (options.shouldContinue && !options.shouldContinue()) return { status: "cancelled" };
    if (!card.address.startsWith("/")) {
      toast.error(t("osc.invalidAddress", { defaultValue: "Address must start with /" }));
      return { status: "skipped", reason: t("osc.invalidAddress", { defaultValue: "Address must start with /" }) };
    }

    if (isChatboxCard(card)) {
      return await sendChatboxWithLimit(
        () => cardPreview(card, { hardware: hardwareRef.current, now: new Date() }),
        options,
      );
    }

    const value = coerceOscValue(card.valueType, card.value);
    if (value === null) {
      toast.error(t("osc.invalidValue", { defaultValue: "Value can't be parsed" }));
      return { status: "skipped", reason: t("osc.invalidValue", { defaultValue: "Value can't be parsed" }) };
    }
    if (options.shouldContinue && !options.shouldContinue()) return { status: "cancelled" };
    const result = await sendOscMessage(card.address, [value], { host: hostRef.current, port: sendPortRef.current });
    if (!result.ok) {
      throw new Error(t("osc.sendFailed", { defaultValue: "OSC send failed" }));
    }
    if (!options.silentSuccess) {
      toast.success(t("osc.sent", { defaultValue: "Sent" }));
    }
    return { status: "sent", message: `${card.address} ${card.value}`.trim() };
  }

  async function sendSelectedCard() {
    if (!selectedCard) {
      toast.error(t("osc.studio.noCardSelected", { defaultValue: "Select a card first" }));
      return;
    }
    await sendCardManually(selectedCard);
  }

  async function sendChatboxWithLimit(messageSource: ChatboxMessageSource, options: SendCardOptions = {}): Promise<SendOutcome> {
    if (options.shouldContinue && !options.shouldContinue()) return { status: "cancelled" };
    if (options.chatboxRateMode === "auto") {
      const elapsed = Date.now() - lastChatboxAutoSentRef.current;
      if (elapsed < CHATBOX_AUTO_RATE_LIMIT_MS) {
        await wait(CHATBOX_AUTO_RATE_LIMIT_MS - elapsed);
        if (options.shouldContinue && !options.shouldContinue()) return { status: "cancelled" };
      }
    }
    if (options.chatboxRateMode !== "none" && options.chatboxRateMode !== "auto") {
      const now = Date.now();
      manualChatboxSentRef.current = manualChatboxSentRef.current.filter(
        (ts) => now - ts < CHATBOX_MANUAL_RATE_WINDOW_MS,
      );
      if (manualChatboxSentRef.current.length >= CHATBOX_MANUAL_RATE_BURST) {
        const oldest = manualChatboxSentRef.current[0] ?? now;
        const waitMs = Math.max(0, CHATBOX_MANUAL_RATE_WINDOW_MS - (now - oldest));
        const reason = t("osc.chatbox.rateLimitBurst", {
          defaultValue: "Chatbox allows 5 manual messages per 5 seconds. Wait {{seconds}}s.",
          seconds: Math.max(1, Math.ceil(waitMs / 1000)),
        });
        if (!options.silentSuccess) {
          toast.error(reason);
        }
        return { status: "skipped", reason };
      }
    }
    const message = typeof messageSource === "function" ? messageSource() : messageSource;
    const trimmed = message.trim().slice(0, 144);
    if (!trimmed) {
      const reason = t("osc.studio.emptyRendered", { defaultValue: "Template has no available values" });
      if (!options.silentSuccess) {
        toast.error(reason);
      }
      return { status: "skipped", reason };
    }
    if (options.shouldContinue && !options.shouldContinue()) return { status: "cancelled" };
    const result = await sendChatbox(
      trimmed,
      { host: hostRef.current, port: sendPortRef.current },
      true,
      options.chatboxNotify ?? true,
    );
    if (!result.ok) {
      throw new Error(t("osc.sendFailed", { defaultValue: "OSC send failed" }));
    }
    if (options.chatboxRateMode === "auto") {
      lastChatboxAutoSentRef.current = Date.now();
    }
    if (options.chatboxRateMode !== "none" && options.chatboxRateMode !== "auto") {
      manualChatboxSentRef.current.push(Date.now());
    }
    if (!options.silentSuccess) {
      toast.success(t("osc.chatbox.sent", { defaultValue: "Chatbox sent" }));
    }
    return { status: "sent", message: trimmed };
  }

  function startAutoSend(cardOverride?: OscStudioCard) {
    const targetCard = cardOverride ?? selectedCard;
    if (!targetCard) {
      toast.error(t("osc.studio.noCardSelected", { defaultValue: "Select a card first" }));
      return;
    }
    stopAutoSend();
    const intervalSec = Math.max(1, targetCard.autoIntervalSec ?? 1);
    const intervalMs = intervalSec * 1000;
    const cardId = targetCard.id;
    const runId = autoRunIdRef.current + 1;
    autoRunIdRef.current = runId;
    autoStatsRef.current = { sendCount: 0, skipCount: 0 };
    setActiveAutoId(cardId);
    setAutoStatus({
      cardId,
      title: targetCard.title,
      state: "running",
      sendCount: 0,
      skipCount: 0,
      nextSendAt: Date.now(),
    });
    toast.success(t("osc.studio.autoStarted", { defaultValue: "Auto send started" }));
    let nextRunAt = Date.now();
    const isCurrentRun = () => autoRunIdRef.current === runId;

    const runOnce = async (): Promise<boolean> => {
      if (!isCurrentRun()) return false;
      const current = latestCardsRef.current.find((card) => card.id === cardId);
      if (!current) {
        setActiveAutoId(null);
        setAutoStatus((prev) => prev && prev.cardId === cardId
          ? { ...prev, state: "error", lastError: t("osc.studio.autoCardMissing", { defaultValue: "Auto-send card was removed" }) }
          : prev);
        return false;
      }
      setAutoStatus((prev) => prev && prev.cardId === cardId
        ? {
            ...prev,
            title: current.title,
            state: "running",
            lastError: undefined,
          }
        : prev);
      if (!hardwareRef.current || Date.now() - lastHardwareRefreshRef.current >= AUTO_TELEMETRY_REFRESH_MS) {
        await refreshHardware(true);
      }
      if (!isCurrentRun()) return false;
      const outcome = await sendCard(current, {
        silentSuccess: true,
        shouldContinue: isCurrentRun,
        chatboxRateMode: "auto",
        chatboxNotify: false,
      });
      if (!isCurrentRun()) return false;
      if (outcome.status === "sent") {
        autoStatsRef.current.sendCount += 1;
        setAutoStatus((prev) => prev && prev.cardId === cardId
          ? {
              ...prev,
              title: current.title,
              state: "sent",
              sendCount: autoStatsRef.current.sendCount,
              skipCount: autoStatsRef.current.skipCount,
              lastMessage: outcome.message,
              lastSentAt: Date.now(),
              lastError: undefined,
            }
          : prev);
      } else if (outcome.status === "skipped") {
        autoStatsRef.current.skipCount += 1;
        setAutoStatus((prev) => prev && prev.cardId === cardId
          ? {
              ...prev,
              title: current.title,
              state: "skipped",
              sendCount: autoStatsRef.current.sendCount,
              skipCount: autoStatsRef.current.skipCount,
              lastError: outcome.reason,
            }
          : prev);
      }
      return outcome.status !== "cancelled" && isCurrentRun();
    };

    const scheduleNext = (delayMs: number) => {
      const scheduledAt = Date.now() + Math.max(0, delayMs);
      setAutoStatus((prev) => prev && prev.cardId === cardId
        ? { ...prev, state: delayMs > 0 ? "waiting" : prev.state, nextSendAt: scheduledAt }
        : prev);
      autoTimerRef.current = window.setTimeout(() => {
        autoTimerRef.current = null;
        void (async () => {
          const shouldContinue = await runOnce();
          if (!shouldContinue || autoRunIdRef.current !== runId) return;
          nextRunAt += intervalMs;
          const nowMs = Date.now();
          while (nextRunAt <= nowMs) {
            nextRunAt += intervalMs;
          }
          scheduleNext(nextRunAt - nowMs);
        })().catch((err) => {
          if (autoRunIdRef.current === runId) {
            const message = err instanceof Error ? err.message : String(err);
            toast.error(message);
            setAutoStatus((prev) => prev && prev.cardId === cardId
              ? { ...prev, state: "error", lastError: message }
              : prev);
            nextRunAt = Date.now() + intervalMs;
            scheduleNext(intervalMs);
          }
        });
      }, Math.max(0, delayMs));
    };

    scheduleNext(0);
  }

  function stopAutoSend() {
    autoRunIdRef.current += 1;
    if (autoTimerRef.current !== null) {
      window.clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    setActiveAutoId(null);
    setAutoStatus(null);
  }

  async function sendRaw() {
    const value = coerceOscValue(valueType, valueText);
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
      const result = await sendOscMessage(address, [value], { host, port: sendPort });
      if (!result.ok) {
        throw new Error(t("osc.sendFailed", { defaultValue: "OSC send failed" }));
      }
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
        await stopOscListener();
        setListening(false);
      } else {
        await startOscListener(listenPort);
        setListening(true);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  function applyScenePreset(sceneId = selectedSceneId) {
    const scene = OSC_STUDIO_SCENES.find((item) => item.id === sceneId);
    if (!scene) return;
    setSelectedSceneId(scene.id);
    const sceneCard = scene.cards[0];
    if (!sceneCard) return;
    if (!selectedCard) {
      const next = appendOscScene(cards, scene.id);
      commitCards(next);
      setSelectedId(next[next.length - 1]?.id ?? selectedId);
      return;
    }
    patchCard(selectedCard.id, {
      ...templatePatchForCard(selectedCard, sceneCard.template ?? ""),
      title: sceneCard.title,
      enabled: true,
      autoIntervalSec: sceneCard.autoIntervalSec ?? 1,
    });
  }

  async function sendCardManually(card: OscStudioCard) {
    if (manualSendingId === card.id) return;
    setManualSendingId(card.id);
    try {
      await sendCard(card, { chatboxRateMode: "manual", chatboxNotify: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setManualSendingId((current) => current === card.id ? null : current);
    }
  }

  async function copyProfile() {
    const exported = exportOscStudioProfile(cards);
    setProfileText(exported);
    try {
      await navigator.clipboard?.writeText(exported);
      toast.success(t("osc.studio.exported", { defaultValue: "Profile copied" }));
    } catch {
      toast.success(t("osc.studio.exportReady", { defaultValue: "Profile ready" }));
    }
  }

  function importProfile() {
    try {
      const next = importOscStudioProfile(profileText);
      commitCards(next);
      setSelectedId(next[0]?.id ?? null);
      toast.success(t("osc.studio.imported", { defaultValue: "Profile imported" }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadAvatarParameters(target?: LocalAvatarItem) {
    const id = target?.avatar_id ?? avatarId.trim();
    if (!id) {
      toast.error(t("osc.studio.avatarMissing", { defaultValue: "Select or enter an avatar id" }));
      return;
    }
    setAvatarParamsLoading(true);
    try {
      const result = await ipc.call<
        { avatarId: string; userId?: string; limit: number },
        AvatarParametersResponse
      >("avatar.parameters.local", {
        avatarId: id,
        userId: target?.user_id,
        limit: 256,
      });
      setAvatarParameters(result);
      setAvatarId(result.avatar_id);
      toast.success(t("osc.studio.avatarLoaded", {
        defaultValue: "Loaded {{count}} parameters",
        count: result.parameters.length,
      }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setAvatarParamsLoading(false);
    }
  }

  function addManualParameter() {
    const card = createAvatarParameterCard(manualParamName, avatarParamType);
    commitCards((prev) => [...prev, card]);
    setSelectedId(card.id);
  }

  function addScannedParameter(name: string, type: string) {
    const safeType: OscValueType = type === "int" || type === "float" || type === "string" || type === "bool"
      ? type
      : "float";
    const card = createAvatarParameterCard(name, safeType);
    commitCards((prev) => [...prev, card]);
    setSelectedId(card.id);
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight">
            {t("osc.studio.title", { defaultValue: "OSC Studio" })}
          </h1>
          <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("osc.studio.subtitle", {
              defaultValue:
                "Build modular VRChat OSC cards, preview exactly what will be sent, then send manually or on a controlled interval.",
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            className="h-8 w-32 font-mono text-[12px]"
          />
          <Input
            type="number"
            value={sendPort}
            onChange={(e) => setSendPort(parseInt(e.target.value, 10) || 9000)}
            className="h-8 w-24 font-mono text-[12px]"
          />
          <Button variant="outline" size="sm" onClick={() => void refreshHardware()} disabled={hardwareLoading}>
            <RefreshCcw className={hardwareLoading ? "size-3 animate-spin" : "size-3"} />
            {t("osc.studio.refreshHardware", { defaultValue: "Hardware" })}
          </Button>
          {activeAutoId ? (
            <Badge variant="warning" className="h-6 px-2 text-[10px]">
              {t("osc.studio.autoRunning", { defaultValue: "AUTO" })}
            </Badge>
          ) : null}
        </div>
      </header>

      <section className="grid gap-3 xl:grid-cols-[minmax(460px,1fr)_380px]">
        <div className="grid gap-3">
          <StudioToolbar
            activeGroup={activeGroup}
            setActiveGroup={setActiveGroup}
            selectedSceneId={selectedSceneId}
            setSelectedSceneId={setSelectedSceneId}
            onApplyScene={applyScenePreset}
            onReset={() => {
              stopAutoSend();
              const next = resetOscStudioCards();
              commitCards(next);
              setSelectedId(next[0]?.id ?? null);
            }}
          />

          <TemplateBuilderPanel
            selectedCard={selectedCard}
            selectedPreview={selectedPreview}
            draggingTemplate={draggedTemplate !== null}
            activeAutoId={activeAutoId}
            autoStatus={autoStatus}
            nowMs={clockTick}
            onTemplateChange={setSelectedTemplateText}
            onPatchSelected={(patch) => {
              if (selectedCard) patchCard(selectedCard.id, patch);
            }}
            onDropTemplate={insertTemplateComponent}
            onClearTemplate={() => setSelectedTemplateText("")}
            onSend={() => void sendSelectedCard()}
            onStartAuto={startAutoSend}
            onStopAuto={stopAutoSend}
          />

          <Card elevation="flat" className="overflow-hidden p-0">
            <div className="unity-panel-header flex items-center justify-between">
              <span>{t("osc.studio.cards", { defaultValue: "Cards" })}</span>
              <Badge variant="muted" className="h-4 px-1.5 text-[9px]">
                {visibleCards.length}/{cards.length}
              </Badge>
            </div>
            <div className="grid gap-2 p-2 md:grid-cols-2">
              {visibleCards.map((card) => {
                const realIndex = cards.findIndex((item) => item.id === card.id);
                return (
                  <OscCardEditor
                    key={card.id}
                    card={card}
                    active={selectedCard?.id === card.id}
                    autoActive={activeAutoId === card.id}
                    preview={cardPreview(card, { hardware, now: new Date(clockTick) })}
                    canMoveUp={realIndex > 0}
                    canMoveDown={realIndex < cards.length - 1}
                    dragging={draggedId === card.id}
                    onSelect={() => setSelectedId(card.id)}
                    onPatch={(patch) => patchCard(card.id, patch)}
                    onMoveUp={() => moveCard(card.id, -1)}
                    onMoveDown={() => moveCard(card.id, 1)}
                    onSend={() => void sendCardManually(card)}
                    onStartAuto={() => startAutoSend(card)}
                    onStopAuto={stopAutoSend}
                    onDragStart={() => dragStart(card.id)}
                    onDragOver={dragOver}
                    onDrop={() => dropOnCard(card.id)}
                    onDragEnd={() => setDraggedId(null)}
                  />
                );
              })}
            </div>
          </Card>

          <AvatarParameterPanel
            localAvatars={localAvatars}
            avatarId={avatarId}
            setAvatarId={setAvatarId}
            loading={avatarParamsLoading}
            manualParamName={manualParamName}
            setManualParamName={setManualParamName}
            avatarParamType={avatarParamType}
            setAvatarParamType={setAvatarParamType}
            avatarParameters={avatarParameters}
            onLoad={(avatar) => void loadAvatarParameters(avatar)}
            onAddManual={addManualParameter}
            onAddScanned={addScannedParameter}
          />

          <RawSendPanel
            address={address}
            setAddress={setAddress}
            valueType={valueType}
            setValueType={setValueType}
            valueText={valueText}
            setValueText={setValueText}
            sending={sending}
            onSend={() => void sendRaw()}
          />
        </div>

        <div className="grid gap-3 self-start">
          <HardwarePanel hardware={hardware} loading={hardwareLoading} />
          <ProfilePanel
            profileText={profileText}
            setProfileText={setProfileText}
            onExport={() => void copyProfile()}
            onImport={importProfile}
          />
          <ComponentCardsPanel
            hardware={hardware}
            filter={componentFilter}
            setFilter={setComponentFilter}
            search={componentSearch}
            setSearch={setComponentSearch}
            onInsert={insertTemplateComponent}
            onDragStart={setDraggedTemplate}
            onDragEnd={() => setDraggedTemplate(null)}
          />
          <ListenPanel
            listening={listening}
            listenPort={listenPort}
            setListenPort={setListenPort}
            log={log}
            setLog={setLog}
            onToggleListen={() => void toggleListen()}
          />
        </div>
      </section>
    </div>
  );
}

function StudioToolbar({
  activeGroup,
  setActiveGroup,
  selectedSceneId,
  setSelectedSceneId,
  onApplyScene,
  onReset,
}: {
  activeGroup: OscCardGroup | "all";
  setActiveGroup: (group: OscCardGroup | "all") => void;
  selectedSceneId: string;
  setSelectedSceneId: (sceneId: string) => void;
  onApplyScene: (sceneId?: string) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card elevation="flat" className="p-2">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant={activeGroup === "all" ? "default" : "outline"}
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => setActiveGroup("all")}
          >
            <Layers3 className="size-3" />
            {t("common.all", { defaultValue: "All" })}
          </Button>
          {OSC_CARD_GROUPS.map((group) => (
            <Button
              key={group.id}
              variant={activeGroup === group.id ? "default" : "outline"}
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => setActiveGroup(group.id)}
            >
              {group.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1 border-t border-[hsl(var(--border))] pt-2">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            {t("osc.studio.templatePresets", { defaultValue: "Templates" })}
          </span>
          {OSC_STUDIO_SCENES.map((scene) => (
            <Button
              key={scene.id}
              variant={selectedSceneId === scene.id ? "default" : "outline"}
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                setSelectedSceneId(scene.id);
                onApplyScene(scene.id);
              }}
            >
              <Square className="size-3" />
              {scene.label}
            </Button>
          ))}
          <div className="flex-1" />
          <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={onReset}>
            <RotateCcw className="size-3" />
            {t("common.reset", { defaultValue: "Reset" })}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function OscCardEditor({
  card,
  active,
  autoActive,
  preview,
  canMoveUp,
  canMoveDown,
  dragging,
  onSelect,
  onPatch,
  onMoveUp,
  onMoveDown,
  onSend,
  onStartAuto,
  onStopAuto,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  card: OscStudioCard;
  active: boolean;
  autoActive: boolean;
  preview: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  dragging: boolean;
  onSelect: () => void;
  onPatch: (patch: Partial<OscStudioCard>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSend: () => void;
  onStartAuto: () => void;
  onStopAuto: () => void;
  onDragStart: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      draggable
      className={`rounded-[var(--radius-sm)] border bg-[hsl(var(--surface-raised))] p-2 transition-opacity ${
        active ? "border-[hsl(var(--primary))]" : "border-[hsl(var(--border))]"
      } ${dragging ? "opacity-45" : ""}`}
      onClick={onSelect}
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
      <div className="mb-2 flex items-center gap-2">
        <GripVertical className="size-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
        <Badge variant={card.enabled ? "success" : "muted"} className="h-4 px-1.5 text-[9px]">
          {card.group}
        </Badge>
        <Input
          value={card.title}
          onChange={(e) => onPatch({ title: e.target.value })}
          className="h-7 min-w-0 flex-1 text-[12px]"
          onClick={(e) => e.stopPropagation()}
        />
        <Button variant="ghost" size="icon" className="size-7" disabled={!canMoveUp} onClick={(e) => { e.stopPropagation(); onMoveUp(); }}>
          <Upload className="size-3" />
        </Button>
        <Button variant="ghost" size="icon" className="size-7" disabled={!canMoveDown} onClick={(e) => { e.stopPropagation(); onMoveDown(); }}>
          <Download className="size-3" />
        </Button>
      </div>

      <div className="grid gap-2">
        <div className="grid grid-cols-[96px_1fr] gap-2">
          <select
            value={card.group}
            onChange={(e) => onPatch({ group: e.target.value as OscCardGroup })}
            onClick={(e) => e.stopPropagation()}
            className="h-7 rounded-[var(--radius-sm)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface-bright))] px-2 text-[11px]"
          >
            {OSC_CARD_GROUPS.map((group) => (
              <option key={group.id} value={group.id}>{group.label}</option>
            ))}
          </select>
          <Input
            value={card.address}
            onChange={(e) => onPatch({ address: e.target.value })}
            className="h-7 font-mono text-[11px]"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        {card.template !== undefined ? (
          <textarea
            value={card.template}
            onChange={(e) => onPatch({ template: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            className="min-h-[72px] resize-y rounded-[var(--radius-sm)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface-bright))] px-2 py-1.5 font-mono text-[11px] outline-none focus:border-[hsl(var(--primary))]"
          />
        ) : (
          <div className="grid grid-cols-[96px_1fr] gap-2">
            <select
              value={card.valueType}
              onChange={(e) => onPatch({ valueType: e.target.value as OscValueType })}
              onClick={(e) => e.stopPropagation()}
              className="h-7 rounded-[var(--radius-sm)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface-bright))] px-2 text-[11px]"
            >
              <option value="int">int</option>
              <option value="float">float</option>
              <option value="string">string</option>
              <option value="bool">bool</option>
            </select>
            <Input
              value={card.value}
              onChange={(e) => onPatch({ value: e.target.value })}
              className="h-7 font-mono text-[11px]"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
        <div className="grid grid-cols-[1fr_88px_88px] gap-2">
          <label className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-2 text-[10px] text-[hsl(var(--muted-foreground))]">
            <span>{t("osc.studio.interval", { defaultValue: "Every" })}</span>
            <Input
              type="number"
              min={1}
              value={card.autoIntervalSec ?? 1}
              onChange={(e) => onPatch({ autoIntervalSec: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              className="h-6 border-0 bg-transparent px-0 font-mono text-[11px] focus-visible:ring-0"
              onClick={(e) => e.stopPropagation()}
            />
            <span>{t("common.seconds", { defaultValue: "s" })}</span>
          </label>
          <Button size="sm" className="h-7" onClick={(e) => { e.stopPropagation(); onSend(); }}>
            <Send className="size-3" />
            {t("osc.sendButton", { defaultValue: "Send" })}
          </Button>
          <Button
            variant={autoActive ? "default" : "outline"}
            size="sm"
            className="h-7"
            onClick={(e) => {
              e.stopPropagation();
              autoActive ? onStopAuto() : onStartAuto();
            }}
          >
            {autoActive ? <Pause className="size-3" /> : <Play className="size-3" />}
            {autoActive
              ? t("osc.studio.stopAutoShort", { defaultValue: "Stop" })
              : t("osc.studio.startAutoShort", { defaultValue: "Auto" })}
          </Button>
        </div>
        <div className="line-clamp-2 min-h-8 rounded-[var(--radius-sm)] bg-[hsl(var(--canvas))] px-2 py-1 font-mono text-[10px] text-[hsl(var(--muted-foreground))]" title={preview}>
          {preview || "--"}
        </div>
      </div>
    </div>
  );
}

function TemplateBuilderPanel({
  selectedCard,
  selectedPreview,
  draggingTemplate,
  activeAutoId,
  autoStatus,
  nowMs,
  onTemplateChange,
  onPatchSelected,
  onDropTemplate,
  onClearTemplate,
  onSend,
  onStartAuto,
  onStopAuto,
}: {
  selectedCard: OscStudioCard | null;
  selectedPreview: string;
  draggingTemplate: boolean;
  activeAutoId: string | null;
  autoStatus: AutoSendStatus | null;
  nowMs: number;
  onTemplateChange: (template: string) => void;
  onPatchSelected: (patch: Partial<OscStudioCard>) => void;
  onDropTemplate: (template: string) => void;
  onClearTemplate: () => void;
  onSend: () => void;
  onStartAuto: () => void;
  onStopAuto: () => void;
}) {
  const { t } = useTranslation();
  const templateText = templateTextForCard(selectedCard);
  const [customText, setCustomText] = useState("");
  const blocks = useMemo(() => templateBlocksFromText(templateText), [templateText]);
  const nextSendInSec = autoStatus?.nextSendAt
    ? Math.max(0, Math.ceil((autoStatus.nextSendAt - nowMs) / 1000))
    : null;
  const replaceBlocks = (nextBlocks: OscTemplateBlock[]) => {
    onTemplateChange(templateTextFromBlocks(nextBlocks));
  };
  const dropTemplate = (event: DragEvent<HTMLDivElement | HTMLTextAreaElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const template = event.dataTransfer.getData("application/x-vrcsm-osc-template")
      || event.dataTransfer.getData("text/plain");
    if (template) onDropTemplate(template);
  };
  return (
    <Card elevation="flat" className="overflow-hidden p-0">
      <div className="unity-panel-header flex items-center justify-between">
        <span>{t("osc.studio.builder", { defaultValue: "Template builder" })}</span>
        {activeAutoId ? (
          <Badge variant="warning" className="h-4 px-1.5 text-[9px]">
            {t("osc.studio.autoRunning", { defaultValue: "AUTO" })}
          </Badge>
        ) : null}
      </div>
      <CardContent className="grid gap-3 p-3">
        {autoStatus ? (
          <div className="grid gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold">
                  {autoStatus.title}
                </div>
                <div className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                  {t("osc.studio.autoStats", {
                    defaultValue: "Sent {{sent}} / skipped {{skipped}}",
                    sent: autoStatus.sendCount,
                    skipped: autoStatus.skipCount,
                  })}
                  {nextSendInSec !== null
                    ? ` · ${t("osc.studio.nextSendIn", { defaultValue: "Next in {{seconds}}s", seconds: nextSendInSec })}`
                    : ""}
                </div>
              </div>
              <Badge variant={autoStatus.state === "error" ? "destructive" : autoStatus.state === "skipped" ? "warning" : "success"} className="h-5 px-2 text-[10px]">
                {autoStatus.state.toUpperCase()}
              </Badge>
            </div>
            {autoStatus.lastMessage ? (
              <div className="line-clamp-2 rounded-[var(--radius-sm)] bg-[hsl(var(--surface-raised))] px-2 py-1 font-mono text-[10px]" title={autoStatus.lastMessage}>
                {autoStatus.lastMessage}
              </div>
            ) : null}
            {autoStatus.lastError ? (
              <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.08)] px-2 py-1 text-[11px] text-[hsl(var(--warning-foreground))]">
                {autoStatus.lastError}
              </div>
            ) : null}
          </div>
        ) : null}
        <div
          className={`grid gap-2 rounded-[var(--radius-sm)] border p-2 ${
            draggingTemplate
              ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)]"
              : "border-[hsl(var(--border))] bg-[hsl(var(--canvas))]"
          }`}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={dropTemplate}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                {t("osc.studio.editArea", { defaultValue: "Edit area" })}
              </div>
              <div className="truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                {selectedCard?.address ?? "/chatbox/input"}
              </div>
            </div>
            <Badge variant={selectedCard?.enabled ?? false ? "success" : "muted"} className="h-4 px-1.5 text-[9px]">
              {selectedCard?.group ?? "chatbox"}
            </Badge>
          </div>

          <div className="grid gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                {t("osc.studio.composer", { defaultValue: "Composer" })}
              </div>
              <div className="flex items-center gap-1">
                <Badge variant="muted" className="h-4 px-1.5 text-[9px]">
                  {blocks.length}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[10px]"
                  disabled={!selectedCard || templateText.length === 0}
                  onClick={onClearTemplate}
                  title={t("osc.studio.clearEditor", { defaultValue: "Clear editor" })}
                >
                  <Trash2 className="size-3" />
                  {t("osc.studio.clearEditor", { defaultValue: "Clear" })}
                </Button>
              </div>
            </div>
            <div
              className="flex min-h-[46px] flex-wrap gap-1.5 rounded-[var(--radius-sm)] border border-dashed border-[hsl(var(--border-strong))] bg-[hsl(var(--canvas))] p-2"
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }}
              onDrop={dropTemplate}
            >
              {blocks.length ? blocks.map((block, index) => (
                <div
                  key={block.id}
                  className={`grid max-w-full grid-cols-[minmax(44px,1fr)_auto_auto_auto] items-center gap-1 rounded-[var(--radius-sm)] border px-1.5 py-1 ${
                    block.kind === "component"
                      ? "border-[hsl(var(--primary)/0.45)] bg-[hsl(var(--primary)/0.08)]"
                      : "border-[hsl(var(--border))] bg-[hsl(var(--surface-bright))]"
                  }`}
                >
                  <span className="min-w-0 truncate font-mono text-[10px]" title={block.text}>
                    {block.text}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5"
                    disabled={index === 0}
                    title={t("osc.studio.blockMoveUp", { defaultValue: "Move block left" })}
                    onClick={() => replaceBlocks(moveTemplateBlock(blocks, index, -1))}
                  >
                    <Upload className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5"
                    disabled={index === blocks.length - 1}
                    title={t("osc.studio.blockMoveDown", { defaultValue: "Move block right" })}
                    onClick={() => replaceBlocks(moveTemplateBlock(blocks, index, 1))}
                  >
                    <Download className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5"
                    title={t("osc.studio.blockRemove", { defaultValue: "Remove block" })}
                    onClick={() => replaceBlocks(blocks.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              )) : (
                <div className="flex min-h-8 items-center text-[11px] text-[hsl(var(--muted-foreground))]">
                  {t("osc.studio.emptyComposer", { defaultValue: "Drag component cards here or add custom text below." })}
                </div>
              )}
            </div>
            <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
              <Input
                value={customText}
                onChange={(event) => setCustomText(event.target.value)}
                className="h-8 text-[12px]"
                placeholder={t("osc.studio.customText", { defaultValue: "Custom text..." })}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => {
                  const text = customText.trim();
                  if (!text) return;
                  onDropTemplate(text);
                  setCustomText("");
                }}
              >
                <Plus className="size-3" />
                {t("osc.studio.addText", { defaultValue: "Add text" })}
              </Button>
              <Button variant="outline" size="sm" className="h-8" onClick={() => onDropTemplate(" | ")}>
                |
              </Button>
              <Button variant="outline" size="sm" className="h-8" onClick={() => onDropTemplate("\n")}>
                {t("osc.studio.insertNewline", { defaultValue: "Line" })}
              </Button>
            </div>
          </div>

          <div className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            {t("osc.studio.rawTemplate", { defaultValue: "Raw template" })}
          </div>
          <textarea
            value={templateText}
            onChange={(event) => onTemplateChange(event.target.value)}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDrop={dropTemplate}
            className="min-h-[118px] resize-y rounded-[var(--radius-sm)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface-bright))] px-2 py-2 font-mono text-[12px] leading-relaxed outline-none focus:border-[hsl(var(--primary))]"
            placeholder={t("osc.studio.dropHint", {
              defaultValue: "Type text here, or drag hardware cards from the right into this editor.",
            })}
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="grid grid-cols-[auto_64px_auto] items-center gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-2 py-1 text-[10px] text-[hsl(var(--muted-foreground))]">
              <span>{t("osc.studio.interval", { defaultValue: "Every" })}</span>
              <Input
                type="number"
                min={1}
                value={selectedCard?.autoIntervalSec ?? 1}
                onChange={(event) => onPatchSelected({ autoIntervalSec: Math.max(1, parseInt(event.target.value, 10) || 1) })}
                disabled={!selectedCard}
                className="h-6 border-0 bg-transparent px-0 font-mono text-[11px] focus-visible:ring-0"
              />
              <span>{t("common.seconds", { defaultValue: "s" })}</span>
            </label>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              disabled={!selectedCard}
              onClick={() => onPatchSelected({ enabled: !selectedCard?.enabled })}
            >
              {selectedCard?.enabled
                ? t("common.enabled", { defaultValue: "Enabled" })
                : t("common.disabled", { defaultValue: "Disabled" })}
            </Button>
          </div>
        </div>

        <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-2">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            <Send className="size-3" />
            {t("osc.studio.chatboxPreview", { defaultValue: "Chatbox preview" })}
          </div>
          <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2">
            <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
              {selectedPreview || t("osc.studio.noPreview", { defaultValue: "Select a card to preview output." })}
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
            <span>{selectedCard?.title ?? "--"}</span>
            <span>{selectedPreview.length}/144</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" onClick={onSend} disabled={!selectedCard}>
            <Send className="size-3" />
            {t("osc.studio.sendSelected", { defaultValue: "Send selected" })}
          </Button>
          {activeAutoId ? (
            <Button variant="outline" size="sm" onClick={onStopAuto}>
              <Pause className="size-3" />
              {t("osc.studio.stopAuto", { defaultValue: "Stop auto" })}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={onStartAuto} disabled={!selectedCard}>
              <Play className="size-3" />
              {t("osc.studio.startAuto", { defaultValue: "Auto send" })}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function HardwarePanel({ hardware, loading }: { hardware: HardwareSnapshot | null; loading: boolean }) {
  const { t } = useTranslation();
  const telemetry = hardware?.telemetry;
  const primaryAdapter = telemetry?.gpu_adapters?.find((adapter) => adapter.primary_candidate)
    ?? telemetry?.gpu_adapters?.[0]
    ?? null;
  const liveSensors = [
    ...(telemetry?.fans ?? []),
    ...(telemetry?.power ?? []),
    ...(telemetry?.sensors ?? []).filter((sensor) => /temperature/i.test(sensor.sensor_type)),
  ].slice(0, 6);
  const sensorHint = t("osc.studio.sensorProviderNeeded", { defaultValue: "Needs sensor provider" });
  return (
    <Card elevation="flat" className="overflow-hidden p-0">
      <div className="unity-panel-header flex items-center gap-2">
        <Cpu className="size-3.5" />
        {t("osc.studio.hardware", { defaultValue: "Hardware variables" })}
      </div>
      <div className="grid gap-3 p-3 text-[11px]">
        <div className="grid gap-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            {t("osc.studio.identityInfo", { defaultValue: "Identity" })}
          </div>
          <Fact label="CPU" value={hardware?.cpuName} />
          <Fact label="GPU" value={hardware?.gpuName} />
          <Fact label="GPU Source" value={[hardware?.gpuVendor, hardware?.gpuSource].filter(Boolean).join(" / ")} />
          <Fact label="RAM" value={hardware?.ramBytes ? `${(hardware.ramBytes / 1024 / 1024 / 1024).toFixed(0)}GB` : null} />
          <Fact label="HMD" value={hardware?.hmdModel || hardware?.hmdManufacturer} />
          <Fact label="GPU VRAM" value={formatBytesGb(telemetry?.gpu?.memory_total_bytes || hardware?.gpuVramBytes)} />
          <Fact label="Adapters" value={telemetry?.gpu_adapters?.length ? `${telemetry.gpu_adapters.length}` : null} />
          <Fact label="Primary" value={primaryAdapter ? [
            primaryAdapter.vendor,
            primaryAdapter.name,
            primaryAdapter.virtual ? "(virtual)" : null,
          ].filter(Boolean).join(" ") : null} />
          <Fact label="Board" value={[telemetry?.motherboard?.manufacturer, telemetry?.motherboard?.product].filter(Boolean).join(" ")} />
          <Fact label="RAM #0" value={formatRamModule(telemetry?.ram_modules?.[0])} />
        </div>
        <div className="grid gap-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            {t("osc.studio.sensorInfo", { defaultValue: "Live sensors" })}
          </div>
          <Fact label="CPU Temp" value={formatCelsius(telemetry?.cpu?.temperature_c) ?? sensorHint} muted={!telemetry?.cpu?.temperature_c} />
          <Fact label="GPU Temp" value={formatCelsius(telemetry?.gpu?.temperature_c) ?? sensorHint} muted={!telemetry?.gpu?.temperature_c} />
          <Fact label="GPU Power" value={formatWatts(telemetry?.gpu?.power_watts) ?? sensorHint} muted={!telemetry?.gpu?.power_watts} />
          <Fact label="Fans" value={telemetry?.fans?.length ? `${telemetry.fans.length} sensors` : sensorHint} muted={!telemetry?.fans?.length} />
          {liveSensors.length ? (
            <div className="mt-1 grid gap-1 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-1.5">
              {liveSensors.map((sensor, index) => (
                <div key={`${sensor.source}-${sensor.id}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 font-mono text-[10px]">
                  <span className="truncate text-[hsl(var(--muted-foreground))]" title={`${sensor.source} ${sensor.id}`}>
                    {sensor.name || sensor.id}
                  </span>
                  <span className="text-[hsl(var(--foreground))]">{formatSensorReading(sensor)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {(telemetry?.sources ?? []).map((source) => (
            <Badge key={source.name} variant={source.available ? "success" : "muted"} className="text-[9px]" title={source.message}>
              {source.name}
            </Badge>
          ))}
          {loading ? <Badge variant="warning" className="text-[9px]">loading</Badge> : null}
        </div>
      </div>
    </Card>
  );
}

function ProfilePanel({
  profileText,
  setProfileText,
  onExport,
  onImport,
}: {
  profileText: string;
  setProfileText: (value: string) => void;
  onExport: () => void;
  onImport: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card elevation="flat" className="overflow-hidden p-0">
      <div className="unity-panel-header flex items-center gap-2">
        <Boxes className="size-3.5" />
        {t("osc.studio.profile", { defaultValue: "Profile import/export" })}
      </div>
      <div className="grid gap-2 p-3">
        <textarea
          value={profileText}
          onChange={(e) => setProfileText(e.target.value)}
          className="min-h-[92px] resize-y rounded-[var(--radius-sm)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface-bright))] px-2 py-1.5 font-mono text-[10px] outline-none focus:border-[hsl(var(--primary))]"
          placeholder='{"version":2,"cards":[...]}'
        />
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="size-3" />
            {t("common.export", { defaultValue: "Export" })}
          </Button>
          <Button variant="outline" size="sm" onClick={onImport} disabled={!profileText.trim()}>
            <Import className="size-3" />
            {t("common.import", { defaultValue: "Import" })}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ComponentCardsPanel({
  hardware,
  filter,
  setFilter,
  search,
  setSearch,
  onInsert,
  onDragStart,
  onDragEnd,
}: {
  hardware: HardwareSnapshot | null;
  filter: OscTemplateComponentFilter;
  setFilter: (filter: OscTemplateComponentFilter) => void;
  search: string;
  setSearch: (value: string) => void;
  onInsert: (template: string) => void;
  onDragStart: (template: string) => void;
  onDragEnd: () => void;
}) {
  const { t } = useTranslation();
  const visibleComponents = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return OSC_TEMPLATE_CARDS.filter((card) => {
      const recommended = isRecommendedComponent(card.id);
      const matchesFilter = filter === "recommended" ? recommended : card.group === filter;
      if (!matchesFilter) return false;
      if (!needle) return true;
      return `${card.label} ${card.description} ${card.template}`.toLowerCase().includes(needle);
    });
  }, [filter, search]);
  const groups = useMemo(
    () => visibleComponents.reduce<Array<{ id: string; label: string; cards: OscTemplateComponentCard[] }>>((acc, card) => {
      const group = acc.find((item) => item.id === card.group);
      if (group) {
        group.cards.push(card);
      } else {
        acc.push({ id: card.group, label: templateGroupLabel(card.group), cards: [card] });
      }
      return acc;
    }, []),
    [visibleComponents],
  );
  const tabs: Array<{ id: OscTemplateComponentFilter; label: string }> = [
    { id: "recommended", label: t("osc.studio.recommended", { defaultValue: "Recommended" }) },
    { id: "time", label: "Time" },
    { id: "cpu", label: "CPU" },
    { id: "gpu", label: "GPU" },
    { id: "memory", label: "RAM" },
    { id: "system", label: "System" },
  ];
  return (
    <Card elevation="flat" className="overflow-hidden p-0">
      <div className="unity-panel-header flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <Gauge className="size-3.5" />
          {t("osc.studio.componentCards", { defaultValue: "Component cards" })}
        </span>
        <Badge variant="muted" className="h-4 px-1.5 text-[9px]">
          {visibleComponents.length}
        </Badge>
      </div>
      <div className="grid gap-3 p-3">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-8 text-[12px]"
          placeholder={t("osc.studio.searchComponents", { defaultValue: "Search CPU, GPU, RAM..." })}
        />
        <div className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <Button
              key={tab.id}
              type="button"
              variant={filter === tab.id ? "default" : "outline"}
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => setFilter(tab.id)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
        {filter === "recommended" ? (
          <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-2 py-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">
            {t("osc.studio.componentHint", { defaultValue: "Start with these stable cards. Temperature, fan and board cards appear in their own tabs because they depend on sensor providers." })}
          </div>
        ) : null}
        {groups.map((group) => (
          <div key={group.id} className="grid gap-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              {group.label}
            </div>
            <div className="grid gap-1.5">
              {group.cards.map((component) => {
                const value = cardPreview({
                  id: component.id,
                  kind: "chatbox-template",
                  title: component.label,
                  group: "chatbox",
                  enabled: true,
                  address: "/chatbox/input",
                  valueType: "string",
                  value: "",
                  template: component.template,
                }, { hardware, now: new Date() });
                return (
                  <button
                    key={component.id}
                    type="button"
                    draggable
                    onClick={() => onInsert(component.template)}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "copy";
                      event.dataTransfer.setData("application/x-vrcsm-osc-template", component.template);
                      event.dataTransfer.setData("text/plain", component.template);
                      onDragStart(component.template);
                    }}
                    onDragEnd={onDragEnd}
                    className="grid gap-1 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-2 py-1.5 text-left transition-colors hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--surface-raised))]"
                    title={t("osc.studio.dragComponent", { defaultValue: "Drag into the editor or click to insert" })}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium">{component.label}</span>
                      <span className="flex items-center gap-1">
                        <Badge variant={isTemplatePreviewComplete(value) ? "success" : "muted"} className="h-4 px-1 text-[8px]">
                          {isTemplatePreviewComplete(value)
                            ? t("common.ready", { defaultValue: "Ready" })
                            : t("common.partial", { defaultValue: "Partial" })}
                        </Badge>
                        <GripVertical className="size-3 text-[hsl(var(--muted-foreground))]" />
                      </span>
                    </span>
                    <span className="line-clamp-1 text-[10px] text-[hsl(var(--muted-foreground))]">{component.description}</span>
                    <span className="line-clamp-1 font-mono text-[10px] text-[hsl(var(--primary))]">{component.template}</span>
                    <span className="line-clamp-1 font-mono text-[10px] text-[hsl(var(--muted-foreground))]">{value}</span>
                    <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-[hsl(var(--primary))]">
                      <Plus className="size-3" />
                      {t("osc.studio.clickToInsert", { defaultValue: "Click to insert" })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {visibleComponents.length === 0 ? (
          <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-3 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
            {t("osc.studio.noComponents", { defaultValue: "No components match this filter." })}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function AvatarParameterPanel({
  localAvatars,
  avatarId,
  setAvatarId,
  loading,
  manualParamName,
  setManualParamName,
  avatarParamType,
  setAvatarParamType,
  avatarParameters,
  onLoad,
  onAddManual,
  onAddScanned,
}: {
  localAvatars: LocalAvatarItem[];
  avatarId: string;
  setAvatarId: (value: string) => void;
  loading: boolean;
  manualParamName: string;
  setManualParamName: (value: string) => void;
  avatarParamType: OscValueType;
  setAvatarParamType: (value: OscValueType) => void;
  avatarParameters: AvatarParametersResponse | null;
  onLoad: (avatar?: LocalAvatarItem) => void;
  onAddManual: () => void;
  onAddScanned: (name: string, type: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Card elevation="flat" className="overflow-hidden p-0">
      <div className="unity-panel-header flex items-center justify-between">
        <span>{t("osc.studio.avatarParams", { defaultValue: "Avatar parameter scan" })}</span>
        <Badge variant="muted" className="h-4 px-1.5 text-[9px]">{localAvatars.length}</Badge>
      </div>
      <CardContent className="grid gap-3 p-3">
        <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-2 py-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">
          {t("osc.studio.avatarParamsHint", {
            defaultValue: "Scans local avatar OSC config and turns parameters into control cards. It is not an avatar model unpacker.",
          })}
        </div>
        <div className="grid gap-2 lg:grid-cols-[1fr_120px]">
          <Input
            value={avatarId}
            onChange={(e) => setAvatarId(e.target.value)}
            placeholder="avtr_..."
            className="h-8 font-mono text-[12px]"
          />
          <Button variant="outline" size="sm" className="h-8" disabled={loading} onClick={() => onLoad()}>
            <RefreshCcw className={loading ? "size-3 animate-spin" : "size-3"} />
            {t("common.load", { defaultValue: "Load" })}
          </Button>
        </div>
        <div className="grid gap-2 md:grid-cols-[1fr_108px_120px]">
          <Input
            value={manualParamName}
            onChange={(e) => setManualParamName(e.target.value)}
            className="h-8 font-mono text-[12px]"
          />
          <select
            value={avatarParamType}
            onChange={(e) => setAvatarParamType(e.target.value as OscValueType)}
            className="h-8 rounded-[var(--radius-sm)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface-bright))] px-2 text-[12px]"
          >
            <option value="bool">bool</option>
            <option value="float">float</option>
            <option value="int">int</option>
            <option value="string">string</option>
          </select>
          <Button size="sm" className="h-8" onClick={onAddManual}>
            <Plus className="size-3" />
            {t("common.add", { defaultValue: "Add" })}
          </Button>
        </div>
        {localAvatars.length ? (
          <ScrollArea className="h-[92px] rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
            <div className="grid gap-1 p-2">
              {localAvatars.slice(0, 20).map((avatar) => (
                <button
                  key={`${avatar.user_id}-${avatar.avatar_id}`}
                  type="button"
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-left text-[11px] hover:bg-[hsl(var(--surface-raised))]"
                  onClick={() => onLoad(avatar)}
                >
                  <span className="truncate font-mono">{avatar.avatar_id}</span>
                  <span className="text-[hsl(var(--muted-foreground))]">{avatar.parameter_count}p</span>
                  <span className="text-[hsl(var(--muted-foreground))]">{avatar.modified_at?.slice(0, 10) ?? "--"}</span>
                </button>
              ))}
            </div>
          </ScrollArea>
        ) : null}
        {avatarParameters ? (
          <ScrollArea className="h-[132px] rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
            <div className="grid gap-1 p-2">
              {avatarParameters.parameters.length === 0 ? (
                <div className="p-3 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
                  {t("osc.studio.noAvatarParams", { defaultValue: "No parameters found in this local avatar file." })}
                </div>
              ) : avatarParameters.parameters.map((param) => (
                <button
                  key={`${avatarParameters.avatar_id}-${param.name}`}
                  type="button"
                  className="grid grid-cols-[1fr_58px_auto] items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-left text-[11px] hover:bg-[hsl(var(--surface-raised))]"
                  onClick={() => onAddScanned(param.name, param.value_type)}
                >
                  <span className="truncate font-mono">{param.name}</span>
                  <Badge variant="muted" className="justify-center text-[9px]">{param.value_type}</Badge>
                  <Plus className="size-3 text-[hsl(var(--muted-foreground))]" />
                </button>
              ))}
            </div>
          </ScrollArea>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RawSendPanel({
  address,
  setAddress,
  valueType,
  setValueType,
  valueText,
  setValueText,
  sending,
  onSend,
}: {
  address: string;
  setAddress: (value: string) => void;
  valueType: OscValueType;
  setValueType: (value: OscValueType) => void;
  valueText: string;
  setValueText: (value: string) => void;
  sending: boolean;
  onSend: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card elevation="flat">
      <CardHeader>
        <CardTitle>{t("osc.send", { defaultValue: "Raw Send" })}</CardTitle>
        <CardDescription>
          {t("osc.sendDesc", {
            defaultValue:
              "Fire a single OSC message. Use addresses like /avatar/parameters/Foo for avatar parameters or /chatbox/input for ChatBox.",
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} className="h-8 font-mono text-[12px]" />
          <select
            value={valueType}
            onChange={(e) => setValueType(e.target.value as OscValueType)}
            className="h-8 rounded-[var(--radius-sm)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface-bright))] px-2 text-[12px]"
          >
            <option value="int">int</option>
            <option value="float">float</option>
            <option value="string">string</option>
            <option value="bool">bool</option>
          </select>
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
          <Input value={valueText} onChange={(e) => setValueText(e.target.value)} className="h-8 font-mono text-[12px]" />
          <Button variant="default" size="sm" onClick={onSend} disabled={sending} className="h-8 gap-1">
            <Send className="size-3.5" />
            {t("osc.sendButton", { defaultValue: "Send" })}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ListenPanel({
  listening,
  listenPort,
  setListenPort,
  log,
  setLog,
  onToggleListen,
}: {
  listening: boolean;
  listenPort: number;
  setListenPort: (value: number) => void;
  log: OscLogEntry[];
  setLog: (value: OscLogEntry[]) => void;
  onToggleListen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card elevation="flat" className="overflow-hidden p-0">
      <div className="unity-panel-header flex items-center justify-between">
        <span>{t("osc.listen", { defaultValue: "Listen" })}</span>
        {listening ? <Badge variant="default" className="h-4 px-1.5 text-[9px]">{t("osc.listening", { defaultValue: "Listening" })}</Badge> : null}
      </div>
      <CardContent className="space-y-3 p-3">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            value={listenPort}
            onChange={(e) => setListenPort(parseInt(e.target.value, 10) || 9001)}
            disabled={listening}
            className="h-8 w-24 font-mono text-[12px]"
          />
          <Button variant={listening ? "outline" : "default"} size="sm" onClick={onToggleListen} className="h-8 gap-1">
            {listening ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
            {listening ? t("osc.stop", { defaultValue: "Stop" }) : t("osc.start", { defaultValue: "Start" })}
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => setLog([])} disabled={log.length === 0} className="h-8 gap-1">
            <Trash2 className="size-3.5" />
            {t("osc.clear", { defaultValue: "Clear" })}
          </Button>
        </div>
        <ScrollArea className="h-[240px] rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
          <div className="p-2 text-[11px] font-mono">
            {log.length === 0 ? (
              <div className="p-4 text-center text-[hsl(var(--muted-foreground))]">
                {listening
                  ? t("osc.empty", { defaultValue: "Waiting for messages..." })
                  : t("osc.notListening", { defaultValue: "Listener stopped" })}
              </div>
            ) : (
              log.map((entry, i) => (
                <div key={`${entry.ts}-${i}`} className="flex items-start gap-2 border-b border-[hsl(var(--border)/0.5)] py-1 last:border-0">
                  <span className="text-[hsl(var(--muted-foreground))]">{entry.ts}</span>
                  <span className="text-[hsl(var(--primary))]">{entry.address}</span>
                  <span>{entry.args.map((a) => JSON.stringify(a)).join(" ")}</span>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function Fact({ label, value, muted = false }: { label: string; value?: string | null; muted?: boolean }) {
  return (
    <div className="grid grid-cols-[76px_1fr] gap-2">
      <span className="text-[hsl(var(--muted-foreground))]">{label}</span>
      <span className={`min-w-0 truncate ${muted ? "text-[hsl(var(--muted-foreground))]" : ""}`}>
        {value || "--"}
      </span>
    </div>
  );
}

function formatCelsius(value?: number | null): string | null {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}C` : null;
}

function formatWatts(value?: number | null): string | null {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(value >= 100 ? 0 : 1)}W` : null;
}

function formatBytesGb(value?: number | null): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? `${(value / 1024 / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 * 1024 ? 0 : 1)}GB`
    : null;
}

function formatRamModule(module?: RamModuleInfo | null): string | null {
  if (!module) return null;
  const parts = [
    module.manufacturer,
    module.part_number,
    module.configured_clock_mhz || module.speed_mhz ? `${module.configured_clock_mhz || module.speed_mhz}MHz` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

function formatSensorReading(sensor: SensorReading): string {
  if (typeof sensor.value !== "number" || !Number.isFinite(sensor.value)) return "--";
  const rounded = Math.abs(sensor.value) >= 100 ? sensor.value.toFixed(0) : sensor.value.toFixed(1);
  return `${rounded}${sensor.unit}`;
}

function createTemplateCard(template: string): OscStudioCard {
  return {
    id: `template-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`,
    kind: "chatbox-template",
    title: "Custom template",
    group: "chatbox",
    enabled: true,
    address: "/chatbox/input",
    valueType: "string",
    value: "",
    template,
    autoIntervalSec: 1,
  };
}

function isChatboxCard(card: OscStudioCard): boolean {
  return (
    card.address === "/chatbox/input" ||
    card.kind === "chatbox-template" ||
    card.kind === "hardware-summary" ||
    card.kind === "sensor-temperature" ||
    card.kind === "performance-overlay"
  );
}

function templatePatchForCard(card: OscStudioCard, template: string): Partial<OscStudioCard> {
  return {
    kind: chatboxTemplateKindForCard(card),
    group: card.group === "avatar" || card.group === "input" || card.group === "raw" ? "chatbox" : card.group,
    address: "/chatbox/input",
    valueType: "string",
    value: "",
    template,
  };
}

function chatboxTemplateKindForCard(card: OscStudioCard): OscStudioCard["kind"] {
  if (card.kind === "hardware-summary" || card.kind === "sensor-temperature" || card.kind === "performance-overlay") {
    return card.kind;
  }
  return "chatbox-template";
}

function templateTextForCard(card: OscStudioCard | null): string {
  if (!card) return "";
  return card.template ?? (card.address === "/chatbox/input" && card.valueType === "string" ? card.value : "");
}

function appendTemplateFragment(current: string, fragment: string): string {
  if (fragment === "\n") {
    const cleanCurrent = current.trimEnd();
    return cleanCurrent ? `${cleanCurrent}\n` : "";
  }
  if (fragment === " | ") {
    const cleanCurrent = current.trimEnd();
    return cleanCurrent && !cleanCurrent.endsWith("|") ? `${cleanCurrent} | ` : cleanCurrent;
  }
  const cleanCurrent = current.trimEnd();
  const cleanFragment = fragment.trim();
  if (!cleanCurrent) return cleanFragment;
  if (!cleanFragment) return cleanCurrent;
  const needsSeparator = !/[\s|/([{-]$/.test(cleanCurrent);
  const separator = cleanCurrent.includes("|") ? " | " : " ";
  return `${cleanCurrent}${needsSeparator ? separator : ""}${cleanFragment}`;
}

function templateBlocksFromText(template: string): OscTemplateBlock[] {
  return template
    .replace(/\r\n/g, "\n")
    .split(/\s+\|\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((text, index) => ({
      id: `${index}-${text}`,
      text,
      kind: /\{[^}]+\}/.test(text) ? "component" : "text",
    }));
}

function templateTextFromBlocks(blocks: OscTemplateBlock[]): string {
  return blocks.map((block) => block.text.trim()).filter(Boolean).join(" | ");
}

function moveTemplateBlock(blocks: OscTemplateBlock[], index: number, direction: -1 | 1): OscTemplateBlock[] {
  const target = index + direction;
  if (target < 0 || target >= blocks.length) return blocks;
  const next = [...blocks];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function isRecommendedComponent(id: string): boolean {
  return [
    "time-now",
    "cpu-load-temp",
    "gpu-load-temp",
    "memory-usage",
    "hardware-names",
  ].includes(id);
}

function isTemplatePreviewComplete(value: string): boolean {
  return value.trim().length > 0 && !value.includes("--");
}

function templateGroupLabel(group: OscTemplateComponentCard["group"]): string {
  switch (group) {
    case "time":
      return "Time";
    case "cpu":
      return "CPU";
    case "gpu":
      return "GPU";
    case "memory":
      return "Memory";
    case "system":
    default:
      return "System";
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));
}
