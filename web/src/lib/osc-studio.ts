export type OscCardKind =
  | "chatbox-template"
  | "hardware-summary"
  | "sensor-temperature"
  | "performance-overlay"
  | "raw-message"
  | "avatar-bool"
  | "avatar-float"
  | "input-button";

export type OscValueType = "int" | "float" | "string" | "bool";

export type OscCardGroup = "chatbox" | "telemetry" | "avatar" | "input" | "raw";

export interface OscStudioCard {
  id: string;
  kind: OscCardKind;
  title: string;
  group: OscCardGroup;
  enabled: boolean;
  address: string;
  valueType: OscValueType;
  value: string;
  template?: string;
  autoIntervalSec?: number;
}

export interface HardwareSnapshot {
  cpuName?: string | null;
  cpuCores?: number | null;
  cpuThreads?: number | null;
  cpuClockMhz?: number | null;
  gpuName?: string | null;
  gpuVramBytes?: number | null;
  gpuDriver?: string | null;
  gpuVendor?: string | null;
  gpuPnpId?: string | null;
  gpuSource?: string | null;
  gpuVirtual?: boolean | null;
  ramBytes?: number | null;
  hmdModel?: string | null;
  hmdManufacturer?: string | null;
  osBuild?: string | null;
  telemetry?: HardwareTelemetrySnapshot | null;
}

export interface TelemetrySourceStatus {
  name: string;
  available: boolean;
  message: string;
}

export interface MotherboardInfo {
  manufacturer?: string | null;
  product?: string | null;
  version?: string | null;
  serial_number?: string | null;
}

export interface RamModuleInfo {
  bank_label?: string | null;
  device_locator?: string | null;
  manufacturer?: string | null;
  part_number?: string | null;
  serial_number?: string | null;
  capacity_bytes?: number | null;
  speed_mhz?: number | null;
  configured_clock_mhz?: number | null;
  memory_type_label?: string | null;
  form_factor_label?: string | null;
}

export interface SensorReading {
  id: string;
  name: string;
  sensor_type: string;
  source: string;
  unit: string;
  value: number | null;
}

export interface GpuAdapterInfo {
  name?: string | null;
  vendor?: string | null;
  pnp_id?: string | null;
  driver_version?: string | null;
  source?: string | null;
  vendor_id?: number | null;
  device_id?: number | null;
  dedicated_video_memory_bytes?: number | null;
  adapter_ram_bytes?: number | null;
  software?: boolean | null;
  virtual?: boolean | null;
  primary_candidate?: boolean | null;
  score?: number | null;
}

export interface HardwareTelemetrySnapshot {
  generated_at: string;
  motherboard?: MotherboardInfo | null;
  memory?: {
    total_bytes?: number | null;
    available_bytes?: number | null;
    used_bytes?: number | null;
    used_pct?: number | null;
  } | null;
  ram_modules?: RamModuleInfo[] | null;
  cpu?: {
    temperature_c?: number | null;
    load_pct?: number | null;
    power_watts?: number | null;
  } | null;
  gpu?: {
    name?: string | null;
    temperature_c?: number | null;
    load_pct?: number | null;
    fan_speed_pct?: number | null;
    power_watts?: number | null;
    memory_used_bytes?: number | null;
    memory_total_bytes?: number | null;
    primary_source?: string | null;
  } | null;
  gpu_adapters?: GpuAdapterInfo[] | null;
  fans?: SensorReading[] | null;
  power?: SensorReading[] | null;
  sensors?: SensorReading[] | null;
  sources?: TelemetrySourceStatus[] | null;
}

export interface OscTemplateContext {
  hardware?: HardwareSnapshot | null;
  now?: Date;
}

export type OscTemplateComponentGroup = "time" | "cpu" | "gpu" | "memory" | "system";

export interface OscTemplateComponentCard {
  id: string;
  group: OscTemplateComponentGroup;
  label: string;
  description: string;
  template: string;
}

const STORAGE_KEY = "vrcsm.oscStudio.cards.v1";
const PROFILE_VERSION = 4;

