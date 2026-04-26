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
import { useUiPrefBoolean } from "@/lib/ui-prefs";
import { ipc } from "@/lib/ipc";
import { useAuth } from "@/lib/auth-context";
import { useIpcQuery } from "@/hooks/useIpcQuery";
import {
  LIBRARY_LIST_NAME,
  useFavoriteActions,
  useFavoriteItems,
} from "@/lib/library";
import type { AvatarHistoryItem, AvatarSearchResult, LocalAvatarItem } from "@/lib/types";
import { Eye, Sliders, Search, User, Info, Lock, Box, Heart, Globe2, Loader2 } from "lucide-react";
import { SmartWearButton } from "@/components/SmartWearButton";
import { ImageZoom } from "@/components/ImageZoom";

type AugmentedAvatar = LocalAvatarItem & {
  display_name?: string;
  author?: string;
  source?: "local" | "avatar-log" | "encounter-log";
  wearer_name?: string;
  wearer_user_id?: string | null;
  last_seen_at?: string | null;
  seen_count?: number;
  wearer_count?: number;
  wearer_names?: string[];
  resolved_avatar_id?: string;
  resolved_thumbnail_url?: string;
  resolution_source?: string | null;
  thumbnail_status?: "idle" | "loading" | "resolved" | "miss";
};

type AvatarListFilter = "local" | "encounters" | "all";

const SEEN_PAGE_SIZE = 40;
const AVATAR_LIST_FILTER_KEY = "vrcsm.avatars.listFilter.v2";

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
  const { data, isLoading, isError } = useIpcQuery<{ id: string }, AvatarDetailsResponse>(
    "avatar.details",
    { id: avatarId! },
    {
      staleTime: 5 * 60 * 1000,
      enabled: !!avatarId && status.authed,
      retry: false,
    }
  );

  return {
    details: data?.details ?? null,
    loading: isLoading,
    unavailable: !isLoading && isError && status.authed,
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

function stableSeenAvatarId(name: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `seen_${h.toString(16).padStart(8, "0")}`;
}

function compareIsoish(a?: string | null, b?: string | null): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a.localeCompare(b);
}

