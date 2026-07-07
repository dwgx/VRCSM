import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import {
  sendChatbox,
  sendOscMessage,
  startOscListener,
  stopOscListener,
} from "@/lib/osc-api";
import {
  cardPreview,
  extrapolatePosition,
  coerceOscValue,
  createOscProfile,
  defaultOscStudioCards,
  deleteOscProfile,
  exportOscStudioProfile,
  getActiveOscProfile,
  importOscStudioProfile,
  loadOscStudioProfiles,
  moveOscCard,
  moveOscCardToIndex,
  renameOscProfile,
  saveOscStudioProfiles,
  setActiveOscProfile,
  setActiveProfileCards,
  updateOscCard,
  type HardwareSnapshot,
  type HardwareTelemetrySnapshot,
  type OscStudioCard,
  type OscStudioProfile,
  type OscTemplateContext,
  type OscValueType,
} from "@/lib/osc-studio";
import { useNowPlaying } from "@/lib/useNowPlaying";
import { currentLyricLine } from "@/lib/lyrics";

export const MAX_LOG_ENTRIES = 200;
export const AUTO_TELEMETRY_REFRESH_MS = 5000;
export const CHATBOX_MANUAL_RATE_WINDOW_MS = 5000;
export const CHATBOX_MANUAL_RATE_BURST = 5;
export const CHATBOX_AUTO_RATE_LIMIT_MS = 2000;

export interface OscMessageEvent {
  address: string;
  args: (number | string | boolean)[];
}

export interface OscLogEntry {
  ts: string;
  address: string;
  args: (number | string | boolean)[];
  /**
   * Message direction. Incoming listener messages omit this (treated as "in").
   * The UI appends "out" entries after a successful send so the send/receive
   * loop is visible in one place.
   */
  direction?: "in" | "out";
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

export interface SendCardOptions {
  silentSuccess?: boolean;
  shouldContinue?: () => boolean;
  chatboxRateMode?: "manual" | "auto" | "none";
  chatboxNotify?: boolean;
}

type ChatboxMessageSource = string | (() => string);

export interface SendOutcome {
  status: "sent" | "skipped" | "cancelled";
  message?: string;
  reason?: string;
}

export interface AutoSendStatus {
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));
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

