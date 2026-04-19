/**
 * Friends tab — joinable friends list and favorite friends.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Heart, Play, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useIpcQuery } from "@/hooks/useIpcQuery";
import { useAuth } from "@/lib/auth-context";
import {
  LIBRARY_LIST_NAME,
  normalizeFavoriteType,
  useFavoriteActions,
  useFavoriteItems,
} from "@/lib/library";
import type { Friend, FriendsListResult } from "@/lib/types";
import {
  parseLocation,
  trustRank,
  trustColorClass,
  instanceTypeLabel,
  regionLabel,
} from "@/lib/vrcFriends";
import { shortenId, openLaunchUrl } from "./workspace-utils";
import { SectionTitle } from "./WorkspaceCards";

// ── Constants ────────────────────────────────────────────────────────────

const MAX_DISPLAY = 12;

// ── World name resolver ─────────────────────────────────────────────────

function useWorldName(worldId: string | undefined) {
  const { data } = useIpcQuery<
    { id: string },
    { details: { name: string } | null }
  >("world.details", { id: worldId ?? "" }, {
    enabled: !!worldId,
    staleTime: 300_000,
  });
  return data?.details?.name ?? null;
}

// ── Trust dot ────────────────────────────────────────────────────────────

function trustDotStyle(rank: ReturnType<typeof trustRank>): React.CSSProperties {
  const colors: Record<string, string> = {
    troll: "#EF4444",
    veteran: "#FFD000",
    trusted: "#8143E6",
    known: "#FF7B42",
    user: "#2BCF5C",
    new: "#1778FF",
    visitor: "#888888",
  };
  return { backgroundColor: colors[rank] ?? "#888888" };
}

// ── Instance badge color ─────────────────────────────────────────────────

function instanceBadgeVariant(
  instanceType: string | undefined,
): "success" | "secondary" | "warning" | "muted" {
  switch (instanceType) {
    case "public":
      return "success";
    case "friends+":
    case "friends":
      return "secondary";
    case "invite+":
    case "invite":
      return "warning";
    default:
      return "muted";
  }
}

// ── Friend row ───────────────────────────────────────────────────────────

function JoinFriendRow({ friend }: { friend: Friend }) {
  const { t } = useTranslation();
  const loc = parseLocation(friend.location);
  const rank = trustRank(friend.tags);
  const worldName = useWorldName(loc.worldId);

  const thumb =
    friend.profilePicOverride ||
    friend.currentAvatarThumbnailImageUrl;

  const worldLabel = worldName ?? (loc.worldId ? shortenId(loc.worldId) : null);

  const typeLabel = instanceTypeLabel(loc.instanceType);
  const region = regionLabel(loc.region);

  const handleJoin = async () => {
    if (!friend.location || !loc.worldId) return;
    try {
      await openLaunchUrl(`vrchat://launch?id=${friend.location}`);
    } catch (err) {
      toast.error(
        t("vrchatWorkspace.joinFailed", {
          defaultValue: "Failed to launch: {{error}}",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  };

  // Favorite toggle
  const { items: libItems } = useFavoriteItems(LIBRARY_LIST_NAME);
  const isFav = useMemo(
    () => libItems.some((item) => item.target_id === friend.id),
    [libItems, friend.id],
  );
  const { toggleFavorite, pending: favPending } =
    useFavoriteActions(LIBRARY_LIST_NAME);

  const handleToggleFav = async () => {
    try {
      await toggleFavorite(
        {
          type: "user",
          target_id: friend.id,
          display_name: friend.displayName,
          thumbnail_url: thumb,
        },
        isFav,
      );
    } catch (err) {
      toast.error(String(err));
    }
  };

  return (
    <div className="flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 transition-colors hover:bg-[hsl(var(--primary)/0.06)]">
      {/* Avatar */}
      <div className="relative shrink-0">
        <div className="flex size-8 items-center justify-center overflow-hidden rounded-full bg-[hsl(var(--canvas))]">
          {thumb ? (
            <img
              src={thumb}
              alt=""
              loading="lazy"
              decoding="async"
              className="size-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <Users className="size-4 text-[hsl(var(--muted-foreground))]" />
          )}
        </div>
        <span
          className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[hsl(var(--surface))]"
          style={trustDotStyle(rank)}
          title={rank}
        />
      </div>

      {/* Name + world */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={`truncate text-[12px] font-medium ${trustColorClass(rank)}`}
          >
            {friend.displayName}
          </span>
        </div>
        {worldLabel && (
          <div className="truncate text-[10px] text-[hsl(var(--muted-foreground))]">
            {worldLabel}
          </div>
        )}
      </div>

      {/* Instance type + region */}
      <div className="hidden shrink-0 items-center gap-1 sm:flex">
        {typeLabel && (
          <Badge
            variant={instanceBadgeVariant(loc.instanceType)}
            className="h-4 px-1.5 text-[9px]"
          >
            {typeLabel}
          </Badge>
        )}
        {region && (
          <Badge variant="muted" className="h-4 px-1.5 text-[9px]">
            {region}
          </Badge>
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title={t("vrchatWorkspace.joinFriend", { defaultValue: "Join" })}
          onClick={handleJoin}
        >
          <Play className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          disabled
          title={t("vrchatWorkspace.requestInvite", {
            defaultValue: "Request invite",
          })}
        >
          <Users className="size-3 opacity-40" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={`size-6 ${isFav ? "text-red-400" : ""}`}
          disabled={favPending}
          title={
            isFav
              ? t("library.unfavorite", { defaultValue: "Unfavorite" })
              : t("library.favorite", { defaultValue: "Favorite" })
          }
          onClick={handleToggleFav}
        >
          <Heart
            className="size-3"
            fill={isFav ? "currentColor" : "none"}
          />
        </Button>
      </div>
    </div>
  );
}

// ── Favorite friend row ──────────────────────────────────────────────────

function FavoriteFriendRow({
  friend,
  isOnline,
}: {
  friend: Friend;
  isOnline: boolean;
}) {
  const rank = trustRank(friend.tags);
  const thumb =
    friend.profilePicOverride ||
    friend.currentAvatarThumbnailImageUrl;

  return (
    <div className="flex items-center gap-2.5 px-2.5 py-1.5">
      <div className="relative shrink-0">
        <div className="flex size-7 items-center justify-center overflow-hidden rounded-full bg-[hsl(var(--canvas))]">
          {thumb ? (
            <img
              src={thumb}
              alt=""
              loading="lazy"
              decoding="async"
              className="size-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <Users className="size-3.5 text-[hsl(var(--muted-foreground))]" />
          )}
        </div>
        {/* Online indicator */}
        <span
          className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-[hsl(var(--surface))]"
          style={{
            backgroundColor: isOnline ? "#2BCF5C" : "#666666",
          }}
        />
      </div>
      <span
        className={`min-w-0 truncate text-[11px] font-medium ${trustColorClass(rank)}`}
      >
        {friend.displayName}
      </span>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────

export default function TabFriends() {
  const { t } = useTranslation();
  const { status: authStatus } = useAuth();
  const [showAllJoinable, setShowAllJoinable] = useState(false);

  const { data: friendsData, isLoading } = useIpcQuery<
    undefined,
    FriendsListResult
  >("friends.list", undefined as undefined, {
    enabled: authStatus.authed,
    staleTime: 30_000,
  });

  const friends = friendsData?.friends ?? [];

  // Friends in joinable worlds (have a world location, not offline/private)
  const joinableFriends = useMemo(
    () =>
      friends.filter((f) => {
        if (!f.location) return false;
        const loc = parseLocation(f.location);
        return loc.kind === "world";
      }),
    [friends],
  );

  // Favorited friends — matched from library items
  const { items: libItems } = useFavoriteItems(LIBRARY_LIST_NAME);
  const favoritedUserIds = useMemo(
    () =>
      new Set(
        libItems
          .filter((item) => normalizeFavoriteType(item.type) === "user")
          .map((item) => item.target_id),
      ),
    [libItems],
  );

  const favoriteFriends = useMemo(
    () => friends.filter((f) => favoritedUserIds.has(f.id)),
    [friends, favoritedUserIds],
  );

  const onlineIds = useMemo(
    () =>
      new Set(
        friends
          .filter(
            (f) => f.location && f.location !== "offline",
          )
          .map((f) => f.id),
      ),
    [friends],
  );

  // Limit display
  const displayJoinable = showAllJoinable
    ? joinableFriends
    : joinableFriends.slice(0, MAX_DISPLAY);

  if (!authStatus.authed) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[hsl(var(--muted-foreground))]">
        <Users className="mb-2 size-8 opacity-40" />
        <p className="text-[12px]">
          {t("friends.signInRequired", {
            defaultValue: "Sign in to VRChat",
          })}
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-[hsl(var(--muted-foreground))]">
        <span className="text-[12px]">
          {t("friends.loading", { defaultValue: "Loading friends..." })}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      {/* Join Friends */}
      <Card elevation="flat">
        <CardHeader className="px-4 pb-2 pt-3">
          <CardTitle className="text-[13px]">
            <SectionTitle
              title={t("vrchatWorkspace.joinFriend", {
                defaultValue: "Join Friends",
              })}
              count={joinableFriends.length}
            />
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-3 pt-0">
          {joinableFriends.length === 0 ? (
            <p className="px-3 py-4 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
              {t("vrchatWorkspace.noJoinable", {
                defaultValue:
                  "No joinable friends are currently exposing an instance.",
              })}
            </p>
          ) : (
            <ScrollArea className="max-h-[420px]">
              <div className="flex flex-col gap-0.5">
                {displayJoinable.map((friend) => (
                  <JoinFriendRow key={friend.id} friend={friend} />
                ))}
              </div>
              {joinableFriends.length > MAX_DISPLAY && !showAllJoinable && (
                <button
                  type="button"
                  onClick={() => setShowAllJoinable(true)}
                  className="mt-1 w-full py-1.5 text-center text-[10px] font-medium text-[hsl(var(--primary))] hover:underline"
                >
                  {t("common.showAll", {
                    defaultValue: "Show all ({{count}})",
                    count: joinableFriends.length,
                  })}
                </button>
              )}
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Favorite Friends */}
      {favoriteFriends.length > 0 && (
        <Card elevation="flat">
          <CardHeader className="px-4 pb-2 pt-3">
            <CardTitle className="text-[13px]">
              <SectionTitle
                title={t("library.favorite", {
                  defaultValue: "Favorite Friends",
                })}
                count={favoriteFriends.length}
              />
            </CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-3 pt-0">
            <ScrollArea className="max-h-[260px]">
              <div className="flex flex-col gap-0.5">
                {favoriteFriends.map((friend) => (
                  <FavoriteFriendRow
                    key={friend.id}
                    friend={friend}
                    isOnline={onlineIds.has(friend.id)}
                  />
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