export const OSC_STUDIO_DEFAULT_CARDS: OscStudioCard[] = [
  {
    id: "clock-status",
    kind: "chatbox-template",
    title: "Clock line",
    group: "chatbox",
    enabled: true,
    address: "/chatbox/input",
    valueType: "string",
    value: "",
    template: "VRChat | {time.short} | {date.iso}",
    autoIntervalSec: 30,
  },
  {
    id: "pc-status-compact",
    kind: "performance-overlay",
    title: "PC status compact",
    group: "telemetry",
    enabled: true,
    address: "/chatbox/input",
    valueType: "string",
    value: "",
    template: "PC {time.short} | CPU {cpu.loadPct} {cpu.tempC} | GPU {gpu.loadPct} {gpu.tempC} | RAM {ram.usedPct}",
    autoIntervalSec: 10,
  },
  {
    id: "hardware-name-line",
    kind: "hardware-summary",
    title: "Hardware names",
    group: "telemetry",
    enabled: true,
    address: "/chatbox/input",
    valueType: "string",
    value: "",
    template: "CPU {cpu.shortName} | GPU {gpu.shortName} | RAM {ram.totalGb}",
    autoIntervalSec: 45,
  },
  {
    id: "thermal-power-line",
    kind: "sensor-temperature",
    title: "Thermal and power",
    group: "telemetry",
    enabled: true,
    address: "/chatbox/input",
    valueType: "string",
    value: "",
    template: "Thermal | CPU {cpu.tempC} {cpu.powerW} | GPU {gpu.tempC} {gpu.powerW} | Fan {gpu.fanPct}",
    autoIntervalSec: 20,
  },
];

export const OSC_VARIABLE_GROUPS = [
  {
    id: "time",
    label: "Time",
    tokens: ["{time}", "{time.short}", "{time.hm}", "{date}", "{date.iso}"],
  },
  {
    id: "cpu",
    label: "CPU",
    tokens: ["{cpu.name}", "{cpu.shortName}", "{cpu.cores}", "{cpu.threads}", "{cpu.clockGhz}", "{cpu.tempC}", "{cpu.loadPct}", "{cpu.powerW}"],
  },
  {
    id: "gpu",
    label: "GPU",
    tokens: ["{gpu.name}", "{gpu.shortName}", "{gpu.vendor}", "{gpu.source}", "{gpu.driver}", "{gpu.tempC}", "{gpu.loadPct}", "{gpu.fanPct}", "{gpu.powerW}", "{gpu.vramGb}", "{gpu.vramUsedGb}", "{gpu.vramTotalGb}"],
  },
  {
    id: "memory",
    label: "Memory",
    tokens: ["{ram.gb}", "{ram.totalGb}", "{ram.usedGb}", "{ram.freeGb}", "{ram.usedPct}", "{ram.module0.model}", "{ram.module0.manufacturer}", "{ram.module0.capacityGb}", "{ram.module0.speedMhz}", "{ram.module0.type}"],
  },
  {
    id: "system",
    label: "System",
    tokens: ["{motherboard.vendor}", "{motherboard.model}", "{motherboard.name}", "{hmd.model}", "{hmd.manufacturer}", "{os.build}", "{sensor.count}", "{fan.count}", "{fan.0}", "{power.0}"],
  },
] as const;

export const OSC_VARIABLES = OSC_VARIABLE_GROUPS.flatMap((group) => group.tokens);

