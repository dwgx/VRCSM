/**
 * RadarHistoryAnalysis — offline log analysis component.
 * Extracted from the monolithic Radar.tsx.
 */

import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Globe,
  Shirt,
  Users,
  Clock,
  TrendingUp,
  Palette,
  UserPlus,
  UserMinus,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  BarChart3,
  RefreshCw,
  History,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";

import { WorldPopupBadge } from "@/components/WorldPopupBadge";

import type {
  ScanLogsResponse,
  AnalysisSession,
  AnalysisSessionPlayer,
  AnalysisSessionTimelineEntry,
} from "./radar-types";
import { formatDateAndTime, formatDuration, formatTimePart, parseEventTimestamp, shortId } from "./radar-utils";
import { PlayerProfileDialog, TrustDot } from "./RadarPlayerWidgets";

function StatCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <Card className="border-[hsl(var(--border)/0.5)]">
      <CardContent className="flex items-center gap-3 p-3">
        <div className="flex size-9 items-center justify-center rounded-md bg-[hsl(var(--muted)/0.4)]">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] truncate">
            {label}
          </div>
          <div className="text-[18px] font-semibold tabular-nums">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function RadarHistoryAnalysis() {
  const { t } = useTranslation();
  const { status: authStatus } = useAuth();
  const [scan, setScan] = useState<ScanLogsResponse | null>(null);
  const [loading, setLoadingState] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [playerTags, setPlayerTags] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let alive = true;
    setLoadingState(true);
    void ipc
      .call<object, { logs: ScanLogsResponse }>("scan", {})
      .then((res) => {
        if (!alive) return;
        setScan(res?.logs ?? null);
        setLoadingState(false);
      })
      .catch(() => {
        if (!alive) return;
        setLoadingState(false);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const sessions = useMemo<AnalysisSession[]>(() => {
    if (!scan) return [];
    const ws = scan.world_switches ?? [];
    const pe = scan.player_events ?? [];
    const av = scan.avatar_switches ?? [];
    const names = scan.world_names ?? {};
    const localUser = scan.local_user_name ?? null;

    const result: AnalysisSession[] = [];

    const nextStartMs: Array<number | null> = ws.map((_, i) => {
      const next = ws[i + 1];
      return next ? parseEventTimestamp(next.iso_time) : null;
    });

    for (let i = 0; i < ws.length; i++) {
      const world = ws[i];
      const startMs = parseEventTimestamp(world.iso_time);
      const endMs = nextStartMs[i];
      const endTime = ws[i + 1]?.iso_time ?? null;

      const belongs = (eventTime: string | null, eventWorldId?: string | null, eventInstanceId?: string | null): boolean => {
        if (eventInstanceId && world.instance_id) {
          return eventInstanceId === world.instance_id;
        }
        if (eventWorldId && world.world_id) {
          if (eventWorldId !== world.world_id) return false;
        }
        const ms = parseEventTimestamp(eventTime);
        if (ms === null) return startMs === null;
        if (startMs !== null && ms < startMs) return false;
        if (endMs !== null && ms >= endMs) return false;
        return true;
      };

      const players = new Map<string, AnalysisSessionPlayer>();
      const timeline: AnalysisSessionTimelineEntry[] = [];
      let avatarChanges = 0;
      let peakConcurrent = 0;
      let currentConcurrent = 0;

      const orderedEvents: Array<{ ms: number; idx: number; fn: () => void }> = [];

      pe.forEach((ev, idx) => {
        if (!belongs(ev.iso_time, ev.world_id ?? null, ev.instance_id ?? null)) return;
        const ms = parseEventTimestamp(ev.iso_time) ?? 0;
        orderedEvents.push({
          ms,
          idx,
          fn: () => {
            if (ev.kind === "joined") {
              const existing = players.get(ev.display_name);
              players.set(ev.display_name, {
                displayName: ev.display_name,
                userId: ev.user_id ?? existing?.userId ?? null,
                joinTime: ev.iso_time ?? existing?.joinTime ?? null,
                leaveTime: null,
                avatarIdOrName: existing?.avatarIdOrName ?? null,
              });
              currentConcurrent++;
              if (currentConcurrent > peakConcurrent) peakConcurrent = currentConcurrent;
              timeline.push({
                id: `${world.instance_id}-p${idx}`,
                kind: "joined",
                time: ev.iso_time,
                actor: ev.display_name,
                sortKey: ms,
              });
            } else if (ev.kind === "left") {
              const existing = players.get(ev.display_name);
              if (existing) {
                players.set(ev.display_name, { ...existing, leaveTime: ev.iso_time });
              }
              currentConcurrent = Math.max(0, currentConcurrent - 1);
              timeline.push({
                id: `${world.instance_id}-l${idx}`,
                kind: "left",
                time: ev.iso_time,
                actor: ev.display_name,
                sortKey: ms,
              });
            }
          },
        });
      });

      av.forEach((ev, idx) => {
        if (!belongs(ev.iso_time, ev.world_id ?? null, ev.instance_id ?? null)) return;
        const isLocalActor = !!(localUser && ev.actor === localUser);
        if (!players.has(ev.actor) && !isLocalActor) return;
        const ms = parseEventTimestamp(ev.iso_time) ?? 0;
        orderedEvents.push({
          ms,
          idx: idx + 1_000_000,
          fn: () => {
            avatarChanges++;
            const existing = players.get(ev.actor);
            if (existing) {
              players.set(ev.actor, { ...existing, avatarIdOrName: ev.avatar_name });
            }
            timeline.push({
              id: `${world.instance_id}-a${idx}`,
              kind: "avatarSwitch",
              time: ev.iso_time,
              actor: ev.actor,
              detail: ev.avatar_name,
              sortKey: ms,
            });
          },
        });
      });

      orderedEvents.sort((a, b) => (a.ms !== b.ms ? a.ms - b.ms : a.idx - b.idx));
      for (const e of orderedEvents) e.fn();

      timeline.sort((a, b) => a.sortKey - b.sortKey);

      const playerArray = Array.from(players.values()).sort((a, b) => {
        const ams = parseEventTimestamp(a.joinTime) ?? 0;
        const bms = parseEventTimestamp(b.joinTime) ?? 0;
        return ams - bms;
      });

      result.push({
        id: `${world.instance_id}-${i}`,
        worldId: world.world_id,
        worldName: names[world.world_id] ?? "",
        instanceId: world.instance_id,
        accessType: world.access_type,
        ownerId: world.owner_id,
        region: world.region,
        startTime: world.iso_time,
        startMs,
        endTime,
        endMs,
        players: playerArray,
        peakConcurrent,
        avatarChanges,
        timeline,
      });
    }

    return result.reverse();
  }, [scan]);

  const aggregate = useMemo(() => {
    const playerSet = new Set<string>();
    const worldSet = new Set<string>();
    const worldHits = new Map<string, { worldId: string; name: string; count: number }>();
    const playerHits = new Map<string, { displayName: string; userId: string | null; count: number }>();
    let totalAvatarChanges = 0;
    let totalDurationMs = 0;

    for (const s of sessions) {
      if (s.worldId) {
        worldSet.add(s.worldId);
        const hit = worldHits.get(s.worldId);
        if (hit) hit.count++;
        else worldHits.set(s.worldId, { worldId: s.worldId, name: s.worldName, count: 1 });
      }
      totalAvatarChanges += s.avatarChanges;
      if (s.startMs !== null && s.endMs !== null) {
        totalDurationMs += Math.max(0, s.endMs - s.startMs);
      }
      for (const p of s.players) {
        // Filter out the signed-in user — "most-encountered players" should
        // not list yourself. Match both by userId (canonical) and by
        // displayName (fallback for sessions where only the name was parsed).
        if (authStatus.userId && p.userId === authStatus.userId) continue;
        if (authStatus.displayName && p.displayName === authStatus.displayName) continue;
        playerSet.add(p.displayName);
        const key = p.userId ?? p.displayName;
        const hit = playerHits.get(key);
        if (hit) hit.count++;
        else playerHits.set(key, { displayName: p.displayName, userId: p.userId, count: 1 });
      }
    }

    const topWorlds = Array.from(worldHits.values()).sort((a, b) => b.count - a.count).slice(0, 5);
    const topPlayers = Array.from(playerHits.values()).sort((a, b) => b.count - a.count).slice(0, 8);

    return {
      sessionCount: sessions.length,
      uniquePlayers: playerSet.size,
      uniqueWorlds: worldSet.size,
      totalAvatarChanges,
      totalDurationMs,
      topWorlds,
      topPlayers,
    };
  }, [sessions, authStatus.userId, authStatus.displayName]);

  useEffect(() => {
    const candidates = new Set<string>();
    for (const s of sessions) {
      for (const p of s.players) {
        if (p.userId && p.userId.startsWith("usr_") && !playerTags[p.userId]) {
          candidates.add(p.userId);
        }
      }
    }
    if (candidates.size === 0) return;
    let alive = true;
    const list = Array.from(candidates).slice(0, 24);
    for (const uid of list) {
      void ipc
        .call<{ userId: string }, { profile: any }>("user.getProfile", { userId: uid })
        .then((res) => {
          if (!alive) return;
          const tags = res?.profile?.tags;
          if (tags && Array.isArray(tags)) {
            setPlayerTags((prev) => (prev[uid] ? prev : { ...prev, [uid]: tags }));
          }
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [sessions, playerTags]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCell
          icon={<History className="size-4 text-[hsl(var(--primary))]" />}
          label={t("radar.analysis.aggregate.totalSessions", { defaultValue: "Sessions" })}
          value={aggregate.sessionCount}
        />
        <StatCell
          icon={<Users className="size-4 text-emerald-400" />}
          label={t("radar.analysis.aggregate.uniquePlayers", { defaultValue: "Unique players" })}
          value={aggregate.uniquePlayers}
        />
        <StatCell
          icon={<Globe className="size-4 text-blue-400" />}
          label={t("radar.analysis.aggregate.uniqueWorlds", { defaultValue: "Unique worlds" })}
          value={aggregate.uniqueWorlds}
        />
        <StatCell
          icon={<Shirt className="size-4 text-purple-400" />}
          label={t("radar.analysis.aggregate.avatarChanges", { defaultValue: "Avatar changes" })}
          value={aggregate.totalAvatarChanges}
        />
      </div>

      {aggregate.topWorlds.length > 0 || aggregate.topPlayers.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card className="border-[hsl(var(--border)/0.5)]">
            <CardHeader className="py-3 border-b border-[hsl(var(--border)/0.5)]">
              <div className="flex items-center gap-2">
                <Globe className="size-4 text-blue-400" />
                <CardTitle className="text-xs">{t("radar.analysis.topWorlds", { defaultValue: "Most-visited worlds" })}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {aggregate.topWorlds.length === 0 ? (
                <div className="p-4 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
                  {t("radar.analysis.empty", { defaultValue: "No data yet." })}
                </div>
              ) : (
                <ul className="divide-y divide-[hsl(var(--border)/0.4)]">
                  {aggregate.topWorlds.map((w) => (
                    <li key={w.worldId} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <WorldPopupBadge worldId={w.worldId} />
                      </div>
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        ×{w.count}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card className="border-[hsl(var(--border)/0.5)]">
            <CardHeader className="py-3 border-b border-[hsl(var(--border)/0.5)]">
              <div className="flex items-center gap-2">
                <Users className="size-4 text-emerald-400" />
                <CardTitle className="text-xs">{t("radar.analysis.topPlayers", { defaultValue: "Most-encountered players" })}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {aggregate.topPlayers.length === 0 ? (
                <div className="p-4 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
                  {t("radar.analysis.empty", { defaultValue: "No data yet." })}
                </div>
              ) : (
                <ul className="divide-y divide-[hsl(var(--border)/0.4)]">
                  {aggregate.topPlayers.map((p) => (
                    <li key={p.userId ?? p.displayName} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <TrustDot tags={p.userId ? playerTags[p.userId] : undefined} />
                        <span className="text-[12px] font-medium truncate">{p.displayName}</span>
                        {p.userId ? (
                          <span className="text-[9px] font-mono text-[hsl(var(--muted-foreground))]">
                            {shortId(p.userId)}
                          </span>
                        ) : null}
                      </div>
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        ×{p.count}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader className="py-3 border-b border-[hsl(var(--border))]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="size-4 text-[hsl(var(--primary))]" />
              <CardTitle className="text-sm">
                {t("radar.analysis.sessions", { defaultValue: "Session history" })}
              </CardTitle>
              <CardDescription className="text-[11px]">
                {t("radar.analysis.sessionsDesc", { defaultValue: "Reconstructed from local logs — newest first." })}
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => setRefreshKey((v) => v + 1)}
              disabled={loading}
            >
              <RefreshCw className={cn("size-3 mr-1", loading && "animate-spin")} />
              {t("common.refresh", { defaultValue: "Refresh" })}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-[12px] text-[hsl(var(--muted-foreground))] animate-pulse">
              {t("common.loading", { defaultValue: "Loading…" })}
            </div>
          ) : sessions.length === 0 ? (
            <div className="p-8 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("radar.analysis.empty", { defaultValue: "No sessions found in local logs." })}
            </div>
          ) : (
            <ul className="divide-y divide-[hsl(var(--border)/0.4)]">
              {sessions.map((session, idx) => {
                const isOpen = expanded[session.id] ?? false;
                const isOngoing = idx === 0 && session.endMs === null;
                const durationMs =
                  session.startMs !== null
                    ? (session.endMs ?? Date.now()) - session.startMs
                    : 0;
                return (
                  <li key={session.id} className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => toggle(session.id)}
                      className="flex items-center gap-3 px-3 py-3 text-left hover:bg-[hsl(var(--muted)/0.2)] transition-colors"
                    >
                      <div className="shrink-0">
                        {isOpen ? (
                          <ChevronDown className="size-4 text-[hsl(var(--muted-foreground))]" />
                        ) : (
                          <ChevronRight className="size-4 text-[hsl(var(--muted-foreground))]" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold truncate">
                            {session.worldName || shortId(session.worldId) || t("common.unknown", { defaultValue: "Unknown" })}
                          </span>
                          <Badge variant="outline" className="font-mono uppercase text-[9px] tracking-widest">
                            {session.accessType}
                          </Badge>
                          {session.region ? (
                            <Badge variant="secondary" className="font-mono uppercase text-[9px]">
                              {session.region}
                            </Badge>
                          ) : null}
                          {isOngoing ? (
                            <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/25 text-[9px]">
                              {t("radar.analysis.ongoing", { defaultValue: "Ongoing" })}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))] flex items-center gap-2 flex-wrap">
                          <Clock className="size-3" />
                          <span className="font-mono">{formatDateAndTime(session.startTime)}</span>
                          <span>·</span>
                          <span>{formatDuration(durationMs)}</span>
                        </div>
                      </div>
                      <div className="hidden sm:flex items-center gap-3 shrink-0 text-[10px] font-mono text-[hsl(var(--muted-foreground))]">
                        <span title={t("radar.stats.uniquePlayers", { defaultValue: "Unique players" })}>
                          <Users className="inline size-3 mr-0.5" />
                          {session.players.length}
                        </span>
                        <span title={t("radar.stats.peakPlayers", { defaultValue: "Peak players" })}>
                          <TrendingUp className="inline size-3 mr-0.5" />
                          {session.peakConcurrent}
                        </span>
                        <span title={t("radar.stats.avatarChanges", { defaultValue: "Avatar changes" })}>
                          <Palette className="inline size-3 mr-0.5" />
                          {session.avatarChanges}
                        </span>
                      </div>
                    </button>
                    {isOpen ? (
                      <div className="px-4 pb-4 pt-1 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] bg-[hsl(var(--canvas))]">
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
                            <Globe className="size-3" />
                            {session.worldId ? (
                              <WorldPopupBadge worldId={session.worldId} />
                            ) : (
                              <span className="font-mono">{t("common.unknown", { defaultValue: "Unknown" })}</span>
                            )}
                          </div>
                          <div className="font-mono text-[10px] bg-black/20 p-2 rounded border border-[hsl(var(--border)/0.5)] break-all select-all text-blue-400">
                            {session.instanceId}
                          </div>
                          <div className="text-[11px] font-semibold mt-2 mb-1 flex items-center gap-1">
                            <Users className="size-3 text-emerald-400" />
                            {t("radar.analysis.session.players", { defaultValue: "Players" })}
                            <span className="text-[10px] font-normal text-[hsl(var(--muted-foreground))]">
                              ({session.players.length})
                            </span>
                          </div>
                          {session.players.length === 0 ? (
                            <div className="text-[11px] italic text-[hsl(var(--muted-foreground))]">
                              {t("radar.analysis.session.noPlayers", { defaultValue: "No player events recorded." })}
                            </div>
                          ) : (
                            <ul className="flex flex-col divide-y divide-[hsl(var(--border)/0.3)] border border-[hsl(var(--border)/0.5)] rounded-md bg-[hsl(var(--card))]">
                              {session.players.map((p) => (
                                <li
                                  key={`${session.id}-${p.displayName}`}
                                  className="flex items-center justify-between gap-2 px-2.5 py-1.5"
                                >
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <TrustDot tags={p.userId ? playerTags[p.userId] : undefined} />
                                    <Dialog>
                                      <DialogTrigger asChild>
                                        <button
                                          type="button"
                                          className="text-[12px] font-medium truncate hover:text-[hsl(var(--primary))] transition-colors"
                                        >
                                          {p.displayName}
                                        </button>
                                      </DialogTrigger>
                                      <PlayerProfileDialog userId={p.userId} displayName={p.displayName} />
                                    </Dialog>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0 text-[9px] font-mono text-[hsl(var(--muted-foreground))]">
                                    <span>{formatTimePart(p.joinTime)}</span>
                                    <ArrowRightLeft className="size-2.5 opacity-60" />
                                    <span>{p.leaveTime ? formatTimePart(p.leaveTime) : "—"}</span>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div className="flex flex-col gap-2">
                          <div className="text-[11px] font-semibold mb-1 flex items-center gap-1">
                            <Clock className="size-3 text-[hsl(var(--primary))]" />
                            {t("radar.analysis.session.timeline", { defaultValue: "Timeline" })}
                            <span className="text-[10px] font-normal text-[hsl(var(--muted-foreground))]">
                              ({session.timeline.length})
                            </span>
                          </div>
                          {session.timeline.length === 0 ? (
                            <div className="text-[11px] italic text-[hsl(var(--muted-foreground))]">
                              {t("radar.timeline.empty", { defaultValue: "No events recorded." })}
                            </div>
                          ) : (
                            <div className="border border-[hsl(var(--border)/0.5)] rounded-md bg-[hsl(var(--card))] max-h-[280px] overflow-y-auto p-2 flex flex-col gap-0.5">
                              {session.timeline.map((entry) => (
                                <div
                                  key={entry.id}
                                  className="flex items-start gap-2 text-[11px] py-0.5"
                                >
                                  <span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))] w-[60px] shrink-0">
                                    {formatTimePart(entry.time)}
                                  </span>
                                  {entry.kind === "joined" ? (
                                    <UserPlus className="mt-0.5 size-3 text-emerald-400 shrink-0" />
                                  ) : entry.kind === "left" ? (
                                    <UserMinus className="mt-0.5 size-3 text-red-400 shrink-0" />
                                  ) : (
                                    <Palette className="mt-0.5 size-3 text-purple-400 shrink-0" />
                                  )}
                                  <span className="min-w-0 flex-1 truncate">
                                    <span className="font-medium">{entry.actor}</span>
                                    {entry.detail ? (
                                      <span className="text-[hsl(var(--muted-foreground))]">
                                        {" → "}
                                        <span className="italic text-purple-400">{entry.detail}</span>
                                      </span>
                                    ) : null}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
