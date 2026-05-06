import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePipelineEvent } from "@/lib/pipeline-events";
import { useSelfLocation } from "@/lib/useSelfLocation";
import { parseLocation } from "@/lib/vrcFriends";
import { CircleDot, Square, Users, Clock, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface Recording {
  id: number; name: string; world_id: string; instance_id: string;
  started_at: string; ended_at: string | null; attendee_count: number;
}
interface Attendee {
  id: number; user_id: string; display_name: string; first_seen_at: string;
}

export default function EventRecorder() {
  const { t } = useTranslation();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [newName, setNewName] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Recording | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Local user's current world+instance — used to gate attendee inserts so
  // recordings only capture people actually in the same room as the user,
  // not every random user-location event flying past on the global pipeline.
  const selfLoc = useSelfLocation();

  const refresh = useCallback(async () => {
    const r = await ipc.eventList();
    setRecordings((r?.recordings ?? []) as unknown as Recording[]);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!selectedId) return;
    ipc.eventAttendees(selectedId).then((r) =>
      setAttendees((r?.attendees ?? []) as unknown as Attendee[])
    ).catch(() => {});
  }, [selectedId]);

  // Buffered events that arrived before useSelfLocation() resolved. Without
  // this, the user-location stream's first ~1-2s of events (often the very
  // people already in the room when the user opens the recorder) get
  // dropped silently because selfLoc.isInWorld is still false.
  type LocEvent = { userId: string; displayName?: string; location?: string };
  const pendingLocEventsRef = useRef<LocEvent[]>([]);
  const PENDING_TTL_MS = 10_000;
  const pendingTimeoutRef = useRef<number | null>(null);

  // Drain the buffer once selfLoc resolves to a world+instance. Apply the
  // same-instance gate retroactively. We only drain when we have a real
  // location to compare against — staying offline / in private just means
  // the events won't match anything and will be discarded by the gate
  // when the buffer ages out.
  useEffect(() => {
    if (!activeId || !selfLoc.isInWorld || !selfLoc.worldId || !selfLoc.instanceId) return;
    const queued = pendingLocEventsRef.current;
    if (queued.length === 0) return;
    pendingLocEventsRef.current = [];
    if (pendingTimeoutRef.current !== null) {
      window.clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
    }
    for (const ev of queued) {
      const target = parseLocation(ev.location ?? null);
      if (target.kind !== "world") continue;
      if (target.worldId !== selfLoc.worldId || target.instanceId !== selfLoc.instanceId) continue;
      ipc.eventAddAttendee(activeId, ev.userId, ev.displayName ?? ev.userId).catch(() => {});
    }
  }, [activeId, selfLoc.isInWorld, selfLoc.worldId, selfLoc.instanceId]);

  usePipelineEvent("user-location", (content: { userId?: string; user?: { displayName?: string }; location?: string }) => {
    if (!activeId || !content?.userId) return;
    // Buffer events while selfLoc hasn't resolved yet so we don't drop the
    // initial burst of people already in the room.
    if (!selfLoc.isInWorld || !selfLoc.worldId || !selfLoc.instanceId) {
      pendingLocEventsRef.current.push({
        userId: content.userId,
        displayName: content.user?.displayName,
        location: content.location,
      });
      // Cap the buffer so a permanently-offline user doesn't accumulate
      // events forever.
      if (pendingLocEventsRef.current.length > 200) {
        pendingLocEventsRef.current.splice(0, pendingLocEventsRef.current.length - 200);
      }
      // Auto-clear if we never resolve.
      if (pendingTimeoutRef.current === null) {
        pendingTimeoutRef.current = window.setTimeout(() => {
          pendingLocEventsRef.current = [];
          pendingTimeoutRef.current = null;
        }, PENDING_TTL_MS);
      }
      return;
    }
    const target = parseLocation(content.location ?? null);
    if (target.kind !== "world") return;
    if (target.worldId !== selfLoc.worldId || target.instanceId !== selfLoc.instanceId) return;
    const name = content.user?.displayName ?? content.userId;
    ipc.eventAddAttendee(activeId, content.userId, name).catch(() => {});
  });

  async function startRec() {
    if (!newName.trim()) return;
    try {
      // Pass the local user's current world+instance so the recording row
      // is anchored to a known room. If the user starts a recording while
      // outside any world, the row is created with empty location and the
      // attendee gate will simply never match anything until selfLoc
      // catches up — that's fine because the room of record is whatever
      // the user was in when they hit start.
      const r = await ipc.eventStart(
        newName.trim(),
        selfLoc.worldId ?? undefined,
        selfLoc.instanceId ?? undefined,
      );
      setActiveId(r.id);
      setNewName("");
      toast.success(t("common.done", { defaultValue: "Done" }));
      void refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }

  async function stopRec() {
    if (!activeId) return;
    try {
      await ipc.eventStop(activeId);
      setActiveId(null);
      toast.success(t("common.done", { defaultValue: "Done" }));
      void refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }

  async function deleteRec(rec: Recording) {
    setDeleting(true);
    try {
      await ipc.eventDelete(rec.id);
      // If we just deleted the active recording row, clear that state
      // so the UI doesn't keep streaming attendees into a dead row.
      if (activeId === rec.id) setActiveId(null);
      if (selectedId === rec.id) {
        setSelectedId(null);
        setAttendees([]);
      }
      toast.success(t("eventRecorder.deleted", { defaultValue: "Recording deleted" }));
      setPendingDelete(null);
      void refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in max-w-5xl mx-auto w-full">
      <header className="flex items-center gap-2">
        <CircleDot className="size-4" />
        <span className="text-[11px] uppercase tracking-[0.08em] font-semibold">
          {t("eventRecorder.title", { defaultValue: "Event Recorder" })}
        </span>
      </header>

      <Card className="unity-panel">
        <CardContent className="p-3 flex items-center gap-2">
          {activeId ? (
            <>
              <Badge variant="destructive" className="animate-pulse">
                {t("common.live", { defaultValue: "Live" })}
              </Badge>
              <span className="text-[12px] flex-1">
                {t("eventRecorder.recording", {
                  defaultValue: "Recording in progress...",
                })}
              </span>
              <Button size="sm" variant="destructive" onClick={() => void stopRec()}>
                <Square className="size-3" /> {t("eventRecorder.stopRecording", { defaultValue: "Stop" })}
              </Button>
            </>
          ) : (
            <>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("eventRecorder.namePlaceholder", {
                  defaultValue: "Event name...",
                })}
                className="h-7 text-[12px] flex-1"
                onKeyDown={(e) => { if (e.key === "Enter") void startRec(); }}
              />
              <Button size="sm" onClick={() => void startRec()} disabled={!newName.trim()}>
                <CircleDot className="size-3" /> {t("eventRecorder.startRecording", { defaultValue: "Start Recording" })}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="unity-panel">
        <CardContent className="p-3 text-[11px] text-[hsl(var(--muted-foreground))] space-y-1">
          <p>{t("eventRecorder.guide1", { defaultValue: "Records who you meet in VRChat instances in real-time." })}</p>
          <p>{t("eventRecorder.guide2", { defaultValue: "1. Enter a name and click Start Recording. 2. While recording, players joining your instance are automatically logged. 3. Click Stop to end the session. Select a recording to see attendees." })}</p>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          {recordings.length === 0 && (
            <Card className="unity-panel">
              <CardContent className="p-6 text-center">
                <CircleDot className="size-6 mx-auto mb-2 text-[hsl(var(--muted-foreground)/0.5)]" />
                <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                  {t("eventRecorder.noRecordings", { defaultValue: "No recordings yet. Start one above to track who joins your instance." })}
                </p>
              </CardContent>
            </Card>
          )}
          {recordings.map((rec) => (
            <div
              key={rec.id}
              className={`unity-panel group flex items-center gap-2 rounded-[var(--radius-md)] border p-3 transition-colors ${
                selectedId === rec.id ? "border-[hsl(var(--primary)/0.55)]" : "border-[hsl(var(--border))]"
              }`}
            >
              <button
                type="button"
                onClick={() => setSelectedId(rec.id)}
                className="flex flex-1 min-w-0 flex-col items-start text-left"
              >
                <div className="text-[12px] font-medium truncate w-full">{rec.name}</div>
                <div className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono flex gap-2 flex-wrap">
                  <span><Users className="inline size-2.5" /> {rec.attendee_count}</span>
                  <span><Clock className="inline size-2.5" /> {new Date(rec.started_at).toLocaleString()}</span>
                  {!rec.ended_at && (
                    <Badge variant="destructive" className="text-[8px]">
                      {t("common.live", { defaultValue: "Live" })}
                    </Badge>
                  )}
                </div>
              </button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-[hsl(var(--muted-foreground))] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[hsl(var(--destructive))]"
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingDelete(rec);
                }}
                title={t("eventRecorder.delete", { defaultValue: "Delete recording" })}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(v) => { if (!v) setPendingDelete(null); }}
          title={t("eventRecorder.deleteTitle", { defaultValue: "Delete recording?" })}
          description={t("eventRecorder.deleteDesc", {
            defaultValue: "This permanently removes \"{{name}}\" and its {{count}} attendee record(s). This cannot be undone.",
            name: pendingDelete?.name ?? "",
            count: pendingDelete?.attendee_count ?? 0,
          })}
          confirmLabel={deleting
            ? t("common.deleting", { defaultValue: "Deleting…" })
            : t("eventRecorder.delete", { defaultValue: "Delete" })}
          cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
          tone="destructive"
          onConfirm={async () => {
            if (pendingDelete) await deleteRec(pendingDelete);
          }}
        />

        {selectedId && (
          <Card className="unity-panel">
            <CardHeader className="pb-2">
              <CardTitle className="text-[12px]">
                {t("eventRecorder.attendees", { defaultValue: "Attendees" })} ({attendees.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-0.5 max-h-[400px] overflow-y-auto">
              {attendees.length === 0 && (
                <p className="text-[11px] text-[hsl(var(--muted-foreground))] py-4 text-center">
                  {t("eventRecorder.noAttendees", { defaultValue: "No attendees recorded yet." })}
                </p>
              )}
              {attendees.map((a) => (
                <div key={a.id} className="flex justify-between text-[11px] font-mono py-0.5 border-b border-[hsl(var(--border)/0.3)]">
                  <span>{a.display_name}</span>
                  <span className="text-[hsl(var(--muted-foreground))]">{new Date(a.first_seen_at).toLocaleTimeString()}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
