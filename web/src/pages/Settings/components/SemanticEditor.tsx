import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Undo2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type {
  VrcSettingEntry,
  VrcSettingType,
  VrcSettingValueSnapshot,
} from "@/lib/types";
import { getSemantic, type SemanticEditor } from "@/lib/vrcSettingsSemantics";
import { hexBytes } from "../utils";

export interface SettingEntryRowProps {
  entry: VrcSettingEntry;
  value: VrcSettingValueSnapshot;
  dirty: boolean;
  disabled: boolean;
  writing: boolean;
  selected: boolean;
  writeLabel: string;
  writingLabel: string;
  revertLabel: string;
  lockHint: string;
  typeLabels: Record<VrcSettingType, string>;
  onEdit: (patch: Partial<VrcSettingValueSnapshot>) => void;
  onSelect: () => void;
  onApply: () => void;
  onRevert: () => void;
}

export function SettingEntryRow({
  entry,
  value,
  dirty,
  disabled,
  writing,
  selected,
  writeLabel,
  writingLabel,
  revertLabel,
  lockHint,
  typeLabels,
  onEdit,
  onSelect,
  onApply,
  onRevert,
}: SettingEntryRowProps) {
  const { t } = useTranslation();
  const localizedDescription = t(
    `settings.vrc.keys.${entry.key}.description`,
    { defaultValue: entry.description ?? "" },
  );

  return (
    <div
      onClick={onSelect}
      className={
        "grid cursor-pointer grid-cols-[1fr_minmax(160px,auto)_auto] items-center gap-3 px-3 py-2 transition-colors hover:bg-[hsl(var(--surface-raised))]" +
        (selected ? " bg-[hsl(var(--surface-raised))]" : "")
      }
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={
              "truncate font-mono text-[12px] " +
              (dirty
                ? "text-[hsl(var(--primary))]"
                : "text-[hsl(var(--foreground))]")
            }
          >
            {entry.key}
          </span>
          <Badge variant="outline" className="font-mono">
            {typeLabels[entry.type]}
          </Badge>
          {entry.type === "raw" ? (
            <Badge variant="muted" className="font-mono text-[10px]">
              {entry.raw?.length ?? 0}B
            </Badge>
          ) : null}
        </div>
        {localizedDescription ? (
          <div className="mt-0.5 truncate text-[11px] text-[hsl(var(--muted-foreground))]">
            {localizedDescription}
          </div>
        ) : null}
      </div>

      <div
        className="flex justify-end"
        onClick={(event) => event.stopPropagation()}
      >
        <EntryEditor
          entry={entry}
          value={value}
          disabled={disabled || writing}
          onEdit={onEdit}
        />
      </div>

      <div
        className="flex items-center gap-1.5"
        onClick={(event) => event.stopPropagation()}
      >
        {dirty ? (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={onRevert}
              disabled={writing}
              title={revertLabel}
            >
              <Undo2 />
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={onApply}
              disabled={disabled || writing}
              title={disabled ? lockHint : writeLabel}
            >
              {writing ? writingLabel : writeLabel}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

interface EntryEditorProps {
  entry: VrcSettingEntry;
  value: VrcSettingValueSnapshot;
  disabled: boolean;
  onEdit: (patch: Partial<VrcSettingValueSnapshot>) => void;
}

export function renderSemanticEditor(
  editor: SemanticEditor,
  entryType: VrcSettingType,
  value: VrcSettingValueSnapshot,
  disabled: boolean,
  onEdit: (patch: Partial<VrcSettingValueSnapshot>) => void,
): ReactElement | null {
  const baseCls =
    "h-7 font-mono text-[12px]" + (disabled ? " opacity-60" : "");

  if (editor.kind === "slider-float") {
    if (entryType !== "float") return null;
    const current = value.floatValue ?? editor.min;
    return (
      <div className="flex items-center gap-2">
        <input
          type="range"
          disabled={disabled}
          min={editor.min}
          max={editor.max}
          step={editor.step}
          value={current}
          onChange={(e) =>
            onEdit({
              type: "float",
              floatValue: Number.parseFloat(e.target.value),
            })
          }
          className="h-2 w-[160px] cursor-pointer accent-[hsl(var(--primary))]"
        />
        <span className="w-[70px] text-right font-mono text-[11px] text-[hsl(var(--foreground))]">
          {current.toFixed(editor.step < 0.1 ? 2 : 1)}
          {editor.unit ? ` ${editor.unit}` : ""}
        </span>
      </div>
    );
  }

  if (editor.kind === "slider-int") {
    if (entryType !== "int") return null;
    const current = value.intValue ?? editor.min;
    return (
      <div className="flex items-center gap-2">
        <input
          type="range"
          disabled={disabled}
          min={editor.min}
          max={editor.max}
          step={editor.step ?? 1}
          value={current}
          onChange={(e) =>
            onEdit({
              type: "int",
              intValue: Number.parseInt(e.target.value, 10),
            })
          }
          className="h-2 w-[160px] cursor-pointer accent-[hsl(var(--primary))]"
        />
        <span className="w-[70px] text-right font-mono text-[11px] text-[hsl(var(--foreground))]">
          {current}
          {editor.unit ? ` ${editor.unit}` : ""}
        </span>
      </div>
    );
  }

  if (editor.kind === "dropdown-int") {
    if (entryType !== "int") return null;
    const current = value.intValue ?? editor.options[0]?.value ?? 0;
    return (
      <select
        disabled={disabled}
        value={current}
        onChange={(e) =>
          onEdit({
            type: "int",
            intValue: Number.parseInt(e.target.value, 10),
          })
        }
        className={`${baseCls} w-[220px] rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-2 text-[hsl(var(--foreground))]`}
      >
        {editor.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label} ({opt.value})
          </option>
        ))}
      </select>
    );
  }

  if (editor.kind === "dropdown-string") {
    if (entryType !== "string") return null;
    const current = value.stringValue ?? editor.options[0]?.value ?? "";
    return (
      <select
        disabled={disabled}
        value={current}
        onChange={(e) =>
          onEdit({ type: "string", stringValue: e.target.value })
        }
        className={`${baseCls} w-[220px] rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-2 text-[hsl(var(--foreground))]`}
      >
        {editor.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  return null;
}

export function EntryEditor({ entry, value, disabled, onEdit }: EntryEditorProps) {
  const semantic = getSemantic(entry.key);
  if (semantic) {
    const widget = renderSemanticEditor(
      semantic.editor,
      entry.type,
      value,
      disabled,
      onEdit,
    );
    if (widget) return widget;
  }

  if (entry.type === "bool") {
    const on = value.boolValue ?? false;
    return (
      <div className="inline-flex items-center overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border-strong))]">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onEdit({ type: "bool", boolValue: false })}
          className={
            "px-3 py-1 text-[11px] font-medium transition-colors " +
            (!on
              ? "bg-[hsl(var(--surface-bright))] text-[hsl(var(--foreground))]"
              : "bg-[hsl(var(--canvas))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))]") +
            (disabled ? " opacity-50" : "")
          }
        >
          OFF
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onEdit({ type: "bool", boolValue: true })}
          className={
            "border-l border-[hsl(var(--border-strong))] px-3 py-1 text-[11px] font-medium transition-colors " +
            (on
              ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
              : "bg-[hsl(var(--canvas))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))]") +
            (disabled ? " opacity-50" : "")
          }
        >
          ON
        </button>
      </div>
    );
  }

  if (entry.type === "int") {
    return (
      <Input
        type="number"
        inputMode="numeric"
        step={1}
        disabled={disabled}
        className="h-7 w-[140px] font-mono text-[12px]"
        value={String(value.intValue ?? 0)}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "" || raw === "-") {
            onEdit({ type: "int", intValue: 0 });
            return;
          }
          const parsed = Number.parseInt(raw, 10);
          if (Number.isFinite(parsed)) {
            onEdit({ type: "int", intValue: parsed });
          }
        }}
      />
    );
  }

  if (entry.type === "float") {
    return (
      <Input
        type="number"
        inputMode="decimal"
        step="any"
        disabled={disabled}
        className="h-7 w-[140px] font-mono text-[12px]"
        value={String(value.floatValue ?? 0)}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "" || raw === "-" || raw === ".") {
            onEdit({ type: "float", floatValue: 0 });
            return;
          }
          const parsed = Number.parseFloat(raw);
          if (Number.isFinite(parsed)) {
            onEdit({ type: "float", floatValue: parsed });
          }
        }}
      />
    );
  }

  if (entry.type === "string") {
    return (
      <Input
        type="text"
        disabled={disabled}
        className="h-7 w-[220px] font-mono text-[12px]"
        value={value.stringValue ?? ""}
        onChange={(e) => onEdit({ type: "string", stringValue: e.target.value })}
      />
    );
  }

  // raw — display only
  return (
    <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-2 py-1 font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
      {hexBytes(entry.raw).slice(0, 48)}
      {(entry.raw?.length ?? 0) > 16 ? " …" : ""}
    </div>
  );
}
