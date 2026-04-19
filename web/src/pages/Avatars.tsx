import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AvatarPreview3D } from "@/components/AvatarPreview3D";
import { IdBadge } from "@/components/IdBadge";
import { UserPopupBadge } from "@/components/UserPopupBadge";
import { useReport } from "@/lib/report-context";
import { prefetchThumbnails, useThumbnail } from "@/lib/thumbnails";
import { cn, formatDate } from "@/lib/utils";
import { ipc } from "@/lib/ipc";
import { useAuth } from "@/lib/auth-context";
import { useIpcQuery } from "@/hooks/useIpcQuery";
import {
  LIBRARY_LIST_NAME,
  useFavoriteActions,
  useFavoriteItems,
} from "@/lib/library";
import type { AvatarSearchResult, LocalAvatarItem } from "@/lib/types";
import { Eye, Sliders, Search, User, Info, Lock, Box, Sword, Heart, Shirt, Globe2, Loader2 } from "lucide-react";

type AugmentedAvatar = LocalAvatarItem & {
  display_name?: string;
  author?: string;
};

// Raw JSON from /api/1/avatars/{id}. VRChat's payload shape is loose and
// evolves over time, so we type the fields we actually render as
// optional and let anything else ride along as `unknown`.
interface AvatarDetailsPayload {
  name?: string;
  description?: string;
  authorName?: string;
  authorId?: string;
  releaseStatus?: string;
  version?: number;
  thumbnailImageUrl?: string;
  imageUrl?: string;
  tags?: string[];
  unityPackages?: Array<{
    platform?: string;
    unityVersion?: string;
    assetVersion?: number;
    assetUrl?: string;
  }>;
  created_at?: string;
  updated_at?: string;
}

interface AvatarDetailsResponse {
  details: AvatarDetailsPayload | null;
}

export function useAvatarDetails(
  avatarId: string | null,
) {
  const { status } = useAuth();
  const { data, isLoading } = useIpcQuery<{ id: string }, AvatarDetailsResponse>(
    "avatar.details",
    { id: avatarId! },
    {
      staleTime: 5 * 60 * 1000,
      enabled: !!avatarId && status.authed,
    }
  );

  return { 
    details: data?.details ?? null, 
    loading: isLoading,
  };
}

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
 * Row thumbnail — real CDN image when available, else the procedural
 * cube at a smaller size so the list pane reads like a Unity hierarchy
 * with icons rather than a wall of text. The inspector uses
 * <AvatarPreview3D> instead for the real 3D pipeline.
 */
function AvatarRowThumb({
  avatarId,
  isFavorited,
  onToggleFavorite,
}: {
  avatarId: string;
  isFavorited: boolean;
  onToggleFavorite?: (thumbnailUrl: string | null) => void;
}) {
  const { url } = useThumbnail(avatarId);
  return (
    <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
      {url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <Avatar3DPreview seed={avatarId} size={22} />
      )}
      {onToggleFavorite ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(url);
          }}
          className={cn(
            "absolute right-0.5 bottom-0.5 flex size-4 items-center justify-center rounded-full border border-black/20 transition-colors",
            isFavorited
              ? "bg-[#C25B5B] text-white"
              : "bg-black/45 text-white/85 hover:bg-black/65",
          )}
          title={isFavorited ? "Remove from library" : "Save to library"}
        >
          <Heart className={cn("size-2.5", isFavorited && "fill-current")} />
        </button>
      ) : null}
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

/**
 * Inspector pane — merges local cache data with /api/1/avatars/{id} when
 * the user is signed in. Local-only fields (eye_height, parameter_count,
 * path, modified_at) always show. API fields (description, tags, release
 * status, version, author, unity packages) appear as soon as they
 * resolve and silently stay empty when anonymous or the avatar is
 * private/deleted. No "loading spinner everywhere" — local data renders
 * instantly and API data fills in as it arrives.
 */
