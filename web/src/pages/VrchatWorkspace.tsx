import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Ban,
  Box,
  Compass,
  Download,
  Globe2,
  Heart,
  LibraryBig,
  Loader2,
  LogIn,
  Orbit,
  Play,
  RefreshCw,
  Shirt,
  Sparkles,
  UserCircle2,
  Users,
  VolumeX,
} from "lucide-react";

import { LoginForm } from "@/components/LoginForm";
import { CollapsibleCard } from "@/components/CollapsibleCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useIpcQuery } from "@/hooks/useIpcQuery";
import { useAuth } from "@/lib/auth-context";
import {
  LIBRARY_LIST_NAME,
  OFFICIAL_FAVORITES_LIST_NAME,
  normalizeFavoriteType,
  useFavoriteActions,
  useFavoriteItems,
} from "@/lib/library";
import { ipc } from "@/lib/ipc";
import { useUiPrefBoolean } from "@/lib/ui-prefs";
import { useReport } from "@/lib/report-context";
import type {
  AuthUserDetailsResult,
  AvatarDetails,
  AvatarHistoryItem,
  AvatarHistoryResult,
  FavoriteItem,
  Friend,
  FriendsListResult,
  VrcSettingEntry,
  VrcSettingsReport,
  WorkspaceGroup,
  WorkspaceGroupsResult,
  WorkspaceModerationItem,
  WorkspaceModerationsResult,
} from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { instanceTypeLabel, parseLocation, relativeTime, trustColorClass, trustLabelKey, trustRank } from "@/lib/vrcFriends";