function normalizeAvatarName(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function normalizeAuthorName(name: string | undefined | null): string {
  return normalizeAvatarName(name ?? "");
}

/**
 * Row thumbnail — real CDN image when available, else the procedural
 * cube at a smaller size so the list pane reads like a Unity hierarchy
 * with icons rather than a wall of text. The inspector uses
 * <AvatarPreview3D> instead for the real 3D pipeline.
 */
function AvatarRowThumb({
  avatarId,
  fallbackUrl,
  placeholder = "cube",
  isFavorited,
  onToggleFavorite,
}: {
  avatarId: string;
  fallbackUrl?: string;
  placeholder?: "cube" | "image";
  isFavorited: boolean;
  onToggleFavorite?: (thumbnailUrl: string | null) => void;
}) {
  const { url } = useThumbnail(avatarId);
  const resolvedUrl = url || fallbackUrl || null;
  return (
    <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
      {resolvedUrl ? (
        <img
          src={resolvedUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : placeholder === "image" ? (
        <ImageIconPlaceholder size="sm" />
      ) : (
        <Avatar3DPreview seed={avatarId} size={22} />
      )}
      {onToggleFavorite ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(resolvedUrl);
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

function ImageIconPlaceholder({ size = "lg" }: { size?: "sm" | "lg" }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[hsl(var(--canvas))]">
      <User className={cn(
        "text-[hsl(var(--muted-foreground))] opacity-60",
        size === "sm" ? "size-4" : "size-12",
      )} />
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
  const [prefer3D, setPrefer3D] = useUiPrefBoolean("vrcsm.avatar.preview3d", false);
  const { details, loading: detailsLoading, unavailable } = useAvatarDetails(
    selected.avatar_id.startsWith("avtr_") ? selected.avatar_id : null,
  );
  const { url: cachedThumb } = useThumbnail(
    selected.avatar_id.startsWith("avtr_") ? selected.avatar_id : null,
  );


  // Broadcast the API-resolved name back up so the left list can show
  // the same label the inspector is showing, even when LocalAvatarData
  // has a stale or user-renamed copy on disk.
  useEffect(() => {
    const name = details?.name?.trim();
    if (name && onCanonicalName) {
      onCanonicalName(selected.avatar_id, name);
    }
  }, [details?.name, selected.avatar_id, onCanonicalName]);


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

  const windowsAssetUrl = details?.unityPackages?.find(
    (p) => p.platform === "standalonewindows"
  )?.assetUrl;
  const fallbackUrl =
    details?.imageUrl ||
    details?.thumbnailImageUrl ||
    cachedThumb ||
    selected.resolved_thumbnail_url ||
    undefined;
  const can3D = Boolean(windowsAssetUrl);
  const isEncounterLog = selected.source === "encounter-log";

  return (
    <Card elevation="flat" className="flex flex-col overflow-hidden p-0">
      <div className="unity-panel-header">
        {t("avatars.inspectorPaneTitle")}
      </div>
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          {(() => {
            if (prefer3D && can3D) {
              return (
                <div className="relative" style={{ width: 220 }}>
                  <AvatarPreview3D
                    avatarId={selected.avatar_id}
                    assetUrl={windowsAssetUrl}
                    bundlePath={selected.path || undefined}
                    fallbackImageUrl={fallbackUrl}
                    size={220}
                    expandedSize={720}
                  />
                  <button
                    type="button"
                    className="absolute bottom-1.5 right-1.5 z-10 flex items-center gap-0.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-white/90 backdrop-blur-sm hover:bg-black/80 transition-colors"
                    onClick={() => setPrefer3D(false)}
                  >
                    <Eye className="size-2.5" />
                    2D
                  </button>
                </div>
              );
            }
            return (
              <div className="relative overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))]" style={{ width: 220, height: 220 }}>
                {fallbackUrl ? (
                  <ImageZoom src={fallbackUrl} className="h-full w-full" imgClassName="h-full w-full object-cover" />
                ) : isEncounterLog ? (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[hsl(var(--canvas))] text-[11px] text-[hsl(var(--muted-foreground))]">
                    <User className="size-12 opacity-60" />
                    <span>
                      {selected.thumbnail_status === "loading"
                        ? t("avatars.thumbnailResolving", { defaultValue: "Resolving thumbnail…" })
                        : t("avatars.noThumbnail", { defaultValue: "No thumbnail" })}
                    </span>
                  </div>
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[hsl(var(--muted))]">
                    <User className="size-12 text-[hsl(var(--muted-foreground))]" />
                  </div>
                )}
                {can3D && (
                  <button
                    type="button"
                    className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-white/90 backdrop-blur-sm hover:bg-black/80 transition-colors"
                    onClick={() => setPrefer3D((v) => !v)}
                  >
                    <Box className="size-2.5" />
                    {prefer3D ? "2D" : "3D"}
                  </button>
                )}
              </div>
            );
          })()}
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
            ) : isEncounterLog ? (
              <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
                {t("avatars.encounterSummary", {
                  wearer: selected.wearer_name ?? t("common.unknown", { defaultValue: "Unknown" }),
                  count: selected.seen_count ?? 1,
                  defaultValue: "Seen on {{wearer}} · {{count}} log events",
                })}
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
            {isEncounterLog ? (
              <Badge variant="outline">
                {t("avatars.logOnly", { defaultValue: "Log only" })}
              </Badge>
            ) : (
              <Badge variant="outline">
                <Sliders className="size-3" />
                {t("avatars.params", { count: selected.parameter_count })}
              </Badge>
            )}
            {isEncounterLog && selected.wearer_count ? (
              <Badge variant="secondary">
                {t("avatars.wearerCount", {
                  count: selected.wearer_count,
                  defaultValue: "{{count}} wearer",
                })}
              </Badge>
            ) : null}
            {isEncounterLog && selected.resolved_avatar_id ? (
              <Badge variant="tonal">
                {t("avatars.thumbnailResolved", { defaultValue: "thumbnail match" })}
              </Badge>
            ) : null}
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

          {/* Switch avatar button — hidden when avatar is unavailable */}
          {authStatus.authed && !unavailable && selected.avatar_id.startsWith("avtr_") ? (
            <SmartWearButton
              avatarId={selected.avatar_id}
              avatarName={displayName}
              variant="button"
            />
          ) : null}
          {unavailable ? (
            <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.08)] px-3 py-2 text-[11px] text-[hsl(var(--destructive))]">
              {t("avatars.unavailable", {
                defaultValue: "This avatar may have been deleted or set to private. It cannot be worn.",
              })}
            </div>
          ) : null}

          {/* ID badges + cache path */}
          <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2">
            <div className="flex gap-2 min-w-0">
               <IdBadge id={selected.avatar_id} size="sm" />
            </div>
            {details?.authorId || (selected.user_id && selected.user_id.startsWith("usr_")) ? (
              <div className="flex gap-2 min-w-0">
                 <UserPopupBadge userId={(details?.authorId ?? selected.user_id) as string} />
              </div>
            ) : null}
            {isEncounterLog && selected.wearer_name ? (
              <div className="flex flex-col gap-1 text-[10.5px]">
                <div>
                  <span className="text-[hsl(var(--muted-foreground))]">
                    {t("avatars.wornBy", { defaultValue: "worn by" })}:{" "}
                  </span>
                  {selected.wearer_user_id?.startsWith("usr_") ? (
                    <UserPopupBadge
                      userId={selected.wearer_user_id}
                      displayName={selected.wearer_name}
                    />
                  ) : (
                    <span className="font-medium text-[hsl(var(--foreground))]">
                      {selected.wearer_name}
                    </span>
                  )}
                </div>
                {selected.last_seen_at ? (
                  <div>
                    <span className="text-[hsl(var(--muted-foreground))]">
                      {t("common.updated", { defaultValue: "Updated" })}:{" "}
                    </span>
                    <span className="font-mono text-[hsl(var(--foreground))]">
                      {formatDate(selected.last_seen_at)}
                    </span>
                  </div>
                ) : null}
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
          {isEncounterLog ? (
            <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2 text-[10.5px] text-[hsl(var(--muted-foreground))]">
              <Info className="mt-px size-3 shrink-0" />
              <span>
                {t("avatars.encounterLogNote", {
                  defaultValue:
                    "This row is indexed from local VRChat logs. The log exposes avatar name and wearer, but not avtr_* or the official thumbnail URL. Thumbnails are resolved by public name search when possible.",
                })}
              </span>
            </div>
          ) : !selected.display_name && !details?.name ? (
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
      className={cn(
        "relative flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left",
        "border border-transparent transition-colors",
        isSelected
          ? "bg-[hsl(var(--primary)/0.20)] border-[hsl(var(--primary)/0.55)]"
          : "hover:bg-[hsl(var(--surface-raised))]",
      )}
    >
      {isSelected ? (
        <span
          aria-hidden
          className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-[hsl(var(--primary))]"
        />
      ) : null}
      <AvatarRowThumb
        avatarId={item.avatar_id}
        fallbackUrl={item.resolved_thumbnail_url}
        placeholder={item.source === "encounter-log" ? "image" : "cube"}
        isFavorited={isFavorited}
        onToggleFavorite={item.avatar_id.startsWith("avtr_") ? onToggleFavorite : undefined}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <div className="truncate text-[12.5px] font-medium text-[hsl(var(--foreground))]">
            {display}
          </div>
          {item.source === "encounter-log" ? (
            <span className="shrink-0 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              {t("avatars.encounterLog", { defaultValue: "Seen" })}
            </span>
          ) : nameMismatch ? (
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
          {item.source === "encounter-log" ? (
            <>
              <span>{t("avatars.wornBy", { defaultValue: "worn by" })}</span>
              <span className="truncate text-[hsl(var(--foreground))]">
                {item.wearer_name ?? t("common.unknown", { defaultValue: "Unknown" })}
              </span>
              <span>·</span>
              <span>{t("avatars.seenTimes", { count: item.seen_count ?? 1, defaultValue: "seen {{count}} times" })}</span>
            </>
          ) : (
            <>
              <span className="font-mono">{shortenId(item.avatar_id, 6, 4)}</span>
              <span>·</span>
              <span>
                {t("avatars.params", { count: item.parameter_count })}
              </span>
            </>
          )}
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
  const doSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || !status.authed) return;
    setSearching(true);
    try {
      const res = await ipc.searchAvatars(q, 24);
      const avatars = res?.avatars ?? [];
      setResults(avatars);
      if (avatars.length === 0) {
        toast.info(t("avatars.search.noResults", { defaultValue: "No results found" }));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }, [query, status.authed]);

  if (!status.authed) return null;

  return (
    <Card elevation="flat" className="p-0">
      <div className="unity-panel-header flex items-center gap-2">
        <Globe2 className="size-3" />
        <span>{t("avatars.search.title", { defaultValue: "Search Public Avatars" })}</span>
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
                <ImageZoom
                  src={av.thumbnailImageUrl}
                  alt={av.name}
                  className="size-10 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]"
                  imgClassName="h-full w-full object-cover"
                />
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
              <SmartWearButton avatarId={av.id} avatarName={av.name} variant="pill" />
            </div>
          ))}
        </div>
      ) : searching ? (
        <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-[hsl(var(--muted-foreground))]">
          <Loader2 className="size-4 animate-spin" />
          {t("avatars.search.searching", { defaultValue: "Searching…" })}
        </div>
      ) : query.trim() && !searching ? (
        <div className="py-6 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
          {t("avatars.search.noResults", { defaultValue: "No results — try a different avatar name" })}
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
  const [listFilter, setListFilter] = useState<AvatarListFilter>(
    () => (localStorage.getItem(AVATAR_LIST_FILTER_KEY) as AvatarListFilter | null) ?? "local",
  );
  const [seenPage, setSeenPage] = useState(1);
  const [nameThumbs, setNameThumbs] = useState<Record<string, {
    avatarId?: string;
    url?: string;
    status: "loading" | "resolved" | "miss";
  }>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { byType: favoriteIds } = useFavoriteItems(LIBRARY_LIST_NAME);
  const { toggleFavorite } = useFavoriteActions();
  const avatarHistoryQuery = useIpcQuery<{ limit: number; offset: number }, { items: AvatarHistoryItem[] }>(
    "db.avatarHistory.list",
    { limit: 500, offset: 0 },
    { staleTime: 60_000 },
  );
  const avatarHistoryById = useMemo(() => {
    const map = new Map<string, AvatarHistoryItem>();
    for (const row of avatarHistoryQuery.data?.items ?? []) {
      if (row.avatar_id) map.set(row.avatar_id, row);
    }
    return map;
  }, [avatarHistoryQuery.data?.items]);
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
        source: "local",
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
        source: "avatar-log",
      });
    }

    const encounters = new Map<string, AugmentedAvatar>();
    const avatarNameSet = new Set(
      Object.values(names)
        .map((n) => n?.name?.trim().toLowerCase())
        .filter(Boolean) as string[],
    );
    for (const ev of report.logs.avatar_switches ?? []) {
      const name = ev.avatar_name?.trim();
      const actor = ev.actor?.trim();
      if (!name || !actor) continue;
      if (avatarNameSet.has(name.toLowerCase())) continue;
      const id = stableSeenAvatarId(name);
      const current = encounters.get(id);
      if (!current) {
        encounters.set(id, {
          user_id: ev.actor_user_id ?? "",
          avatar_id: id,
          path: "",
          eye_height: null,
          parameter_count: 0,
          modified_at: ev.iso_time,
          display_name: name,
          source: "encounter-log",
          wearer_name: actor,
          wearer_user_id: ev.actor_user_id,
          author: ev.author_name ?? undefined,
          last_seen_at: ev.iso_time,
          seen_count: 1,
          wearer_count: 1,
          wearer_names: [actor],
        });
        continue;
      }
      current.seen_count = (current.seen_count ?? 0) + 1;
      if (!current.wearer_names?.includes(actor)) {
        current.wearer_names = [...(current.wearer_names ?? []), actor];
        current.wearer_count = current.wearer_names.length;
      }
      if (compareIsoish(ev.iso_time, current.last_seen_at) > 0) {
        current.last_seen_at = ev.iso_time;
        current.modified_at = ev.iso_time;
        current.wearer_name = actor;
        current.wearer_user_id = ev.actor_user_id;
        current.user_id = ev.actor_user_id ?? current.user_id;
        current.author = ev.author_name ?? current.author;
      }
    }

    const withDbResolution = [...encounters.values()].map((item) => {
      const db = avatarHistoryById.get(item.avatar_id);
      if (!db) return item;
      return {
        ...item,
        author: item.author ?? db.author_name ?? undefined,
        wearer_user_id: item.wearer_user_id ?? db.first_seen_user_id ?? undefined,
        resolved_avatar_id: db.resolved_avatar_id ?? undefined,
        resolved_thumbnail_url: db.resolved_thumbnail_url ?? db.resolved_image_url ?? undefined,
        resolution_source: db.resolution_source,
        thumbnail_status: db.resolution_status === "resolved" || db.resolution_status === "miss"
          ? db.resolution_status
          : item.thumbnail_status,
      };
    });

    out.push(
      ...withDbResolution.sort((a, b) =>
        compareIsoish(b.last_seen_at, a.last_seen_at),
      ),
    );

    return out;
  }, [avatarHistoryById, report]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const base =
      listFilter === "encounters"
        ? items.filter((it) => it.source === "encounter-log")
        : listFilter === "local"
          ? items.filter((it) => it.path !== "")
          : items;
    if (!q) return base;
    return base.filter(
      (it) =>
        it.avatar_id.toLowerCase().includes(q) ||
        it.user_id.toLowerCase().includes(q) ||
        (it.display_name?.toLowerCase().includes(q) ?? false) ||
        (it.author?.toLowerCase().includes(q) ?? false) ||
        (it.wearer_name?.toLowerCase().includes(q) ?? false),
      );
  }, [items, filter, listFilter]);

  useEffect(() => {
    setSeenPage(1);
    setSelectedId(null);
  }, [filter, listFilter]);

  const pagedFiltered = useMemo(() => {
    if (listFilter !== "encounters") return filtered;
    const start = (seenPage - 1) * SEEN_PAGE_SIZE;
    return filtered.slice(start, start + SEEN_PAGE_SIZE);
  }, [filtered, listFilter, seenPage]);

  const seenTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filtered.length / SEEN_PAGE_SIZE)),
    [filtered.length],
  );

  const encounterCount = useMemo(
    () => items.filter((it) => it.source === "encounter-log").length,
    [items],
  );
  const localCount = useMemo(
    () => items.filter((it) => it.path !== "").length,
    [items],
  );

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
    const lookupIds = items
      .map((it) => it.avatar_id)
      .filter((id) => id.startsWith("avtr_"));
    if (lookupIds.length > 0) {
      prefetchThumbnails(lookupIds);
    }
  }, [items]);

  useEffect(() => {
    if (listFilter !== "encounters") return;
    const candidates = pagedFiltered
      .filter((item) => item.source === "encounter-log" && item.display_name)
      .slice(0, SEEN_PAGE_SIZE);
    const missing = candidates.filter((item) => {
      if (item.thumbnail_status === "resolved" || item.thumbnail_status === "miss") return false;
      const key = normalizeAvatarName(item.display_name ?? "");
      return key && !nameThumbs[key];
    });
    if (missing.length === 0) return;

    setNameThumbs((prev) => {
      const next = { ...prev };
      for (const item of missing) {
        const key = normalizeAvatarName(item.display_name ?? "");
        if (key) next[key] = { status: "loading" };
      }
      return next;
    });

    let cancelled = false;
    const run = async () => {
      for (const item of missing) {
        if (cancelled) return;
        const name = item.display_name?.trim();
        if (!name) continue;
        const key = normalizeAvatarName(name);
        try {
          const persist = async (params: {
            status: "resolved" | "miss";
            source?: string;
            avatarId?: string;
            thumbnailUrl?: string;
            imageUrl?: string;
          }) => {
            try {
              await ipc.dbAvatarHistoryResolve({
                avatar_id: item.avatar_id,
                resolved_avatar_id: params.avatarId ?? null,
                resolved_thumbnail_url: params.thumbnailUrl ?? null,
                resolved_image_url: params.imageUrl ?? null,
                resolution_source: params.source ?? null,
                resolution_status: params.status,
                resolved_at: new Date().toISOString(),
              });
            } catch {
              // Resolution is still useful for the current page even if the
              // persistence write fails; the next scan can retry.
            }
          };

          if (item.wearer_user_id?.startsWith("usr_")) {
            const profileResp = await ipc.call<
              { userId: string },
              { profile: { currentAvatarName?: string; currentAvatarId?: string; currentAvatarThumbnailImageUrl?: string; currentAvatarImageUrl?: string } | null }
            >("user.getProfile", { userId: item.wearer_user_id });
            const profile = profileResp.profile;
            const profileName = normalizeAvatarName(profile?.currentAvatarName ?? "");
            const profileUrl =
              profile?.currentAvatarThumbnailImageUrl ||
              profile?.currentAvatarImageUrl ||
              undefined;
            if (profileUrl && profileName === key) {
              await persist({
                status: "resolved",
                source: "wearer_profile",
                avatarId: profile?.currentAvatarId,
                thumbnailUrl: profile?.currentAvatarThumbnailImageUrl,
                imageUrl: profile?.currentAvatarImageUrl,
              });
              setNameThumbs((prev) => ({
                ...prev,
                [key]: {
                  status: "resolved",
                  avatarId: profile?.currentAvatarId,
                  url: profileUrl,
                },
              }));
              await new Promise((resolve) => window.setTimeout(resolve, 80));
              continue;
            }
          }

          const res = await ipc.searchAvatars(name, 5);
          const avatars = res?.avatars ?? [];
          const authorKey = normalizeAuthorName(item.author);
          const nameMatches = avatars.filter((a) => normalizeAvatarName(a.name) === key);
          const exact = authorKey ? nameMatches.find((a) => {
            if (normalizeAvatarName(a.name) !== key) return false;
            return normalizeAuthorName(a.authorName) === authorKey;
          }) : (nameMatches.length === 1 ? nameMatches[0] : undefined);
          const chosen = exact;
          const url = chosen?.thumbnailImageUrl || chosen?.imageUrl || undefined;
          await persist(url
            ? {
              status: "resolved",
              source: authorKey ? "public_search_name_author" : "public_search_name",
              avatarId: chosen?.id,
              thumbnailUrl: chosen?.thumbnailImageUrl,
              imageUrl: chosen?.imageUrl,
            }
            : { status: "miss", source: authorKey ? "public_search_name_author" : "public_search_name" });
          setNameThumbs((prev) => ({
            ...prev,
            [key]: url
              ? { status: "resolved", avatarId: chosen?.id, url }
              : { status: "miss" },
          }));
        } catch {
          try {
            await ipc.dbAvatarHistoryResolve({
              avatar_id: item.avatar_id,
              resolution_status: "miss",
              resolution_source: "resolver_error",
              resolved_at: new Date().toISOString(),
            });
          } catch {
            // Best-effort cache update.
          }
          setNameThumbs((prev) => ({ ...prev, [key]: { status: "miss" } }));
        }
        await new Promise((resolve) => window.setTimeout(resolve, 80));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [listFilter, nameThumbs, pagedFiltered]);

  const displayRows = useMemo(
    () =>
      pagedFiltered.map((item) => {
        if (item.source !== "encounter-log" || !item.display_name) return item;
        const hit = nameThumbs[normalizeAvatarName(item.display_name)];
        if (!hit) return item;
        return {
          ...item,
          resolved_avatar_id: hit.avatarId,
          resolved_thumbnail_url: hit.url,
          thumbnail_status: hit.status,
        };
      }),
    [nameThumbs, pagedFiltered],
  );

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
    if (!displayRows.length) return null;
    if (!selectedId) return displayRows[0] ?? null;
    return displayRows.find((it) => it.avatar_id === selectedId) ?? displayRows[0];
  }, [displayRows, selectedId]);

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
            <div className="flex flex-col gap-1.5 border-b border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 py-1.5">
              <div className="flex items-center gap-2">
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
              <div
                className="grid grid-cols-3 gap-1"
                title={t("avatars.includeLogOnlyHint", {
                  defaultValue:
                    "Show avatars that only appear in your VRChat output log, including avatars seen on other players.",
                })}
              >
                {([
                  ["local", t("avatars.filterLocal", { defaultValue: "Local" }), localCount],
                  ["encounters", t("avatars.filterSeen", { defaultValue: "Seen" }), encounterCount],
                  ["all", t("common.all", { defaultValue: "All" }), items.length],
                ] as const).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setListFilter(key);
                      localStorage.setItem(AVATAR_LIST_FILTER_KEY, key);
                    }}
                    className={cn(
                      "flex items-center justify-center gap-1 rounded-[var(--radius-sm)] border px-1.5 py-1 text-[10px] transition-colors",
                      listFilter === key
                        ? "border-[hsl(var(--primary)/0.55)] bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--foreground))]"
                        : "border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-raised))]",
                    )}
                  >
                    <span className="truncate">{label}</span>
                    <span className="font-mono">{count}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="scrollbar-thin flex-1 overflow-y-auto px-1 py-1">
              {filtered.length === 0 ? (
                <div className="py-6 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
                  {t("avatars.noMatch")}
                </div>
              ) : (
                <div className="flex flex-col gap-px">
                  {displayRows.map((item) => (
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
                  {listFilter === "encounters" && seenTotalPages > 1 && (
                    <div className="flex items-center justify-between gap-2 border-t border-[hsl(var(--border))] px-1 py-2 text-[10px] text-[hsl(var(--muted-foreground))]">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        disabled={seenPage <= 1}
                        onClick={() => setSeenPage((p) => Math.max(1, p - 1))}
                      >
                        {t("common.previous", { defaultValue: "Prev" })}
                      </Button>
                      <span className="font-mono">
                        {seenPage}/{seenTotalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        disabled={seenPage >= seenTotalPages}
                        onClick={() => setSeenPage((p) => Math.min(seenTotalPages, p + 1))}
                      >
                        {t("common.next", { defaultValue: "Next" })}
                      </Button>
                    </div>
                  )}
                  {listFilter !== "encounters" && filtered.length > displayRows.length && (
                    <div className="py-4 text-center text-[10px] text-[hsl(var(--muted-foreground))]">
                      {t("avatars.hiddenCount", { count: filtered.length - displayRows.length, defaultValue: `+${filtered.length - displayRows.length} more. Use search to filter.` })}
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
