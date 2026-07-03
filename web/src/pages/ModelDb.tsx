import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  EyeOff,
  Globe2,
  Image as ImageIcon,
  Loader2,
  Lock,
  Pencil,
  RefreshCcw,
  Radar,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LoginForm } from "@/components/LoginForm";
import {
  LayoutModeSwitcher,
  useLayoutMode,
  type LayoutMode,
} from "@/components/LayoutModeSwitcher";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { ipc } from "@/lib/ipc";
import { getAvatarDetails } from "@/lib/vrchat-api";
import { FLAG_AMPLITUDE_HARVEST, useExperimentalFlag } from "@/lib/experimental";
import { harvestLocalAvatarIds, newlyHarvestedIds } from "@/lib/avatar-harvest";
import {
  buildAvatarPatch,
  deleteAvatar,
  listOwnedAvatars,
  replaceAvatarImageFromFile,
  updateAvatar,
  type OwnedAvatarReleaseFilter,
} from "@/lib/vrc-media";
import type { AvatarSearchResult, AvatarDetails } from "@/lib/types";

const RELEASE_FILTERS: OwnedAvatarReleaseFilter[] = ["all", "public", "private", "hidden"];
const RELEASE_OPTIONS = ["public", "private"] as const;
const OWNED_QUERY_KEY = "avatars.listOwned";

// Card grid classes per layout mode — mirrors the Worlds page so the model
// manager gets the same switchable density (九宫格 / 四宫格 / 一排 / 一列).
const MODEL_LAYOUT_CLASS: Record<LayoutMode, string> = {
  "default": "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
  "grid-3": "grid grid-cols-3 gap-3",
  "grid-2": "grid grid-cols-2 gap-3",
  "row": "flex flex-col gap-2",
  "list": "flex flex-col divide-y divide-[hsl(var(--border))] rounded-[var(--radius-md)] border border-[hsl(var(--border))]",
};

function releaseIcon(status: string | null | undefined) {
  if (status === "public") return <Globe2 className="size-3" />;
  if (status === "hidden") return <Trash2 className="size-3" />;
  return <Lock className="size-3" />;
}

