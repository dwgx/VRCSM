import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useReport } from "@/lib/report-context";
import { formatDate } from "@/lib/utils";
import type { LocalAvatarItem } from "@/lib/types";
import { Eye, Sliders, Search, User, Info, Lock } from "lucide-react";

type AugmentedAvatar = LocalAvatarItem & {
  display_name?: string;
  author?: string;
};

/**
 * Stable 32-bit string hash (FNV-1a ish) used to seed the 3D preview
 * colour palette so each avatar gets a distinct look every mount.
 */
function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function hueSet(seed: string): number[] {
  const base = hashString(seed);
  return Array.from({ length: 6 }, (_, i) => ((base >> (i * 5)) & 0xff) % 360);
}

function shortenId(id: string, head = 8, tail = 4): string {
  const clean = id.replace(/^avtr_/, "");
  if (clean.length <= head + tail + 3) return clean;
  return `${clean.slice(0, head)}…${clean.slice(-tail)}`;
}

/**
 * Inspector preview. VRChat's public avatar API refuses all anonymous
 * requests with HTTP 401 — see the note in `web/src/lib/thumbnails.ts`
 * and `src/core/VrcApi.cpp` — so we render a procedural CSS 3D cube
 * keyed off the avatar id. Each avatar gets a stable distinct palette
 * via the hash seed, which at least gives the inspector something more
 * visually distinctive than a blank panel.
 */
function AvatarPreview({
  avatarId,
  size = 140,
}: {
  avatarId: string;
  size?: number;
}) {
  return (
    <div
      className="relative flex items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]"
      style={{ width: size, height: size }}
    >
      <Avatar3DPreview seed={avatarId} size={Math.round(size * 0.62)} />
    </div>
  );
}

/**
 * Row thumbnail — same procedural cube at a smaller size so the list
 * pane reads like a Unity hierarchy with icons rather than a wall of
 * text. Uses the same seed as the inspector preview so the colours
 * stay stable when switching selection.
 */
function AvatarRowThumb({ avatarId }: { avatarId: string }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
      <Avatar3DPreview seed={avatarId} size={22} />
    </div>
  );
}

/** Pure CSS 3D cube. No three.js dependency, ~1KB of markup. */
function Avatar3DPreview({ seed, size = 96 }: { seed: string; size?: number }) {
  const hues = useMemo(() => hueSet(seed), [seed]);
  const half = size / 2;
  const style: React.CSSProperties & { "--half": string } = {
    width: size,
    height: size,
    "--half": `${half}px`,
  };
  const face = (index: number): React.CSSProperties => ({
    // Two-stop gradient gives each face a lit/shaded falloff.
    background: `linear-gradient(135deg, hsl(${hues[index]} 72% 56%), hsl(${
      (hues[index] + 40) % 360
    } 65% 32%))`,
  });
  return (
    <div className="avatar-3d-stage shrink-0" style={style}>
      <div className="avatar-3d-cube">
        <div
          className="avatar-3d-face avatar-3d-face-front"
          style={face(0)}
        >
          <div className="avatar-3d-grid" />
        </div>
        <div
          className="avatar-3d-face avatar-3d-face-back"
          style={face(1)}
        />
        <div
          className="avatar-3d-face avatar-3d-face-right"
          style={face(2)}
        />
        <div
          className="avatar-3d-face avatar-3d-face-left"
          style={face(3)}
        />
        <div
          className="avatar-3d-face avatar-3d-face-top"
          style={face(4)}
        />
        <div
          className="avatar-3d-face avatar-3d-face-bottom"
          style={face(5)}
        />
      </div>
    </div>
  );
}

function AvatarRow({
  item,
  isSelected,
  onSelect,
}: {
  item: AugmentedAvatar;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const display = item.display_name ?? shortenId(item.avatar_id);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        "relative flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left " +
        "border border-transparent transition-colors " +
        (isSelected
          ? "bg-[hsl(var(--primary)/0.20)] border-[hsl(var(--primary)/0.55)]"
          : "hover:bg-[hsl(var(--surface-raised))]")
      }
    >
      {isSelected ? (
        <span
          aria-hidden
          className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-[hsl(var(--primary))]"
        />
      ) : null}
      <AvatarRowThumb avatarId={item.avatar_id} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="truncate text-[12.5px] font-medium text-[hsl(var(--foreground))]">
          {display}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">
          <span className="font-mono">{shortenId(item.avatar_id, 6, 4)}</span>
          <span>·</span>
          <span>
            {t("avatars.params", { count: item.parameter_count })}
          </span>
        </div>
      </div>
    </button>
  );
}

