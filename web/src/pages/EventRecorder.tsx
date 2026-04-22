import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePipelineEvent } from "@/lib/pipeline-events";
import { CircleDot, Square, Users, Clock } from "lucide-react";

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

  const refresh = useCallback(async () => {
    const r = await ipc.eventList();
    setRecordings((r.recordings ?? []) as unknown as Recording[]);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!selectedId) return;
    ipc.eventAttendees(selectedId).then((r) =>
      setAttendees((r.attendees ?? []) as unknown as Attendee[])
    ).catch(() => {});
  }, [selectedId]);

  usePipelineEvent("user-location", (content: { userId?: string; user?: { displayName?: string }; location?: string }) => {
    if (!activeId || !content?.userId) return;
    const name = content.user?.displayName ?? content.userId;
    ipc.eventAddAttendee(activeId, content.userId, name).catch(() => {});
  });

  async function startRec() {
    if (!newName.trim()) return;
    try {
      const r = await ipc.eventStart(newName.trim());
      setActiveId(r.id);
      setNewName("");
      toast.success("Recording started");
      void refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }

  async function stopRec() {
    if (!activeId) return;
    try {
      await ipc.eventStop(activeId);
      setActiveId(null);
      toast.success("Recording stopped");
      void refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
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
              <Badge variant="destructive" className="animate-pulse">REC</Badge>
              <span className="text-[12px] flex-1">Recording #{activeId} in progress...</span>
              <Button size="sm" variant="destructive" onClick={() => void stopRec()}>
                <Square className="size-3" /> Stop
              </Button>
            </>
          ) : (
            <>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Event name..."
                className="h-7 text-[12px] flex-1"
                onKeyDown={(e) => { if (e.key === "Enter") void startRec(); }}
              />
              <Button size="sm" onClick={() => void startRec()} disabled={!newName.trim()}>
                <CircleDot className="size-3" /> Start Recording
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          {recordings.map((rec) => (
            <button
              key={rec.id}
              onClick={() => setSelectedId(rec.id)}
              className={`unity-panel flex items-center gap-3 rounded-[var(--radius-md)] border p-3 text-left transition-colors ${
                selectedId === rec.id ? "border-[hsl(var(--primary)/0.55)]" : "border-[hsl(var(--border))]"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium truncate">{rec.name}</div>
                <div className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono flex gap-2">
                  <span><Users className="inline size-2.5" /> {rec.attendee_count}</span>
                  <span><Clock className="inline size-2.5" /> {new Date(rec.started_at).toLocaleString()}</span>
                  {!rec.ended_at && <Badge variant="destructive" className="text-[8px]">LIVE</Badge>}
                </div>
              </div>
            </button>
          ))}
        </div>

        {selectedId && attendees.length > 0 && (
          <Card className="unity-panel">
            <CardHeader className="pb-2">
              <CardTitle className="text-[12px]">Attendees ({attendees.length})</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-0.5 max-h-[400px] overflow-y-auto">
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
