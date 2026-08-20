import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Save, Trash2, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { ipc } from "@/lib/ipc";
import { sendOscMessage } from "@/lib/osc-api";
import { useUiPrefString } from "@/lib/ui-prefs";
import type { LocalAvatarItem } from "@/lib/types";
import {
  AVATAR_PRESETS_STORAGE_KEY,
  applyAvatarPreset,
  createPreset,
  deletePreset,
  isAvatarMismatch,
  listPresetsForAvatar,
  looksLikeAvatarId,
  mergeLiveOscParams,
  paramsFromLocalParameters,
  parseAvatarPresetStore,
  serializeAvatarPresetStore,
  upsertPreset,
  type AvatarPreset,
  type AvatarPresetValue,
  type OscParamMessage,
} from "@/lib/avatar-presets";
import type { AvatarParametersResponse } from "./shared";

interface AvatarPresetsPanelProps {
  avatarId?: string;
  userId?: string;
  localAvatars?: LocalAvatarItem[];
  incoming?: readonly OscParamMessage[];
}

export function AvatarPresetsPanel({
  avatarId: avatarIdProp,
  userId,
  localAvatars = [],
  incoming = [],
}: AvatarPresetsPanelProps) {
  const { t } = useTranslation();
  const [raw, setRaw] = useUiPrefString(AVATAR_PRESETS_STORAGE_KEY, "");
  const [name, setName] = useState("");
  const [avatarId, setAvatarId] = useState(avatarIdProp ?? "");
  const [saving, setSaving] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<AvatarPreset | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AvatarPreset | null>(null);

  useEffect(() => {
    if (avatarIdProp) setAvatarId(avatarIdProp);
    else if (!avatarId && localAvatars[0]) setAvatarId(localAvatars[0].avatar_id);
  }, [avatarId, avatarIdProp, localAvatars]);

  const presets = useMemo(() => parseAvatarPresetStore(raw), [raw]);
  const currentId = avatarId.trim();
  const mine = useMemo(() => listPresetsForAvatar(presets, currentId), [presets, currentId]);
  const others = useMemo(
    () => presets.filter((p) => p.avatarId !== currentId),
    [presets, currentId],
  );

  function commit(next: AvatarPreset[]) {
    setRaw(serializeAvatarPresetStore(next));
  }

  async function loadParams(): Promise<Record<string, AvatarPresetValue>> {
    const id = currentId;
    let local: ReturnType<typeof paramsFromLocalParameters> = {};
    if (looksLikeAvatarId(id)) {
      const res = await ipc.call<
        { avatarId: string; userId?: string; limit: number },
        AvatarParametersResponse
      >("avatar.parameters.local", {
        avatarId: id,
        userId: userId || undefined,
        limit: 256,
      });
      local = paramsFromLocalParameters(res.parameters ?? []);
    }
    return mergeLiveOscParams(local, incoming);
  }

  async function saveCurrent() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t("avatars.presets.needName", { defaultValue: "Name this preset first" }));
      return;
    }
    if (!looksLikeAvatarId(currentId)) {
      toast.error(t("osc.avatar.missing", { defaultValue: "Enter or pick an avatar id" }));
      return;
    }
    setSaving(true);
    try {
      const params = await loadParams();
      const made = createPreset({ name: trimmed, avatarId: currentId, params });
      if (!made) {
        toast.error(t("avatars.presets.noParams", { defaultValue: "No parameters to snapshot" }));
        return;
      }
      commit(upsertPreset(presets, made));
      setName("");
      toast.success(
        t("avatars.presets.saved", {
          defaultValue: "Saved {{name}} ({{count}} params)",
          name: made.name,
          count: Object.keys(made.params).length,
        }),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function applyNow(target: AvatarPreset) {
    setApplyingId(target.id);
    try {
      const result = await applyAvatarPreset(target, (address, args) =>
        sendOscMessage(address, args),
      );
      if (result.failed > 0 && result.sent === 0) {
        toast.error(t("osc.sendFailed", { defaultValue: "OSC send failed" }));
        return;
      }
      toast.success(
        t("avatars.presets.applied", {
          defaultValue: "Applied {{name}} ({{count}} params)",
          name: target.name,
          count: result.sent,
        }),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setApplyingId(null);
      setMismatch(null);
    }
  }

  function requestApply(target: AvatarPreset) {
    if (isAvatarMismatch(target, currentId)) {
      setMismatch(target);
      return;
    }
    void applyNow(target);
  }

  function PresetRow({ item, foreign }: { item: AvatarPreset; foreign?: boolean }) {
    const count = Object.keys(item.params).length;
    return (
      <div className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-[11px] hover:bg-[hsl(var(--surface-raised))]">
        <div className="min-w-0">
          <div className="truncate font-medium">{item.name}</div>
          <div className="truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
            {count}p
            {foreign ? ` · ${item.avatarId}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2"
            disabled={applyingId !== null}
            onClick={() => requestApply(item)}
          >
            <Play className="size-3" />
            {t("avatars.presets.apply", { defaultValue: "Apply" })}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title={t("common.delete", { defaultValue: "Delete" })}
            onClick={() => setPendingDelete(item)}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Card elevation="flat" className="overflow-hidden p-0">
      <div className="unity-panel-header flex items-center justify-between gap-2">
        <span>{t("avatars.presets.title", { defaultValue: "Param presets" })}</span>
        <Badge variant="muted" className="h-4 px-1.5 text-[9px]">
          {mine.length}
        </Badge>
      </div>
      <div className="grid gap-3 p-3">
        <p className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-2 py-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">
          {t("avatars.presets.hint", {
            defaultValue:
              "Snapshot LocalAvatarData defaults (and any live OSC /avatar/parameters values) into VRCSM JSON. Apply sends OSC. Applying a preset saved for a different avatar asks first.",
          })}
        </p>

        {!avatarIdProp && localAvatars.length ? (
          <ScrollArea className="h-[72px] rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
            <div className="grid gap-1 p-2">
              {localAvatars.slice(0, 20).map((avatar) => (
                <button
                  key={`${avatar.user_id}-${avatar.avatar_id}`}
                  type="button"
                  className={`grid grid-cols-[1fr_auto] items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-left text-[11px] hover:bg-[hsl(var(--surface-raised))] ${
                    avatar.avatar_id === currentId
                      ? "bg-[hsl(var(--primary)/0.12)]"
                      : ""
                  }`}
                  onClick={() => setAvatarId(avatar.avatar_id)}
                >
                  <span className="truncate font-mono">{avatar.avatar_id}</span>
                  <span className="text-[hsl(var(--muted-foreground))]">{avatar.parameter_count}p</span>
                </button>
              ))}
            </div>
          </ScrollArea>
        ) : null}

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("avatars.presets.namePlaceholder", { defaultValue: "Preset name" })}
            className="h-8 text-[12px]"
            aria-label={t("avatars.presets.namePlaceholder", { defaultValue: "Preset name" })}
          />
          <Button
            size="sm"
            className="h-8 gap-1.5"
            disabled={saving}
            onClick={() => void saveCurrent()}
          >
            <Save className="size-3" />
            {t("avatars.presets.save", { defaultValue: "Save current" })}
          </Button>
        </div>

        {mine.length === 0 && others.length === 0 ? (
          <div className="p-3 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
            {t("avatars.presets.empty", { defaultValue: "No presets yet." })}
          </div>
        ) : (
          <ScrollArea className="h-[148px] rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
            <div className="grid gap-1 p-2">
              {mine.map((item) => (
                <PresetRow key={item.id} item={item} />
              ))}
              {others.length > 0 ? (
                <>
                  <div className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    {t("avatars.presets.otherAvatars", { defaultValue: "Other avatars" })}
                  </div>
                  {others.map((item) => (
                    <PresetRow key={item.id} item={item} foreign />
                  ))}
                </>
              ) : null}
            </div>
          </ScrollArea>
        )}
      </div>

      <AlertDialog open={mismatch !== null} onOpenChange={(open) => !open && setMismatch(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("avatars.presets.mismatchTitle", { defaultValue: "Apply to a different avatar?" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("avatars.presets.mismatchBody", {
                defaultValue:
                  "This preset was saved for {{saved}}, but the current avatar is {{current}}. Parameter names may not match.",
                saved: mismatch?.avatarId ?? "",
                current: currentId || "—",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setMismatch(null)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => mismatch && void applyNow(mismatch)}>
              {t("avatars.presets.apply", { defaultValue: "Apply" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("avatars.presets.deleteTitle", { defaultValue: "Delete this preset?" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.name ?? ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingDelete(null)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingDelete) return;
                commit(deletePreset(presets, pendingDelete.id));
                setPendingDelete(null);
              }}
            >
              {t("common.delete", { defaultValue: "Delete" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
