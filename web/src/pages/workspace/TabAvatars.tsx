import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Download, Heart, Loader2, Shirt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useIpcQuery } from "@/hooks/useIpcQuery";
import { useAuth } from "@/lib/auth-context";
import { ipc } from "@/lib/ipc";
import { LIBRARY_LIST_NAME, useFavoriteActions, useFavoriteItems } from "@/lib/library";
import { useReport } from "@/lib/report-context";
import type { AvatarDetails, AvatarHistoryItem, AvatarHistoryResult } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { SectionTitle } from "./WorkspaceCards";

const DOWNLOAD_DIR_KEY = "vrcsm.avatarDownloadDir";

function readLastDownloadDir(): string | null {
  try {
    return localStorage.getItem(DOWNLOAD_DIR_KEY);
  } catch {
    return null;
  }
}

function saveLastDownloadDir(dir: string): void {
  try {
    localStorage.setItem(DOWNLOAD_DIR_KEY, dir);
  } catch {
    /* noop */
  }
}

/** Shorten an avatar id for display when no name is available. */
function shortenAvatarId(id: string, head = 10, tail = 6): string {
  if (id.length <= head + tail + 3) return id;
  return `${id.slice(0, head)}...${id.slice(-tail)}`;
}

// ── Avatar History Section ──────────────────────────────────────────────

