import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ipc } from "@/lib/ipc";
import { useGreyPrefs } from "@/lib/grey-prefs";
import { emptyWatchDraft, validateWatchDraft, type EventWatchDraft } from "@/lib/event-watch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface WatchRow {
  id: string;
  enabled: boolean;
  label: string;
  worldId: string;
  groupId: string;
  region: string;
  access: string;
  minUsers: number;
  maxUsers: number;
  nameContains: string;
  notify: boolean;
  autoJoin: boolean;
}

export default function EventWatch() {
  const { t } = useTranslation();
  const { prefs, patch } = useGreyPrefs();
  const greyOn = prefs?.greyEnabled === true;
  const [watches, setWatches] = useState<WatchRow[]>([]);
  const [draft, setDraft] = useState<EventWatchDraft>(emptyWatchDraft());
  const [error, setError] = useState<string | null>(null);
  const [autoJoinConfirm, setAutoJoinConfirm] = useState(false);

  async function refresh() {
    const res = await ipc.call<Record<string, never>, { watches: WatchRow[] }>("eventWatch.list", {});
    setWatches(res.watches ?? []);
  }

  useEffect(() => {
    void refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function save() {
    setError(null);
    const invalid = validateWatchDraft(draft);
    if (invalid) {
      setError(invalid);
      return;
    }
    try {
      if (draft.autoJoin && prefs && prefs.eventWatch["autoJoinConfirmed"] !== true) {
        setAutoJoinConfirm(true);
        return;
      }
      await ipc.call("eventWatch.upsert", { watch: { ...draft, enabled: draft.enabled ?? false } });
      setDraft(emptyWatchDraft());
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <header>
        <h1 className="text-[22px] font-semibold">
          {t("eventWatch.title", { defaultValue: "Event Watch" })}
        </h1>
        <p className="mt-2 text-[12px] text-[hsl(var(--muted-foreground))] leading-relaxed">
          {t("grey.tos.eventWatch", {
            defaultValue:
              "Event Watch notifies you when a group or world instance matches a filter you set. Auto-join is a separate toggle and is OFF by default. When auto-join is on, VRCSM still notifies first and waits 15 seconds so you can cancel. Joining instances automatically can violate VRChat’s Terms of Service if used to snipe or harass. Prefer notify-only.",
          })}
        </p>
        <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
          {t("eventWatch.worldOnlyHint", {
            defaultValue:
              "World-only watches use friend locations; group watches use the group instance list.",
          })}
        </p>
      </header>

      {!greyOn ? (
        <p className="text-[12px]">{t("grey.disabled", { defaultValue: "Optional helpers are off." })}</p>
      ) : (
        <>
          <div className="unity-panel p-3 flex flex-col gap-2">
            <Input
              placeholder="label"
              value={draft.label ?? ""}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
            <Input
              placeholder="wrld_…"
              value={draft.worldId ?? ""}
              onChange={(e) => setDraft({ ...draft, worldId: e.target.value })}
            />
            <Input
              placeholder="grp_…"
              value={draft.groupId ?? ""}
              onChange={(e) => setDraft({ ...draft, groupId: e.target.value })}
            />
            <label className="flex items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                checked={draft.notify !== false}
                onChange={(e) => setDraft({ ...draft, notify: e.target.checked, autoJoin: e.target.checked ? draft.autoJoin : false })}
              />
              {t("eventWatch.notify", { defaultValue: "Notify" })}
            </label>
            <label className="flex items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                checked={!!draft.autoJoin}
                onChange={(e) => setDraft({ ...draft, autoJoin: e.target.checked, notify: e.target.checked ? true : draft.notify })}
              />
              {t("eventWatch.autoJoin", { defaultValue: "Auto-join (wait 15s)" })}
            </label>
            <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
              {t("eventWatch.autoJoinConfirm", {
                defaultValue: "Wait 15 seconds after the notification, then join. You can cancel.",
              })}
            </p>
            <Button size="sm" onClick={() => void save()}>
              {t("common.save", { defaultValue: "Save" })}
            </Button>
          </div>
          {autoJoinConfirm ? (
            <div className="unity-panel p-3 flex flex-col gap-2">
              <p className="text-[12px]">
                {t("eventWatch.autoJoinConfirm", {
                  defaultValue: "Wait 15 seconds after the notification, then join. You can cancel.",
                })}
              </p>
              <Button
                size="sm"
                onClick={() => {
                  void patch({ eventWatch: { autoJoinConfirmed: true } }).then(() => {
                    setAutoJoinConfirm(false);
                    void save();
                  });
                }}
              >
                {t("eventWatch.autoJoin", { defaultValue: "Confirm auto-join" })}
              </Button>
            </div>
          ) : null}
          <ul className="flex flex-col gap-2">
            {watches.map((w) => (
              <li key={w.id} className="unity-panel p-2 flex items-center justify-between text-[12px]">
                <span>
                  {w.label || w.worldId || w.groupId} {w.notify ? "notify" : ""} {w.autoJoin ? "auto-join" : ""}
                </span>
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void ipc.call("eventWatch.cancelJoin", {})}
                  >
                    {t("eventWatch.cancelJoin", { defaultValue: "Cancel join" })}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void ipc.call("eventWatch.remove", { id: w.id }).then(refresh)}
                  >
                    {t("common.remove", { defaultValue: "Remove" })}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {error ? <p className="text-[11px] text-[hsl(var(--destructive))]">{error}</p> : null}
    </div>
  );
}
