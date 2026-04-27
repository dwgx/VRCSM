import type { PluginManifestDto } from "@/lib/types";

function localeCandidates(language: string | undefined): string[] {
  const lang = (language || "").trim();
  const lower = lang.toLowerCase();
  const out = [lang, lower];
  const base = lower.split("-")[0];
  if (base && base !== lower) out.push(base);
  if (lower.startsWith("zh")) out.push("zh-CN", "zh");
  out.push("en");
  return Array.from(new Set(out.filter(Boolean)));
}

export function pluginText(
  plugin: Pick<PluginManifestDto, "i18n">,
  language: string | undefined,
  key: string,
  fallback: string,
): string {
  const table = plugin.i18n;
  if (!table) return fallback;
  for (const locale of localeCandidates(language)) {
    const value = table[locale]?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

export function pluginDisplayName(plugin: PluginManifestDto, language: string | undefined): string {
  return pluginText(plugin, language, "name", plugin.name);
}

export function pluginDescription(plugin: PluginManifestDto, language: string | undefined): string {
  return pluginText(plugin, language, "description", plugin.description ?? "");
}