function Avatars() {
  const { t } = useTranslation();
  const { report, loading, error } = useReport();
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /**
   * Merge LocalAvatarData items with the avatar_names map produced by
   * LogParser so the UI can display a human-readable name + author when
   * the avatar has been loaded at least once.
   */
  const items = useMemo<AugmentedAvatar[]>(() => {
    if (!report) return [];
    const names = report.logs.avatar_names ?? {};
    return report.local_avatar_data.recent_items.map((it) => {
      const n = names[it.avatar_id];
      return {
        ...it,
        display_name: n?.name,
        author: n?.author ?? undefined,
      };
    });
  }, [report]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.avatar_id.toLowerCase().includes(q) ||
        (it.display_name?.toLowerCase().includes(q) ?? false) ||
        (it.author?.toLowerCase().includes(q) ?? false),
    );
  }, [items, filter]);

  const selected = useMemo(() => {
    if (!filtered.length) return null;
    if (!selectedId) return filtered[0] ?? null;
    return filtered.find((it) => it.avatar_id === selectedId) ?? filtered[0];
  }, [filtered, selectedId]);

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight">
            {t("avatars.title")}
          </h1>
          <p className="mt-1.5 text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("avatars.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
          <span>{t("avatars.totalCount", { count: items.length })}</span>
        </div>
      </header>

      {loading && !report ? (
        <Card>
          <CardContent className="py-8 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("avatars.scanning")}
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("avatars.loadFailed")}</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("avatars.empty")}
          </CardContent>
        </Card>
      ) : (
        <div className="grid min-h-[560px] gap-4 md:grid-cols-[260px_1fr]">
          {/* List pane — Unity hierarchy style */}
          <Card elevation="flat" className="flex flex-col overflow-hidden p-0">
            <div className="unity-panel-header flex items-center justify-between">
              <span>{t("avatars.listPaneTitle")}</span>
              <span className="font-mono text-[10px] normal-case tracking-normal">
                {filtered.length}
              </span>
            </div>
            <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 py-1.5">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t("avatars.filterPlaceholder")}
                  className="h-7 pl-7 text-[12px]"
                />
              </div>
            </div>
            <div className="scrollbar-thin flex-1 overflow-y-auto px-1 py-1">
              {filtered.length === 0 ? (
                <div className="py-6 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
                  {t("avatars.noMatch")}
                </div>
              ) : (
                <div className="flex flex-col gap-px">
                  {filtered.map((item) => (
                    <AvatarRow
                      key={item.avatar_id}
                      item={item}
                      isSelected={selected?.avatar_id === item.avatar_id}
                      onSelect={() => setSelectedId(item.avatar_id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* Inspector pane — 3D preview + metadata */}
          {selected ? (
            <Card elevation="flat" className="flex flex-col overflow-hidden p-0">
              <div className="unity-panel-header">
                {t("avatars.inspectorPaneTitle")}
              </div>
              <div className="grid gap-4 p-5 md:grid-cols-[160px_1fr]">
                {/* Procedural preview. VRChat's public avatar API requires
                    a logged-in session — see VrcApi.cpp — so we intentionally
                    do not attempt a real thumbnail here. */}
                <div className="flex flex-col items-center gap-2">
                  <AvatarPreview avatarId={selected.avatar_id} size={140} />
                  <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                    {t("avatars.previewLabel")}
                  </span>
                </div>

                {/* Metadata panel */}
                <div className="flex min-w-0 flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="text-[18px] font-semibold leading-tight text-[hsl(var(--foreground))]">
                      {selected.display_name ?? t("avatars.unknownName")}
                    </div>
                    {selected.author ? (
                      <div className="text-[12px] text-[hsl(var(--muted-foreground))]">
                        {t("avatars.byAuthor", { author: selected.author })}
                      </div>
                    ) : (
                      <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
                        {t("avatars.nameFromLogOnly")}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="tonal">
                      <Eye className="size-3" />
                      {t("avatars.eyeHeight", {
                        value: selected.eye_height?.toFixed(2) ?? "—",
                      })}
                    </Badge>
                    <Badge variant="outline">
                      <Sliders className="size-3" />
                      {t("avatars.params", {
                        count: selected.parameter_count,
                      })}
                    </Badge>
                    {selected.modified_at ? (
                      <Badge variant="secondary">
                        {t("avatars.modified", {
                          date: formatDate(selected.modified_at),
                        })}
                      </Badge>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-1 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2 text-[11px]">
                    <div>
                      <span className="text-[hsl(var(--muted-foreground))]">
                        id:{" "}
                      </span>
                      <span className="font-mono text-[hsl(var(--foreground))]">
                        {selected.avatar_id}
                      </span>
                    </div>
                    <div>
                      <span className="text-[hsl(var(--muted-foreground))]">
                        user:{" "}
                      </span>
                      <span className="font-mono text-[hsl(var(--foreground))]">
                        {selected.user_id}
                      </span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="shrink-0 text-[hsl(var(--muted-foreground))]">
                        path:{" "}
                      </span>
                      <span className="break-all font-mono text-[10.5px] text-[hsl(var(--foreground))]">
                        {selected.path}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2 text-[10.5px] text-[hsl(var(--muted-foreground))]">
                    <Lock className="mt-px size-3 shrink-0" />
                    <span>{t("avatars.thumbnailNote")}</span>
                  </div>
                  {!selected.display_name ? (
                    <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2 text-[10.5px] text-[hsl(var(--muted-foreground))]">
                      <Info className="mt-px size-3 shrink-0" />
                      <span>{t("avatars.nameNote")}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            </Card>
          ) : (
            <Card elevation="flat" className="flex items-center justify-center p-0">
              <div className="flex flex-col items-center gap-2 py-10 text-[12px] text-[hsl(var(--muted-foreground))]">
                <User className="size-6" />
                {t("avatars.pickOne")}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

export default Avatars;
