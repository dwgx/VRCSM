import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Zap, Plus, Trash2, Play, Pause, History, ChevronRight } from "lucide-react";

interface Rule {
  id: number;
  name: string;
  description: string;
  enabled: boolean;
  dsl_yaml: string;
  created_at: string;
  updated_at: string;
  last_fired_at: string | null;
  fire_count: number;
  cooldown_seconds: number;
}

interface RuleFiring {
  id: number;
  rule_id: number;
  fired_at: string;
  trigger_payload: string;
  result_code: number;
  result_body: string;
}

export default function Rules() {
  const { t } = useTranslation();
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [firings, setFirings] = useState<RuleFiring[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newYaml, setNewYaml] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ipc.rulesList();
      setRules((res?.rules ?? []) as unknown as Rule[]);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!selectedId) return;
    ipc.rulesHistory(selectedId).then((r) => setFirings((r?.firings ?? []) as unknown as RuleFiring[])).catch(() => {});
  }, [selectedId]);

  const selected = rules.find((r) => r.id === selectedId) ?? null;

  async function handleCreate() {
    if (!newName.trim() || !newYaml.trim()) return;
    try {
      await ipc.rulesCreate(newName.trim(), newYaml.trim());
      toast.success("Rule created");
      setNewName("");
      setNewYaml("");
      setShowCreate(false);
      void refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleToggle(rule: Rule) {
    try {
      await ipc.rulesSetEnabled(rule.id, !rule.enabled);
      void refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDelete(id: number) {
    try {
      await ipc.rulesDelete(id);
      toast.success("Rule deleted");
      if (selectedId === id) setSelectedId(null);
      void refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in max-w-5xl mx-auto w-full">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Zap className="size-4" />
          <span className="text-[11px] uppercase tracking-[0.08em] font-semibold">
            {t("rules.title", { defaultValue: "Automation Rules" })}
          </span>
          <Badge variant="secondary">{rules.length}</Badge>
        </div>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
          <Plus className="size-3" />
          {t("rules.create", { defaultValue: "New Rule" })}
        </Button>
      </header>

      {showCreate && (
        <Card className="unity-panel">
          <CardContent className="p-3 flex flex-col gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("rules.namePlaceholder", { defaultValue: "Rule name..." })}
              className="h-7 text-[12px]"
            />
            <textarea
              value={newYaml}
              onChange={(e) => setNewYaml(e.target.value)}
              placeholder={t("rules.yamlPlaceholder", { defaultValue: "trigger: friend.online\ncondition: user.displayName contains 'Natsumi'\naction:\n  type: vrcsm.notification.show\n  title: Friend online!\n  message: '{{user.displayName}} is online'" })}
              className="min-h-[120px] rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-2 text-[11px] font-mono resize-y"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void handleCreate()} disabled={!newName.trim() || !newYaml.trim()}>
                {t("rules.save", { defaultValue: "Save Rule" })}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>
                {t("common.cancel", { defaultValue: "Cancel" })}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          {rules.length === 0 && !loading && (
            <Card className="unity-panel">
              <CardContent className="p-6 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
                {t("rules.empty", { defaultValue: "No rules yet. Create one to automate VRChat actions." })}
              </CardContent>
            </Card>
          )}
          {rules.map((rule) => (
            <button
              key={rule.id}
              onClick={() => setSelectedId(rule.id)}
              className={`unity-panel flex items-center gap-3 rounded-[var(--radius-md)] border p-3 text-left transition-colors ${
                selectedId === rule.id
                  ? "border-[hsl(var(--primary)/0.55)] bg-[hsl(var(--primary)/0.08)]"
                  : "border-[hsl(var(--border))] hover:bg-[hsl(var(--surface-raised))]"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium truncate">{rule.name}</span>
                  <Badge variant={rule.enabled ? "default" : "outline"} className="text-[9px]">
                    {rule.enabled ? "ON" : "OFF"}
                  </Badge>
                </div>
                <div className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono mt-0.5">
                  Fired {rule.fire_count}x
                  {rule.last_fired_at ? ` · last ${new Date(rule.last_fired_at).toLocaleTimeString()}` : ""}
                </div>
              </div>
              <ChevronRight className="size-3 text-[hsl(var(--muted-foreground))]" />
            </button>
          ))}
        </div>

        {selected && (
          <Card className="unity-panel">
            <CardHeader className="pb-2">
              <CardTitle className="text-[13px] flex items-center justify-between">
                {selected.name}
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => void handleToggle(selected)}>
                    {selected.enabled ? <Pause className="size-3" /> : <Play className="size-3" />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void handleDelete(selected.id)}>
                    <Trash2 className="size-3 text-[hsl(var(--destructive))]" />
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <pre className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-2 text-[10px] font-mono overflow-x-auto max-h-[200px]">
                {selected.dsl_yaml}
              </pre>

              <div className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono">
                Cooldown: {selected.cooldown_seconds}s · Created: {new Date(selected.created_at).toLocaleDateString()}
              </div>

              {firings.length > 0 && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1 text-[11px] font-semibold">
                    <History className="size-3" />
                    {t("rules.history", { defaultValue: "Firing History" })}
                  </div>
                  {firings.slice(0, 10).map((f) => (
                    <div key={f.id} className="flex justify-between text-[10px] font-mono border-b border-[hsl(var(--border)/0.3)] py-0.5">
                      <span>{new Date(f.fired_at).toLocaleString()}</span>
                      <Badge variant={f.result_code === 0 ? "default" : "destructive"} className="text-[8px]">
                        {f.result_code === 0 ? "OK" : `ERR ${f.result_code}`}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