function statusBadgeVariant(status: string | null): "success" | "secondary" | "warning" | "muted" {
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

function shortenId(id: string, head = 10, tail = 6) {
  if (id.length <= head + tail + 3) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

function openLaunchUrl(url: string) {
  return ipc.call<{ url: string }, { ok: boolean }>("shell.openUrl", { url });
}

function openVrchatUserProfile(userId: string) {
  return openLaunchUrl(`https://vrchat.com/home/user/${userId}`);
}

function moderationLabel(item: WorkspaceModerationItem, t: ReturnType<typeof useTranslation>["t"]) {
  switch ((item.type || "").toLowerCase()) {
    case "block":
      return t("vrchatWorkspace.block", { defaultValue: "Block" });
    case "mute":
      return t("vrchatWorkspace.mute", { defaultValue: "Mute" });
    default:
      return item.type || t("common.unknown", { defaultValue: "Unknown" });
  }
}

function moderationVariant(item: WorkspaceModerationItem): "warning" | "secondary" | "muted" {
  switch ((item.type || "").toLowerCase()) {
    case "block":
      return "warning";
    case "mute":
      return "secondary";
    default:
      return "muted";
  }
}

function WorkspaceActionCard({
  icon: Icon,
  title,
  body,
  onClick,
}: {
  icon: typeof Orbit;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-3 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3 text-left transition-colors hover:border-[hsl(var(--primary)/0.45)] hover:bg-[hsl(var(--primary)/0.08)]"
    >
      <div className="flex size-9 items-center justify-center rounded-[var(--radius-sm)] bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]">
        <Icon className="size-4" />
      </div>
      <div className="space-y-1">
        <div className="text-[13px] font-semibold text-[hsl(var(--foreground))]">{title}</div>
        <div className="text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">{body}</div>
      </div>
    </button>
  );
}

function FavoriteTypeBadge({ item }: { item: FavoriteItem }) {
  const { t } = useTranslation();
  const type = normalizeFavoriteType(item.type);
  return (
    <Badge variant="secondary">
      {t(
        type === "avatar"
          ? "library.types.avatar"
          : type === "world"
            ? "library.types.world"
            : type === "user"
              ? "library.types.user"
              : "library.types.other",
      )}
    </Badge>
  );
}

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalarText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function stringArrayField(record: JsonRecord | null, key: string): string[] {
  const value = record?.[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function findScalarField(record: JsonRecord | null, needles: string[]): { key: string; value: string } | null {
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

function settingValueText(entry: VrcSettingEntry | null): string | null {
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

function detectRuntimeSummary(report: ReturnType<typeof useReport>["report"]) {
  const env = report?.logs.environment;
  if (!env) {
    return {
      label: "Unknown",
      detail: "No VRChat environment block parsed yet.",
    };
  }

  const xrDevice = env.xr_device?.trim();
  const deviceModel = env.device_model?.trim();
  const platform = env.platform?.trim();
  const store = env.store?.trim();
  const probeText = `${xrDevice ?? ""} ${deviceModel ?? ""} ${platform ?? ""}`.toLowerCase();

  if (xrDevice || /quest|vive|index|oculus|pimax|windowsmr|xr|openvr|openxr/.test(probeText)) {
    return {
      label: "VR",
      detail: xrDevice ?? deviceModel ?? platform ?? store ?? "XR runtime detected",
    };
  }

  if (platform?.toLowerCase().includes("android")) {
    return {
      label: "Standalone",
      detail: deviceModel ?? platform,
    };
  }

  return {
    label: "Desktop",
    detail: platform ?? store ?? deviceModel ?? "Windows",
  };
}

export default function VrchatWorkspace() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { status: authStatus } = useAuth();
  const { report } = useReport();
  const [loginOpen, setLoginOpen] = useState(false);
  const [syncingOfficial, setSyncingOfficial] = useState(false);
  const [lastOfficialSyncAt, setLastOfficialSyncAt] = useState<string | null>(null);
  const [favoriteBusyId, setFavoriteBusyId] = useState<string | null>(null);
  const [downloadBusyId, setDownloadBusyId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useUiPrefBoolean("vrcsm.layout.vrchat.sidebar.visible", true);

  const friendsQuery = useIpcQuery<{ offline: boolean }, FriendsListResult>(
    "friends.list",
    { offline: false },
    {
      enabled: authStatus.authed,
      staleTime: 60_000,
    },
  );

  const onlineFriends = friendsQuery.data?.friends ?? [];
  const groupsQuery = useIpcQuery<undefined, WorkspaceGroupsResult>(
    "groups.list",
    undefined,
    {
      enabled: authStatus.authed,
      staleTime: 120_000,
    },
  );
  const moderationsQuery = useIpcQuery<undefined, WorkspaceModerationsResult>(
    "moderations.list",
    undefined,
    {
      enabled: authStatus.authed,
      staleTime: 120_000,
    },
  );

  const groups = useMemo(() => {
    return [...(groupsQuery.data?.groups ?? [])].sort((a, b) => {
      if (a.isRepresenting !== b.isRepresenting) {
        return a.isRepresenting ? -1 : 1;
      }
      return (b.onlineMemberCount ?? 0) - (a.onlineMemberCount ?? 0);
    });
  }, [groupsQuery.data?.groups]);
  const moderationItems = useMemo(() => {
    return [...(moderationsQuery.data?.items ?? [])].sort((a, b) =>
      (b.created ?? "").localeCompare(a.created ?? ""),
    );
  }, [moderationsQuery.data?.items]);
  const avatarHistoryQuery = useIpcQuery<{ limit: number; offset: number }, AvatarHistoryResult>(
    "db.avatarHistory.list",
    { limit: 8, offset: 0 },
    {
      staleTime: 120_000,
    },
  );
  const authUserQuery = useIpcQuery<undefined, AuthUserDetailsResult>(
    "auth.user",
    undefined,
    {
      enabled: authStatus.authed,
      staleTime: 60_000,
    },
  );
  const settingsQuery = useIpcQuery<undefined, VrcSettingsReport>(
    "settings.readAll",
    undefined,
    {
      staleTime: 300_000,
    },
  );
  const blockedCount = useMemo(
    () => moderationItems.filter((item) => (item.type || "").toLowerCase() === "block").length,
    [moderationItems],
  );
  const mutedCount = useMemo(
    () => moderationItems.filter((item) => (item.type || "").toLowerCase() === "mute").length,
    [moderationItems],
  );
  const actionableFriends = useMemo(() => {
    return onlineFriends
      .filter((friend) => parseLocation(friend.location).kind === "world")
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [onlineFriends]);

  const { items: libraryItems } = useFavoriteItems(LIBRARY_LIST_NAME);
  const { items: officialItems } = useFavoriteItems(OFFICIAL_FAVORITES_LIST_NAME);
  const { toggleFavorite } = useFavoriteActions();

  const favoriteFriendItems = useMemo(
    () => libraryItems.filter((item) => normalizeFavoriteType(item.type) === "user"),
    [libraryItems],
  );
  const favoriteFriendIds = useMemo(
    () => new Set(favoriteFriendItems.map((item) => item.target_id)),
    [favoriteFriendItems],
  );
  const officialAvatarItems = useMemo(
    () => officialItems.filter((item) => normalizeFavoriteType(item.type) === "avatar"),
    [officialItems],
  );
  const officialWorldItems = useMemo(
    () => officialItems.filter((item) => normalizeFavoriteType(item.type) === "world"),
    [officialItems],
  );
  const favoriteFriendsWithPresence = useMemo(() => {
    const onlineMap = new Map(onlineFriends.map((friend) => [friend.id, friend] as const));
    return favoriteFriendItems.map((item) => ({
      item,
      friend: onlineMap.get(item.target_id) ?? null,
    }));
  }, [favoriteFriendItems, onlineFriends]);
  const recentWorlds = useMemo(() => {
    const logs = report?.logs;
    if (!logs) return [];
    return logs.recent_world_ids.slice(0, 8).map((worldId) => ({
      id: worldId,
      name: logs.world_names[worldId] ?? null,
      lastSeen:
        logs.world_switches.find((entry) => entry.world_id === worldId)?.iso_time ?? null,
    }));
  }, [report]);
  const avatarHistoryItems = avatarHistoryQuery.data?.items ?? [];
  const rawAuthUser = useMemo(() => {
    return isJsonRecord(authUserQuery.data?.user) ? authUserQuery.data.user : null;
  }, [authUserQuery.data]);
  const rawAuthUserTags = useMemo(() => stringArrayField(rawAuthUser, "tags"), [rawAuthUser]);
  const subscriptionTagFacts = useMemo(() => {
    return rawAuthUserTags
      .filter((tag) => /support|subscr|vrc\+|plus|patreon|patron/i.test(tag))
      .sort((a, b) => a.localeCompare(b))
      .map((tag) => ({
        key: tag,
        value: tag,
      }));
  }, [rawAuthUserTags]);
  const downloadCandidates = useMemo(() => {
    const items: Array<{
      avatar_id: string;
      avatar_name: string | null;
      author_name: string | null;
      first_seen_on: string | null;
      first_seen_at: string | null;
    }> = [];
    const seen = new Set<string>();

    for (const item of avatarHistoryItems) {
      if (!item.avatar_id || seen.has(item.avatar_id)) continue;
      seen.add(item.avatar_id);
      items.push(item);
    }

    const logs = report?.logs;
    if (logs) {
      for (const avatarId of logs.recent_avatar_ids) {
        if (!avatarId || seen.has(avatarId)) continue;
        seen.add(avatarId);
        const info = logs.avatar_names[avatarId];
        items.push({
          avatar_id: avatarId,
          avatar_name: info?.name ?? null,
          author_name: info?.author ?? null,
          first_seen_on: null,
          first_seen_at: null,
        });
      }
    }

    return items.slice(0, 8);
  }, [avatarHistoryItems, report]);
  const downloadNameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of downloadCandidates) {
      const name = item.avatar_name?.trim();
      if (!name) {
        continue;
      }
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return counts;
  }, [downloadCandidates]);
  const linkedAccounts = useMemo(() => {
    const providers = [
      { label: "Steam", needles: ["steamid", "steam"] },
      { label: "Meta / Oculus", needles: ["oculus", "meta"] },
      { label: "Viveport", needles: ["viveport", "vive"] },
      { label: "PICO", needles: ["pico"] },
      { label: "Google", needles: ["google"] },
      { label: "Email", needles: ["obfuscatedemail", "email"] },
    ];

    return providers.map((provider) => {
      const field = findScalarField(rawAuthUser, provider.needles);
      return {
        label: provider.label,
        key: field?.key ?? null,
        value: field?.value ?? null,
        linked: Boolean(field?.value),
      };
    });
  }, [rawAuthUser]);
  const subscriptionSignalFacts = useMemo(() => {
    if (!rawAuthUser) {
      return [] as Array<{ key: string; value: string }>;
    }

    return Object.entries(rawAuthUser)
      .filter(([key, value]) => {
        if (key === "tags") {
          return false;
        }
        if (!/support|subscription|subscribed|patreon|patron/i.test(key)) {
          return false;
        }
        return scalarText(value) !== null;
      })
      .map(([key, value]) => ({
        key,
        value: scalarText(value) ?? "",
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [rawAuthUser]);
  const marketplaceFacts = useMemo(() => {
    if (!rawAuthUser) {
      return [] as Array<{ key: string; value: string }>;
    }

    return Object.entries(rawAuthUser)
      .filter(([key, value]) => {
        if (!/market|purchase|inventory|product|listing|balance|credit/i.test(key)) {
          return false;
        }
        return scalarText(value) !== null;
      })
      .map(([key, value]) => ({
        key,
        value: scalarText(value) ?? "",
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [rawAuthUser]);
  const topInventoryAuthors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of avatarHistoryItems) {
      const author = item.author_name?.trim();
      if (!author) {
        continue;
      }
      counts.set(author, (counts.get(author) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([author, count]) => ({ author, count }))
      .sort((a, b) => (b.count - a.count) || a.author.localeCompare(b.author))
      .slice(0, 5);
  }, [avatarHistoryItems]);
  const lastExpiredSubscriptionEntry = useMemo(() => {
    return settingsQuery.data?.entries.find((entry) => /LastExpiredSubscription$/i.test(entry.key)) ?? null;
  }, [settingsQuery.data?.entries]);
  const lastExpiredSubscriptionValue = settingValueText(lastExpiredSubscriptionEntry);
  const subscriptionActive = useMemo(() => {
    if (subscriptionTagFacts.some((item) => item.key.toLowerCase() === "system_supporter")) {
      return true;
    }
    return subscriptionSignalFacts.some((item) => {
      const loweredValue = item.value.toLowerCase();
      return loweredValue === "true" || loweredValue.includes("vrc+") || loweredValue.includes("support");
    });
  }, [subscriptionSignalFacts, subscriptionTagFacts]);
  const recentDownloadFolder =
    typeof window !== "undefined" ? window.localStorage.getItem("vrcsm.avatarDownloadDir") : null;
  const runtimeSummary = useMemo(() => detectRuntimeSummary(report), [report]);

  useEffect(() => {
    if (lastOfficialSyncAt || officialItems.length === 0) return;
    const newest = officialItems
      .map((item) => item.added_at)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => b.localeCompare(a))[0];
    if (newest) {
      setLastOfficialSyncAt(newest);
    }
  }, [lastOfficialSyncAt, officialItems]);

  async function handleOfficialSync() {
    if (!authStatus.authed || syncingOfficial) {
      if (!authStatus.authed) {
        setLoginOpen(true);
      }
      return;
    }

    setSyncingOfficial(true);
    try {
      const result = await ipc.favoriteSyncOfficial();
      setLastOfficialSyncAt(result.synced_at);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["favorites.lists"] }),
        queryClient.invalidateQueries({ queryKey: ["favorites.items"] }),
      ]);
      toast.success(
        t("library.officialSyncSuccess", {
          count: result.imported,
          avatars: result.avatars,
          worlds: result.worlds,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(t("library.officialSyncFailed", { error: message }));
    } finally {
      setSyncingOfficial(false);
    }
  }

  async function handleToggleFriendFavorite(friend: Friend) {
    const isFavorited = favoriteFriendIds.has(friend.id);
    setFavoriteBusyId(friend.id);
    try {
      await toggleFavorite(
        {
          type: "user",
          target_id: friend.id,
          list_name: LIBRARY_LIST_NAME,
          display_name: friend.displayName,
          thumbnail_url:
            friend.profilePicOverride ??
            friend.currentAvatarThumbnailImageUrl ??
            friend.currentAvatarImageUrl ??
            undefined,
        },
        isFavorited,
      );
      toast.success(
        t(isFavorited ? "library.removedToast" : "library.savedToast", {
          name: friend.displayName,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(t("library.toggleFailed", { error: message }));
    } finally {
      setFavoriteBusyId(null);
    }
  }

  async function handleDownloadAvatar(candidate: {
    avatar_id: string;
    avatar_name: string | null;
  }) {
    if (!authStatus.authed) {
      setLoginOpen(true);
      return;
    }

    setDownloadBusyId(candidate.avatar_id);
    try {
      const folder = await ipc.pickFolder({
        title: t("vrchatWorkspace.pickDownloadFolder", {
          defaultValue: "Choose a folder for avatar bundles",
        }),
        initialDir: localStorage.getItem("vrcsm.avatarDownloadDir") ?? undefined,
      });
      if (folder.cancelled || !folder.path) {
        return;
      }

      localStorage.setItem("vrcsm.avatarDownloadDir", folder.path);

      const detailsResult = await ipc.call<{ id: string }, { details: AvatarDetails | null }>(
        "avatar.details",
        { id: candidate.avatar_id },
      );
      const details = detailsResult.details;
      const assetUrl =
        details?.unityPackages?.find((pkg) => pkg.platform === "standalonewindows")?.assetUrl
        ?? details?.assetUrl
        ?? null;

      if (!assetUrl) {
        toast.error(
          t("vrchatWorkspace.downloadAssetMissing", {
            defaultValue: "This avatar does not expose a downloadable Windows asset URL.",
          }),
        );
        return;
      }

      const result = await ipc.downloadAvatarBundle({
        avatarId: candidate.avatar_id,
        assetUrl,
        outDir: folder.path,
        displayName: details?.name ?? candidate.avatar_name ?? candidate.avatar_id,
      });
      toast.success(
        t("vrchatWorkspace.downloadSuccess", {
          defaultValue: "Bundle saved to {{path}}",
          path: result.path,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(t("vrchatWorkspace.downloadFailed", { defaultValue: "Download failed: {{error}}", error: message }));
    } finally {
      setDownloadBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight">
            {t("vrchatWorkspace.title", { defaultValue: "VRChat Workspace" })}
          </h1>
          <p className="mt-1.5 max-w-3xl text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("profile.quickActionsDesc", {
              defaultValue:
                "Native join flow, favorites sync, local friend pins, and recent-world shortcuts gathered into one VRChat-focused control surface.",
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSidebar((current) => !current)}
          >
            {showSidebar
              ? t("common.hide", { defaultValue: "Hide" })
              : t("common.show", { defaultValue: "Show" })}{" "}
            {t("common.sidebar", { defaultValue: "Sidebar" })}
          </Button>
          <Button
            variant={authStatus.authed ? "outline" : "tonal"}
            size="sm"
            onClick={() => {
              if (authStatus.authed) {
                void handleOfficialSync();
              } else {
                setLoginOpen(true);
              }
            }}
            disabled={syncingOfficial}
          >
            {syncingOfficial ? <Loader2 className="size-4 animate-spin" /> : authStatus.authed ? <RefreshCw className="size-4" /> : <LogIn className="size-4" />}
            {authStatus.authed
              ? syncingOfficial
                ? t("library.officialSyncing")
                : t("library.officialSync")
              : t("auth.signInWithVrchat")}
          </Button>
          <Badge variant={authStatus.authed ? "success" : "muted"}>
            {authStatus.authed ? t("auth.signedIn") : t("profile.notSignedIn")}
          </Badge>
          {lastOfficialSyncAt ? (
            <Badge variant="muted">
              {t("library.officialLastSync", { date: formatDate(lastOfficialSyncAt) })}
            </Badge>
          ) : null}
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("friends.bucket.joinMe", { defaultValue: "Join Me" })}</CardDescription>
            <CardTitle className="text-[22px]">{actionableFriends.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("library.types.user", { defaultValue: "Users" })}</CardDescription>
            <CardTitle className="text-[22px]">{favoriteFriendItems.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("library.officialSync", { defaultValue: "VRChat favorites" })}</CardDescription>
            <CardTitle className="text-[22px]">{officialItems.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("worlds.title", { defaultValue: "Worlds" })}</CardDescription>
            <CardTitle className="text-[22px]">{recentWorlds.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("logs.environment", { defaultValue: "Environment" })}</CardDescription>
            <CardTitle className="text-[22px]">{runtimeSummary.label}</CardTitle>
            <div className="text-[11px] text-[hsl(var(--muted-foreground))]">{runtimeSummary.detail}</div>
          </CardHeader>
        </Card>
      </div>

      <div className={showSidebar ? "grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_380px]" : "grid gap-4"}>
        <div className="min-w-0 flex flex-col gap-4">
          <Card elevation="flat">
            <CardHeader>
              <CardTitle>{t("profile.quickActions", { defaultValue: "Native Workspace" })}</CardTitle>
              <CardDescription>
                {t("profile.liveContextHint", {
                  defaultValue:
                    "Jump directly into the built-in VRCSM flows instead of bouncing between tabs and external panels.",
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <WorkspaceActionCard
                icon={Users}
                title={t("friends.title")}
                body={t("friends.subtitle")}
                onClick={() => navigate("/friends")}
              />
              <WorkspaceActionCard
                icon={Shirt}
                title={t("avatars.title")}
                body={t("avatars.subtitle")}
                onClick={() => navigate("/avatars")}
              />
              <WorkspaceActionCard
                icon={Globe2}
                title={t("worlds.title")}
                body={t("worlds.subtitle")}
                onClick={() => navigate("/worlds")}
              />
              <WorkspaceActionCard
                icon={LibraryBig}
                title={t("library.title")}
                body={t("library.subtitle")}
                onClick={() => navigate("/library")}
              />
              <WorkspaceActionCard
                icon={UserCircle2}
                title={t("profile.title")}
                body={t("profile.subtitle")}
                onClick={() => navigate("/profile")}
              />
              <WorkspaceActionCard
                icon={Compass}
                title={t("dashboard.title")}
                body={t("dashboard.recentActivityDesc")}
                onClick={() => navigate("/")}
              />
            </CardContent>
          </Card>

          <CollapsibleCard
            elevation="flat"
            title={t("profile.openFriendsManager", { defaultValue: "Join Friends" })}
            description={authStatus.authed ? t("friends.subtitle") : t("friends.signInRequiredBody")}
            actions={(
              <Button variant="outline" size="sm" onClick={() => friendsQuery.refetch()} disabled={!authStatus.authed || friendsQuery.isFetching}>
                <RefreshCw className={friendsQuery.isFetching ? "size-4 animate-spin" : "size-4"} />
                {t("common.refresh")}
              </Button>
            )}
            storageKey="vrcsm.section.vrchat.joinFriends.open"
            contentClassName="space-y-3"
          >
              {!authStatus.authed ? (
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-4 text-[12px] text-[hsl(var(--muted-foreground))]">
                  <div className="font-medium text-[hsl(var(--foreground))]">{t("friends.signInRequired")}</div>
                  <div className="mt-1.5">{t("friends.signInRequiredBody")}</div>
                  <Button variant="tonal" size="sm" className="mt-3" onClick={() => setLoginOpen(true)}>
                    <LogIn className="size-4" />
                    {t("auth.signInWithVrchat")}
                  </Button>
                </div>
              ) : actionableFriends.length === 0 ? (
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-4 text-[12px] text-[hsl(var(--muted-foreground))]">
                  {t("vrchatWorkspace.noJoinable", {
                    defaultValue: "No joinable friends are currently exposing an instance.",
                  })}
                </div>
              ) : (
                actionableFriends.slice(0, 8).map((friend) => {
                  const loc = parseLocation(friend.location);
                  const worldName =
                    (loc.worldId && report?.logs.world_names[loc.worldId]) ||
                    loc.worldId ||
                    t("friends.location.world");
                  const accessLabel = instanceTypeLabel(loc.instanceType);
                  const canDirectJoin =
                    loc.instanceType === "public" ||
                    loc.instanceType === "friends" ||
                    loc.instanceType === "friends+" ||
                    loc.instanceType === "group" ||
                    loc.instanceType === "group-public" ||
                    loc.instanceType === "group-plus";
                  const canRequestInvite =
                    loc.instanceType === "invite" || loc.instanceType === "invite+";
                  const rank = trustRank(friend.tags);
                  return (
                    <div
                      key={friend.id}
                      className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3 lg:flex-row lg:items-center lg:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className={`text-[13px] font-semibold ${trustColorClass(rank)}`}>{friend.displayName}</div>
                          <Badge variant={statusBadgeVariant(friend.status)}>{friend.status ?? "unknown"}</Badge>
                          <Badge variant="muted">{t(trustLabelKey(rank))}</Badge>
                        </div>
                        <div className="mt-1 truncate text-[12px] text-[hsl(var(--foreground))]">{worldName}</div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                          <span>{friend.statusDescription || t("common.none")}</span>
                          <span>{relativeTime(friend.last_activity || friend.last_login) || t("common.none")}</span>
                          {loc.region ? <span>{loc.region.toUpperCase()}</span> : null}
                          {accessLabel ? <span>{accessLabel}</span> : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button
                          variant="tonal"
                          size="sm"
                          onClick={() => {
                            void openLaunchUrl(`vrchat://launch?id=${friend.location}`).catch((error: unknown) => {
                              const message = error instanceof Error ? error.message : String(error);
                              toast.error(t("worlds.launchFailed", { error: message }));
                            });
                          }}
                        >
                          <Play className="size-4" />
                          {canDirectJoin
                            ? t("vrchatWorkspace.joinFriend", { defaultValue: "Join friend" })
                            : canRequestInvite
                              ? t("vrchatWorkspace.requestInvite", { defaultValue: "Request invite" })
                              : t("worlds.launchInVrc", { defaultValue: "Launch in VRChat" })}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            void openVrchatUserProfile(friend.id).catch((error: unknown) => {
                              const message = error instanceof Error ? error.message : String(error);
                              toast.error(t("worlds.openFailed", { error: message }));
                            });
                          }}
                        >
                          <Users className="size-4" />
                          {t("vrchatWorkspace.openFriendProfile", { defaultValue: "Open profile" })}
                        </Button>
                        <Button
                          variant={favoriteFriendIds.has(friend.id) ? "tonal" : "outline"}
                          size="sm"
                          disabled={favoriteBusyId === friend.id}
                          onClick={() => {
                            void handleToggleFriendFavorite(friend);
                          }}
                        >
                          <Heart className={favoriteFriendIds.has(friend.id) ? "size-4 fill-current" : "size-4"} />
                          {favoriteBusyId === friend.id
                            ? t("library.syncing")
                            : favoriteFriendIds.has(friend.id)
                              ? t("library.remove")
                              : t("vrchatWorkspace.saveToLibrary", {
                                  defaultValue: "Save to library",
                                })}
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
          </CollapsibleCard>

          <CollapsibleCard
            elevation="flat"
            title={t("worlds.title", { defaultValue: "Worlds" })}
            description={t("worlds.subtitle", { defaultValue: "Recent worlds parsed from VRChat output logs." })}
            storageKey="vrcsm.section.vrchat.worlds.open"
            contentClassName="space-y-2"
          >
              {recentWorlds.length === 0 ? (
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-4 text-[12px] text-[hsl(var(--muted-foreground))]">
                  {t("worlds.empty")}
                </div>
              ) : (
                recentWorlds.map((world) => (
                  <div
                    key={world.id}
                    className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-[hsl(var(--foreground))]">
                        {world.name ?? t("worlds.unknownName")}
                      </div>
                      <div className="mt-1 truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                        {world.id}
                      </div>
                      {world.lastSeen ? (
                        <div className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                          {formatDate(world.lastSeen)}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button variant="outline" size="sm" onClick={() => navigate(`/worlds?select=${encodeURIComponent(world.id)}`)}>
                        <Globe2 className="size-4" />
                        {t("library.open")}
                      </Button>
                      <Button
                        variant="tonal"
                        size="sm"
                        onClick={() => {
                          void openLaunchUrl(`vrchat://launch?id=${world.id}`).catch((error: unknown) => {
                            const message = error instanceof Error ? error.message : String(error);
                            toast.error(t("worlds.launchFailed", { error: message }));
                          });
                        }}
                      >
                        <Play className="size-4" />
                        {t("worlds.launchInVrc")}
                      </Button>
                    </div>
                  </div>
                ))
              )}
          </CollapsibleCard>
        </div>

        <div className="min-w-0 flex flex-col gap-4">
          <CollapsibleCard
            elevation="flat"
            title={t("library.officialSync", { defaultValue: "Sync VRChat favorites" })}
            description={t("library.subtitle", {
              defaultValue: "A unified local shelf for worlds, avatars, and future tagged collections.",
            })}
            actions={(
              <Button variant="outline" size="sm" onClick={() => void handleOfficialSync()} disabled={syncingOfficial}>
                {syncingOfficial ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                {syncingOfficial ? t("library.officialSyncing") : t("library.officialSync")}
              </Button>
            )}
            storageKey="vrcsm.section.vrchat.favorites.open"
            contentClassName="space-y-4"
          >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                    {t("library.types.avatar")}
                  </div>
                  <div className="mt-1 text-[18px] font-semibold text-[hsl(var(--foreground))]">
                    {officialAvatarItems.length}
                  </div>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                    {t("library.types.world")}
                  </div>
                  <div className="mt-1 text-[18px] font-semibold text-[hsl(var(--foreground))]">
                    {officialWorldItems.length}
                  </div>
                </div>
              </div>

              {officialItems.length === 0 ? (
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-4 text-[12px] text-[hsl(var(--muted-foreground))]">
                  {authStatus.authed
                    ? t("library.emptyBody", {
                        defaultValue:
                          "Sync avatars and worlds from your VRChat account first. They will land here as a native local list.",
                      })
                    : t("friends.signInRequiredBody")}
                </div>
              ) : (
                <div className="space-y-2">
                  {officialItems.slice(0, 10).map((item) => {
                    const type = normalizeFavoriteType(item.type);
                    return (
                      <div
                        key={`${item.type}:${item.target_id}`}
                        className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3 md:flex-row md:items-center md:justify-between"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-[13px] font-semibold text-[hsl(var(--foreground))]">
                              {item.display_name ?? shortenId(item.target_id)}
                            </div>
                            <FavoriteTypeBadge item={item} />
                          </div>
                          <div className="mt-1 truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                            {item.target_id}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              navigate(
                                type === "avatar"
                                  ? `/avatars?select=${encodeURIComponent(item.target_id)}`
                                  : type === "world"
                                    ? `/worlds?select=${encodeURIComponent(item.target_id)}`
                                    : "/library",
                              )
                            }
                          >
                            {t("library.open")}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => navigate("/library")}>
                            {t("library.edit")}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
          </CollapsibleCard>

          <Card elevation="flat">
            <CardHeader>
              <CardTitle>{t("library.types.user", { defaultValue: "Users" })}</CardTitle>
              <CardDescription>
                {t("library.defaultCollectionHint", { defaultValue: "Default cross-type local shelf" })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {favoriteFriendsWithPresence.length === 0 ? (
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-4 text-[12px] text-[hsl(var(--muted-foreground))]">
                  {t("library.emptyBody", {
                    defaultValue:
                      "Pin friends from the join list to build a personal shortlist you can revisit quickly.",
                  })}
                </div>
              ) : (
                favoriteFriendsWithPresence.slice(0, 10).map(({ item, friend }) => {
                  const loc = friend ? parseLocation(friend.location) : null;
                  const canJoin = friend && loc?.kind === "world";
                  return (
                    <div
                      key={item.target_id}
                      className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-semibold text-[hsl(var(--foreground))]">
                            {item.display_name ?? shortenId(item.target_id)}
                          </div>
                          <div className="mt-1 truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                            {item.target_id}
                          </div>
                        </div>
                        <Badge variant={friend ? statusBadgeVariant(friend.status) : "muted"}>
                          {friend?.status ?? t("friends.location.offline")}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
                        {canJoin
                          ? (loc?.worldId && report?.logs.world_names[loc.worldId]) || loc?.worldId || t("friends.location.world")
                          : item.note || t("common.none")}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => navigate("/friends")}>
                          <Users className="size-4" />
                          {t("friends.detailPaneTitle")}
                        </Button>
                        {canJoin ? (
                          <Button
                            variant="tonal"
                            size="sm"
                            onClick={() => {
                              void openLaunchUrl(`vrchat://launch?id=${friend.location}`).catch((error: unknown) => {
                                const message = error instanceof Error ? error.message : String(error);
                                toast.error(t("worlds.launchFailed", { error: message }));
                              });
                            }}
                          >
                            <Play className="size-4" />
                            {t("profile.openFriendsManager", { defaultValue: "Join friend" })}
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            void openVrchatUserProfile(item.target_id).catch((error: unknown) => {
                              const message = error instanceof Error ? error.message : String(error);
                              toast.error(t("worlds.openFailed", { error: message }));
                            });
                          }}
                        >
                          <Users className="size-4" />
                          {t("vrchatWorkspace.openFriendProfile", { defaultValue: "Open profile" })}
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <CollapsibleCard
            elevation="flat"
            title={t("vrchatWorkspace.groupsTitle", { defaultValue: "Groups" })}
            description={t("vrchatWorkspace.groupsBody", {
              defaultValue:
                "Your VRChat groups from the signed-in session, surfaced natively inside the workspace.",
            })}
            storageKey="vrcsm.section.vrchat.groups.open"
            contentClassName="space-y-3"
          >
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    {t("vrchatWorkspace.groupCount", {
                      defaultValue: "{{count}} groups",
                      count: groups.length,
                    })}
                  </Badge>
                  {groups.some((group) => group.isRepresenting) ? (
                    <Badge variant="success">
                      {t("vrchatWorkspace.representing", { defaultValue: "Representing active" })}
                    </Badge>
                  ) : null}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => groupsQuery.refetch()}
                  disabled={!authStatus.authed || groupsQuery.isFetching}
                >
                  <RefreshCw className={groupsQuery.isFetching ? "size-4 animate-spin" : "size-4"} />
                  {t("common.refresh")}
                </Button>
              </div>

              {!authStatus.authed ? (
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-4 text-[12px] text-[hsl(var(--muted-foreground))]">
                  {t("friends.signInRequiredBody")}
                </div>
              ) : groups.length === 0 ? (
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-4 text-[12px] text-[hsl(var(--muted-foreground))]">
                  {t("vrchatWorkspace.noGroups", {
                    defaultValue: "No groups were returned for this account.",
                  })}
                </div>
              ) : (
                groups.slice(0, 6).map((group: WorkspaceGroup) => (
                  <div
                    key={group.id}
                    className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-[13px] font-semibold text-[hsl(var(--foreground))]">
                            {group.name || shortenId(group.id)}
                          </div>
                          {group.shortCode ? <Badge variant="muted">#{group.shortCode}</Badge> : null}
                          {group.isRepresenting ? (
                            <Badge variant="success">
                              {t("vrchatWorkspace.representing", { defaultValue: "Representing" })}
                            </Badge>
                          ) : null}
                          {group.isVerified ? (
                            <Badge variant="secondary">
                              {t("vrchatWorkspace.verified", { defaultValue: "Verified" })}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-1 truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                          {group.id}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
                        <Users className="size-3.5" />
                        <span>{group.onlineMemberCount}/{group.memberCount}</span>
                      </div>
                    </div>
                    <div className="mt-2 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                      {group.description || t("common.none")}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {group.privacy ? <Badge variant="muted">{group.privacy}</Badge> : null}
                      {group.roles.slice(0, 3).map((role) => (
                        <Badge key={`${group.id}:${role}`} variant="secondary">
                          {role}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))
              )}
          </CollapsibleCard>

          <CollapsibleCard
            elevation="flat"
            title={t("vrchatWorkspace.blocksMutesTitle", { defaultValue: "Blocks & Mutes" })}
            description={t("vrchatWorkspace.blocksMutesBody", {
              defaultValue:
                "Current player moderation entries pulled from your signed-in VRChat session.",
            })}
            storageKey="vrcsm.section.vrchat.blocks.open"
            contentClassName="space-y-3"
          >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                    <Ban className="size-3.5" />
                    {t("vrchatWorkspace.blocked", { defaultValue: "Blocked" })}
                  </div>
                  <div className="mt-1 text-[18px] font-semibold text-[hsl(var(--foreground))]">{blockedCount}</div>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                    <VolumeX className="size-3.5" />
                    {t("vrchatWorkspace.muted", { defaultValue: "Muted" })}
                  </div>
                  <div className="mt-1 text-[18px] font-semibold text-[hsl(var(--foreground))]">{mutedCount}</div>
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => moderationsQuery.refetch()}
                  disabled={!authStatus.authed || moderationsQuery.isFetching}
                >
                  <RefreshCw className={moderationsQuery.isFetching ? "size-4 animate-spin" : "size-4"} />
                  {t("common.refresh")}
                </Button>
              </div>

              {!authStatus.authed ? (
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-4 text-[12px] text-[hsl(var(--muted-foreground))]">
                  {t("friends.signInRequiredBody")}
                </div>
              ) : moderationItems.length === 0 ? (
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-4 text-[12px] text-[hsl(var(--muted-foreground))]">
                  {t("vrchatWorkspace.noModerations", {
                    defaultValue: "No block or mute entries were returned for this account.",
                  })}
                </div>
              ) : (
                moderationItems.slice(0, 8).map((item) => (
                  <div
                    key={item.id || `${item.type}:${item.targetUserId}`}
                    className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-[13px] font-semibold text-[hsl(var(--foreground))]">
                            {item.targetDisplayName || shortenId(item.targetUserId ?? item.id)}
                          </div>
                          <Badge variant={moderationVariant(item)}>
                            {moderationLabel(item, t)}
                          </Badge>
                        </div>
                        <div className="mt-1 truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                          {item.targetUserId || item.id}
                        </div>
                      </div>
                      <div className="shrink-0 text-[11px] text-[hsl(var(--muted-foreground))]">
                        {item.created ? formatDate(item.created) : t("common.none")}
                      </div>
                    </div>
                  </div>
                ))
              )}
          </CollapsibleCard>

          <CollapsibleCard
            elevation="flat"
            title={t("vrchatWorkspace.inventoryTitle", { defaultValue: "Inventory" })}
            description={t("vrchatWorkspace.inventoryBody", {
              defaultValue:
                "Recent avatars seen across local cache, log parsing, and avatar history persisted by VRCSM.",
            })}
            storageKey="vrcsm.section.vrchat.inventory.open"
            contentClassName="space-y-3"
          >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                    <Box className="size-3.5" />
                    {t("vrchatWorkspace.localAvatarData", { defaultValue: "Local avatar data" })}
                  </div>
                  <div className="mt-1 text-[18px] font-semibold text-[hsl(var(--foreground))]">
                    {report?.local_avatar_data.item_count ?? 0}
                  </div>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                    <Sparkles className="size-3.5" />
                    {t("vrchatWorkspace.avatarHistory", { defaultValue: "Avatar history" })}
                  </div>
                  <div className="mt-1 text-[18px] font-semibold text-[hsl(var(--foreground))]">
                    {avatarHistoryItems.length}
                  </div>
                </div>
              </div>

              {avatarHistoryItems.length === 0 ? (
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-4 text-[12px] text-[hsl(var(--muted-foreground))]">
                  {t("vrchatWorkspace.noInventory", {
                    defaultValue: "No persisted avatar history yet. Wear avatars or inspect them to let VRCSM build inventory.",
                  })}
                </div>
              ) : (
                avatarHistoryItems.map((item: AvatarHistoryItem) => (
                  <div
                    key={item.avatar_id}
                    className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="truncate text-[13px] font-semibold text-[hsl(var(--foreground))]">
                            {item.avatar_name || shortenId(item.avatar_id)}
                          </div>
                          {item.avatar_name && (downloadNameCounts.get(item.avatar_name.trim()) ?? 0) > 1 ? (
                            <Badge variant="warning">
                              {t("avatars.duplicateNameHint", {
                                defaultValue: "Same name, different ID",
                              })}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-1 truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                          {item.avatar_id}
                        </div>
                        <div className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                          {item.author_name || t("common.none")}
                          {item.first_seen_on ? ` · ${item.first_seen_on}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-[11px] text-[hsl(var(--muted-foreground))]">
                        {item.first_seen_at ? formatDate(item.first_seen_at) : t("common.none")}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/avatars?select=${encodeURIComponent(item.avatar_id)}`)}
                      >
                        <Shirt className="size-4" />
                        {t("library.open")}
                      </Button>
                      <Button
                        variant="tonal"
                        size="sm"
                        disabled={downloadBusyId === item.avatar_id}
                        onClick={() => {
                          void handleDownloadAvatar(item);
                        }}
                      >
                        <Download className="size-4" />
                        {downloadBusyId === item.avatar_id
                          ? t("library.syncing")
                          : t("vrchatWorkspace.downloadBundle", { defaultValue: "Download bundle" })}
                      </Button>
                    </div>
                  </div>
                ))
              )}
          </CollapsibleCard>

          <CollapsibleCard
            elevation="flat"
            title={t("vrchatWorkspace.downloadTitle", { defaultValue: "Download" })}
            description={t("vrchatWorkspace.downloadBody", {
              defaultValue:
                "Download recent avatar bundles directly from the signed-in VRChat session into a local folder you choose.",
            })}
            storageKey="vrcsm.section.vrchat.download.open"
            contentClassName="space-y-3"
          >
              {!authStatus.authed ? (
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-4 text-[12px] text-[hsl(var(--muted-foreground))]">
                  {t("friends.signInRequiredBody")}
                </div>
              ) : downloadCandidates.length === 0 ? (
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-4 text-[12px] text-[hsl(var(--muted-foreground))]">
                  {t("vrchatWorkspace.noDownloadCandidates", {
                    defaultValue: "No recent avatars are available as download candidates yet.",
                  })}
                </div>
              ) : (
                downloadCandidates.map((item) => (
                  <div
                    key={`download:${item.avatar_id}`}
                    className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-[13px] font-semibold text-[hsl(var(--foreground))]">
                          {item.avatar_name || shortenId(item.avatar_id)}
                        </div>
                        {item.avatar_name && (downloadNameCounts.get(item.avatar_name.trim()) ?? 0) > 1 ? (
                          <Badge variant="warning">
                            {t("avatars.duplicateNameHint", {
                              defaultValue: "Same name, different ID",
                            })}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-1 truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                        {item.avatar_id}
                      </div>
                      <div className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                        {item.author_name || t("common.none")}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/avatars?select=${encodeURIComponent(item.avatar_id)}`)}
                      >
                        <Shirt className="size-4" />
                        {t("library.open")}
                      </Button>
                      <Button
                        variant="tonal"
                        size="sm"
                        disabled={downloadBusyId === item.avatar_id}
                        onClick={() => {
                          void handleDownloadAvatar(item);
                        }}
                      >
                        <Download className="size-4" />
                        {downloadBusyId === item.avatar_id
                          ? t("library.syncing")
                          : t("vrchatWorkspace.downloadBundle", { defaultValue: "Download bundle" })}
                      </Button>
                    </div>
                  </div>
                ))
              )}
          </CollapsibleCard>

          <CollapsibleCard
            elevation="flat"
            title={t("vrchatWorkspace.marketplaceTitle", { defaultValue: "Marketplace" })}
            description={t("vrchatWorkspace.marketplaceBody", {
              defaultValue:
                "Ownership and acquisition signals pulled from official favorites, local avatar inventory, recent bundle targets, and any commerce-related fields exposed by the active VRChat session.",
            })}
            storageKey="vrcsm.section.vrchat.marketplace.open"
            contentClassName="space-y-3"
          >
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                    <Shirt className="size-3.5" />
                    {t("vrchatWorkspace.favoriteAvatars", { defaultValue: "Favorite avatars" })}
                  </div>
                  <div className="mt-1 text-[18px] font-semibold text-[hsl(var(--foreground))]">{officialAvatarItems.length}</div>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                    <Globe2 className="size-3.5" />
                    {t("vrchatWorkspace.favoriteWorlds", { defaultValue: "Favorite worlds" })}
                  </div>
                  <div className="mt-1 text-[18px] font-semibold text-[hsl(var(--foreground))]">{officialWorldItems.length}</div>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                    <Download className="size-3.5" />
                    {t("vrchatWorkspace.downloadReady", { defaultValue: "Download-ready" })}
                  </div>
                  <div className="mt-1 text-[18px] font-semibold text-[hsl(var(--foreground))]">{downloadCandidates.length}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => navigate("/library")}>
                  <LibraryBig className="size-4" />
                  {t("profile.openLibrary", { defaultValue: "Open library" })}
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate("/avatars")}>
                  <Shirt className="size-4" />
                  {t("profile.openAvatarManager", { defaultValue: "Open avatars" })}
                </Button>
              </div>

              {recentDownloadFolder ? (
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3 text-[11px] text-[hsl(var(--muted-foreground))]">
                  <div className="text-[10px] uppercase tracking-[0.08em]">{t("vrchatWorkspace.downloadFolder", { defaultValue: "Download folder" })}</div>
                  <div className="mt-1 break-all font-mono text-[hsl(var(--foreground))]">{recentDownloadFolder}</div>
                </div>
              ) : null}

              {topInventoryAuthors.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-[hsl(var(--foreground))]">
                    {t("vrchatWorkspace.topCreators", { defaultValue: "Top creators in local inventory" })}
                  </div>
                  {topInventoryAuthors.map((item) => (
                    <div
                      key={item.author}
                      className="flex items-center justify-between rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3"
                    >
                      <div className="truncate text-[12px] text-[hsl(var(--foreground))]">{item.author}</div>
                      <Badge variant="secondary">
                        {t("vrchatWorkspace.inventoryCount", {
                          defaultValue: "{{count}} avatars",
                          count: item.count,
                        })}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-4 text-[12px] text-[hsl(var(--muted-foreground))]">
                  {t("vrchatWorkspace.noMarketplaceSignals", {
                    defaultValue: "No local ownership signals yet. Favorite, inspect, or download avatars to let VRCSM build this surface.",
                  })}
                </div>
              )}

              {marketplaceFacts.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {marketplaceFacts.slice(0, 8).map((fact) => (
                    <Badge key={fact.key} variant="muted" className="gap-1.5 px-2.5 py-1">
                      <Sparkles className="size-3" />
                      {fact.key}: {fact.value}
                    </Badge>
                  ))}
                </div>
              ) : null}
          </CollapsibleCard>

          <CollapsibleCard
            elevation="flat"
            title={t("vrchatWorkspace.accountLinkTitle", { defaultValue: "Account Link" })}
            description={t("vrchatWorkspace.accountLinkBody", {
              defaultValue:
                "Linked platform and identity fields resolved from the signed-in VRChat session, surfaced locally without bouncing out to the web panel.",
            })}
            storageKey="vrcsm.section.vrchat.account.open"
            contentClassName="space-y-3"
          >
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                    <UserCircle2 className="size-3.5" />
                    {t("vrchatWorkspace.linkedProviders", { defaultValue: "Linked providers" })}
                  </div>
                  <div className="mt-1 text-[18px] font-semibold text-[hsl(var(--foreground))]">
                    {linkedAccounts.filter((item) => item.linked).length}
                  </div>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                    {t("auth.username", { defaultValue: "Username" })}
                  </div>
                  <div className="mt-1 truncate text-[14px] font-semibold text-[hsl(var(--foreground))]">
                    {findScalarField(rawAuthUser, ["username"])?.value ?? t("common.none")}
                  </div>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                    {t("friends.platform", { defaultValue: "Platform" })}
                  </div>
                  <div className="mt-1 truncate text-[14px] font-semibold text-[hsl(var(--foreground))]">
                    {findScalarField(rawAuthUser, ["last_platform", "platform"])?.value ?? t("common.none")}
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => authUserQuery.refetch()}
                  disabled={!authStatus.authed || authUserQuery.isFetching}
                >
                  <RefreshCw className={authUserQuery.isFetching ? "size-4 animate-spin" : "size-4"} />
                  {t("common.refresh")}
                </Button>
              </div>

              {!authStatus.authed ? (
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-4 text-[12px] text-[hsl(var(--muted-foreground))]">
                  {t("friends.signInRequiredBody")}
                </div>
              ) : (
                linkedAccounts.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-[hsl(var(--foreground))]">{item.label}</div>
                        <div className="mt-1 break-all text-[11px] text-[hsl(var(--muted-foreground))]">
                          {item.value ?? t("vrchatWorkspace.notLinked", { defaultValue: "Not linked" })}
                        </div>
                        {item.key ? (
                          <div className="mt-1 font-mono text-[10px] text-[hsl(var(--muted-foreground))]">{item.key}</div>
                        ) : null}
                      </div>
                      <Badge variant={item.linked ? "success" : "muted"}>
                        {item.linked
                          ? t("vrchatWorkspace.linked", { defaultValue: "Linked" })
                          : t("vrchatWorkspace.notLinked", { defaultValue: "Not linked" })}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
          </CollapsibleCard>

          <CollapsibleCard
            elevation="flat"
            title={t("vrchatWorkspace.subscriptionsTitle", { defaultValue: "Subscriptions" })}
            description={t("vrchatWorkspace.subscriptionsBody", {
              defaultValue:
                "Supporter and subscription state inferred from the authenticated user payload plus local VRChat settings signals stored on this machine.",
            })}
            storageKey="vrcsm.section.vrchat.subscriptions.open"
            contentClassName="space-y-3"
          >
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                    <Heart className="size-3.5" />
                    {t("vrchatWorkspace.subscriptionStatus", { defaultValue: "Status" })}
                  </div>
                  <div className="mt-1 text-[18px] font-semibold text-[hsl(var(--foreground))]">
                    {subscriptionActive
                      ? t("vrchatWorkspace.subscriptionActive", { defaultValue: "Active" })
                      : t("vrchatWorkspace.subscriptionInactive", { defaultValue: "Inactive" })}
                  </div>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                    {t("vrchatWorkspace.subscriptionSignals", { defaultValue: "Signals" })}
                  </div>
                  <div className="mt-1 text-[18px] font-semibold text-[hsl(var(--foreground))]">
                    {subscriptionSignalFacts.length + subscriptionTagFacts.length}
                  </div>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                    {t("vrchatWorkspace.lastExpiredSubscription", { defaultValue: "Last expired" })}
                  </div>
                  <div className="mt-1 truncate text-[14px] font-semibold text-[hsl(var(--foreground))]">
                    {lastExpiredSubscriptionValue ?? t("common.none")}
                  </div>
                </div>
              </div>

              {subscriptionTagFacts.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {subscriptionTagFacts.slice(0, 8).map((tag) => (
                    <Badge
                      key={tag.key}
                      variant={tag.key.toLowerCase() === "system_supporter" ? "success" : "muted"}
                      className="gap-1.5 px-2.5 py-1"
                    >
                      <Sparkles className="size-3" />
                      {tag.value}
                    </Badge>
                  ))}
                </div>
              ) : null}

              {subscriptionSignalFacts.length > 0 ? (
                subscriptionSignalFacts.map((fact) => (
                  <div
                    key={fact.key}
                    className="flex items-center justify-between rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold text-[hsl(var(--foreground))]">{fact.key}</div>
                      <div className="mt-1 break-all text-[11px] text-[hsl(var(--muted-foreground))]">{fact.value}</div>
                    </div>
                    <Badge variant="secondary">{t("vrchatWorkspace.liveSignal", { defaultValue: "Live signal" })}</Badge>
                  </div>
                ))
              ) : (
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-4 text-[12px] text-[hsl(var(--muted-foreground))]">
                  {t("vrchatWorkspace.noSubscriptionSignals", {
                    defaultValue: "No dedicated subscription fields were exposed by this session.",
                  })}
                </div>
              )}
          </CollapsibleCard>
        </div>
      </div>

      <LoginForm open={loginOpen} onOpenChange={setLoginOpen} />
    </div>
  );
}