export function useOscStudio() {
  const { t } = useTranslation();

  // --- Now-playing media snapshot (polled + pushed) --------------------------
  const nowPlaying = useNowPlaying();

  // --- Profiles + cards ------------------------------------------------------
  const [profilesState, setProfilesState] = useState(() => loadOscStudioProfiles());
  const activeProfile = useMemo(() => getActiveOscProfile(profilesState), [profilesState]);
  const cards = activeProfile.cards;

  const [host, setHost] = useState("127.0.0.1");
  const [sendPort, setSendPort] = useState(9000);

  const [hardware, setHardware] = useState<HardwareSnapshot | null>(null);
  const [hardwareLoading, setHardwareLoading] = useState(false);

  const [activeAutoId, setActiveAutoId] = useState<string | null>(null);
  const [autoStatus, setAutoStatus] = useState<AutoSendStatus | null>(null);
  const [manualSendingId, setManualSendingId] = useState<string | null>(null);

  const [listenPort, setListenPort] = useState(9001);
  const [listening, setListening] = useState(false);
  const [log, setLog] = useState<OscLogEntry[]>([]);

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

  useEffect(() => {
    latestCardsRef.current = cards;
  }, [cards]);

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

  // --- Cards CRUD (auto-commit to active profile) ----------------------------
  function commitProfiles(
    updater: (prev: ReturnType<typeof loadOscStudioProfiles>) => ReturnType<typeof loadOscStudioProfiles>,
  ) {
    setProfilesState((prev) => {
      const next = updater(prev);
      latestCardsRef.current = getActiveOscProfile(next).cards;
      saveOscStudioProfiles(next);
      return next;
    });
  }

  function commitCards(
    nextOrUpdater: OscStudioCard[] | ((prev: OscStudioCard[]) => OscStudioCard[]),
  ) {
    commitProfiles((prev) => {
      const prevCards = getActiveOscProfile(prev).cards;
      const nextCards = typeof nextOrUpdater === "function"
        ? (nextOrUpdater as (prev: OscStudioCard[]) => OscStudioCard[])(prevCards)
        : nextOrUpdater;
      return setActiveProfileCards(prev, nextCards);
    });
  }

  function addCard(card: OscStudioCard) {
    commitCards((prev) => [...prev, card]);
  }

  function patchCard(cardId: string, patch: Partial<OscStudioCard>) {
    commitCards((prev) => updateOscCard(prev, cardId, patch));
  }

  function removeCard(cardId: string) {
    commitCards((prev) => prev.filter((card) => card.id !== cardId));
  }

  function moveCard(cardId: string, direction: -1 | 1) {
    commitCards((prev) => moveOscCard(prev, cardId, direction));
  }

  function moveCardToIndex(cardId: string, targetIndex: number) {
    commitCards((prev) => moveOscCardToIndex(prev, cardId, targetIndex));
  }

  function setCards(cards: OscStudioCard[]) {
    commitCards(cards);
  }

  function resetCards(): OscStudioCard[] {
    const next = defaultOscStudioCards();
    commitCards(next);
    return next;
  }

  // --- Profile management ----------------------------------------------------
  function selectProfile(id: string) {
    stopAutoSend();
    commitProfiles((prev) => setActiveOscProfile(prev, id));
  }

  function addProfile(name?: string): OscStudioProfile {
    let created: OscStudioProfile | null = null;
    commitProfiles((prev) => {
      const next = createOscProfile(prev, name);
      created = getActiveOscProfile(next);
      return next;
    });
    return created ?? getActiveOscProfile(profilesState);
  }

  function renameProfile(id: string, name: string) {
    commitProfiles((prev) => renameOscProfile(prev, id, name));
  }

  function removeProfile(id: string) {
    stopAutoSend();
    commitProfiles((prev) => deleteOscProfile(prev, id));
  }

  function exportActiveProfile(): string {
    return exportOscStudioProfile(cards);
  }

  function importIntoActiveProfile(text: string): OscStudioCard[] {
    const next = importOscStudioProfile(text);
    commitCards(next);
    return next;
  }

  // --- Hardware snapshot -----------------------------------------------------
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

  // --- Sending ---------------------------------------------------------------
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

  // Build a render context from live refs (not React state) so the recursive
  // auto-send loop and the 1s send cadence always read the freshest hardware +
  // music snapshot and the NowPlayingPanel's width/ASCII-fold controls, with
  // {music.position} extrapolated at each send via `now`.
  function liveTemplateContext(): OscTemplateContext {
    const now = new Date();
    const music = nowPlaying.musicRef.current;
    // Resolve {music.lyrics} to the line matching the live playback position so
    // it advances as the song plays (the lyrics were fetched once on track
    // change; here we just pick the current line from the parsed ref).
    const lyricLine =
      music && music.active
        ? currentLyricLine(nowPlaying.lyricsRef.current, extrapolatePosition(music, now.getTime()))
        : "";
    return {
      hardware: hardwareRef.current,
      now,
      music,
      musicProgressWidth: nowPlaying.progressWidthRef.current,
      musicMarqueeWidth: nowPlaying.marqueeWidthRef.current,
      musicLyricLine: lyricLine,
      asciiFold: nowPlaying.asciiFoldRef.current,
    };
  }

  async function sendCard(card: OscStudioCard, options: SendCardOptions = {}): Promise<SendOutcome> {
    if (!card.enabled) {
      return { status: "skipped", reason: t("osc.studio.cardDisabled", { defaultValue: "Card is disabled" }) };
    }
    if (options.shouldContinue && !options.shouldContinue()) return { status: "cancelled" };
    if (!card.address.startsWith("/")) {
      const reason = t("osc.invalidAddress", { defaultValue: "Address must start with /" });
      if (!options.silentSuccess) toast.error(reason);
      return { status: "skipped", reason };
    }

    if (isChatboxCard(card)) {
      return await sendChatboxWithLimit(
        () => cardPreview(card, liveTemplateContext()),
        options,
      );
    }

    const value = coerceOscValue(card.valueType, card.value);
    if (value === null) {
      const reason = t("osc.invalidValue", { defaultValue: "Value can't be parsed" });
      if (!options.silentSuccess) toast.error(reason);
      return { status: "skipped", reason };
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

  async function sendRaw(address: string, valueType: OscValueType, valueText: string): Promise<boolean> {
    const value = coerceOscValue(valueType, valueText);
    if (value === null) {
      toast.error(t("osc.invalidValue", { defaultValue: "Value can't be parsed" }));
      return false;
    }
    if (!address.startsWith("/")) {
      toast.error(t("osc.invalidAddress", { defaultValue: "Address must start with /" }));
      return false;
    }
    try {
      const result = await sendOscMessage(address, [value], { host: hostRef.current, port: sendPortRef.current });
      if (!result.ok) {
        throw new Error(t("osc.sendFailed", { defaultValue: "OSC send failed" }));
      }
      toast.success(t("osc.sent", { defaultValue: "Sent" }));
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  // --- Auto send (recursive setTimeout + runId re-entrancy guard) ------------
  function startAutoSend(targetCard: OscStudioCard | null) {
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

  // --- Listen ----------------------------------------------------------------
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

  function clearLog() {
    setLog([]);
  }

  useEffect(() => {
    void refreshHardware();
    return () => stopAutoSend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    // profiles
    profiles: profilesState.profiles,
    activeProfileId: profilesState.activeProfileId,
    activeProfile,
    selectProfile,
    addProfile,
    renameProfile,
    removeProfile,
    exportActiveProfile,
    importIntoActiveProfile,

    // cards
    cards,
    commitCards,
    setCards,
    addCard,
    patchCard,
    removeCard,
    moveCard,
    moveCardToIndex,
    resetCards,

    // connection
    host,
    setHost,
    sendPort,
    setSendPort,

    // hardware
    hardware,
    hardwareLoading,
    hardwareRef,
    refreshHardware,

    // now-playing music
    nowPlaying,
    liveTemplateContext,

    // sending
    sendCard,
    sendCardManually,
    sendRaw,
    sendChatboxWithLimit,
    manualSendingId,

    // auto send
    activeAutoId,
    autoStatus,
    startAutoSend,
    stopAutoSend,

    // listen
    listenPort,
    setListenPort,
    listening,
    log,
    setLog,
    clearLog,
    toggleListen,
  };
}

export type OscStudioApi = ReturnType<typeof useOscStudio>;