function AvatarInspector({
  selected,
  onCanonicalName,
}: {
  selected: AugmentedAvatar;
  onCanonicalName?: (avatarId: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const { status: authStatus } = useAuth();
  const { details, loading: detailsLoading } = useAvatarDetails(
    selected.avatar_id,
  );
  const [switching, setSwitching] = useState(false);

  // Broadcast the API-resolved name back up so the left list can show
  // the same label the inspector is showing, even when LocalAvatarData
  // has a stale or user-renamed copy on disk.
  useEffect(() => {
    const name = details?.name?.trim();
    if (name && onCanonicalName) {
      onCanonicalName(selected.avatar_id, name);
    }
  }, [details?.name, selected.avatar_id, onCanonicalName]);

  async function handleSelectAvatar() {
    if (!authStatus.authed) {
      toast.error(t("avatars_extra.selectAvatarNeedsAuth"));
      return;
    }
    setSwitching(true);
    try {
      const res = await ipc.call<{ avatarId: string }, { ok: boolean }>(
        "avatar.select",
        { avatarId: selected.avatar_id },
      );
      if (res.ok) {
        toast.success(t("avatars_extra.selectAvatarDone"));
      } else {
        toast.error(t("avatars_extra.selectAvatarFailed"));
      }
    } catch (e) {
      toast.error(
        `${t("avatars_extra.selectAvatarFailed")}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    } finally {
      setSwitching(false);
    }
  }

  // API-sourced display name beats logs beats "unknown".
  const displayName =
    details?.name ?? selected.display_name ?? t("avatars.unknownName");
  const authorName = details?.authorName ?? selected.author;
  const tags = details?.tags ?? [];
  // VRChat tags look like `author_tag_nsfw` / `content_horror` —
  // strip the prefix for display.
  const prettyTags = tags
    .map((tag) => tag.replace(/^(author_tag_|content_|system_)/, ""))
    .filter((tag) => tag.length > 0);

  return (
    <Card elevation="flat" className="flex flex-col overflow-hidden p-0">
      <div className="unity-panel-header">
        {t("avatars.inspectorPaneTitle")}
      </div>
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          {(() => {
            const windowsAssetUrl = details?.unityPackages?.find(
              (p) => p.platform === "standalonewindows"
            )?.assetUrl;
            const fallbackUrl = details?.imageUrl || details?.thumbnailImageUrl;
            return (
              <AvatarPreview3D
                avatarId={selected.avatar_id}
                assetUrl={windowsAssetUrl}
                bundlePath={selected.path || undefined}
                fallbackImageUrl={fallbackUrl}
                size={220}
                expandedSize={720}
              />
            );
          })()}
          <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2 text-[10.5px] text-[hsl(var(--muted-foreground))]">
            <div className="font-medium uppercase tracking-[0.08em] text-[hsl(var(--foreground))]">
              {t("avatars.previewLabel")}
            </div>
            <div className="mt-1 leading-relaxed">
              {t("avatars.previewWorkbench", {
                defaultValue:
                  "Scroll to zoom, hold Shift and drag to pan, and use the debug modes to inspect silhouette and large accessories.",
              })}
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          {/* Name + author */}
          <div className="flex flex-col gap-1">
            <div className="text-[18px] font-semibold leading-tight text-[hsl(var(--foreground))]">
              {displayName}
            </div>
            {authorName ? (
              <div className="text-[12px] text-[hsl(var(--muted-foreground))]">
                {t("avatars.byAuthor", { author: authorName })}
              </div>
            ) : detailsLoading ? (
              <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
                {t("avatars.loadingDetails", {
                  defaultValue: "Loading details…",
                })}
              </div>
            ) : (
              <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
                {authStatus.authed
                  ? t("avatars.nameFromLogOnly")
                  : t("avatars.signInForDetails", {
                      defaultValue: "Sign in for full metadata",
                    })}
              </div>
            )}
          </div>

          {/* Local + API-derived badges */}
          <div className="flex flex-wrap gap-1.5">
            {selected.eye_height != null && selected.eye_height > 0 && (
              <Badge variant="tonal">
                <Eye className="size-3" />
                {t("avatars.eyeHeight", {
                  value: selected.eye_height.toFixed(2),
                })}
              </Badge>
            )}
            <Badge variant="outline">
              <Sliders className="size-3" />
              {t("avatars.params", { count: selected.parameter_count })}
            </Badge>
            {details?.releaseStatus ? (
              <Badge
                variant={details.releaseStatus === "public" ? "success" : "secondary"}
              >
                {details.releaseStatus}
              </Badge>
            ) : null}
            {typeof details?.version === "number" ? (
              <Badge variant="outline">v{details.version}</Badge>
            ) : null}
            {selected.modified_at ? (
              <Badge variant="secondary">
                {t("avatars.modified", {
                  date: formatDate(selected.modified_at),
                })}
              </Badge>
            ) : null}
          </div>

          {/* Description — API only, hides cleanly when absent */}
          {details?.description ? (
            <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2 text-[12px] leading-relaxed text-[hsl(var(--foreground))]">
              {details.description}
            </div>
          ) : null}

          {/* Tags */}
          {prettyTags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {prettyTags.slice(0, 12).map((tag) => (
                <span
                  key={tag}
                  className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-1.5 py-0.5 text-[10px] font-mono text-[hsl(var(--muted-foreground))]"
                >
                  {tag}
                </span>
              ))}
              {prettyTags.length > 12 ? (
                <span className="px-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                  +{prettyTags.length - 12}
                </span>
              ) : null}
            </div>
          ) : null}

          {/* Unity packages — platform + unity version summary */}
          {details?.unityPackages && details.unityPackages.length > 0 ? (
            <div className="flex flex-col gap-1 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2 text-[11px]">
              <div className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
                <Box className="size-3" />
                <span>
                  {t("avatars.unityPackages", {
                    count: details.unityPackages.length,
                    defaultValue: "{{count}} platform variants",
                  })}
                </span>
              </div>
              {details.unityPackages.slice(0, 4).map((pkg, i) => (
                <div
                  key={`${pkg.platform ?? "?"}-${i}`}
                  className="flex items-center justify-between gap-2 text-[10.5px] text-[hsl(var(--foreground))]"
                >
                  <span className="font-mono">{pkg.platform ?? "—"}</span>
                  <span className="font-mono text-[hsl(var(--muted-foreground))]">
                    {pkg.unityVersion ?? ""}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {/* Switch avatar button — only when signed in */}
          {authStatus.authed ? (
            <Button
              variant="tonal"
              size="sm"
              onClick={handleSelectAvatar}
              disabled={switching}
              className="self-start"
            >
              <Sword />
              {switching
                ? t("common.loading")
                : t("avatars_extra.selectAvatar")}
            </Button>
          ) : null}

          {/* ID badges + cache path */}
          <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2">
            <div className="flex gap-2 min-w-0">
               <IdBadge id={selected.avatar_id} size="sm" />
            </div>
            {details?.authorId || selected.user_id ? (
              <div className="flex gap-2 min-w-0">
                 <UserPopupBadge userId={(details?.authorId ?? selected.user_id) as string} />
              </div>
            ) : null}
            {selected.path ? (
              <div className="flex items-start gap-1.5">
                <span className="shrink-0 text-[hsl(var(--muted-foreground))]">
                  {t("common.path", { defaultValue: "Path" })}:{" "}
                </span>
                <span className="break-all font-mono text-[10.5px] text-[hsl(var(--foreground))]">
                  {selected.path}
                </span>
              </div>
            ) : null}
            {details?.created_at ? (
              <div>
                <span className="text-[hsl(var(--muted-foreground))]">
                  {t("common.created", { defaultValue: "Created" })}:{" "}
                </span>
                <span className="font-mono text-[hsl(var(--foreground))]">
                  {formatDate(details.created_at)}
                </span>
              </div>
            ) : null}
            {details?.updated_at ? (
              <div>
                <span className="text-[hsl(var(--muted-foreground))]">
                  {t("common.updated", { defaultValue: "Updated" })}:{" "}
                </span>
                <span className="font-mono text-[hsl(var(--foreground))]">
                  {formatDate(details.updated_at)}
                </span>
              </div>
            ) : null}
          </div>

          {!authStatus.authed ? (
            <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2 text-[10.5px] text-[hsl(var(--muted-foreground))]">
              <Lock className="mt-px size-3 shrink-0" />
              <span>{t("avatars.thumbnailNote")}</span>
            </div>
          ) : null}
          {!selected.display_name && !details?.name ? (
            <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2 text-[10.5px] text-[hsl(var(--muted-foreground))]">
              <Info className="mt-px size-3 shrink-0" />
              <span>{t("avatars.nameNote")}</span>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function AvatarRow({
  item,
  isSelected,
  isFavorited,
  duplicateNameCount,
  canonicalName,
  onSelect,
  onToggleFavorite,
}: {
  item: AugmentedAvatar;
  isSelected: boolean;
  isFavorited: boolean;
  duplicateNameCount: number;
  canonicalName?: string | null;
  onSelect: () => void;
  onToggleFavorite: (thumbnailUrl: string | null) => void;
}) {
  const { t } = useTranslation();
  // Prefer the VRChat API's canonical name when it has been fetched for
  // this avatar (by the inspector). Falls back to the LocalAvatarData
  // cached name, then the shortened id. Without this, the left list
  // shows one name ("超聪明Kipfel") while the inspector on the right
  // shows a completely different authored name ("AKALII by nikkie")
  // because LocalAvatarData stored whatever VRChat wrote when the file
  // was last cached — which can diverge from the live API.
  const display =
    (canonicalName && canonicalName.trim()) ||
    item.display_name ||
    shortenId(item.avatar_id);
  const nameMismatch =
    canonicalName &&
    item.display_name &&
    canonicalName.trim() !== item.display_name.trim();
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
      <AvatarRowThumb
        avatarId={item.avatar_id}
        isFavorited={isFavorited}
        onToggleFavorite={onToggleFavorite}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <div className="truncate text-[12.5px] font-medium text-[hsl(var(--foreground))]">
            {display}
          </div>
          {nameMismatch ? (
            <span
              className="shrink-0 rounded-[var(--radius-sm)] border border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.12)] px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[hsl(var(--primary))]"
              title={t("avatars.localNameWas", {
                defaultValue: "Cached as: {{name}}",
                name: item.display_name ?? "",
              })}
            >
              {t("avatars.renamedHint", { defaultValue: "Renamed" })}
            </span>
          ) : duplicateNameCount > 1 ? (
            <span className="shrink-0 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              {t("avatars.duplicateNameHint", {
                defaultValue: "Same name",
              })}
            </span>
          ) : null}
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

function PublicAvatarSearch() {
  const { t } = useTranslation();
  const { status } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AvatarSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [wearing, setWearing] = useState<string | null>(null);

  const doSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || !status.authed) return;
    setSearching(true);
    try {
      const res = await ipc.searchAvatars(q, 24);
      setResults(res.avatars ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }, [query, status.authed]);

  const handleWear = useCallback(async (av: AvatarSearchResult) => {
    setWearing(av.id);
    try {
      await ipc.call("avatar.select", { avatarId: av.id });
      toast.success(t("avatars.search.woreAvatar", {
        defaultValue: "Now wearing: {{name}}",
        name: av.name,
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg.includes("403")
        ? t("avatars.search.notCloneable", { defaultValue: "This avatar does not allow cloning." })
        : msg);
    } finally {
      setWearing(null);
    }
  }, [t]);

  if (!status.authed) return null;

  return (
    <Card elevation="flat" className="p-0">
      <div className="unity-panel-header flex items-center gap-2">
        <Globe2 className="size-3" />
        <span>{t("avatars.search.title", { defaultValue: "Search Public Avatars" })}</span>
        <span className="ml-1 rounded-[3px] bg-[hsl(45_93%_47%/0.15)] px-1 py-px text-[8px] font-semibold uppercase tracking-[0.06em] text-[hsl(45_93%_47%)]">
          {t("common.experimental", { defaultValue: "Beta" })}
        </span>
      </div>
      <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }}
            placeholder={t("avatars.search.placeholder", { defaultValue: "Search by avatar name…" })}
            className="h-7 pl-7 text-[12px]"
          />
        </div>
        <Button size="sm" onClick={doSearch} disabled={searching || !query.trim()}>
          {searching ? <Loader2 className="size-3 animate-spin" /> : <Search className="size-3" />}
          {t("avatars.search.go", { defaultValue: "Search" })}
        </Button>
      </div>
      {results.length > 0 ? (
        <div className="grid grid-cols-1 gap-px p-1 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((av) => (
            <div
              key={av.id}
              className="flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-2 hover:bg-[hsl(var(--surface-raised))] transition-colors"
            >
              {av.thumbnailImageUrl ? (
                <div className="size-10 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
                  <img
                    src={av.thumbnailImageUrl}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
              ) : (
                <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
                  <User className="size-4 text-[hsl(var(--muted-foreground))]" />
                </div>
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[12px] font-medium">{av.name}</span>
                <span className="truncate text-[10px] text-[hsl(var(--muted-foreground))]">
                  {av.authorName}
                </span>
              </div>
              <button
                type="button"
                disabled={wearing === av.id}
                onClick={() => handleWear(av)}
                className="flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.08)] px-2 py-1 text-[10px] font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.18)] disabled:opacity-50 transition-colors"
              >
                <Shirt className="size-3" />
                {wearing === av.id
                  ? t("avatars.search.wearing", { defaultValue: "…" })
                  : t("avatars.search.wear", { defaultValue: "Wear" })}
              </button>
            </div>
          ))}
        </div>
      ) : searching ? (
        <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-[hsl(var(--muted-foreground))]">
          <Loader2 className="size-4 animate-spin" />
          {t("avatars.search.searching", { defaultValue: "Searching…" })}
        </div>
      ) : null}
    </Card>
  );
}

function Avatars() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const { report, loading, error } = useReport();
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { byType: favoriteIds } = useFavoriteItems(LIBRARY_LIST_NAME);
  const { toggleFavorite } = useFavoriteActions();
  // Canonical name cache: `avatarId → API-fetched display name`. Populated
  // by the inspector each time it resolves a new avatar, read back by the
  // left-list rows so a single avatar never shows two different names
  // across the list and the inspector header.
  const [canonicalNames, setCanonicalNames] = useState<Record<string, string>>({});
  const registerCanonicalName = useCallback((avatarId: string, name: string) => {
    setCanonicalNames((prev) => (prev[avatarId] === name ? prev : { ...prev, [avatarId]: name }));
  }, []);

  useEffect(() => {
    const selectedFromRoute = searchParams.get("select");
    if (selectedFromRoute) {
      setSelectedId(selectedFromRoute);
    }
  }, [searchParams]);

  // Merge LocalAvatarData with recent_avatar_ids + avatar_names from the
  // parsed logs. LocalAvatarData only contains avatars the user has
  // physically cached on disk under LocalLow\VRChat\VRChat\LocalAvatarData,
  // which in practice skews heavily toward *private* avatars (the ones
  // VRChat's API will 401/404 on, so no thumbnail). Public avatars the
  // user has worn recently only show up in output_log_*.txt, so we
  // fold recent_avatar_ids in as virtual rows and let the thumbnail
  // fetcher light them up with real images. Rows from logs have no
  // on-disk metadata, hence the empty path / null eye_height / 0
  // parameter_count — the row renderer already tolerates those.
  const items = useMemo<AugmentedAvatar[]>(() => {
    if (!report) return [];
    const names = report.logs.avatar_names ?? {};
    const seen = new Set<string>();
    const out: AugmentedAvatar[] = [];

    for (const it of report.local_avatar_data.recent_items) {
      if (seen.has(it.avatar_id)) continue;
      seen.add(it.avatar_id);
      const n = names[it.avatar_id];
      out.push({
        ...it,
        display_name: n?.name,
        author: n?.author ?? undefined,
      });
    }

    for (const [id, n] of Object.entries(names)) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        user_id: "",
        avatar_id: id,
        path: "",
        eye_height: null,
        parameter_count: 0,
        modified_at: null,
        display_name: n?.name,
        author: n?.author ?? undefined,
      });
    }

    return out;
  }, [report]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.avatar_id.toLowerCase().includes(q) ||
        it.user_id.toLowerCase().includes(q) ||
        (it.display_name?.toLowerCase().includes(q) ?? false) ||
        (it.author?.toLowerCase().includes(q) ?? false),
      );
  }, [items, filter]);

  const displayNameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      // Count by the name we actually *display* (canonical when known,
      // cached-on-disk name otherwise). Otherwise the "Same name" badge
      // fires on the stale disk-cache name even after the inspector has
      // already shown the user this is really a different avatar.
      const canonical = canonicalNames[item.avatar_id]?.trim();
      const name = (canonical || item.display_name?.trim() || "").trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return counts;
  }, [items, canonicalNames]);

  // Warm the thumbnail cache as soon as the avatar list lands so the
  // row icons + inspector preview don't each trigger individual fetches
  // as the user scrolls. One batched IPC → WinHTTP → CDN.
  useEffect(() => {
    if (items.length > 0) {
      prefetchThumbnails(items.map((it) => it.avatar_id));
    }
  }, [items]);

  async function handleToggleFavorite(
    item: AugmentedAvatar,
    thumbnailUrl: string | null,
  ) {
    const isFavorited = favoriteIds.avatar.has(item.avatar_id);
    try {
      await toggleFavorite(
        {
          type: "avatar",
          target_id: item.avatar_id,
          list_name: LIBRARY_LIST_NAME,
          display_name: item.display_name,
          thumbnail_url: thumbnailUrl,
        },
        isFavorited,
      );
      toast.success(
        t(
          isFavorited ? "library.removedToast" : "library.savedToast",
          {
            name: item.display_name ?? shortenId(item.avatar_id),
          },
        ),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(t("library.toggleFailed", { error: message }));
    }
  }

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
        <div className="grid min-h-[560px] items-start gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
          {/* List pane — Unity hierarchy style */}
          <Card elevation="flat" className="flex flex-col p-0 border border-[hsl(var(--border))] h-[calc(100vh-140px)]">
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
                  {filtered.slice(0, 250).map((item) => (
                    <AvatarRow
                      key={item.avatar_id}
                      item={item}
                      isSelected={selected?.avatar_id === item.avatar_id}
                      isFavorited={favoriteIds.avatar.has(item.avatar_id)}
                      duplicateNameCount={displayNameCounts.get(
                        (canonicalNames[item.avatar_id]?.trim() ||
                          item.display_name?.trim() ||
                          "").trim(),
                      ) ?? 0}
                      canonicalName={canonicalNames[item.avatar_id]}
                      onSelect={() => setSelectedId(item.avatar_id)}
                      onToggleFavorite={(thumbnailUrl) =>
                        handleToggleFavorite(item, thumbnailUrl)
                      }
                    />
                  ))}
                  {filtered.length > 250 && (
                    <div className="py-4 text-center text-[10px] text-[hsl(var(--muted-foreground))]">
                      {t("avatars.hiddenCount", { count: filtered.length - 250, defaultValue: `+${filtered.length - 250} more. Use search to filter.` })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* Inspector pane — 3D preview + metadata */}
          <div className="sticky top-4 h-[calc(100vh-140px)] min-w-0 overflow-y-auto overflow-x-hidden scrollbar-none rounded-[var(--radius-lg)]">
            {selected ? (
              <AvatarInspector selected={selected} onCanonicalName={registerCanonicalName} />
            ) : (
              <Card elevation="flat" className="flex items-center justify-center p-0">
                <div className="flex flex-col items-center gap-2 py-10 text-[12px] text-[hsl(var(--muted-foreground))]">
                  <User className="size-6" />
                  {t("avatars.pickOne")}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      <PublicAvatarSearch />
    </div>
  );
}

export default Avatars;