export const OSC_TEMPLATE_CARDS: OscTemplateComponentCard[] = [
  {
    id: "time-now",
    group: "time",
    label: "Clock",
    description: "Current time with seconds",
    template: "{time.short}",
  },
  {
    id: "date-today",
    group: "time",
    label: "Date",
    description: "ISO date",
    template: "{date.iso}",
  },
  {
    id: "cpu-load-temp",
    group: "cpu",
    label: "CPU load + temp",
    description: "CPU utilization and thermals",
    template: "CPU {cpu.loadPct} {cpu.tempC}",
  },
  {
    id: "cpu-power",
    group: "cpu",
    label: "CPU power",
    description: "CPU package power when available",
    template: "CPU {cpu.powerW}",
  },
  {
    id: "gpu-load-temp",
    group: "gpu",
    label: "GPU load + temp",
    description: "Primary GPU utilization and thermals",
    template: "GPU {gpu.loadPct} {gpu.tempC}",
  },
  {
    id: "gpu-vram",
    group: "gpu",
    label: "GPU VRAM",
    description: "Used and total video memory",
    template: "VRAM {gpu.vramUsedGb}/{gpu.vramTotalGb}",
  },
  {
    id: "gpu-power-fan",
    group: "gpu",
    label: "GPU power + fan",
    description: "Power draw and fan percentage",
    template: "GPU {gpu.powerW} Fan {gpu.fanPct}",
  },
  {
    id: "memory-usage",
    group: "memory",
    label: "RAM usage",
    description: "System memory usage",
    template: "RAM {ram.usedPct} {ram.usedGb}/{ram.totalGb}",
  },
  {
    id: "memory-module",
    group: "memory",
    label: "RAM module",
    description: "First memory module model and speed",
    template: "RAM {ram.module0.manufacturer} {ram.module0.model} {ram.module0.speedMhz}",
  },
  {
    id: "motherboard",
    group: "system",
    label: "Motherboard",
    description: "Board vendor and model",
    template: "Board {motherboard.name}",
  },
  {
    id: "hardware-names",
    group: "system",
    label: "Hardware names",
    description: "Short CPU/GPU/RAM identity line",
    template: "CPU {cpu.shortName} | GPU {gpu.shortName} | RAM {ram.totalGb}",
  },
  {
    id: "sensor-count",
    group: "system",
    label: "Sensor count",
    description: "Detected telemetry sensor counts",
    template: "Sensors {sensor.count} | Fans {fan.count}",
  },
];

export const OSC_CARD_GROUPS: Array<{ id: OscCardGroup; label: string }> = [
  { id: "chatbox", label: "Chatbox" },
  { id: "telemetry", label: "Telemetry" },
  { id: "avatar", label: "Avatar" },
  { id: "input", label: "Input" },
  { id: "raw", label: "Raw" },
];

export const OSC_STUDIO_SCENES: Array<{ id: string; label: string; cards: OscStudioCard[] }> = [
  {
    id: "template-clock",
    label: "Clock",
    cards: [
      {
        id: "scene-clock",
        kind: "chatbox-template",
        title: "Clock line",
        group: "chatbox",
        enabled: true,
        address: "/chatbox/input",
        valueType: "string",
        value: "",
        template: "VRChat | {time.short} | {date.iso}",
        autoIntervalSec: 30,
      },
    ],
  },
  {
    id: "template-performance",
    label: "Performance",
    cards: [
      {
        id: "scene-performance",
        kind: "performance-overlay",
        title: "PC status compact",
        group: "telemetry",
        enabled: true,
        address: "/chatbox/input",
        valueType: "string",
        value: "",
        template: "PC {time.short} | CPU {cpu.loadPct} {cpu.tempC} | GPU {gpu.loadPct} {gpu.tempC} | RAM {ram.usedPct}",
        autoIntervalSec: 10,
      },
    ],
  },
  {
    id: "template-hardware",
    label: "Hardware",
    cards: [
      {
        id: "scene-hardware",
        kind: "hardware-summary",
        title: "Hardware names",
        group: "telemetry",
        enabled: true,
        address: "/chatbox/input",
        valueType: "string",
        value: "",
        template: "CPU {cpu.shortName} | GPU {gpu.shortName} | RAM {ram.totalGb}",
        autoIntervalSec: 45,
      },
    ],
  },
  {
    id: "template-thermal",
    label: "Thermal",
    cards: [
      {
        id: "scene-thermal",
        kind: "sensor-temperature",
        title: "Thermal and power",
        group: "telemetry",
        enabled: true,
        address: "/chatbox/input",
        valueType: "string",
        value: "",
        template: "Thermal | CPU {cpu.tempC} {cpu.powerW} | GPU {gpu.tempC} {gpu.powerW} | Fan {gpu.fanPct}",
        autoIntervalSec: 20,
      },
    ],
  },
];

function cloneDefaults(): OscStudioCard[] {
  return OSC_STUDIO_DEFAULT_CARDS.map((card) => ({ ...card }));
}

