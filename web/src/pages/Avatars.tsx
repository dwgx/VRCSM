import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
import { IdBadge } from "@/components/IdBadge";
import { UserPopupBadge } from "@/components/UserPopupBadge";
import { ProfileCard, type VrcUserProfile } from "@/components/ProfileCard";
import { ThumbImage } from "@/components/ThumbImage";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { useReport } from "@/lib/report-context";
import { prefetchThumbnails, useThumbnail } from "@/lib/thumbnails";
import { cn, formatDate } from "@/lib/utils";
import { ipc } from "@/lib/ipc";
import { useAuth } from "@/lib/auth-context";
import { vrcApiThrottle } from "@/lib/api-throttle";
import { useIpcQuery } from "@/hooks/useIpcQuery";
import {
  LIBRARY_LIST_NAME,
  useFavoriteActions,
  useFavoriteItems,
} from "@/lib/library";
import type { AvatarHistoryItem, AvatarSearchResult, LocalAvatarItem, UserSearchResult } from "@/lib/types";
import { Eye, Sliders, Search, User, Info, Lock, Box, Heart, Globe2, Loader2 } from "lucide-react";
import { SmartWearButton } from "@/components/SmartWearButton";
import { ImageZoom } from "@/components/ImageZoom";

const AvatarPreview3D = lazy(() =>
  import("@/components/AvatarPreview3D").then((mod) => ({ default: mod.AvatarPreview3D })),
);

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
  author_user_id?: string;
  resolution_source?: string | null;
  thumbnail_status?: "idle" | "loading" | "resolved" | "miss";
  reference_thumbnail_url?: string;
  reference_source?: "public_search_name_unique_reference" | "wearer_current_profile" | "wearer_current_profile_verified";
  reference_status?: "loading" | "resolved" | "miss";
  wearer_reference_url?: string;
  wearer_reference_user_id?: string;
  wearer_reference_display_name?: string;
  wearer_reference_avatar_name?: string;
  wearer_reference_status?: "loading" | "resolved" | "miss";
};

type AvatarListFilter = "local" | "encounters" | "all";

const SEEN_PAGE_SIZE = 40;
const WEARER_REFERENCE_LOOKAHEAD = 10;
const AVATAR_PUBLIC_SEARCH_TIMEOUT_MS = 6000;
const WEARER_REFERENCE_TIMEOUT_MS = 5000;
const AVATAR_LIST_FILTER_KEY = "vrcsm.avatars.listFilter.v2";
const WEARER_REFERENCE_CACHE_KEY = "vrcsm.avatars.wearerReferences.v2";

type WearerReference = {
  status: "loading" | "resolved" | "miss";
  userId?: string;
  displayName?: string;
  avatarId?: string;
  url?: string;
  avatarName?: string;
  verifiedForAvatarName?: string;
};

type WearerProfileResponse = {
  profile: VrcUserProfile | null;
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

function stableSeenAvatarId(name: string, author?: string | null): string {
  const cleanAuthor = author?.trim();
  return cleanAuthor ? `name:${name}|author:${cleanAuthor}` : `name:${name}`;
}

function compareIsoish(a?: string | null, b?: string | null): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a.localeCompare(b);
}

function normalizeAvatarName(name?: string | null): string {
  return (name ?? "")
    .normalize("NFKC")
    .replace(/[._\-‐‑‒–—―\s]+/g, "")
    .toLowerCase()
    .trim();
}

function isSameAvatarName(a?: string | null, b?: string | null): boolean {
  const left = normalizeAvatarName(a);
  const right = normalizeAvatarName(b);
  return Boolean(left && right && left === right);
}

function isFuzzyAvatarNameMatch(a?: string | null, b?: string | null): boolean {
  const left = normalizeAvatarName(a);
  const right = normalizeAvatarName(b);
  return Boolean(left && right && Math.min(left.length, right.length) >= 2 && (left.includes(right) || right.includes(left)));
}

function trustedVrchatImageUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return undefined;
    const host = parsed.hostname.toLowerCase();
    if (
      host === "api.vrchat.cloud" ||
      host.endsWith(".vrchat.cloud") ||
      host === "assets.vrchat.com" ||
      host.endsWith(".assets.vrchat.com")
    ) {
      return url;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function trustedAvatarSearchImage(avatar?: AvatarSearchResult | null): string | undefined {
  return trustedVrchatImageUrl(avatar?.thumbnailImageUrl) ?? trustedVrchatImageUrl(avatar?.imageUrl);
}

function trustedProfileImage(user?: Pick<
  VrcUserProfile | UserSearchResult,
  "profilePicOverride" | "currentAvatarImageUrl" | "currentAvatarThumbnailImageUrl"
> | null): string | undefined {
  return (
    trustedVrchatImageUrl(user?.profilePicOverride) ??
    trustedVrchatImageUrl(user?.currentAvatarImageUrl) ??
    trustedVrchatImageUrl(user?.currentAvatarThumbnailImageUrl)
  );
}

function pickUserSearchCandidate(
  users: UserSearchResult[],
  displayName?: string | null,
): { user: UserSearchResult; exact: boolean; ambiguous: boolean } | null {
  const valid = users.filter((user) => user.id?.startsWith("usr_"));
  if (valid.length === 0) return null;
  const exact = valid.filter((user) => isSameAvatarName(user.displayName, displayName));
  if (exact.length > 0) {
    return { user: exact[0], exact: true, ambiguous: exact.length > 1 };
  }
  return { user: valid[0], exact: false, ambiguous: true };
}

function pickAvatarSearchCandidate(
  avatars: AvatarSearchResult[],
  lookup: { displayName?: string; authorName?: string | null },
): { avatar: AvatarSearchResult; verified: boolean } | null {
  const trusted = avatars.filter((avatar) => avatar.id?.startsWith("avtr_") && trustedAvatarSearchImage(avatar));
  if (trusted.length === 0) return null;

  const exactName = trusted.filter((avatar) => isSameAvatarName(avatar.name, lookup.displayName));
  const authorExact = lookup.authorName
    ? exactName.find((avatar) => isSameAvatarName(avatar.authorName, lookup.authorName))
    : undefined;
  if (authorExact) return { avatar: authorExact, verified: true };
  if (!lookup.authorName && exactName.length === 1) return { avatar: exactName[0], verified: true };
  if (exactName.length > 0) return { avatar: exactName[0], verified: false };

  const sameAuthor = lookup.authorName
    ? trusted.filter((avatar) => isSameAvatarName(avatar.authorName, lookup.authorName))
    : [];
  const sameAuthorFuzzyName = sameAuthor.find((avatar) => isFuzzyAvatarNameMatch(avatar.name, lookup.displayName));
  if (sameAuthorFuzzyName) return { avatar: sameAuthorFuzzyName, verified: false };
  if (sameAuthor.length > 0) return { avatar: sameAuthor[0], verified: false };

  const fuzzyName = trusted.find((avatar) => isFuzzyAvatarNameMatch(avatar.name, lookup.displayName));
  if (fuzzyName) return { avatar: fuzzyName, verified: false };
  return { avatar: trusted[0], verified: false };
}

function readWearerReferenceCache(): Record<string, WearerReference> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(WEARER_REFERENCE_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, WearerReference> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!key || !value || typeof value !== "object") continue;
      const item = value as Partial<WearerReference>;
      if (item.status !== "resolved" && item.status !== "miss") continue;
      out[key] = {
        status: item.status,
        userId: typeof item.userId === "string" ? item.userId : undefined,
        displayName: typeof item.displayName === "string" ? item.displayName : undefined,
        avatarId: typeof item.avatarId === "string" ? item.avatarId : undefined,
        url: typeof item.url === "string" ? item.url : undefined,
        avatarName: typeof item.avatarName === "string" ? item.avatarName : undefined,
        verifiedForAvatarName: typeof item.verifiedForAvatarName === "string" ? item.verifiedForAvatarName : undefined,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writeWearerReferenceCache(cache: Record<string, WearerReference>): void {
  if (typeof window === "undefined") return;
  try {
    const entries = Object.entries(cache).filter(([, item]) => item.status === "resolved" && item.url);
    window.localStorage.setItem(WEARER_REFERENCE_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Ignore quota errors; the UI can still use the in-memory cache.
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
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
  isReference,
  placeholder = "cube",
  isFavorited,
  onToggleFavorite,
}: {
  avatarId: string;
  fallbackUrl?: string;
  isReference?: boolean;
  placeholder?: "cube" | "image";
  isFavorited: boolean;
  onToggleFavorite?: (thumbnailUrl: string | null) => void;
}) {
  const { url } = useThumbnail(avatarId);
  const resolvedUrl = url || fallbackUrl || null;
  return (
    <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
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
        <Avatar3DPreview seed={avatarId} size={20} />
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
      {resolvedUrl && isReference ? (
        <span
          className="absolute left-0.5 top-0.5 size-1.5 rounded-full bg-amber-400 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
          title="参考图"
        >
          <span className="sr-only">参考图</span>
        </span>
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
  const style: CSSProperties & { "--half": string } = {
    width: size,
    height: size,
    "--half": `${half}px`,
  };
  const face = (index: number): CSSProperties => ({
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

function WearerProfileFallbackCard({
  wearerUserId,
  wearerName,
  avatarName,
  thumbnailStatus,
  onResolvedReference,
}: {
  wearerUserId?: string | null;
  wearerName?: string | null;
  avatarName?: string | null;
  thumbnailStatus?: AugmentedAvatar["thumbnail_status"] | AugmentedAvatar["reference_status"];
  onResolvedReference?: (reference: WearerReference) => void;
}) {
  const { t } = useTranslation();
  const { status: authStatus } = useAuth();
  const [open, setOpen] = useState(false);
  const reportedReferenceKey = useRef<string | null>(null);
  const directUserId = wearerUserId?.startsWith("usr_") ? wearerUserId : null;
  const query = wearerName?.trim() ?? "";
  const shouldSearchByName = authStatus.authed && !directUserId && query.length > 0;

  const { data: searchData, isLoading: searchLoading } = useIpcQuery<
    { query: string; count: number; offset: number },
    { users: UserSearchResult[] }
  >(
    "user.search",
    { query, count: 8, offset: 0 },
    {
      enabled: shouldSearchByName,
      staleTime: 10 * 60_000,
      gcTime: 30 * 60_000,
      retry: false,
    },
  );

  const searchPick = useMemo(
    () => pickUserSearchCandidate(searchData?.users ?? [], wearerName),
    [searchData?.users, wearerName],
  );
  const profileUserId = directUserId ?? searchPick?.user.id ?? null;

  const { data: profileData, isLoading: profileLoading } = useIpcQuery<
    { userId: string },
    WearerProfileResponse
  >(
    "user.getProfile",
    { userId: profileUserId ?? "" },
    {
      enabled: authStatus.authed && !!profileUserId,
      staleTime: 10 * 60_000,
      gcTime: 30 * 60_000,
      retry: false,
    },
  );

  const profile = profileData?.profile ?? null;
  const fallbackUser = profile ?? searchPick?.user ?? null;
  const imageUrl = trustedProfileImage(fallbackUser);
  const name = profile?.displayName ?? searchPick?.user.displayName ?? wearerName ?? t("common.unknown", { defaultValue: "Unknown" });
  const loading = thumbnailStatus === "loading" || searchLoading || profileLoading;
  const matchLabel = searchPick && !directUserId
    ? searchPick.exact && !searchPick.ambiguous
      ? t("avatars.profileFallbackNameMatch", { defaultValue: "Name match" })
      : t("avatars.profileFallbackAmbiguous", { defaultValue: "Name guess" })
    : t("avatars.profileFallbackKnownUser", { defaultValue: "Wearer profile" });

  useEffect(() => {
    if (!imageUrl || !onResolvedReference) return;
    const currentAvatarName = profile?.currentAvatarName || undefined;
    const currentAvatarId = profile?.currentAvatarId?.startsWith("avtr_")
      ? profile.currentAvatarId
      : undefined;
    const verifiedForAvatarName =
      currentAvatarName && isSameAvatarName(currentAvatarName, avatarName)
        ? avatarName ?? undefined
        : undefined;
    const key = [
      profileUserId ?? query,
      imageUrl,
      currentAvatarId ?? "",
      currentAvatarName ?? "",
      verifiedForAvatarName ?? "",
    ].join("|");
    if (reportedReferenceKey.current === key) return;
    reportedReferenceKey.current = key;
    onResolvedReference({
      status: "resolved",
      userId: profileUserId?.startsWith("usr_") ? profileUserId : undefined,
      displayName: name,
      avatarId: currentAvatarId,
      url: imageUrl,
      avatarName: currentAvatarName,
      verifiedForAvatarName,
    });
  }, [
    avatarName,
    imageUrl,
    onResolvedReference,
    profile?.currentAvatarId,
    profile?.currentAvatarName,
    profileUserId,
    query,
  ]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative flex h-full w-full flex-col justify-end overflow-hidden bg-[hsl(var(--canvas))] text-left"
      >
        {imageUrl ? (
          <ThumbImage
            src={imageUrl}
            seedKey={profileUserId ?? query}
            label={name}
            alt=""
            className="absolute inset-0 h-full w-full border-0"
            aspect=""
            rounded=""
            priority="eager"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[hsl(var(--canvas))]">
            {loading ? (
              <Loader2 className="size-9 animate-spin text-[hsl(var(--muted-foreground))]" />
            ) : (
              <User className="size-12 text-[hsl(var(--muted-foreground))]" />
            )}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <div className="relative z-10 flex w-full flex-col gap-1 p-3 text-white">
          <div className="w-fit rounded bg-black/55 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">
            {matchLabel}
          </div>
          <div className="truncate text-[14px] font-bold drop-shadow-sm">
            {name}
          </div>
          <div className="line-clamp-2 text-[10.5px] leading-snug text-white/75">
            {imageUrl
              ? t("avatars.profileFallbackNote", {
                  name: avatarName ?? t("common.unknown", { defaultValue: "Unknown" }),
                  defaultValue: "No verified avatar thumbnail. Showing this wearer's current profile image as a reference for {{name}}.",
                })
              : t("avatars.thumbnailMiss", { defaultValue: "No verified thumbnail match" })}
          </div>
        </div>
      </button>

      <DialogContent className="max-w-[420px] p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">{name}</DialogTitle>
        {profile ? (
          <ProfileCard user={profile} />
        ) : (
          <div className="p-8 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
            {loading
              ? t("common.loading", { defaultValue: "Loading…" })
              : t("avatars.profileFallbackUnavailable", { defaultValue: "Could not load the wearer profile." })}
          </div>
        )}
      </DialogContent>
    </Dialog>
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
  onWearerReferenceResolved,
}: {
  selected: AugmentedAvatar;
  onCanonicalName?: (avatarId: string, name: string) => void;
  onWearerReferenceResolved?: (avatarId: string, reference: WearerReference) => void;
}) {
  const { t } = useTranslation();
  const { status: authStatus } = useAuth();
  const [preview3DFor, setPreview3DFor] = useState<string | null>(null);
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
  const isEncounterLog = selected.source === "encounter-log";
  const referenceUrl = !fallbackUrl && isEncounterLog ? selected.reference_thumbnail_url : undefined;
  const previewUrl = fallbackUrl || referenceUrl;
  const wearerReferenceUrl = isEncounterLog && !referenceUrl ? selected.wearer_reference_url : undefined;
  const wearerProfileUserId =
    selected.wearer_reference_user_id ??
    (selected.wearer_user_id?.startsWith("usr_") ? selected.wearer_user_id : undefined);
  const wearerProfileDisplayName =
    selected.wearer_reference_display_name ??
    selected.wearer_name ??
    t("common.unknown", { defaultValue: "Unknown" });
  const previewSize = isEncounterLog ? 200 : 220;
  const can3D = !isEncounterLog && Boolean(windowsAssetUrl);
  const show3D = can3D && preview3DFor === selected.avatar_id;

  useEffect(() => {
    setPreview3DFor(null);
  }, [selected.avatar_id]);

  return (
    <Card elevation="flat" className="flex flex-col overflow-hidden p-0">
      <div className="unity-panel-header">
        {t("avatars.inspectorPaneTitle")}
      </div>
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          {(() => {
            if (show3D) {
              return (
                <div className="relative" style={{ width: previewSize }}>
                  <Suspense
                    fallback={
                      <div className="flex items-center justify-center rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] text-[11px] text-[hsl(var(--muted-foreground))]" style={{ width: previewSize, height: previewSize }}>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        {t("common.loading", { defaultValue: "Loading…" })}
                      </div>
                    }
                  >
                    <AvatarPreview3D
                      avatarId={selected.avatar_id}
                      assetUrl={windowsAssetUrl}
                      bundlePath={selected.path || undefined}
                      fallbackImageUrl={previewUrl}
                      size={previewSize}
                      expandedSize={720}
                    />
                  </Suspense>
                  <button
                    type="button"
                    className="absolute bottom-1.5 right-1.5 z-10 flex items-center gap-0.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-white/90 backdrop-blur-sm hover:bg-black/80 transition-colors"
                    onClick={() => setPreview3DFor(null)}
                  >
                    <Eye className="size-2.5" />
                    2D
                  </button>
                </div>
              );
            }
            return (
              <div className="relative overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))]" style={{ width: previewSize, height: previewSize }}>
                {previewUrl ? (
                  <>
                    <ImageZoom src={previewUrl} className="h-full w-full" imgClassName="h-full w-full object-cover" />
                    {referenceUrl ? (
                      <div className="absolute left-2 top-2 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-bold text-white/90 backdrop-blur-sm">
                        {t("avatars.referenceImageBadge", { defaultValue: "Reference image" })}
                      </div>
                    ) : null}
                  </>
                ) : isEncounterLog && (selected.wearer_user_id?.startsWith("usr_") || selected.wearer_name) ? (
                  <WearerProfileFallbackCard
                    wearerUserId={selected.wearer_user_id}
                    wearerName={selected.wearer_name}
                    avatarName={displayName}
                    thumbnailStatus={selected.thumbnail_status ?? selected.reference_status}
                    onResolvedReference={(reference) => onWearerReferenceResolved?.(selected.avatar_id, reference)}
                  />
                ) : isEncounterLog ? (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[hsl(var(--canvas))] text-[11px] text-[hsl(var(--muted-foreground))]">
                    <User className="size-12 opacity-60" />
                    <span>
                      {selected.thumbnail_status === "loading"
                        ? t("avatars.thumbnailResolving", { defaultValue: "Resolving thumbnail…" })
                        : selected.reference_status === "loading"
                          ? t("avatars.referenceImageLoading", { defaultValue: "Loading wearer reference image…" })
                          : selected.thumbnail_status === "miss" || selected.reference_status === "miss"
                            ? t("avatars.thumbnailMiss", { defaultValue: "No verified thumbnail match" })
                            : t("avatars.noThumbnail", { defaultValue: "No thumbnail" })}
                    </span>
                  </div>
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[hsl(var(--muted))]">
                    <User className="size-12 text-[hsl(var(--muted-foreground))]" />
                  </div>
                )}
                {can3D && previewUrl && (
                  <button
                    type="button"
                    className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-white/90 backdrop-blur-sm hover:bg-black/80 transition-colors"
                    onClick={() => setPreview3DFor(selected.avatar_id)}
                  >
                    <Box className="size-2.5" />
                    3D
                  </button>
                )}
              </div>
            );
          })()}
          {wearerReferenceUrl ? (
            <div className="rounded-[var(--radius-sm)] border border-amber-500/35 bg-amber-500/10 p-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                {t("avatars.wearerCurrentReference", { defaultValue: "Wearer current reference" })}
              </div>
              <ImageZoom
                src={wearerReferenceUrl}
                className="h-24 w-24 overflow-hidden rounded-[var(--radius-sm)] border border-black/10"
                imgClassName="h-full w-full object-cover"
              />
              <div className="mt-1 text-[10px] leading-snug text-[hsl(var(--muted-foreground))]">
                {t("avatars.wearerReferenceNote", {
                  name: selected.wearer_reference_avatar_name ?? t("common.unknown", { defaultValue: "Unknown" }),
                  defaultValue: "Current public avatar/profile image: {{name}}. It is not used as this row's thumbnail unless the avatar name matches the log.",
                })}
              </div>
            </div>
          ) : null}
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
            {details?.authorId || selected.author_user_id || (selected.user_id && selected.user_id.startsWith("usr_")) ? (
              <div className="flex gap-2 min-w-0">
                 <UserPopupBadge
                   userId={(details?.authorId ?? selected.author_user_id ?? selected.user_id) as string}
                   displayName={authorName}
                 />
              </div>
            ) : null}
            {isEncounterLog && selected.wearer_name ? (
              <div className="flex flex-col gap-1 text-[10.5px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[hsl(var(--muted-foreground))]">
                    {t("avatars.wornBy", { defaultValue: "worn by" })}:{" "}
                  </span>
                  {wearerProfileUserId ? (
                    <UserPopupBadge
                      userId={wearerProfileUserId}
                      displayName={wearerProfileDisplayName}
                    />
                  ) : (
                    <span className="font-medium text-[hsl(var(--foreground))]">
                      {wearerProfileDisplayName}
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
                    "This row is indexed from local VRChat logs. VRChat logs expose avatar name and wearer, but not avtr_* or the official thumbnail URL. VRCSM shows a thumbnail only when it can verify an exact public avatar match or the wearer's current profile still matches this logged avatar name.",
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
  const wearerUserId =
    item.wearer_reference_user_id ??
    (item.wearer_user_id?.startsWith("usr_") ? item.wearer_user_id : undefined);
  const wearerDisplayName =
    item.wearer_reference_display_name ?? item.wearer_name ?? t("common.unknown", { defaultValue: "Unknown" });
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
        fallbackUrl={item.resolved_thumbnail_url ?? item.reference_thumbnail_url ?? item.wearer_reference_url}
        isReference={!item.resolved_thumbnail_url && Boolean(item.reference_thumbnail_url ?? item.wearer_reference_url)}
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
          ) : null}
          {item.source === "encounter-log" && !item.resolved_thumbnail_url && (item.reference_thumbnail_url || item.wearer_reference_url) ? (
            <span className="shrink-0 rounded-[var(--radius-sm)] border border-amber-500/40 bg-amber-500/12 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-600">
              {t("avatars.referenceImageBadgeShort", { defaultValue: "Reference" })}
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
              {wearerUserId ? (
                <UserPopupBadge userId={wearerUserId} displayName={wearerDisplayName} compact />
              ) : (
                <span className="truncate text-[hsl(var(--foreground))]">
                  {wearerDisplayName}
                </span>
              )}
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
  const { status: authStatus } = useAuth();
  const [filter, setFilter] = useState("");
  const [listFilter, setListFilter] = useState<AvatarListFilter>(
    () => (localStorage.getItem(AVATAR_LIST_FILTER_KEY) as AvatarListFilter | null) ?? "local",
  );
  const [seenPage, setSeenPage] = useState(1);
  const [resolvedThumbs, setResolvedThumbs] = useState<Record<string, {
    avatarId?: string;
    authorId?: string;
    url?: string;
    verified?: boolean;
    status: "loading" | "resolved" | "miss";
  }>>({});
  const [wearerReferences, setWearerReferences] = useState<Record<string, WearerReference>>(
    () => readWearerReferenceCache(),
  );
  const resolvedThumbsRef = useRef(resolvedThumbs);
  const wearerReferencesRef = useRef<Record<string, WearerReference>>({});
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
  const registerWearerReference = useCallback((avatarId: string, reference: WearerReference) => {
    if (!avatarId) return;
    setWearerReferences((prev) => {
      const current = prev[avatarId];
      if (
        current?.status === reference.status &&
        current?.userId === reference.userId &&
        current?.displayName === reference.displayName &&
        current?.url === reference.url &&
        current?.avatarId === reference.avatarId &&
        current?.avatarName === reference.avatarName &&
        current?.verifiedForAvatarName === reference.verifiedForAvatarName
      ) {
        return prev;
      }
      const next = { ...prev, [avatarId]: reference };
      wearerReferencesRef.current = next;
      return next;
    });
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
      const id = stableSeenAvatarId(name, ev.author_name);
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
      const legacyDb = item.display_name ? avatarHistoryById.get(stableSeenAvatarId(item.display_name)) : undefined;
      const db = avatarHistoryById.get(item.avatar_id) ?? legacyDb;
      if (!db) return item;
      const unsafeLegacyProfileMatch =
        db.avatar_id !== item.avatar_id &&
        (db.resolution_source === "wearer_profile" || db.resolution_source === "wearer_profile_verified") &&
        !db.resolved_avatar_id;
      const trustedDbThumbnail = unsafeLegacyProfileMatch
        ? undefined
        : trustedVrchatImageUrl(db.resolved_thumbnail_url) ?? trustedVrchatImageUrl(db.resolved_image_url);
      const trustedResolvedAvatarId =
        !unsafeLegacyProfileMatch && db.resolved_avatar_id?.startsWith("avtr_")
          ? db.resolved_avatar_id
          : undefined;
      const trustedDbStatus =
        unsafeLegacyProfileMatch
          ? item.thumbnail_status
          : db.resolution_status === "resolved"
            ? trustedDbThumbnail
              ? "resolved"
              : item.thumbnail_status
            : db.resolution_status === "miss"
              ? "miss"
              : item.thumbnail_status;
      return {
        ...item,
        author: item.author ?? db.author_name ?? undefined,
        wearer_user_id: item.wearer_user_id ?? db.first_seen_user_id ?? undefined,
        resolved_avatar_id: trustedResolvedAvatarId,
        resolved_thumbnail_url: trustedDbThumbnail,
        resolution_source: db.resolution_source,
        thumbnail_status: trustedDbStatus,
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

  useEffect(() => {
    resolvedThumbsRef.current = resolvedThumbs;
  }, [resolvedThumbs]);

  useEffect(() => {
    wearerReferencesRef.current = wearerReferences;
    writeWearerReferenceCache(wearerReferences);
  }, [wearerReferences]);

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

  const displayRows = useMemo<AugmentedAvatar[]>(
    () =>
      pagedFiltered.map((item) => {
        if (item.source !== "encounter-log" || !item.display_name) return item;
        const hit = resolvedThumbs[item.avatar_id];
        const ref = wearerReferences[item.avatar_id];
        if (!hit && !ref) return item;
        const hitUrl = trustedVrchatImageUrl(hit?.url);
        const verifiedHitUrl = hitUrl && hit?.verified !== false ? hitUrl : undefined;
        const referenceHitUrl = hitUrl && hit?.verified === false ? hitUrl : undefined;
        const trustedReferenceUrl = trustedVrchatImageUrl(ref?.url);
        const verifiedReferenceUrl =
          trustedReferenceUrl && ref?.verifiedForAvatarName && isSameAvatarName(ref.verifiedForAvatarName, item.display_name)
            ? trustedReferenceUrl
            : undefined;
        const unverifiedReferenceUrl =
          !verifiedReferenceUrl && trustedReferenceUrl && ref?.status === "resolved"
            ? trustedReferenceUrl
            : undefined;
        const referenceFallbackUrl = verifiedReferenceUrl ?? unverifiedReferenceUrl;
        const hasPrimaryThumbnail = Boolean(verifiedHitUrl ?? item.resolved_thumbnail_url);
        return {
          ...item,
          resolved_avatar_id: (verifiedHitUrl ? hit?.avatarId : undefined) ?? (verifiedReferenceUrl ? ref?.avatarId : undefined) ?? item.resolved_avatar_id,
          resolved_thumbnail_url: verifiedHitUrl ?? item.resolved_thumbnail_url,
          author_user_id: hit?.authorId?.startsWith("usr_") ? hit.authorId : item.author_user_id,
          thumbnail_status: hit?.status ?? item.thumbnail_status,
          reference_thumbnail_url: !hasPrimaryThumbnail ? referenceHitUrl ?? referenceFallbackUrl : undefined,
          reference_source: referenceHitUrl
            ? "public_search_name_unique_reference"
            : verifiedReferenceUrl
            ? "wearer_current_profile_verified"
            : referenceFallbackUrl
              ? "wearer_current_profile"
              : undefined,
          reference_status: !hasPrimaryThumbnail ? ref?.status : undefined,
          wearer_reference_url: unverifiedReferenceUrl,
          wearer_reference_user_id: ref?.userId?.startsWith("usr_") ? ref.userId : undefined,
          wearer_reference_display_name: ref?.displayName,
          wearer_reference_avatar_name: ref?.avatarName,
          wearer_reference_status: ref?.status,
        };
      }),
    [resolvedThumbs, wearerReferences, pagedFiltered],
  );

  useEffect(() => {
    const lookupIds = displayRows
      .slice(0, 80)
      .map((it) => it.resolved_avatar_id || it.avatar_id)
      .filter((id) => id.startsWith("avtr_"));
    if (lookupIds.length > 0) {
      prefetchThumbnails([...new Set(lookupIds)]);
    }
  }, [displayRows]);

  useEffect(() => {
    if (!authStatus.authed || listFilter !== "encounters") return;
    const targets = displayRows
      .filter((item) => {
        if (item.source !== "encounter-log") return false;
        if (item.resolved_thumbnail_url || item.reference_thumbnail_url || item.wearer_reference_url) return false;
        if (!item.wearer_user_id?.startsWith("usr_") && !item.wearer_name?.trim()) return false;
        const existing = wearerReferencesRef.current[item.avatar_id];
        return existing?.status !== "resolved" && existing?.status !== "loading" && existing?.status !== "miss";
      })
      .slice(0, WEARER_REFERENCE_LOOKAHEAD);
    if (targets.length === 0) return;

    let cancelled = false;
    setWearerReferences((prev) => {
      let next = prev;
      for (const item of targets) {
        const current = next[item.avatar_id];
        if (current?.status === "resolved" || current?.status === "loading" || current?.status === "miss") continue;
        next = { ...next, [item.avatar_id]: { status: "loading" as const } };
      }
      if (next !== prev) {
        wearerReferencesRef.current = next;
      }
      return next;
    });

    async function resolveVisibleWearerReferences() {
      for (const item of targets) {
        if (cancelled) return;
        try {
          if (item.wearer_user_id?.startsWith("usr_")) {
            const res = await withTimeout(
              vrcApiThrottle(() =>
                ipc.call<{ userId: string }, WearerProfileResponse>("user.getProfile", {
                  userId: item.wearer_user_id as string,
                }),
              ),
              WEARER_REFERENCE_TIMEOUT_MS,
            );
            if (cancelled) return;
            const profile = res.profile;
            const url = trustedProfileImage(profile);
            const currentAvatarName = profile?.currentAvatarName || undefined;
            const currentAvatarId = profile?.currentAvatarId?.startsWith("avtr_")
              ? profile.currentAvatarId
              : undefined;
            registerWearerReference(
              item.avatar_id,
              url
                ? {
                    status: "resolved",
                    userId: item.wearer_user_id,
                    displayName: profile?.displayName ?? item.wearer_name,
                    avatarId: currentAvatarId,
                    url,
                    avatarName: currentAvatarName,
                    verifiedForAvatarName: isSameAvatarName(currentAvatarName, item.display_name)
                      ? item.display_name ?? undefined
                      : undefined,
                  }
                : { status: "miss" },
            );
            continue;
          }

          const wearerName = item.wearer_name?.trim();
          if (!wearerName) {
            registerWearerReference(item.avatar_id, { status: "miss" });
            continue;
          }
          const res = await withTimeout(
            vrcApiThrottle(() => ipc.searchUsers(wearerName, 8)),
            WEARER_REFERENCE_TIMEOUT_MS,
          );
          if (cancelled) return;
          const picked = pickUserSearchCandidate(res.users ?? [], wearerName);
          const url = picked?.exact && !picked.ambiguous ? trustedProfileImage(picked.user) : undefined;
          registerWearerReference(
            item.avatar_id,
            url
              ? {
                  status: "resolved",
                  userId: picked?.user.id,
                  displayName: picked?.user.displayName,
                  url,
                  avatarName: picked?.user.displayName,
                }
              : { status: "miss" },
          );
        } catch {
          if (cancelled) return;
          registerWearerReference(item.avatar_id, { status: "miss" });
        }
      }
    }

    void resolveVisibleWearerReferences();

    return () => {
      cancelled = true;
    };
  }, [authStatus.authed, displayRows, listFilter, registerWearerReference]);

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
  const selectedEncounterLookup = useMemo(
    () =>
      selected?.source === "encounter-log"
        ? {
            avatarId: selected.avatar_id,
            displayName: selected.display_name,
            authorName: selected.author,
            wearerUserId: selected.wearer_user_id,
            resolvedThumbnailUrl: selected.resolved_thumbnail_url,
            thumbnailStatus: selected.thumbnail_status,
          }
        : null,
    [
      selected?.source,
      selected?.avatar_id,
      selected?.display_name,
      selected?.author,
      selected?.wearer_user_id,
      selected?.resolved_thumbnail_url,
      selected?.thumbnail_status,
    ],
  );

  useEffect(() => {
    if (!authStatus.authed) return;
    const lookup = selectedEncounterLookup;
    if (!lookup?.displayName || lookup.resolvedThumbnailUrl) return;
    if (lookup.thumbnailStatus === "resolved") return;
    const existing = resolvedThumbsRef.current[lookup.avatarId];
    if (existing?.status === "resolved" || existing?.status === "loading" || existing?.status === "miss") return;

    const request: NonNullable<typeof selectedEncounterLookup> = lookup;
    let cancelled = false;

    async function resolveByPublicSearch() {
      try {
        setResolvedThumbs((prev) => ({
          ...prev,
          [request.avatarId]: { status: "loading" },
        }));
        const searchQueries = [request.displayName ?? ""];
        if (request.authorName) {
          searchQueries.push(`${request.displayName ?? ""} ${request.authorName}`, request.authorName);
        }
        const uniqueQueries = [...new Set(searchQueries.map((query) => query.trim()).filter(Boolean))];
        let picked: { avatar: AvatarSearchResult; verified: boolean } | null = null;
        for (const query of uniqueQueries) {
          const res = await withTimeout(
            vrcApiThrottle(() => ipc.searchAvatars(query, 40)),
            AVATAR_PUBLIC_SEARCH_TIMEOUT_MS,
          );
          if (cancelled) return;
          const candidate = pickAvatarSearchCandidate(res.avatars ?? [], request);
          if (!candidate) continue;
          picked = candidate;
          if (candidate.verified) break;
        }
        if (cancelled) return;
        const match = picked?.avatar;
        const verified = Boolean(picked?.verified);
        const thumbUrl = trustedVrchatImageUrl(match?.thumbnailImageUrl);
        const imageUrl = trustedVrchatImageUrl(match?.imageUrl);
        const url = thumbUrl || imageUrl;
        if (match?.id?.startsWith("avtr_") && url) {
          setResolvedThumbs((prev) => ({
            ...prev,
            [request.avatarId]: {
              status: "resolved",
              avatarId: match.id,
              authorId: match.authorId?.startsWith("usr_") ? match.authorId : undefined,
              url,
              verified,
            },
          }));
          if (verified) {
            await ipc.dbAvatarHistoryResolve({
              avatar_id: request.avatarId,
              resolved_avatar_id: match.id,
              resolved_thumbnail_url: thumbUrl || url,
              resolved_image_url: imageUrl || url,
              resolution_source: request.authorName ? "public_search_exact" : "public_search_name_unique",
              resolution_status: "resolved",
            }).catch(() => {});
          }
          prefetchThumbnails([match.id]);
          return;
        }
        setResolvedThumbs((prev) => ({
          ...prev,
          [request.avatarId]: { status: "miss" },
        }));
      } catch {
        if (cancelled) return;
        setResolvedThumbs((prev) => ({
          ...prev,
          [request.avatarId]: { status: "miss" },
        }));
      }
    }

    void resolveByPublicSearch();

    return () => {
      cancelled = true;
    };
  }, [
    authStatus.authed,
    selectedEncounterLookup?.avatarId,
    selectedEncounterLookup?.displayName,
    selectedEncounterLookup?.authorName,
    selectedEncounterLookup?.resolvedThumbnailUrl,
    selectedEncounterLookup?.thumbnailStatus,
  ]);

  useEffect(() => {
    if (!selectedEncounterLookup) return;
    const lookup = selectedEncounterLookup;
    if (!lookup.wearerUserId?.startsWith("usr_")) return;
    const existing = wearerReferencesRef.current[lookup.avatarId];
    if (existing?.status === "resolved" || existing?.status === "miss") return;

    let cancelled = false;
    setWearerReferences((prev) => {
      const current = prev[lookup.avatarId];
      if (current?.status === "resolved" || current?.status === "miss") return prev;
      const next = { ...prev, [lookup.avatarId]: { status: "loading" as const } };
      wearerReferencesRef.current = next;
      return next;
    });

    async function resolveSelectedWearerReference() {
      const userId = lookup.wearerUserId;
      if (!userId) return;
      try {
        const res = await withTimeout(
          ipc.call<{ userId: string }, WearerProfileResponse>("user.getProfile", { userId }),
          WEARER_REFERENCE_TIMEOUT_MS,
        );
        if (cancelled) return;
        const profile = res.profile;
        const thumbUrl = trustedVrchatImageUrl(profile?.currentAvatarThumbnailImageUrl);
        const imageUrl = trustedVrchatImageUrl(profile?.currentAvatarImageUrl);
        const url = thumbUrl || imageUrl;
        const avatarName = profile?.currentAvatarName || undefined;
        const avatarId = profile?.currentAvatarId?.startsWith("avtr_")
          ? profile.currentAvatarId
          : undefined;
        const verifiedForAvatarName =
          url && isSameAvatarName(avatarName, lookup.displayName)
            ? lookup.displayName
            : undefined;
        setWearerReferences((prev) => ({
          ...prev,
          [lookup.avatarId]: url
            ? {
                status: "resolved",
                userId,
                displayName: profile?.displayName ?? lookup.displayName,
                avatarId,
                url,
                avatarName,
                verifiedForAvatarName,
              }
            : { status: "miss" },
        }));
        if (verifiedForAvatarName) {
          await ipc.dbAvatarHistoryResolve({
            avatar_id: lookup.avatarId,
            resolved_avatar_id: avatarId ?? null,
            resolved_thumbnail_url: thumbUrl || url,
            resolved_image_url: imageUrl || url,
            resolution_source: "wearer_profile_verified",
            resolution_status: "resolved",
          }).catch(() => {});
          if (avatarId) {
            prefetchThumbnails([avatarId]);
          }
        }
      } catch {
        if (cancelled) return;
        setWearerReferences((prev) => ({
          ...prev,
          [lookup.avatarId]: { status: "miss" },
        }));
      }
    }

    void resolveSelectedWearerReference();

    return () => {
      cancelled = true;
    };
  }, [
    selectedEncounterLookup?.avatarId,
    selectedEncounterLookup?.displayName,
    selectedEncounterLookup?.wearerUserId,
  ]);

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
              {listFilter === "encounters" ? (
                <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-2 py-1.5 text-[10.5px] leading-snug text-[hsl(var(--muted-foreground))]">
                  {t("avatars.seenThumbnailHow", {
                    defaultValue:
                      "Seen-avatar thumbnails appear when the log has a real avtr_* id, when public search finds one exact name/author match, or when the wearer's current public avatar still matches the logged name. Otherwise VRCSM keeps it blank instead of guessing.",
                  })}
                </div>
              ) : null}
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
              <AvatarInspector
                selected={selected}
                onCanonicalName={registerCanonicalName}
                onWearerReferenceResolved={registerWearerReference}
              />
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
