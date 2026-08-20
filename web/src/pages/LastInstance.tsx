import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Copy, Link2, LogIn, Save } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { launchVrchatLocation, writeInstanceShortcut } from "@/lib/shell-api";
import { useUiPrefBoolean, useUiPrefString } from "@/lib/ui-prefs";
import { useIpcQuery } from "@/hooks/useIpcQuery";
import {
  httpsLaunchUrl,
  pickLastInstance,
  visitLocation,
  vrchatLaunchUrl,
  type WorldVisitRow,
} from "@/lib/last-instance";
import type { WorldDetails } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WorldPopupBadge } from "@/components/WorldPopupBadge";

const VISIT_LIMIT = 250;
const MAX_AGE_OPTIONS = [0, 15, 30, 60, 180, 1440] as const;

function formatJoined(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const normalized = iso.includes(".") && !iso.includes("T")
      ? iso.replace(/^(\d{4})\.(\d{2})\.(\d{2})[ T]/, "$1-$2-$3T")
      : iso;
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function LastInstance() {
  const { t } = useTranslation();
  const [skipPublic, setSkipPublic] = useUiPrefBoolean("vrcsm.lastInstance.skipPublic", false);
  const [maxAgeRaw, setMaxAgeRaw] = useUiPrefString("vrcsm.lastInstance.maxAgeMinutes", "0");
  const [busy, setBusy] = useState<"rejoin" | "lnk" | null>(null);

  const maxAgeMinutes = (() => {
    const n = Number(maxAgeRaw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  })();

  const { data, isLoading, error } = useQuery({
    queryKey: ["db.worldVisits.list", { limit: VISIT_LIMIT, offset: 0 }],
    queryFn: () => ipc.dbWorldVisits(VISIT_LIMIT, 0),
    staleTime: 30_000,
  });

  const visits = (data?.items ?? []) as WorldVisitRow[];
  const visit = useMemo(
    () =>
      pickLastInstance(visits, {
        skipPublic,
        maxAgeMinutes: maxAgeMinutes > 0 ? maxAgeMinutes : null,
      }),
    [visits, skipPublic, maxAgeMinutes],
  );

  const location = visit ? visitLocation(visit) : null;
  const worldId = visit?.world_id ?? "";

  const { data: worldData } = useIpcQuery<{ id: string }, { details: WorldDetails | null }>(
    "world.details",
    { id: worldId },
    {
      enabled: !!worldId && worldId.startsWith("wrld_"),
      staleTime: 10 * 60_000,
      retry: false,
    },
  );
  const worldName = worldData?.details?.name ?? worldId;

  async function copyText(text: string, okKey: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t(okKey, { defaultValue: "Copied." }));
    } catch (e) {
      toast.error(
        t("lastInstance.copyFailed", {
          error: e instanceof Error ? e.message : String(e),
          defaultValue: "Copy failed: {{error}}",
        }),
      );
    }
  }

  async function handleRejoin() {
    if (!location) return;
    setBusy("rejoin");
    try {
      await launchVrchatLocation(location, true);
      toast.success(t("lastInstance.rejoinOk", { defaultValue: "Launch requested." }));
    } catch (e) {
      toast.error(
        t("lastInstance.rejoinFailed", {
          error: e instanceof Error ? e.message : String(e),
          defaultValue: "Rejoin failed: {{error}}",
        }),
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleShortcut() {
    if (!location) return;
    setBusy("lnk");
    try {
      const result = await writeInstanceShortcut({
        location,
        worldName: worldName || undefined,
      });
      toast.success(
        t("lastInstance.shortcutSaved", {
          path: result.path,
          defaultValue: "Shortcut saved to {{path}}",
        }),
      );
    } catch (e) {
      toast.error(
        t("lastInstance.shortcutFailed", {
          error: e instanceof Error ? e.message : String(e),
          defaultValue: "Could not save shortcut: {{error}}",
        }),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 animate-fade-in">
      <header className="flex flex-col gap-2">
        <div className="unity-panel-header inline-flex items-center gap-2 border-0 bg-transparent px-0 py-0 normal-case tracking-normal">
          <span className="text-[11px] uppercase tracking-[0.08em]">
            {t("lastInstance.title", { defaultValue: "Last instance" })}
          </span>
        </div>
        <p className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
          {t("lastInstance.subtitle", {
            defaultValue: "Rejoin the newest logged instance after a crash or kick.",
          })}
        </p>
      </header>

      <Card className="unity-panel">
        <CardContent className="flex flex-wrap items-center gap-4 p-3 text-[11px]">
          <label className="flex cursor-pointer select-none items-center gap-2">
            <input
              type="checkbox"
              checked={skipPublic}
              onChange={(e) => setSkipPublic(e.target.checked)}
              className="h-4 w-4 cursor-pointer border border-[hsl(var(--border-strong))]"
            />
            <span>
              {t("lastInstance.skipPublic", { defaultValue: "Skip public instances" })}
            </span>
          </label>
          <label className="flex items-center gap-2">
            <span className="font-mono uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
              {t("lastInstance.maxAge", { defaultValue: "Max age" })}
            </span>
            <select
              value={String(maxAgeMinutes)}
              onChange={(e) => setMaxAgeRaw(e.target.value)}
              className="h-7 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-2 font-mono text-[11px] text-[hsl(var(--foreground))] outline-none focus:border-[hsl(var(--primary)/0.6)]"
            >
              {MAX_AGE_OPTIONS.map((mins) => (
                <option key={mins} value={String(mins)}>
                  {mins === 0
                    ? t("lastInstance.maxAgeOff", { defaultValue: "Off" })
                    : t("lastInstance.maxAgeMinutes", {
                        count: mins,
                        defaultValue: "{{count}} min",
                      })}
                </option>
              ))}
            </select>
          </label>
        </CardContent>
      </Card>

      {isLoading && (
        <p className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
          {t("lastInstance.loading", { defaultValue: "Loading visits…" })}
        </p>
      )}
      {error && (
        <p className="font-mono text-[11px] text-[hsl(var(--destructive,red))]">
          {t("lastInstance.error", {
            detail: error instanceof Error ? error.message : String(error),
            defaultValue: "Failed to load visits: {{detail}}",
          })}
        </p>
      )}
      {!isLoading && !error && visits.length === 0 && (
        <Card className="unity-panel">
          <CardContent className="p-6 text-center">
            <p className="font-mono text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("lastInstance.empty", {
                defaultValue: "No world visits in the local log history yet.",
              })}
            </p>
          </CardContent>
        </Card>
      )}
      {!isLoading && !error && visits.length > 0 && !visit && (
        <Card className="unity-panel">
          <CardContent className="p-6 text-center">
            <p className="font-mono text-[12px] text-[hsl(var(--muted-foreground))]">
              {t("lastInstance.noneEligible", {
                defaultValue: "No eligible instance under the current filters.",
              })}
            </p>
          </CardContent>
        </Card>
      )}

      {visit && location && (
        <Card className="unity-panel">
          <CardContent className="flex flex-col gap-3 p-4 text-[11px]">
            <div className="flex flex-wrap items-center gap-2">
              {visit.world_id ? (
                <WorldPopupBadge worldId={visit.world_id} prefetch />
              ) : (
                <span className="truncate font-mono text-[12px] font-medium">
                  {t("lastInstance.unknownWorld", { defaultValue: "Unknown world" })}
                </span>
              )}
              <Badge variant="outline">{visit.access_type || "—"}</Badge>
              {visit.region && <Badge variant="outline">{visit.region.toUpperCase()}</Badge>}
            </div>

            <dl className="grid gap-1.5 font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
              <div className="flex flex-wrap gap-2">
                <dt className="uppercase tracking-[0.08em]">
                  {t("lastInstance.world", { defaultValue: "World" })}
                </dt>
                <dd className="text-[hsl(var(--foreground))]">{worldName || "—"}</dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="uppercase tracking-[0.08em]">
                  {t("lastInstance.location", { defaultValue: "Location" })}
                </dt>
                <dd className="break-all text-[hsl(var(--foreground))]">{location}</dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="uppercase tracking-[0.08em]">
                  {t("lastInstance.joinedAt", { defaultValue: "Joined" })}
                </dt>
                <dd className="text-[hsl(var(--foreground))]">
                  {formatJoined(visit.joined_at) || "—"}
                  {!visit.left_at && (
                    <>
                      {" · "}
                      {t("lastInstance.stillInWorld", { defaultValue: "still in world" })}
                    </>
                  )}
                </dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="uppercase tracking-[0.08em]">
                  {t("lastInstance.accessType", { defaultValue: "Access" })}
                </dt>
                <dd className="text-[hsl(var(--foreground))]">{visit.access_type || "—"}</dd>
              </div>
            </dl>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button size="sm" onClick={() => void handleRejoin()} disabled={busy !== null}>
                <LogIn className="size-3" />
                {t("lastInstance.rejoin", { defaultValue: "Rejoin" })}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void copyText(
                    vrchatLaunchUrl(location),
                    "lastInstance.copiedVrchat",
                  )
                }
              >
                <Copy className="size-3" />
                {t("lastInstance.copyVrchat", { defaultValue: "Copy vrchat://" })}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void copyText(httpsLaunchUrl(location), "lastInstance.copiedHttps")
                }
              >
                <Link2 className="size-3" />
                {t("lastInstance.copyHttps", { defaultValue: "Copy https" })}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleShortcut()}
                disabled={busy !== null}
              >
                <Save className="size-3" />
                {t("lastInstance.saveShortcut", { defaultValue: "Save .lnk" })}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