export default function ModelDb({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const { status } = useAuth();
  const qc = useQueryClient();
  const [loginOpen, setLoginOpen] = useState(false);
  const [release, setRelease] = useState<OwnedAvatarReleaseFilter>("all");
  const [query, setQuery] = useState("");
  const [manageTarget, setManageTarget] = useState<AvatarSearchResult | null>(null);
  const [harvestEnabled] = useExperimentalFlag(FLAG_AMPLITUDE_HARVEST);
  const [harvesting, setHarvesting] = useState(false);
  const [layout, setLayout] = useLayoutMode("models");

  const queryKey = useMemo(() => [OWNED_QUERY_KEY, { releaseStatus: release }], [release]);

  // VRChat refuses to *list* hidden avatars (the API 401s), so the "hidden"
  // filter can't drive a normal list query. We surface a by-id lookup panel
  // instead — see HiddenAvatarLookup below — and skip the list query entirely.
  const isHidden = release === "hidden";

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () => listOwnedAvatars(release),
    enabled: status.authed && !isHidden,
    staleTime: 30_000,
  });

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: [OWNED_QUERY_KEY] });
  }, [qc]);

  const avatars = data ?? [];

  const onScanLocalCache = useCallback(async () => {
    // Gated: harvestLocalAvatarIds performs no IPC unless the flag is ON.
    if (!harvestEnabled || harvesting) return;
    setHarvesting(true);
    try {
      const ids = await harvestLocalAvatarIds(harvestEnabled);
      const owned = new Set(avatars.map((a) => a.id));
      const fresh = newlyHarvestedIds(ids, owned);
      if (ids.length === 0) {
        toast.info(
          t("modelDb.harvest.empty", {
            defaultValue:
              "No avatar ids found in the local analytics cache (or VRChat hasn't written one yet).",
          }),
        );
      } else {
        toast.success(
          t("modelDb.harvest.found", {
            total: ids.length,
            fresh: fresh.length,
            defaultValue:
              "Found {{total}} avatar id(s) locally · {{fresh}} not in your owned list.",
          }),
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setHarvesting(false);
    }
  }, [harvestEnabled, harvesting, avatars, t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return avatars;
    return avatars.filter((a) =>
      [a.id, a.name, a.description, a.releaseStatus, ...(a.tags ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [avatars, query]);

  if (!status.authed) {
    return (
      <div className="flex flex-col gap-4 animate-fade-in">
        {!embedded && (
          <header>
            <h1 className="text-[22px] font-semibold leading-none tracking-tight flex items-center gap-2">
              <Boxes className="size-5 text-[hsl(var(--primary))]" />
              {t("modelDb.title", { defaultValue: "Model Database" })}
            </h1>
          </header>
        )}
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>{t("friends.signInRequired")}</CardTitle>
            <CardDescription>{t("friends.signInRequiredBody")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="tonal" onClick={() => setLoginOpen(true)}>
              {t("auth.signInWithVrchat", { defaultValue: "Sign in with VRChat" })}
            </Button>
          </CardContent>
        </Card>
        <LoginForm open={loginOpen} onOpenChange={setLoginOpen} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      {!embedded && (
        <header className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold leading-none tracking-tight flex items-center gap-2">
            <Boxes className="size-5 text-[hsl(var(--primary))]" />
            {t("modelDb.title", { defaultValue: "Model Database" })}
          </h1>
          <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("modelDb.subtitle", {
              defaultValue:
                "Manage the avatars your account owns: rename, edit visibility, swap the image, or delete.",
            })}
          </p>
        </header>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("modelDb.searchPlaceholder", { defaultValue: "Filter your avatars" })}
            className="h-8 pl-8 text-[12px]"
          />
        </div>
        <div className="flex items-center gap-1 rounded-[var(--radius)] border border-[hsl(var(--border)/0.5)] p-0.5">
          {RELEASE_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setRelease(f)}
              className={cn(
                "h-7 rounded-[calc(var(--radius)-2px)] px-2.5 text-[11px] capitalize transition-colors",
                release === f
                  ? "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))]"
                  : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
              )}
            >
              {t(`modelDb.filter.${f}`, { defaultValue: f })}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-[12px] gap-1.5"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          <RefreshCcw className={cn("size-3.5", isFetching && "animate-spin")} />
          {t("common.refresh", { defaultValue: "Refresh" })}
        </Button>
        {harvestEnabled && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-[12px] gap-1.5"
            disabled={harvesting}
            title={t("modelDb.harvest.tooltip", {
              defaultValue:
                "Read-only scan of VRChat's local analytics cache for avatar ids (experimental).",
            })}
            onClick={() => void onScanLocalCache()}
          >
            <Radar className={cn("size-3.5", harvesting && "animate-spin")} />
            {t("modelDb.harvest.scan", { defaultValue: "Scan local cache" })}
          </Button>
        )}
        <LayoutModeSwitcher value={layout} onChange={setLayout} />
      </div>

      {isHidden ? (
        <HiddenAvatarLookup
          onManage={(avatar) => setManageTarget(avatar)}
          layoutClass={MODEL_LAYOUT_CLASS[layout]}
        />
      ) : isLoading ? (
        <div className="flex items-center justify-center py-16 text-[hsl(var(--muted-foreground))]">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : isError ? (
        <Card elevation="flat">
          <CardContent className="py-6 text-[12px] text-[hsl(var(--destructive))]">
            {error instanceof Error ? error.message : String(error)}
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card elevation="flat">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-[12px] text-[hsl(var(--muted-foreground))]">
            <Boxes className="size-6" />
            {t("modelDb.empty", { defaultValue: "No owned avatars found." })}
          </CardContent>
        </Card>
      ) : (
        <div className={MODEL_LAYOUT_CLASS[layout]}>
          {filtered.map((avatar) => (
            <ModelCard
              key={avatar.id}
              avatar={avatar}
              onManage={() => setManageTarget(avatar)}
            />
          ))}
        </div>
      )}

      {manageTarget && (
        <ManageDialog
          avatar={manageTarget}
          open={Boolean(manageTarget)}
          onClose={() => setManageTarget(null)}
          onChanged={invalidate}
        />
      )}
    </div>
  );
}

/**
 * Hidden-avatar lookup. VRChat refuses to *list* hidden (deleted) avatars —
 * `GET /avatars?user=me&releaseStatus=hidden` 401s even with a valid session,
 * and `releaseStatus=all` never includes them. The only way to see a hidden
 * avatar is to fetch it by id (`GET /avatars/{id}`), which works for avatars
 * you own. So we gather candidate ids from the local log history (avatars this
 * install has seen) plus any id the user pastes, resolve each by id, and keep
 * the ones that come back `releaseStatus === "hidden"`.
 */
function HiddenAvatarLookup({
  onManage,
  layoutClass,
}: {
  onManage: (avatar: AvatarSearchResult) => void;
  layoutClass: string;
}) {
  const { t } = useTranslation();
  const [manualId, setManualId] = useState("");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [found, setFound] = useState<AvatarSearchResult[]>([]);
  const [checkedCount, setCheckedCount] = useState(0);

  const detailsToResult = useCallback((d: AvatarDetails): AvatarSearchResult => ({
    id: d.id,
    name: d.name,
    description: d.description ?? "",
    authorId: d.authorId,
    authorName: d.authorName,
    imageUrl: d.imageUrl ?? "",
    thumbnailImageUrl: d.thumbnailImageUrl ?? "",
    releaseStatus: d.releaseStatus,
    version: d.version,
    tags: d.tags ?? [],
    created_at: d.created_at ?? "",
    updated_at: d.updated_at ?? "",
  }), []);

  // Resolve a single id and, if it's a hidden avatar, fold it into `found`.
  const probeId = useCallback(
    async (id: string): Promise<"hidden" | "other" | "error"> => {
      try {
        const { details } = await getAvatarDetails(id);
        if (!details) return "error";
        if (details.releaseStatus === "hidden") {
          setFound((prev) =>
            prev.some((a) => a.id === details.id)
              ? prev
              : [...prev, detailsToResult(details)],
          );
          return "hidden";
        }
        return "other";
      } catch {
        return "error";
      }
    },
    [detailsToResult],
  );

  const onLookupManual = useCallback(async () => {
    const id = manualId.trim();
    if (!/^avtr_[0-9a-fA-F-]+$/.test(id)) {
      toast.error(t("modelDb.hidden.badId", { defaultValue: "Enter a valid avtr_ id." }));
      return;
    }
    const result = await probeId(id);
    if (result === "hidden") {
      toast.success(t("modelDb.hidden.foundOne", { defaultValue: "Hidden avatar resolved." }));
      setManualId("");
    } else if (result === "other") {
      toast.info(
        t("modelDb.hidden.notHidden", {
          defaultValue: "That avatar exists but isn't hidden.",
        }),
      );
    } else {
      toast.error(
        t("modelDb.hidden.notOwned", {
          defaultValue: "Couldn't resolve that id — VRChat only returns avatars you own.",
        }),
      );
    }
  }, [manualId, probeId, t]);

  // Scan ids the local DB has seen in logs. We page through db.avatarHistory
  // and probe each id with a bounded concurrency so we don't hammer the API.
  const onScanHistory = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    setFound([]);
    setCheckedCount(0);
    setProgress({ done: 0, total: 0 });
    try {
      const ids: string[] = [];
      const seen = new Set<string>();
      const pageSize = 100;
      for (let offset = 0; offset < 2000; offset += pageSize) {
        const page = await ipc.call<
          { limit: number; offset: number },
          { items?: Array<{ avatar_id: string }> }
        >("db.avatarHistory.list", { limit: pageSize, offset });
        const items = page.items ?? [];
        for (const it of items) {
          if (it.avatar_id && !seen.has(it.avatar_id)) {
            seen.add(it.avatar_id);
            ids.push(it.avatar_id);
          }
        }
        if (items.length < pageSize) break;
      }

      setProgress({ done: 0, total: ids.length });
      if (ids.length === 0) {
        toast.info(
          t("modelDb.hidden.noHistory", {
            defaultValue: "No avatar ids in local history yet. Play VRChat to populate it, or paste an id above.",
          }),
        );
        return;
      }

      // Bounded-concurrency worker pool over the id list.
      let cursor = 0;
      let done = 0;
      const CONCURRENCY = 4;
      const worker = async () => {
        for (;;) {
          const i = cursor++;
          if (i >= ids.length) return;
          await probeId(ids[i]);
          done += 1;
          setProgress({ done, total: ids.length });
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      setCheckedCount(ids.length);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, [scanning, probeId, t]);

  return (
    <div className="flex flex-col gap-3">
      <Card elevation="flat">
        <CardContent className="flex flex-col gap-3 py-4">
          <div className="flex items-start gap-2 text-[12px] text-[hsl(var(--muted-foreground))]">
            <EyeOff className="mt-0.5 size-4 shrink-0" />
            <p>
              {t("modelDb.hidden.explainer", {
                defaultValue:
                  "VRChat can't list hidden (deleted) avatars. Look them up by id instead — scan ids seen in your local logs, or paste a specific avtr_ id. Only avatars you own will resolve.",
              })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Input
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void onLookupManual();
                }}
                placeholder="avtr_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="h-8 text-[12px] font-mono"
              />
            </div>
            <Button
              variant="tonal"
              size="sm"
              className="h-8 text-[12px]"
              disabled={scanning}
              onClick={() => void onLookupManual()}
            >
              {t("modelDb.hidden.lookup", { defaultValue: "Look up id" })}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-[12px]"
              disabled={scanning}
              onClick={() => void onScanHistory()}
            >
              <Radar className={cn("size-3.5", scanning && "animate-spin")} />
              {t("modelDb.hidden.scanHistory", { defaultValue: "Scan log history" })}
            </Button>
          </div>
          {progress && progress.total > 0 && (
            <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
              {scanning
                ? t("modelDb.hidden.scanning", {
                    done: progress.done,
                    total: progress.total,
                    defaultValue: "Checking {{done}} / {{total}} ids…",
                  })
                : t("modelDb.hidden.scanDone", {
                    checked: checkedCount,
                    found: found.length,
                    defaultValue: "Checked {{checked}} ids · {{found}} hidden avatar(s) found.",
                  })}
            </div>
          )}
        </CardContent>
      </Card>

      {found.length > 0 && (
        <div className={layoutClass}>
          {found.map((avatar) => (
            <ModelCard key={avatar.id} avatar={avatar} onManage={() => onManage(avatar)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ModelCard({
  avatar,
  onManage,
}: {
  avatar: AvatarSearchResult;
  onManage: () => void;
}) {
  const { t } = useTranslation();
  const image = avatar.thumbnailImageUrl || avatar.imageUrl;
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--surface))]">
      <div className="relative aspect-square overflow-hidden bg-[hsl(var(--muted)/0.3)]">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt={avatar.name}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-[hsl(var(--muted-foreground))]">
            <ImageIcon className="size-6" />
          </div>
        )}
        <Badge
          variant="secondary"
          className="absolute left-1.5 top-1.5 h-5 gap-1 px-1.5 text-[10px] capitalize"
        >
          {releaseIcon(avatar.releaseStatus)}
          {avatar.releaseStatus || "unknown"}
        </Badge>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <div className="truncate text-[12px] font-medium" title={avatar.name}>
          {avatar.name || avatar.id}
        </div>
        {avatar.description ? (
          <p className="line-clamp-2 text-[11px] text-[hsl(var(--muted-foreground))]">
            {avatar.description}
          </p>
        ) : null}
        <div className="mt-auto pt-1.5">
          <Button
            variant="tonal"
            size="sm"
            className="h-7 w-full gap-1.5 text-[11px]"
            onClick={onManage}
          >
            <Pencil className="size-3" />
            {t("modelDb.manage", { defaultValue: "Manage" })}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ManageDialog({
  avatar,
  open,
  onClose,
  onChanged,
}: {
  avatar: AvatarSearchResult;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(avatar.name ?? "");
  const [description, setDescription] = useState(avatar.description ?? "");
  const [releaseStatus, setReleaseStatus] = useState(avatar.releaseStatus ?? "private");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const busy = saving || uploading || deleting;

  async function onSave() {
    const patch = buildAvatarPatch(
      {
        name: avatar.name,
        description: avatar.description,
        releaseStatus: avatar.releaseStatus,
      },
      { name, description, releaseStatus },
    );
    if (!patch) {
      toast.info(t("modelDb.noChanges", { defaultValue: "No changes to save." }));
      return;
    }
    setSaving(true);
    try {
      await updateAvatar(avatar.id, patch);
      toast.success(t("modelDb.saved", { defaultValue: "Avatar updated." }));
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function onConfirmReplaceImage() {
    if (!pendingImage) return;
    setUploading(true);
    try {
      await replaceAvatarImageFromFile(avatar.id, pendingImage, true);
      toast.success(t("modelDb.imageReplaced", { defaultValue: "Avatar image replaced." }));
      setPendingImage(null);
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function onConfirmDelete() {
    setDeleting(true);
    try {
      await deleteAvatar(avatar.id);
      toast.success(t("modelDb.deleted", { defaultValue: "Avatar deleted." }));
      onChanged();
      setConfirmDelete(false);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => (!o && !busy ? onClose() : undefined)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("modelDb.manageTitle", { defaultValue: "Manage avatar" })}</DialogTitle>
            <DialogDescription className="truncate font-mono text-[11px]">
              {avatar.id}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
                {t("modelDb.field.name", { defaultValue: "Name" })}
              </span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
                className="h-8 text-[12px]"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
                {t("modelDb.field.description", { defaultValue: "Description" })}
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={busy}
                rows={3}
                className="resize-none rounded-[var(--radius)] border border-[hsl(var(--border)/0.6)] bg-[hsl(var(--background))] px-2.5 py-1.5 text-[12px] outline-none focus:border-[hsl(var(--primary))]"
              />
            </label>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
                {t("modelDb.field.visibility", { defaultValue: "Visibility" })}
              </span>
              <div className="flex items-center gap-1.5">
                {RELEASE_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    disabled={busy}
                    onClick={() => setReleaseStatus(opt)}
                    className={cn(
                      "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius)] border text-[12px] capitalize transition-colors",
                      releaseStatus === opt
                        ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]"
                        : "border-[hsl(var(--border)/0.5)] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
                    )}
                  >
                    {releaseIcon(opt)}
                    {t(`modelDb.filter.${opt}`, { defaultValue: opt })}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
                {t("modelDb.field.image", { defaultValue: "Avatar image" })}
              </span>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setPendingImage(f);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-[12px]"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Upload className="size-3.5" />
                )}
                {t("modelDb.replaceImage", { defaultValue: "Replace image" })}
              </Button>
            </div>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-[12px] text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/0.1)]"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-3.5" />
              {t("modelDb.delete", { defaultValue: "Delete avatar" })}
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 text-[12px]" disabled={busy} onClick={onClose}>
                {t("common.cancel", { defaultValue: "Cancel" })}
              </Button>
              <Button size="sm" className="h-8 gap-1.5 text-[12px]" disabled={busy} onClick={() => void onSave()}>
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {t("common.save", { defaultValue: "Save" })}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        tone="destructive"
        loading={deleting}
        title={t("modelDb.deleteConfirmTitle", { defaultValue: "Delete this avatar?" })}
        description={t("modelDb.deleteConfirmBody", {
          name: avatar.name || avatar.id,
          defaultValue:
            'Permanently delete "{{name}}"? VRChat hides the avatar, removes its asset files, and reserves the id forever. This cannot be undone.',
        })}
        confirmLabel={t("modelDb.delete", { defaultValue: "Delete avatar" })}
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        onConfirm={() => void onConfirmDelete()}
      />

      <ConfirmDialog
        open={pendingImage !== null}
        onOpenChange={(o) => {
          if (!o && !uploading) setPendingImage(null);
        }}
        tone="destructive"
        loading={uploading}
        title={t("modelDb.replaceImageConfirmTitle", { defaultValue: "Replace this avatar's image?" })}
        description={t("modelDb.replaceImageConfirmBody", {
          name: avatar.name || avatar.id,
          defaultValue:
            'Upload a new image for "{{name}}" and re-point it on your live VRChat account. The avatar\'s public thumbnail changes immediately.',
        })}
        confirmLabel={t("modelDb.replaceImage", { defaultValue: "Replace image" })}
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        onConfirm={() => void onConfirmReplaceImage()}
      />
    </>
  );
}