export function loadOscStudioCards(): OscStudioCard[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneDefaults();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) && typeof parsed.version === "number" && parsed.version < PROFILE_VERSION) {
      return cloneDefaults();
    }
    const maybeCards = Array.isArray(parsed.cards) ? parsed.cards : parsed;
    if (!Array.isArray(maybeCards)) return cloneDefaults();
    const cards = maybeCards.filter(isOscStudioCard).map(normalizeCard);
    return cards.length ? cards : cloneDefaults();
  } catch {
    return cloneDefaults();
  }
}

export function saveOscStudioCards(cards: OscStudioCard[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: PROFILE_VERSION,
      cards,
      savedAt: new Date().toISOString(),
    }));
  } catch {
    // Ignore private-mode/quota failures; the page still works in memory.
  }
}

export function moveOscCard(
  cards: OscStudioCard[],
  cardId: string,
  direction: -1 | 1,
): OscStudioCard[] {
  const index = cards.findIndex((card) => card.id === cardId);
  if (index === -1) return cards;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= cards.length) return cards;
  const next = [...cards];
  const [card] = next.splice(index, 1);
  next.splice(nextIndex, 0, card);
  return next;
}

export function moveOscCardToIndex(
  cards: OscStudioCard[],
  cardId: string,
  targetIndex: number,
): OscStudioCard[] {
  const index = cards.findIndex((card) => card.id === cardId);
  if (index === -1) return cards;
  const next = [...cards];
  const [card] = next.splice(index, 1);
  const clamped = Math.max(0, Math.min(targetIndex, next.length));
  next.splice(clamped, 0, card);
  return next;
}

export function appendOscScene(cards: OscStudioCard[], sceneId: string): OscStudioCard[] {
  const scene = OSC_STUDIO_SCENES.find((item) => item.id === sceneId);
  if (!scene) return cards;
  const stamp = Date.now().toString(36);
  return [
    ...cards,
    ...scene.cards.map((card, index) => ({
      ...card,
      id: `${card.id}-${stamp}-${index}`,
    })),
  ];
}

export function createAvatarParameterCard(name: string, valueType: OscValueType): OscStudioCard {
  const safeName = name.trim().replace(/^\/avatar\/parameters\//, "") || "NewParameter";
  return {
    id: `avatar-param-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`,
    kind: valueType === "float" ? "avatar-float" : "avatar-bool",
    title: safeName,
    group: "avatar",
    enabled: true,
    address: `/avatar/parameters/${safeName}`,
    valueType,
    value: valueType === "bool" ? "true" : "1",
  };
}

export function exportOscStudioProfile(cards: OscStudioCard[]): string {
  return JSON.stringify(
    {
      version: PROFILE_VERSION,
      exportedAt: new Date().toISOString(),
      cards,
    },
    null,
    2,
  );
}

export function importOscStudioProfile(text: string): OscStudioCard[] {
  const parsed = JSON.parse(text) as unknown;
  const rawCards = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { cards?: unknown }).cards)
      ? (parsed as { cards: unknown[] }).cards
      : null;
  if (!rawCards) {
    throw new Error("Profile JSON must be an array or an object with cards[]");
  }
  const cards = rawCards.filter(isOscStudioCard).map(normalizeCard);
  if (cards.length === 0) {
    throw new Error("Profile does not contain valid cards");
  }
  return cards;
}

export function updateOscCard(
  cards: OscStudioCard[],
  cardId: string,
  patch: Partial<OscStudioCard>,
): OscStudioCard[] {
  return cards.map((card) => (card.id === cardId ? { ...card, ...patch } : card));
}

export function resetOscStudioCards(): OscStudioCard[] {
  const cards = cloneDefaults();
  saveOscStudioCards(cards);
  return cards;
}

export function coerceOscValue(
  valueType: OscValueType,
  valueText: string,
): number | string | boolean | null {
  switch (valueType) {
    case "int": {
      const n = parseInt(valueText, 10);
      return Number.isFinite(n) ? n : null;
    }
    case "float": {
      const n = parseFloat(valueText);
      return Number.isFinite(n) ? n : null;
    }
    case "bool":
      return valueText.toLowerCase() === "true" || valueText === "1";
    case "string":
    default:
      return valueText;
  }
}

