import { useRadar } from "@/lib/hooks/useRadar";
import type { RadarPlayer } from "@/lib/types";

function fmtHex(n: number) {
  return n ? `0x${n.toString(16).toUpperCase().padStart(12, "0")}` : "—";
}

function fmtPos(p: RadarPlayer) {
  return `(${p.posX.toFixed(1)}, ${p.posY.toFixed(1)}, ${p.posZ.toFixed(1)})`;
}

function StatusDot({ on }: { on: boolean }) {
  return (
    <span className={`relative flex h-2.5 w-2.5 shrink-0 rounded-full ${on ? "bg-emerald-500" : "bg-red-500"}`}>
      {on && (
        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-75" />
      )}
    </span>
  );
}

function AddressBadge({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2">
      <span className="text-[10px] font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
        {label}
      </span>
      <span className="font-mono text-xs text-sky-400">{fmtHex(value)}</span>
    </div>
  );
}

export default function MemoryRadar() {
  const { snap, loading, error } = useRadar(1000);

  return (
    <div className="flex flex-col gap-5 pb-8">
      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <StatusDot on={snap.attached} />
        <h1 className="text-xl font-semibold tracking-tight">
          Zero-Log Memory Radar
        </h1>
        <span
          className={`ml-auto rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
            snap.attached
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-red-500/15 text-red-400"
          }`}
        >
          {snap.attached ? "VRChat Connected" : "VRChat Not Running"}
        </span>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* ── Address row ── */}
      <div className="grid grid-cols-2 gap-3">
        <AddressBadge label="VRChat.exe Base" value={snap.vrcBase} />
        <AddressBadge label="GameAssembly.dll Base" value={snap.gaBase} />
      </div>

      {/* ── World info ── */}
      {(snap.worldId || snap.instanceId) && (
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3 text-sm">
          <p className="text-xs font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground))] mb-2">
            Current Instance
          </p>
          <p className="font-mono text-[hsl(var(--foreground))]">
            {snap.worldId || "—"}{snap.instanceId ? ` · ${snap.instanceId}` : ""}
          </p>
        </div>
      )}

      {/* ── Player List ── */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] overflow-hidden">
        <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-4 py-3">
          <h2 className="text-sm font-medium text-[hsl(var(--foreground))]">
            Live Players
          </h2>
          <span className="rounded-full bg-[hsl(var(--surface))] px-2.5 py-0.5 text-[11px] font-mono text-[hsl(var(--muted-foreground))]">
            {snap.players.length} online
          </span>
        </div>

        {loading && (
          <div className="px-4 py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
            Probing GameAssembly…
          </div>
        )}

        {!loading && !snap.attached && (
          <div className="px-4 py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
            Start VRChat and join a world to begin scanning.
          </div>
        )}

        {!loading && snap.attached && snap.players.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
            No players detected — join a world instance.
            <br />
            <span className="text-xs opacity-60">
              (IL2CPP class traversal activates once you enter a room)
            </span>
          </div>
        )}

        {snap.players.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] text-[10px] font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">User ID</th>
                <th className="px-4 py-2 text-right">Actor#</th>
                <th className="px-4 py-2 text-right">Position</th>
                <th className="px-4 py-2 text-center">Flags</th>
              </tr>
            </thead>
            <tbody>
              {snap.players.map((p) => (
                <tr
                  key={p.actorNumber}
                  className={`border-b border-[hsl(var(--border)/0.5)] last:border-0 transition-colors hover:bg-[hsl(var(--surface))] ${
                    p.isLocal ? "bg-sky-500/5" : ""
                  }`}
                >
                  <td className="px-4 py-2.5 font-medium text-[hsl(var(--foreground))]">
                    {p.displayName || "—"}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
                    {p.userId || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-[hsl(var(--muted-foreground))]">
                    {p.actorNumber}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-[11px] text-sky-400">
                    {fmtPos(p)}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {p.isLocal && (
                        <span className="rounded-sm bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-sky-400">
                          YOU
                        </span>
                      )}
                      {p.isMaster && (
                        <span className="rounded-sm bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                          MASTER
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Engine Status ── */}
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3">
        <p className="text-[10px] font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground))] mb-2">
          Engine
        </p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-[hsl(var(--muted-foreground))]">Mode</span>
            <span className="font-mono text-[hsl(var(--foreground))]">ReadProcessMemory (passive)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[hsl(var(--muted-foreground))]">EAC Safe</span>
            <span className="font-mono text-emerald-400">Yes — read-only, no injection</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[hsl(var(--muted-foreground))]">Source</span>
            <span className="font-mono text-[hsl(var(--foreground))]">IL2CPP dump (97.7% coverage)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[hsl(var(--muted-foreground))]">Poll Rate</span>
            <span className="font-mono text-[hsl(var(--foreground))]">1 Hz</span>
          </div>
        </div>
      </div>
    </div>
  );
}
