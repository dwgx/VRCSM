import { useTranslation } from "react-i18next";
import { Cpu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { HardwareSnapshot, RamModuleInfo, SensorReading } from "@/lib/osc-studio";

interface HardwarePanelProps {
  hardware: HardwareSnapshot | null;
  loading: boolean;
}

/**
 * Read-only view of the hardware telemetry snapshot that feeds {variable}
 * tokens. Lets users confirm which values are live before wiring them into a
 * chatbox template.
 */
export function HardwarePanel({ hardware, loading }: HardwarePanelProps) {
  const { t } = useTranslation();
  const telemetry = hardware?.telemetry;
  const primaryAdapter = telemetry?.gpu_adapters?.find((a) => a.primary_candidate) ?? telemetry?.gpu_adapters?.[0] ?? null;
  const liveSensors = [
    ...(telemetry?.fans ?? []),
    ...(telemetry?.power ?? []),
    ...(telemetry?.sensors ?? []).filter((s) => /temperature/i.test(s.sensor_type)),
  ].slice(0, 6);
  const sensorHint = t("osc.hw.sensorNeeded", { defaultValue: "Needs sensor provider" });

  return (
    <Card elevation="flat" className="overflow-hidden p-0">
      <div className="unity-panel-header flex items-center gap-2">
        <Cpu className="size-3.5" />
        {t("osc.hw.title", { defaultValue: "Hardware values" })}
        {loading ? <Badge variant="warning" className="ml-auto h-4 px-1.5 text-[9px]">{t("osc.hw.loading", { defaultValue: "loading" })}</Badge> : null}
      </div>
      <div className="grid gap-3 p-3 text-[11px]">
        <div className="grid gap-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            {t("osc.hw.identity", { defaultValue: "Identity" })}
          </div>
          <Fact label="CPU" value={hardware?.cpuName} />
          <Fact label="GPU" value={hardware?.gpuName} />
          <Fact label="RAM" value={hardware?.ramBytes ? `${(hardware.ramBytes / 1024 ** 3).toFixed(0)}GB` : null} />
          <Fact label="HMD" value={hardware?.hmdModel || hardware?.hmdManufacturer} />
          <Fact label="Board" value={[telemetry?.motherboard?.manufacturer, telemetry?.motherboard?.product].filter(Boolean).join(" ")} />
          <Fact label="RAM #0" value={formatRamModule(telemetry?.ram_modules?.[0])} />
          <Fact label="Primary GPU" value={primaryAdapter ? [primaryAdapter.vendor, primaryAdapter.name].filter(Boolean).join(" ") : null} />
        </div>
        <div className="grid gap-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            {t("osc.hw.live", { defaultValue: "Live sensors" })}
          </div>
          <Fact label="CPU Temp" value={formatCelsius(telemetry?.cpu?.temperature_c) ?? sensorHint} muted={!telemetry?.cpu?.temperature_c} />
          <Fact label="GPU Temp" value={formatCelsius(telemetry?.gpu?.temperature_c) ?? sensorHint} muted={!telemetry?.gpu?.temperature_c} />
          <Fact label="GPU Power" value={formatWatts(telemetry?.gpu?.power_watts) ?? sensorHint} muted={!telemetry?.gpu?.power_watts} />
          <Fact label="CPU Load" value={formatPct(telemetry?.cpu?.load_pct) ?? sensorHint} muted={typeof telemetry?.cpu?.load_pct !== "number"} />
          {liveSensors.length ? (
            <div className="mt-1 grid gap-1 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-1.5">
              {liveSensors.map((sensor, i) => (
                <div key={`${sensor.source}-${sensor.id}-${i}`} className="grid grid-cols-[1fr_auto] gap-2 font-mono text-[10px]">
                  <span className="truncate text-[hsl(var(--muted-foreground))]" title={`${sensor.source} ${sensor.id}`}>{sensor.name || sensor.id}</span>
                  <span>{formatSensor(sensor)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1">
          {(telemetry?.sources ?? []).map((source) => (
            <Badge key={source.name} variant={source.available ? "success" : "muted"} className="text-[9px]" title={source.message}>
              {source.name}
            </Badge>
          ))}
        </div>
      </div>
    </Card>
  );
}

function Fact({ label, value, muted = false }: { label: string; value?: string | null; muted?: boolean }) {
  return (
    <div className="grid grid-cols-[84px_1fr] gap-2">
      <span className="text-[hsl(var(--muted-foreground))]">{label}</span>
      <span className={`min-w-0 truncate ${muted ? "text-[hsl(var(--muted-foreground))]" : ""}`}>{value || "--"}</span>
    </div>
  );
}

function formatCelsius(value?: number | null): string | null {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}C` : null;
}
function formatWatts(value?: number | null): string | null {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(value >= 100 ? 0 : 1)}W` : null;
}
function formatPct(value?: number | null): string | null {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}%` : null;
}
function formatRamModule(module?: RamModuleInfo | null): string | null {
  if (!module) return null;
  const parts = [
    module.manufacturer,
    module.part_number,
    module.configured_clock_mhz || module.speed_mhz ? `${module.configured_clock_mhz || module.speed_mhz}MHz` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}
function formatSensor(sensor: SensorReading): string {
  if (typeof sensor.value !== "number" || !Number.isFinite(sensor.value)) return "--";
  const rounded = Math.abs(sensor.value) >= 100 ? sensor.value.toFixed(0) : sensor.value.toFixed(1);
  return `${rounded}${sensor.unit}`;
}