export function renderOscTemplate(
  template: string,
  context: OscTemplateContext = {},
): string {
  const now = context.now ?? new Date();
  const hardware = context.hardware ?? {};
  const telemetry: Partial<HardwareTelemetrySnapshot> = hardware.telemetry ?? {};
  const cpu = telemetry.cpu ?? {};
  const gpu = telemetry.gpu ?? {};
  const memory = telemetry.memory ?? {};
  const motherboard = telemetry.motherboard ?? {};
  const ram0 = telemetry.ram_modules?.[0] ?? {};
  const fans = telemetry.fans ?? [];
  const power = telemetry.power ?? [];
  const replacements: Record<string, string> = {
    "{time}": now.toLocaleTimeString(),
    "{time.short}": now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    "{time.hm}": now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    "{date}": now.toLocaleDateString(),
    "{date.iso}": now.toISOString().slice(0, 10),
    "{cpu.name}": valueOrDash(hardware.cpuName),
    "{cpu.shortName}": shortenHardwareName(hardware.cpuName),
    "{cpu.cores}": numberOrDash(hardware.cpuCores),
    "{cpu.threads}": numberOrDash(hardware.cpuThreads),
    "{cpu.clockGhz}": hardware.cpuClockMhz
      ? `${(hardware.cpuClockMhz / 1000).toFixed(1)}GHz`
      : "--",
    "{gpu.name}": valueOrDash(hardware.gpuName ?? gpu.name),
    "{gpu.shortName}": shortenHardwareName(hardware.gpuName ?? gpu.name),
    "{gpu.vendor}": valueOrDash(hardware.gpuVendor),
    "{gpu.source}": valueOrDash(gpu.primary_source ?? hardware.gpuSource),
    "{gpu.vramGb}": formatBytesGb(hardware.gpuVramBytes ?? gpu.memory_total_bytes),
    "{gpu.driver}": valueOrDash(hardware.gpuDriver),
    "{ram.gb}": formatBytesGb(hardware.ramBytes ?? memory.total_bytes),
    "{ram.totalGb}": formatBytesGb(memory.total_bytes ?? hardware.ramBytes),
    "{ram.freeGb}": formatBytesGb(memory.available_bytes),
    "{hmd.model}": valueOrDash(hardware.hmdModel),
    "{hmd.manufacturer}": valueOrDash(hardware.hmdManufacturer),
    "{os.build}": valueOrDash(hardware.osBuild),
    "{cpu.tempC}": formatCelsius(cpu.temperature_c),
    "{cpu.loadPct}": formatPercent(cpu.load_pct),
    "{cpu.powerW}": formatWatts(cpu.power_watts),
    "{gpu.tempC}": formatCelsius(gpu.temperature_c),
    "{gpu.loadPct}": formatPercent(gpu.load_pct),
    "{gpu.fanPct}": formatPercent(gpu.fan_speed_pct),
    "{gpu.powerW}": formatWatts(gpu.power_watts),
    "{gpu.vramUsedGb}": formatBytesGb(gpu.memory_used_bytes),
    "{gpu.vramTotalGb}": formatBytesGb(gpu.memory_total_bytes),
    "{ram.usedGb}": formatBytesGb(memory.used_bytes),
    "{ram.usedPct}": formatPercent(memory.used_pct),
    "{motherboard.vendor}": valueOrDash(motherboard.manufacturer),
    "{motherboard.model}": valueOrDash(motherboard.product),
    "{motherboard.name}": [motherboard.manufacturer, motherboard.product].filter(Boolean).join(" ") || "--",
    "{ram.module0.model}": valueOrDash(ram0.part_number),
    "{ram.module0.manufacturer}": valueOrDash(ram0.manufacturer),
    "{ram.module0.capacityGb}": formatBytesGb(ram0.capacity_bytes),
    "{ram.module0.speedMhz}": ram0.configured_clock_mhz || ram0.speed_mhz
      ? `${ram0.configured_clock_mhz || ram0.speed_mhz}MHz`
      : "--",
    "{ram.module0.type}": valueOrDash(ram0.memory_type_label),
    "{sensor.count}": `${telemetry.sensors?.length ?? 0}`,
    "{fan.count}": `${fans.length}`,
    "{fan.0}": formatSensor(fans[0]),
    "{power.0}": formatSensor(power[0]),
  };

  const rendered = Object.entries(replacements).reduce(
    (text, [token, value]) => text.replaceAll(token, value),
    template,
  );
  return cleanRenderedTemplate(rendered.replace(/\{[a-zA-Z0-9_.-]+\}/g, "--"), template);
}