function AvatarHistorySection() {
  const { t } = useTranslation();
  const { byType: favoriteIds } = useFavoriteItems(LIBRARY_LIST_NAME);
  const { toggleFavorite } = useFavoriteActions();

  const { data, isLoading, error } = useIpcQuery<
    { limit: number; offset: number },
    AvatarHistoryResult
  >("db.avatarHistory.list", { limit: 20, offset: 0 }, { staleTime: 30_000 });

  const items = data?.items ?? [];

  async function handleToggle(item: AvatarHistoryItem) {
    const isFav = favoriteIds.avatar.has(item.avatar_id);
    try {
      await toggleFavorite(
        {
          type: "avatar",
          target_id: item.avatar_id,
          list_name: LIBRARY_LIST_NAME,
          display_name: item.avatar_name ?? undefined,
        },
        isFav,
      );
      toast.success(
        t(isFav ? "library.removedToast" : "library.savedToast", {
          name: item.avatar_name ?? shortenAvatarId(item.avatar_id),
        }),
      );
    } catch (e) {
      toast.error(
        t("library.toggleFailed", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  }

  if (isLoading) {
    return (
      <Card elevation="flat">
        <CardContent className="flex items-center justify-center py-10">
          <Loader2 className="size-5 animate-spin text-[hsl(var(--muted-foreground))]" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card elevation="flat">
        <CardHeader>
          <CardTitle className="text-[13px]">
            {t("vrchatWorkspace.avatarHistory", { defaultValue: "Avatar History" })}
          </CardTitle>
          <CardDescription className="text-[11px]">
            {error.message}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card elevation="flat" className="p-0">
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-[13px]">
          <SectionTitle
            title={t("vrchatWorkspace.avatarHistory", { defaultValue: "Avatar History" })}
            count={items.length}
          />
        </CardTitle>
        <CardDescription className="text-[11px]">
          {t("vrchatWorkspace.avatarHistoryDesc", {
            defaultValue: "Recently used avatars from parsed VRChat logs.",
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {items.length === 0 ? (
          <div className="px-4 pb-4 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
            {t("vrchatWorkspace.noAvatarHistory", {
              defaultValue: "No avatar history recorded yet.",
            })}
          </div>
        ) : (
          <ScrollArea className="max-h-[340px]">
            <div className="flex flex-col gap-px px-2 pb-2">
              {items.map((item) => {
                const isFav = favoriteIds.avatar.has(item.avatar_id);
                return (
                  <div
                    key={item.avatar_id}
                    className="flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-1.5 transition-colors hover:bg-[hsl(var(--surface-raised))]"
                  >
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]">
                      <Shirt className="size-3.5" />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[12px] font-medium text-[hsl(var(--foreground))]">
                        {item.avatar_name ?? shortenAvatarId(item.avatar_id)}
                      </span>
                      <div className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                        {item.author_name ? (
                          <>
                            <span className="truncate">{item.author_name}</span>
                            <span>·</span>
                          </>
                        ) : null}
                        {item.first_seen_at ? (
                          <span>{formatDate(item.first_seen_at)}</span>
                        ) : null}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0"
                      onClick={() => handleToggle(item)}
                      title={isFav ? t("library.removeFromLibrary", { defaultValue: "Remove from Library" }) : t("library.saveToLibrary", { defaultValue: "Save to Library" })}
                    >
                      <Heart
                        className={`size-3.5 ${isFav ? "fill-[hsl(var(--destructive))] text-[hsl(var(--destructive))]" : "text-[hsl(var(--muted-foreground))]"}`}
                      />
                    </Button>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

// ── Download Section ────────────────────────────────────────────────────

interface DownloadableAvatar {
  avatar_id: string;
  avatar_name: string | null;
  author_name: string | null;
}

function AvatarDownloadSection() {
  const { t } = useTranslation();
  const { status: authStatus } = useAuth();
  const { report } = useReport();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const { data: historyData } = useIpcQuery<
    { limit: number; offset: number },
    AvatarHistoryResult
  >("db.avatarHistory.list", { limit: 20, offset: 0 }, { staleTime: 30_000 });

  // Merge avatar history + recent avatar IDs from log report
  const downloadables = useMemo<DownloadableAvatar[]>(() => {
    const seen = new Set<string>();
    const out: DownloadableAvatar[] = [];

    // From DB history
    for (const item of historyData?.items ?? []) {
      if (seen.has(item.avatar_id)) continue;
      seen.add(item.avatar_id);
      out.push({
        avatar_id: item.avatar_id,
        avatar_name: item.avatar_name,
        author_name: item.author_name,
      });
    }

    // From parsed logs
    const logAvatarIds = report?.logs.recent_avatar_ids ?? [];
    const avatarNames = report?.logs.avatar_names ?? {};
    for (const id of logAvatarIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const info = avatarNames[id];
      out.push({
        avatar_id: id,
        avatar_name: info?.name ?? null,
        author_name: info?.author ?? null,
      });
    }

    return out;
  }, [historyData, report]);

  async function handleDownload(item: DownloadableAvatar) {
    if (!authStatus.authed) {
      toast.error(
        t("vrchatWorkspace.signInRequired", {
          defaultValue: "Sign in to download avatar bundles.",
        }),
      );
      return;
    }

    setDownloadingId(item.avatar_id);
    try {
      // Pick a folder (use last-used directory as initial)
      const lastDir = readLastDownloadDir();
      const folderResult = await ipc.pickFolder({
        title: t("vrchatWorkspace.pickDownloadFolder", {
          defaultValue: "Select download folder",
        }),
        initialDir: lastDir ?? undefined,
      });
      if (folderResult.cancelled || !folderResult.path) {
        return;
      }
      saveLastDownloadDir(folderResult.path);

      // Fetch avatar details to get the asset URL
      const detailsResult = await ipc.call<
        { id: string },
        { details: AvatarDetails | null }
      >("avatar.details", { id: item.avatar_id });

      const details = detailsResult.details;
      if (!details) {
        toast.error(
          t("vrchatWorkspace.avatarDetailsFailed", {
            defaultValue: "Could not fetch avatar details. It may be private or deleted.",
          }),
        );
        return;
      }

      // Find the Windows PC asset URL
      const pcPkg = details.unityPackages?.find(
        (p) => p.platform === "standalonewindows",
      );
      const assetUrl = pcPkg?.assetUrl ?? details.assetUrl;
      if (!assetUrl) {
        toast.error(
          t("vrchatWorkspace.noAssetUrl", {
            defaultValue: "No downloadable asset URL found for this avatar.",
          }),
        );
        return;
      }

      // Download the bundle
      const result = await ipc.downloadAvatarBundle({
        avatarId: item.avatar_id,
        assetUrl,
        outDir: folderResult.path,
        displayName: details.name ?? item.avatar_name ?? undefined,
      });

      if (result.ok) {
        toast.success(
          t("vrchatWorkspace.downloadComplete", {
            defaultValue: "Downloaded to {{path}}",
            path: result.path,
          }),
        );
      }
    } catch (e) {
      toast.error(
        t("vrchatWorkspace.downloadFailed", {
          defaultValue: "Download failed: {{error}}",
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setDownloadingId(null);
    }
  }

  if (downloadables.length === 0) return null;

  return (
    <Card elevation="flat" className="p-0">
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-[13px]">
          <SectionTitle
            title={t("vrchatWorkspace.avatarDownloads", { defaultValue: "Download Bundles" })}
            count={downloadables.length}
          />
        </CardTitle>
        <CardDescription className="text-[11px]">
          {t("vrchatWorkspace.avatarDownloadsDesc", {
            defaultValue: "Download avatar .vrca bundles to a local folder. Requires sign-in.",
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="max-h-[340px] overflow-y-auto">
          <div className="flex flex-col gap-px px-2 pb-2">
            {downloadables.map((item) => {
              const isDownloading = downloadingId === item.avatar_id;
              return (
                <div
                  key={item.avatar_id}
                  className="flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-1.5 transition-colors hover:bg-[hsl(var(--surface-raised))]"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[hsl(var(--secondary)/0.2)] text-[hsl(var(--secondary-foreground))]">
                    <Download className="size-3.5" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[12px] font-medium text-[hsl(var(--foreground))]">
                      {item.avatar_name ?? shortenAvatarId(item.avatar_id)}
                    </span>
                    {item.author_name ? (
                      <span className="truncate text-[10px] text-[hsl(var(--muted-foreground))]">
                        {item.author_name}
                      </span>
                    ) : null}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 gap-1 text-[11px]"
                    disabled={isDownloading}
                    onClick={() => handleDownload(item)}
                  >
                    {isDownloading ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Download className="size-3" />
                    )}
                    {t("vrchatWorkspace.download", { defaultValue: "Download" })}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Tab Root ─────────────────────────────────────────────────────────────

export default function TabAvatars() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <AvatarHistorySection />
      <AvatarDownloadSection />
    </div>
  );
}
