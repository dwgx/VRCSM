import { useEffect, useMemo, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useReport } from "@/lib/report-context";
import {
  appendOscScene,
  cardPreview,
  extrapolatePosition,
  type OscStudioCard,
} from "@/lib/osc-studio";
import { currentLyricLine, currentLyricTrans } from "@/lib/lyrics";
import { useOscStudio, type OscLogEntry, type SendOutcome } from "@/lib/useOscStudio";
import { ProfileBar } from "./osc/ProfileBar";
import { MessageCard } from "./osc/MessageCard";
import { MessageEditor } from "./osc/MessageEditor";
import { AddMessageMenu } from "./osc/AddMessageMenu";
import { LoopPanel } from "./osc/LoopPanel";
import { HardwarePanel } from "./osc/HardwarePanel";
import { AvatarScanPanel } from "./osc/AvatarScanPanel";
import { NowPlayingPanel } from "./osc/NowPlayingPanel";
import { outgoingSpecForCard, type TemplateExtras } from "./osc/shared";

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

function blankChatboxCard(): OscStudioCard {
  return {
    id: makeId("msg"),
    kind: "chatbox-template",
    title: "New chatbox line",
    group: "chatbox",
    enabled: true,
    address: "/chatbox/input",
    valueType: "string",
    value: "",
    template: "",
    autoIntervalSec: 1,
  };
}

function blankValueCard(): OscStudioCard {
  return {
    id: makeId("msg"),
    kind: "raw-message",
    title: "New value message",
    group: "raw",
    enabled: true,
    address: "/avatar/parameters/Example",
    valueType: "float",
    value: "1",
    autoIntervalSec: 1,
  };
}