export function cardPreview(card: OscStudioCard, context: OscTemplateContext): string {
  if (card.template) return renderOscTemplate(card.template, context).slice(0, 144);
  return card.value.slice(0, 144);
}

function isOscStudioCard(value: unknown): value is OscStudioCard {
  if (!value || typeof value !== "object") return false;
  const card = value as Partial<OscStudioCard>;
  return (
    typeof card.id === "string" &&
    typeof card.title === "string" &&
    typeof card.address === "string" &&
    typeof card.valueType === "string" &&
    typeof card.value === "string" &&
    typeof card.enabled === "boolean"
  );
}

function normalizeCard(card: OscStudioCard): OscStudioCard {
  return {
    ...card,
    group: card.group ?? groupForKind(card.kind),
  };
}

function groupForKind(kind: OscCardKind): OscCardGroup {
  switch (kind) {
    case "chatbox-template":
      return "chatbox";
    case "hardware-summary":
    case "sensor-temperature":
    case "performance-overlay":
      return "telemetry";
    case "avatar-bool":
    case "avatar-float":
      return "avatar";
    case "input-button":
      return "input";
    case "raw-message":
    default:
      return "raw";
  }
}

function valueOrDash(value: string | null | undefined): string {
  return value && value.trim() ? value.trim() : "--";
}

function numberOrDash(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "--";
}

function formatBytesGb(value: number | null | undefined): string {
  if (!value) return "--";
  return `${(value / 1024 / 1024 / 1024).toFixed(1)}GB`;
}

function formatCelsius(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${Math.round(value)}C`;
}

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${Math.round(value)}%`;
}

function formatWatts(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value.toFixed(value >= 100 ? 0 : 1)}W`;
}

function formatSensor(sensor: SensorReading | null | undefined): string {
  if (!sensor || typeof sensor.value !== "number" || !Number.isFinite(sensor.value)) return "--";
  const rounded = Math.abs(sensor.value) >= 100 ? sensor.value.toFixed(0) : sensor.value.toFixed(1);
  return `${sensor.name} ${rounded}${sensor.unit}`;
}

function cleanRenderedTemplate(value: string, template: string): string {
  const templateLines = template.split(/\r?\n/);
  return value
    .split(/\r?\n/)
    .map((line, lineIndex) => {
      const templateParts = (templateLines[lineIndex] ?? "")
        .split("|")
        .map((part) => part.trim());
      const parts = line
        .split("|")
        .map((part, index) => ({
          text: cleanTemplatePart(part, templateParts[index] ?? ""),
          template: templateParts[index] ?? "",
        }))
        .filter((part) => part.text.length > 0);
      if (
        parts.length === 1 &&
        templateParts.length > 1 &&
        !hasTemplateToken(parts[0].template) &&
        templateParts.some(hasTemplateToken)
      ) {
        return "";
      }
      return parts.map((part) => part.text).join(" | ");
    })
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

function hasTemplateToken(value: string): boolean {
  return /\{[a-zA-Z0-9_.-]+\}/.test(value);
}

function cleanTemplatePart(value: string, templatePart: string): string {
  const cleaned = value
    .replace(/\s*--\s*/g, " ")
    .replace(/\s+([/:,])/g, "$1")
    .replace(/([/:,])\s+/g, "$1")
    .replace(/[/:,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  if (!hasTemplateToken(templatePart)) return cleaned;

  const staticOnly = templatePart
    .replace(/\{[a-zA-Z0-9_.-]+\}/g, " ")
    .replace(/\s+([/:,])/g, "$1")
    .replace(/([/:,])\s+/g, "$1")
    .replace(/[/:,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned === staticOnly ? "" : cleaned;
}

function shortenHardwareName(value: string | null | undefined): string {
  if (!value || !value.trim()) return "--";
  return value
    .replace(/\b(?:Intel\(R\)|AMD|NVIDIA|GeForce|Radeon|Graphics|Processor|CPU|GPU|Laptop GPU)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 28) || value.trim().slice(0, 28);
}
