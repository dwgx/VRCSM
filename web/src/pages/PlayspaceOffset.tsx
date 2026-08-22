import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Move3d, RotateCcw } from "lucide-react";
import { ipc, IpcError } from "@/lib/ipc";
import { useGreyPrefs } from "@/lib/grey-prefs";
import { useVrcProcess } from "@/lib/vrc-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  controlsDisabled,
  DEFAULT_PLAYSPACE_LOCKS,
  formatOffsetMeters,
  keyToNudge,
  type PlayspaceLocks,
  type PlayspaceStatus,
  type PlayspaceVec3,
} from "@/lib/playspace-math";

const ZERO: PlayspaceVec3 = { x: 0, y: 0, z: 0 };

function idleStatus(locks: PlayspaceLocks): PlayspaceStatus {
  return { state: "idle", offset: ZERO, locks, gripHeld: false };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function asStatus(raw: unknown, prev: PlayspaceStatus): PlayspaceStatus {
  if (!raw || typeof raw !== "object") return prev;
  const o = raw as Record<string, unknown>;
  const offsetRaw = o.offset && typeof o.offset === "object" ? (o.offset as Record<string, unknown>) : null;
  const locksRaw = o.locks && typeof o.locks === "object" ? (o.locks as Record<string, unknown>) : null;
  const state = typeof o.state === "string" ? (o.state as PlayspaceStatus["state"]) : prev.state;
  return {
    state,
    error: typeof o.error === "string" ? o.error : state === prev.state ? prev.error : undefined,
    offset: offsetRaw
      ? {
          x: typeof offsetRaw.x === "number" ? offsetRaw.x : 0,
          y: typeof offsetRaw.y === "number" ? offsetRaw.y : 0,
          z: typeof offsetRaw.z === "number" ? offsetRaw.z : 0,
        }
      : prev.offset,
    locks: locksRaw
      ? {
          lockX: typeof locksRaw.lockX === "boolean" ? locksRaw.lockX : prev.locks.lockX,
          lockY: typeof locksRaw.lockY === "boolean" ? locksRaw.lockY : prev.locks.lockY,
          lockZ: typeof locksRaw.lockZ === "boolean" ? locksRaw.lockZ : prev.locks.lockZ,
        }
      : prev.locks,
    steamVrRuntime: typeof o.steamVrRuntime === "string" ? o.steamVrRuntime : prev.steamVrRuntime,
    gripHeld: typeof o.gripHeld === "boolean" ? o.gripHeld : prev.gripHeld,
    offsetLimitHit: typeof o.offsetLimitHit === "boolean" ? o.offsetLimitHit : prev.offsetLimitHit,
  };
}

export default function PlayspaceOffsetPage() {
  const { t } = useTranslation();
  const { prefs } = useGreyPrefs();
  const helpersOn = prefs?.greyEnabled === true;
  const { status: vrcStatus } = useVrcProcess();
  const [status, setStatus] = useState<PlayspaceStatus>(() => idleStatus(DEFAULT_PLAYSPACE_LOCKS));
  const [busy, setBusy] = useState<"start" | "stop" | "reset" | null>(null);
  const [greyDisabled, setGreyDisabled] = useState(false);
  const locksRef = useRef(status.locks);
  locksRef.current = status.locks;
  const statusRef = useRef(status);
  statusRef.current = status;
  const toastedLimit = useRef(false);

  const applyStatus = useCallback((next: PlayspaceStatus) => {
    setStatus(next);
    if (next.offsetLimitHit && !toastedLimit.current) {
      toastedLimit.current = true;
      toast.error(
        t("playspace.offsetLimit", {
          defaultValue: "Offset limit 5.0 m reached. Further motion is ignored until Reset.",
        }),
      );
    }
    if (!next.offsetLimitHit) toastedLimit.current = false;
  }, [t]);

  const handleIpcError = useCallback(
    (err: unknown, fallback: PlayspaceStatus): PlayspaceStatus => {
      if (err instanceof IpcError && err.code === "grey_disabled") {
        setGreyDisabled(true);
        return { ...fallback, state: "idle", error: err.message };
      }
      if (
        err instanceof IpcError &&
        (err.code === "steamvr_not_running" ||
          err.code === "mock_not_implemented" ||
          err.code === "method_not_found")
      ) {
        return {
          ...fallback,
          state: "steamvr_not_running",
          error: err.message,
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { ...fallback, state: "error", error: message };
    },
    [],
  );

  const refresh = useCallback(async () => {
    try {
      const raw = await ipc.call<Record<string, never>, unknown>("playspace.status", {});
      applyStatus(asStatus(raw, statusRef.current));
    } catch (err) {
      applyStatus(handleIpcError(err, statusRef.current));
    }
  }, [applyStatus, handleIpcError]);

  useEffect(() => {
    if (!helpersOn) {
      setGreyDisabled(true);
      return;
    }
    setGreyDisabled(false);
    void refresh();
    const unsub = ipc.on<unknown>("playspace.status", (data) => {
      applyStatus(asStatus(data, statusRef.current));
    });
    const id = window.setInterval(() => {
      void refresh();
    }, 1000);
    return () => {
      unsub();
      window.clearInterval(id);
    };
  }, [helpersOn, applyStatus, refresh]);

  const callOrStatus = useCallback(
    async (method: string, params: Record<string, unknown> | undefined, kind: typeof busy) => {
      setBusy(kind);
      try {
        const raw = await ipc.call<typeof params, unknown>(method, params);
        applyStatus(asStatus(raw, statusRef.current));
      } catch (err) {
        applyStatus(handleIpcError(err, statusRef.current));
        if (!(err instanceof IpcError && err.code === "grey_disabled")) {
          toast.error(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setBusy(null);
      }
    },
    [applyStatus, handleIpcError],
  );

  const steamVrDown = status.state === "steamvr_not_running";
  const labOff = controlsDisabled(status.state);
  const canStart = !greyDisabled && busy === null && status.state !== "ready" && status.state !== "active";
  const canOperate = !greyDisabled && !labOff && busy === null;

  async function toggleLock(key: keyof PlayspaceLocks, value: boolean) {
    const patch = { [key]: value };
    setStatus((s) => ({ ...s, locks: { ...s.locks, [key]: value } }));
    try {
      const raw = await ipc.call<typeof patch, unknown>("playspace.setLocks", patch);
      applyStatus(asStatus(raw, { ...statusRef.current, locks: { ...locksRef.current, [key]: value } }));
    } catch (err) {
      applyStatus(handleIpcError(err, statusRef.current));
    }
  }

  async function sendNudge(delta: PlayspaceVec3) {
    if (!canOperate) return;
    try {
      const raw = await ipc.call<{ dx: number; dy: number; dz: number }, unknown>("playspace.nudge", {
        dx: delta.x,
        dy: delta.y,
        dz: delta.z,
      });
      applyStatus(asStatus(raw, statusRef.current));
    } catch (err) {
      if (err instanceof IpcError && err.code === "offset_limit") {
        applyStatus({ ...statusRef.current, offsetLimitHit: true });
        return;
      }
      applyStatus(handleIpcError(err, statusRef.current));
    }
  }

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.repeat) return;
      if (isTypingTarget(ev.target)) return;
      if (document.visibilityState !== "visible") return;
      if (!canOperate) return;
      const delta = keyToNudge(ev.key, locksRef.current);
      if (!delta) return;
      ev.preventDefault();
      void sendNudge(delta);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // sendNudge closes over canOperate via status; refresh when those change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canOperate, status.locks.lockX, status.locks.lockY, status.locks.lockZ]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 animate-fade-in">
      <header className="flex flex-col gap-2">
        <div className="unity-panel-header inline-flex items-center gap-2 border-0 bg-transparent px-0 py-0 normal-case tracking-normal">
          <Move3d className="size-3.5" />
          <span className="text-[11px] uppercase tracking-[0.08em]">
            {t("playspace.title", { defaultValue: "Playspace offset" })}
          </span>
        </div>
        <p className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
          {t("grey.tos.playspace", {
            defaultValue:
              "Playspace offset moves SteamVR’s tracking origin through the official OpenVR chaperone API. It does not modify VRChat. Large offsets can put you outside your physical room. Chaperone bounds are not rewritten. Default Y-lock stays on.",
          })}
        </p>
      </header>

      {greyDisabled && (
        <Card className="unity-panel">
          <CardContent className="p-3 font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
            {t("grey.disabled.settingsHint", {
              defaultValue: "Optional social/VR helpers are off. Enable them in Settings → Experimental.",
            })}
          </CardContent>
        </Card>
      )}

      {steamVrDown && (
        <Card className="unity-panel border-[hsl(var(--destructive)/0.4)]">
          <CardContent className="p-3 font-mono text-[12px]">
            {t("playspace.steamvrNotRunning", { defaultValue: "SteamVR not running" })}
            {status.error ? (
              <span className="mt-1 block text-[11px] text-[hsl(var(--muted-foreground))]">{status.error}</span>
            ) : null}
          </CardContent>
        </Card>
      )}

      <Card className="unity-panel">
        <CardContent className="flex flex-wrap items-center gap-2 p-3 text-[11px]">
          <Badge variant="outline">{status.state}</Badge>
          {status.gripHeld ? (
            <Badge>{t("playspace.gripHeld", { defaultValue: "Grip held" })}</Badge>
          ) : null}
          <Badge variant="outline">
            {t("playspace.offset", { defaultValue: "Offset" })}: {formatOffsetMeters(status.offset)}
          </Badge>
          {vrcStatus.running ? (
            <Badge variant="outline">
              {t("playspace.vrcRunning", {
                defaultValue: "VRChat running (display only — not attached)",
              })}
            </Badge>
          ) : null}
          {status.steamVrRuntime ? (
            <span className="w-full truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
              {status.steamVrRuntime}
            </span>
          ) : null}
        </CardContent>
      </Card>

      <Card className="unity-panel" tabIndex={0}>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!canStart}
              onClick={() => void callOrStatus("playspace.start", {}, "start")}
            >
              {t("playspace.start", { defaultValue: "Start" })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canOperate}
              onClick={() => void callOrStatus("playspace.stop", {}, "stop")}
            >
              {t("playspace.stop", { defaultValue: "Stop" })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canOperate}
              onClick={() => void callOrStatus("playspace.reset", {}, "reset")}
            >
              <RotateCcw />
              {t("playspace.reset", { defaultValue: "Reset" })}
            </Button>
          </div>

          <div className="flex flex-wrap gap-4 font-mono text-[11px]">
            {([
              ["lockX", t("playspace.lockX", { defaultValue: "Lock X" })],
              ["lockY", t("playspace.lockY", { defaultValue: "Lock Y" })],
              ["lockZ", t("playspace.lockZ", { defaultValue: "Lock Z" })],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex cursor-pointer select-none items-center gap-2">
                <input
                  type="checkbox"
                  checked={status.locks[key]}
                  disabled={greyDisabled || busy !== null}
                  onChange={(e) => void toggleLock(key, e.target.checked)}
                  className="h-4 w-4 cursor-pointer border border-[hsl(var(--border-strong))]"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <p className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
            {t("playspace.keyboardHint", {
              defaultValue:
                "Test panel (window focused): arrows move XZ, Page Up/Down move Y if unlocked. Grip + stick on the controllers while Start is active. Dual-grip tap resets to identity.",
            })}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
