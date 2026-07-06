import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Braces, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  OSC_VARIABLE_GROUPS,
  renderOscTemplate,
  type HardwareSnapshot,
} from "@/lib/osc-studio";
import type { TemplateExtras } from "./shared";

interface VariablePickerProps {
  hardware: HardwareSnapshot | null;
  now: Date;
  musicExtras?: TemplateExtras;
  onInsert: (token: string) => void;
  disabled?: boolean;
}

/**
 * Single "insert variable" control that replaces the old drag-only component
 * library. Click a token to insert it at the caret; a live sample value is
 * shown next to each so users know what the token resolves to right now.
 */
export function VariablePicker({ hardware, now, musicExtras = {}, onInsert, disabled }: VariablePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return OSC_VARIABLE_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      tokens: group.tokens.filter((token) => !needle || token.toLowerCase().includes(needle)),
    })).filter((group) => group.tokens.length > 0);
  }, [search]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={disabled}>
          <Braces className="size-3.5" />
          {t("osc.editor.insertVariable", { defaultValue: "Insert variable" })}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[320px] p-0">
        <div className="border-b border-[hsl(var(--border))] p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("osc.editor.searchVariable", { defaultValue: "Search CPU, GPU, time..." })}
              className="h-8 pl-7 text-[12px]"
              autoFocus
            />
          </div>
        </div>
        <ScrollArea className="h-[300px]">
          <div className="p-1">
            {groups.map((group) => (
              <div key={group.id} className="mb-1">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  {group.label}
                </div>
                {group.tokens.map((token) => {
                  const sample = renderOscTemplate(token, { hardware, now, ...musicExtras });
                  return (
                    <button
                      key={token}
                      type="button"
                      onClick={() => {
                        onInsert(token);
                        setOpen(false);
                      }}
                      className="grid w-full grid-cols-[1fr_auto] items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-left transition-colors hover:bg-[hsl(var(--accent))]"
                    >
                      <span className="truncate font-mono text-[11px] text-[hsl(var(--primary))]">{token}</span>
                      <span className="truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]" title={sample}>
                        {sample || "--"}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
            {groups.length === 0 ? (
              <div className="p-3 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
                {t("osc.editor.noVariables", { defaultValue: "No variables match." })}
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
