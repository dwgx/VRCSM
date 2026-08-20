import {
  vrchatAvatarUrl,
  vrchatGroupUrl,
  vrchatUserUrl,
  vrchatWorldUrl,
} from "@/lib/shell-api";

export type PaletteEntityKind = "friend" | "world" | "avatar" | "group" | "note";

export const PALETTE_ENTITY_KIND_ORDER: readonly PaletteEntityKind[] = [
  "friend",
  "world",
  "avatar",
  "group",
  "note",
] as const;

export const PALETTE_ENTITY_SECTION_I18N: Record<
  PaletteEntityKind,
  { key: string; defaultValue: string }
> = {
  friend: { key: "cmd.sections.friends", defaultValue: "Friends" },
  world: { key: "cmd.sections.worlds", defaultValue: "Worlds" },
  avatar: { key: "cmd.sections.avatars", defaultValue: "Avatars" },
  group: { key: "cmd.sections.groups", defaultValue: "Groups" },
  note: { key: "cmd.sections.notes", defaultValue: "Notes" },
};

export interface PaletteEntityLike {
  type: string;
  id: string;
  displayName?: string;
  subtitle?: string;
  evidence?: Array<{ kind?: string; label?: string; detail?: string }>;
  primaryAction?: {
    enabled: boolean;
    route?: string;
  };
}

export type PaletteOpenIntent =
  | { via: "navigate"; route: string }
  | { via: "shell"; url: string }
  | { via: "copy"; text: string };

export type RankedPaletteRow<E extends PaletteEntityLike, C, L> =
  | { row: "entity"; kind: PaletteEntityKind; item: E }
  | { row: "command"; item: C; score: number }
  | { row: "log"; item: L; score: number };

export function matchScore(haystack: string, query: string): number {
  if (!query) return 1;
  const h = haystack.toLowerCase();
  const q = query.toLowerCase();
  if (h === q) return 1000;
  if (h.startsWith(q)) return 500;
  if (h.includes(q)) return 100;
  let i = 0;
  for (const ch of h) {
    if (ch === q[i]) i++;
    if (i === q.length) return 50;
  }
  return 0;
}

function idKind(id: string): PaletteEntityKind | null {
  const lower = id.trim().toLowerCase();
  if (lower.startsWith("usr_")) return "friend";
  if (lower.startsWith("wrld_")) return "world";
  if (lower.startsWith("avtr_")) return "avatar";
  if (lower.startsWith("grp_")) return "group";
  return null;
}

function looksLikeNote(item: PaletteEntityLike): boolean {
  const blob = [
    item.subtitle ?? "",
    ...(item.evidence ?? []).map((entry) =>
      [entry.kind, entry.label, entry.detail].filter(Boolean).join(" "),
    ),
  ]
    .join(" ")
    .toLowerCase();
  return /\b(?:note|notes|memo|memos)\b/.test(blob);
}

export function classifyPaletteEntity(item: PaletteEntityLike): PaletteEntityKind | null {
  const fromId = idKind(item.id ?? "");
  if (fromId) return fromId;

  const type = (item.type ?? "").trim().toLowerCase();
  if (type === "user" || type === "friend") return "friend";
  if (type === "world") return "world";
  if (type === "avatar") return "avatar";
  if (type === "group") return "group";
  if (type === "favorite" || looksLikeNote(item)) return "note";
  return null;
}

function fallbackRoute(kind: PaletteEntityKind, id: string): string {
  const encoded = encodeURIComponent(id);
  switch (kind) {
    case "friend":
      return `/friends?select=${encoded}`;
    case "world":
      return `/worlds?select=${encoded}`;
    case "avatar":
      return `/avatars?select=${encoded}`;
    case "group":
      return `/groups?select=${encoded}`;
    case "note":
      return `/library?select=${encoded}`;
  }
}

function fallbackUrl(kind: PaletteEntityKind, id: string): string | null {
  switch (kind) {
    case "friend":
      return vrchatUserUrl(id);
    case "world":
      return vrchatWorldUrl(id);
    case "avatar":
      return vrchatAvatarUrl(id);
    case "group":
      return vrchatGroupUrl(id);
    case "note":
      return null;
  }
}

function isUsefulRoute(route: string | undefined, kind: PaletteEntityKind | null): boolean {
  if (!route) return false;
  if (route === "/logs" && kind !== null) return false;
  return true;
}

export function entityOpenIntent(item: PaletteEntityLike): PaletteOpenIntent {
  const kind = classifyPaletteEntity(item);
  const claimed =
    item.primaryAction?.enabled === true ? item.primaryAction.route : undefined;
  if (isUsefulRoute(claimed, kind) && claimed) {
    return { via: "navigate", route: claimed };
  }
  if (kind) {
    const url = fallbackUrl(kind, item.id);
    if (url) return { via: "shell", url };
    return { via: "navigate", route: fallbackRoute(kind, item.id) };
  }
  return { via: "copy", text: item.id };
}

export function rankPaletteRows<E extends PaletteEntityLike, C, L>(opts: {
  query: string;
  commands: readonly C[];
  commandScore: (command: C) => number;
  entities: readonly E[];
  logs: readonly L[];
  logScore: (log: L) => number;
  max?: number;
}): Array<RankedPaletteRow<E, C, L>> {
  const max = opts.max ?? 80;
  const query = opts.query.trim();
  const out: Array<RankedPaletteRow<E, C, L>> = [];

  if (query !== "") {
    const buckets: Record<PaletteEntityKind, E[]> = {
      friend: [],
      world: [],
      avatar: [],
      group: [],
      note: [],
    };
    for (const entity of opts.entities) {
      const kind = classifyPaletteEntity(entity);
      if (kind) buckets[kind].push(entity);
    }
    for (const kind of PALETTE_ENTITY_KIND_ORDER) {
      for (const item of buckets[kind]) {
        out.push({ row: "entity", kind, item });
      }
    }
  }

  const commands: Array<Extract<RankedPaletteRow<E, C, L>, { row: "command" }>> = [];
  for (const item of opts.commands) {
    const score = query === "" ? 1 : opts.commandScore(item);
    if (query === "" || score > 0) {
      commands.push({ row: "command", item, score });
    }
  }
  if (query !== "") {
    commands.sort((a, b) => b.score - a.score);
  }
  out.push(...commands);

  if (query !== "") {
    const logs: Array<Extract<RankedPaletteRow<E, C, L>, { row: "log" }>> = [];
    for (const item of opts.logs) {
      const score = opts.logScore(item);
      if (score > 0) logs.push({ row: "log", item, score });
    }
    logs.sort((a, b) => b.score - a.score);
    out.push(...logs);
  }

  return out.slice(0, max);
}
