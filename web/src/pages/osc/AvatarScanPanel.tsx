import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, RefreshCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ipc } from "@/lib/ipc";
import { createAvatarParameterCard, type OscStudioCard, type OscValueType } from "@/lib/osc-studio";
import type { LocalAvatarItem } from "@/lib/types";
import { safeValueType, type AvatarParametersResponse } from "./shared";

const VALUE_TYPES: OscValueType[] = ["bool", "float", "int", "string"];

interface AvatarScanPanelProps {
  localAvatars: LocalAvatarItem[];
  onAddCard: (card: OscStudioCard) => void;
}

/**
 * Scans a local avatar's OSC config and turns its parameters into value cards.
 * Also allows adding a parameter card by name for avatars not scanned yet.
 */
export function AvatarScanPanel({ localAvatars, onAddCard }: AvatarScanPanelProps) {
  const { t } = useTranslation();
  const [avatarId, setAvatarId] = useState("");
  const [manualName, setManualName] = useState("MuteSelf");
  const [manualType, setManualType] = useState<OscValueType>("bool");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AvatarParametersResponse | null>(null);

  useEffect(() => {
    if (!avatarId && localAvatars[0]) setAvatarId(localAvatars[0].avatar_id);
  }, [avatarId, localAvatars]);

  async function load(target?: LocalAvatarItem) {
    const id = target?.avatar_id ?? avatarId.trim();
    if (!id) {
      toast.error(t("osc.avatar.missing", { defaultValue: "Enter or pick an avatar id" }));
      return;
    }
    setLoading(true);
    try {
      const res = await ipc.call<
        { avatarId: string; userId?: string; limit: number },
        AvatarParametersResponse
      >("avatar.parameters.local", { avatarId: id, userId: target?.user_id, limit: 256 });
      setResult(res);
      setAvatarId(res.avatar_id);
      toast.success(t("osc.avatar.loaded", { defaultValue: "Loaded {{count}} parameters", count: res.parameters.length }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card elevation="flat" className="overflow-hidden p-0">
      <div className="unity-panel-header flex items-center justify-between gap-2">
        <span>{t("osc.avatar.title", { defaultValue: "Avatar parameters" })}</span>
        <Badge variant="muted" className="h-4 px-1.5 text-[9px]">{localAvatars.length}</Badge>
      </div>
      <div className="grid gap-3 p-3">
        <p className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-2 py-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">
          {t("osc.avatar.hint", { defaultValue: "Reads a local avatar's OSC config and adds its parameters as value messages." })}
        </p>

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Input value={avatarId} onChange={(e) => setAvatarId(e.target.value)} placeholder="avtr_..." className="h-8 font-mono text-[12px]" />
          <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={loading} onClick={() => void load()}>
            <RefreshCcw className={loading ? "size-3 animate-spin" : "size-3"} />
            {t("osc.avatar.load", { defaultValue: "Load" })}
          </Button>
        </div>

        <div className="grid grid-cols-[1fr_92px_auto] gap-2">
          <Input value={manualName} onChange={(e) => setManualName(e.target.value)} className="h-8 font-mono text-[12px]" aria-label={t("osc.avatar.paramName", { defaultValue: "Parameter name" })} />
          <select
            value={manualType}
            onChange={(e) => setManualType(e.target.value as OscValueType)}
            className="h-8 rounded-[var(--radius-sm)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface-bright))] px-2 text-[12px]"
            aria-label={t("osc.avatar.paramType", { defaultValue: "Parameter type" })}
          >
            {VALUE_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <Button size="sm" className="h-8 gap-1.5" onClick={() => onAddCard(createAvatarParameterCard(manualName, manualType))}>
            <Plus className="size-3" />
            {t("common.add", { defaultValue: "Add" })}
          </Button>
        </div>

        {localAvatars.length ? (
          <ScrollArea className="h-[92px] rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
            <div className="grid gap-1 p-2">
              {localAvatars.slice(0, 20).map((avatar) => (
                <button
                  key={`${avatar.user_id}-${avatar.avatar_id}`}
                  type="button"
                  className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-left text-[11px] hover:bg-[hsl(var(--surface-raised))]"
                  onClick={() => void load(avatar)}
                >
                  <span className="truncate font-mono">{avatar.avatar_id}</span>
                  <span className="text-[hsl(var(--muted-foreground))]">{avatar.parameter_count}p</span>
                </button>
              ))}
            </div>
          </ScrollArea>
        ) : null}

        {result ? (
          <ScrollArea className="h-[132px] rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
            <div className="grid gap-1 p-2">
              {result.parameters.length === 0 ? (
                <div className="p-3 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
                  {t("osc.avatar.noParams", { defaultValue: "No parameters in this avatar file." })}
                </div>
              ) : result.parameters.map((param) => (
                <button
                  key={`${result.avatar_id}-${param.name}`}
                  type="button"
                  className="grid grid-cols-[1fr_58px_auto] items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-left text-[11px] hover:bg-[hsl(var(--surface-raised))]"
                  onClick={() => onAddCard(createAvatarParameterCard(param.name, safeValueType(param.value_type)))}
                >
                  <span className="truncate font-mono">{param.name}</span>
                  <Badge variant="muted" className="justify-center text-[9px]">{param.value_type}</Badge>
                  <Plus className="size-3 text-[hsl(var(--muted-foreground))]" />
                </button>
              ))}
            </div>
          </ScrollArea>
        ) : null}
      </div>
    </Card>
  );
}
