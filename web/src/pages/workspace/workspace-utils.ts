/**
 * Pure utility functions for the VRChat Workspace page — no React, no side-effects.
 */

import { ipc } from "@/lib/ipc";
import type { VrcSettingEntry, WorkspaceModerationItem } from "@/lib/types";
import type { useTranslation } from "react-i18next";
import type { useReport } from "@/lib/report-context";

// ── Status helpers ────────────────────────────────────────────────────────

export function statusBadgeVariant(status: string | null): "success" | "secondary" | "warning" | "muted" {
  switch (status) {
    case "join me":
    case "active":
      return "success";
    case "ask me":
      return "secondary";
    case "busy":
      return "warning";
    default:
      return "muted";
  }
}

export function shortenId(id: string, head = 10, tail = 6) {
  if (id.length <= head + tail + 3) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

export function openLaunchUrl(url: string) {
  return ipc.call<{ url: string }, { ok: boolean }>("shell.openUrl", { url });
}

export function openVrchatUserProfile(userId: string) {
  return openLaunchUrl(`https://vrchat.com/home/user/${userId}`);
}

// ── Moderation helpers ────────────────────────────────────────────────────

export function moderationLabel(item: WorkspaceModerationItem, t: ReturnType<typeof useTranslation>["t"]) {
  switch ((item.type || "").toLowerCase()) {
    case "block":
      return t("vrchatWorkspace.block", { defaultValue: "Block" });
    case "mute":
      return t("vrchatWorkspace.mute", { defaultValue: "Mute" });
    default:
      return item.type || t("common.unknown", { defaultValue: "Unknown" });
  }
}

export function moderationVariant(item: WorkspaceModerationItem): "warning" | "secondary" | "muted" {
  switch ((item.type || "").toLowerCase()) {
    case "block":
      return "warning";
    case "mute":
      return "secondary";
    default:
      return "muted";
  }
}

// ── JSON introspection helpers ────────────────────────────────────────────

export type JsonRecord = Record<string, unknown>;

export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function scalarText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

export function stringArrayField(record: JsonRecord | null, key: string): string[] {
  const value = record?.[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function findScalarField(record: JsonRecord | null, needles: string[]): { key: string; value: string } | null {
  if (!record) {
    return null;
  }

  const normalized = needles.map((needle) => needle.toLowerCase());
  for (const [key, value] of Object.entries(record)) {
    const lowered = key.toLowerCase();
    if (!normalized.some((needle) => lowered === needle)) {
      continue;
    }
    const text = scalarText(value);
    if (text) {
      return { key, value: text };
    }
  }

  for (const [key, value] of Object.entries(record)) {
    const lowered = key.toLowerCase();
    if (!normalized.some((needle) => lowered.includes(needle))) {
      continue;
    }
    const text = scalarText(value);
    if (text) {
      return { key, value: text };
    }
  }

  return null;
}

// ── VRC settings value text ───────────────────────────────────────────────

export function settingValueText(entry: VrcSettingEntry | null): string | null {
  if (!entry) {
    return null;
  }

  switch (entry.type) {
    case "string":
      return entry.stringValue?.trim() ? entry.stringValue : null;
    case "int":
      return typeof entry.intValue === "number" ? String(entry.intValue) : null;
    case "float":
      return typeof entry.floatValue === "number" ? String(entry.floatValue) : null;
    case "bool":
      return typeof entry.boolValue === "boolean" ? (entry.boolValue ? "true" : "false") : null;
    case "raw":
      return Array.isArray(entry.raw) && entry.raw.length > 0 ? entry.raw.join(", ") : null;
    default:
      return null;
  }
}

// ── Runtime detection ─────────────────────────────────────────────────────

export function detectRuntimeSummary(report: ReturnType<typeof useReport>["report"]) {
  const env = report?.logs.environment;
  if (!env) {
    return {
      label: "Unknown",
      detail: "No VRChat environment block parsed yet.",
    };
  }

  // VRChat writes the literal string "None" when no XR runtime is active —
  // treat that as absent, otherwise we mis-classify desktop users as VR
  // with a device name of "None".
  const rawXr = env.xr_device?.trim() ?? "";
  const xrDevice = rawXr && rawXr.toLowerCase() !== "none" ? rawXr : undefined;
  const deviceModel = env.device_model?.trim() || undefined;
  const platform = env.platform?.trim() || undefined;
  const store = env.store?.trim() || undefined;
  const probeText = `${xrDevice ?? ""} ${deviceModel ?? ""} ${platform ?? ""}`.toLowerCase();

  if (xrDevice || /quest|vive|index|oculus|pimax|windowsmr|openvr|openxr/.test(probeText)) {
    return {
      label: "VR",
      detail: xrDevice ?? deviceModel ?? platform ?? store ?? "XR runtime detected",
    };
  }

  if (platform?.toLowerCase().includes("android")) {
    return {
      label: "Standalone",
      detail: deviceModel ?? platform ?? "Quest / Pico / other standalone",
    };
  }

  return {
    label: "Desktop",
    detail: deviceModel ?? platform ?? store ?? "Windows",
  };
}