export default function OscTools() {
  const { t } = useTranslation();
  const { report } = useReport();
  const studio = useOscStudio();
  const {
    cards,
    patchCard,
    removeCard,
    moveCard,
    moveCardToIndex,
    addCard,
    resetCards,
    hardware,
    sendCard,
    setLog,
    activeAutoId,
    autoStatus,
    startAutoSend,
    stopAutoSend,
    hardwareLoading,
    nowPlaying,
  } = studio;

  const [selectedId, setSelectedId] = useState<string | null>(() => cards[0]?.id ?? null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [clockTick, setClockTick] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Keep a valid selection as the card list changes (profile switch, delete).
  useEffect(() => {
    if (cards.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!cards.some((card) => card.id === selectedId)) {
      setSelectedId(cards[0].id);
    }
  }, [cards, selectedId]);

  const now = useMemo(() => new Date(clockTick), [clockTick]);

  // Resolve the current synced-lyric line here so {music.lyrics} isn't empty
  // in OscTools previews/sends. Previously musicExtras omitted it, so the
  // NowPlayingPanel (which resolves its own line) showed lyrics but the card
  // editor's "will send" preview and the actual send rendered "" — collapsing
  // the ♪ {music.lyrics} template to empty. Recomputed each 1s clock tick so
  // the line advances with playback.
  const musicExtras: TemplateExtras = useMemo(() => {
    const music = nowPlaying.music;
    const posMs = music && music.active ? extrapolatePosition(music, now.getTime()) : 0;
    const lines = nowPlaying.lyrics;
    return {
      music,
      musicProgressWidth: nowPlaying.progressWidth,
      musicMarqueeWidth: nowPlaying.marqueeWidth,
      musicLyricLine: music && music.active ? currentLyricLine(lines, posMs) : "",
      musicLyricTranslated: music && music.active ? currentLyricTrans(lines, posMs) : "",
      asciiFold: nowPlaying.asciiFold,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    now,
    nowPlaying.music,
    nowPlaying.lyrics,
    nowPlaying.progressWidth,
    nowPlaying.marqueeWidth,
    nowPlaying.asciiFold,
  ]);

  const selectedCard = useMemo(
    () => cards.find((card) => card.id === selectedId) ?? null,
    [cards, selectedId],
  );
  const localAvatars = report?.local_avatar_data.recent_items ?? [];

  function echoOutcome(card: OscStudioCard, outcome: SendOutcome) {
    if (outcome.status !== "sent") return;
    // Use spec.argPreview for the arg column (rendered text for chatbox,
    // coerced value for value cards). outcome.message for value cards is
    // "<address> <value>", which would duplicate the address column.
    const spec = outgoingSpecForCard(card, hardware, new Date(), musicExtras);
    const entry: OscLogEntry = {
      ts: new Date().toISOString().slice(11, 23),
      address: spec.address,
      args: [spec.argPreview],
      direction: "out",
    };
    setLog((prev) => [entry, ...prev].slice(0, 200));
  }

  async function handleSend(card: OscStudioCard) {
    if (sendingId) return;
    setSendingId(card.id);
    try {
      // sendCard already surfaces skip/error feedback via toast (single
      // ownership in the hook); don't double-toast here.
      const outcome = await sendCard(card, { chatboxRateMode: "manual", chatboxNotify: true });
      echoOutcome(card, outcome);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSendingId((current) => (current === card.id ? null : current));
    }
  }

  function handleAddCard(card: OscStudioCard) {
    addCard(card);
    setSelectedId(card.id);
  }

  function handleAddScene(sceneId: string) {
    const next = appendOscScene(cards, sceneId);
    studio.commitCards(next);
    setSelectedId(next[next.length - 1]?.id ?? null);
  }

  function dropOnCard(targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    const targetIndex = cards.findIndex((card) => card.id === targetId);
    if (targetIndex >= 0) moveCardToIndex(draggedId, targetIndex);
    setDraggedId(null);
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-[18px] font-semibold tracking-tight">
          {t("osc.studio.title", { defaultValue: "OSC Studio" })}
        </h1>
        <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
          {t("osc.page.subtitle", {
            defaultValue: "Build VRChat OSC messages, preview exactly what gets sent, and watch the send/receive loop in one place.",
          })}
        </p>
      </header>

      <ProfileBar
        studio={studio}
        autoRunning={activeAutoId !== null}
        onImported={(firstId) => setSelectedId(firstId)}
      />

      <section className="grid gap-3 xl:grid-cols-[minmax(240px,320px)_minmax(360px,1fr)_minmax(260px,340px)]">
        {/* Column 1 — message list */}
        <Card elevation="flat" className="flex flex-col overflow-hidden p-0">
          <div className="unity-panel-header flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              {t("osc.list.title", { defaultValue: "Messages" })}
              <Badge variant="muted" className="h-4 px-1.5 text-[9px]">{cards.length}</Badge>
            </span>
            <div className="flex items-center gap-1">
              <AddMessageMenu
                onAddBlank={() => handleAddCard(blankChatboxCard())}
                onAddRaw={() => handleAddCard(blankValueCard())}
                onAddScene={handleAddScene}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                title={t("osc.list.reset", { defaultValue: "Reset to defaults" })}
                onClick={() => setResetOpen(true)}
              >
                <RotateCcw className="size-3.5" />
              </Button>
              <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("osc.list.resetTitle", { defaultValue: "Reset messages?" })}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("osc.list.resetBody", { defaultValue: "This replaces the current profile's messages with the built-in defaults." })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setResetOpen(false)}>{t("common.cancel", { defaultValue: "Cancel" })}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        stopAutoSend();
                        const next = resetCards();
                        setSelectedId(next[0]?.id ?? null);
                        setResetOpen(false);
                      }}
                    >
                      {t("common.reset", { defaultValue: "Reset" })}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
          <div className="grid gap-2 p-2">
            {cards.length === 0 ? (
              <div className="p-6 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
                {t("osc.list.empty", { defaultValue: "No messages yet. Use \"Add message\" to start." })}
              </div>
            ) : (
              cards.map((card, index) => (
                <MessageCard
                  key={card.id}
                  card={card}
                  active={card.id === selectedId}
                  autoActive={activeAutoId === card.id}
                  sending={sendingId === card.id}
                  preview={cardPreview(card, { hardware, now, ...musicExtras })}
                  outgoing={outgoingSpecForCard(card, hardware, now, musicExtras).address}
                  canMoveUp={index > 0}
                  canMoveDown={index < cards.length - 1}
                  dragging={draggedId === card.id}
                  onSelect={() => setSelectedId(card.id)}
                  onToggleEnabled={() => patchCard(card.id, { enabled: !card.enabled })}
                  onMoveUp={() => moveCard(card.id, -1)}
                  onMoveDown={() => moveCard(card.id, 1)}
                  onSend={() => void handleSend(card)}
                  onToggleAuto={() => (activeAutoId === card.id ? stopAutoSend() : startAutoSend(card))}
                  onDragStart={() => setDraggedId(card.id)}
                  onDragOver={(e: DragEvent<HTMLDivElement>) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={() => dropOnCard(card.id)}
                  onDragEnd={() => setDraggedId(null)}
                />
              ))
            )}
          </div>
        </Card>

        {/* Column 2 — editor + send/receive loop */}
        <div className="grid content-start gap-3">
          <MessageEditor
            card={selectedCard}
            hardware={hardware}
            now={now}
            nowMs={clockTick}
            musicExtras={musicExtras}
            sending={sendingId === selectedCard?.id}
            autoActive={activeAutoId !== null && activeAutoId === selectedCard?.id}
            autoStatus={autoStatus}
            onPatch={(patch) => selectedCard && patchCard(selectedCard.id, patch)}
            onRemove={() => selectedCard && removeCard(selectedCard.id)}
            onSend={() => selectedCard && void handleSend(selectedCard)}
            onStartAuto={() => startAutoSend(selectedCard)}
            onStopAuto={stopAutoSend}
          />
          <LoopPanel studio={studio} />
        </div>

        {/* Column 3 — now playing + hardware + avatar sources */}
        <div className="grid content-start gap-3">
          <NowPlayingPanel
            nowPlaying={nowPlaying}
            now={now}
            onAddCard={handleAddCard}
            onSetTemplate={(template) =>
              selectedCard && patchCard(selectedCard.id, { template })
            }
            canSetTemplate={selectedCard?.address === "/chatbox/input" || selectedCard?.template !== undefined}
          />
          <HardwarePanel hardware={hardware} loading={hardwareLoading} />
          <AvatarScanPanel localAvatars={localAvatars} onAddCard={handleAddCard} />
        </div>
      </section>
    </div>
  );
}
