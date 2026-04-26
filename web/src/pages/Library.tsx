import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Copy,
  Edit3,
  ExternalLink,
  FileText,
  Globe2,
  Heart,
  LayoutGrid,
  Loader2,
  Search,
  Shirt,
  Tag,
  Trash2,
  User,
  RefreshCw,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import {
  LIBRARY_LIST_NAME,
  normalizeFavoriteType,
  useFavoriteActions,
  useFavoriteItems,
  useFavoriteLists,
  type FavoriteEntityType,
} from "@/lib/library";
import { useAuth } from "@/lib/auth-context";
import { ipc } from "@/lib/ipc";
import {
  LayoutModeSwitcher,
  useLayoutMode,
  type LayoutMode,
} from "@/components/LayoutModeSwitcher";

const LIBRARY_LAYOUT_CLASS: Record<LayoutMode, string> = {
  "default": "grid gap-4 md:grid-cols-2 2xl:grid-cols-3",
  "grid-3": "grid gap-4 grid-cols-3",
  "grid-2": "grid gap-4 grid-cols-2",
  "row": "flex flex-col gap-3",
  "list": "flex flex-col divide-y divide-[hsl(var(--border))] rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))]",
};
import { useThumbnail } from "@/lib/thumbnails";
import type { FavoriteItem } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { ImageZoom } from "@/components/ImageZoom";

type TypeFilter = "all" | FavoriteEntityType;

function parseTagInput(input: string) {
  return input
    .split(/[\n,，]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function typeMeta(type: FavoriteEntityType) {
  switch (type) {
    case "avatar":
      return {
        labelKey: "library.types.avatar",
        icon: Shirt,
      };
    case "world":
      return {
        labelKey: "library.types.world",
        icon: Globe2,
      };
    case "user":
      return {
        labelKey: "library.types.user",
        icon: User,
      };
    default:
      return {
        labelKey: "library.types.other",
        icon: LayoutGrid,
      };
  }
}

function LibraryThumb({ item }: { item: FavoriteItem }) {
  const type = normalizeFavoriteType(item.type);
  const { url } = useThumbnail(item.thumbnail_url ? null : item.target_id);
  const resolvedUrl = item.thumbnail_url ?? url;
  const meta = typeMeta(type);
  const Icon = meta.icon;

  return (
    <div className="relative h-28 overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]">
      <div
        className="absolute inset-0 opacity-80"
        style={{
          background:
            type === "avatar"
              ? "linear-gradient(135deg, rgba(217,148,71,0.9), rgba(65,35,22,0.95))"
              : type === "world"
                ? "linear-gradient(135deg, rgba(59,143,214,0.9), rgba(19,41,64,0.95))"
                : type === "user"
                  ? "linear-gradient(135deg, rgba(111,179,92,0.9), rgba(24,51,21,0.95))"
                  : "linear-gradient(135deg, rgba(143,143,143,0.9), rgba(40,40,40,0.95))",
        }}
      />
      {resolvedUrl ? (
        <ImageZoom
          src={resolvedUrl}
          className="absolute inset-0 h-full w-full z-[1]"
          imgClassName="h-full w-full object-cover"
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
      <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-white/15 bg-black/35 px-2 py-1 text-[10px] uppercase tracking-wider text-white/90">
        <Icon className="size-3" />
        {type}
      </div>
    </div>
  );
}

function LibraryTagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.slice(0, 4).map((tag) => (
        <Badge key={tag} variant="muted" className="gap-1 text-[10px]">
          <Tag className="size-3" />
          {tag}
        </Badge>
      ))}
      {tags.length > 4 ? (
        <Badge variant="muted" className="text-[10px]">
          +{tags.length - 4}
        </Badge>
      ) : null}
    </div>
  );
}

function LibraryEditDialog({
  item,
  open,
  pending,
  onOpenChange,
  onSave,
}: {
  item: FavoriteItem | null;
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: { note: string; tags: string[] }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState("");
  const [tagsInput, setTagsInput] = useState("");

  useEffect(() => {
    if (!open || !item) return;
    setNote(item.note ?? "");
    setTagsInput(item.tags.join(", "));
  }, [item, open]);

  async function handleSave() {
    if (!item) return;
    await onSave({
      note,
      tags: parseTagInput(tagsInput),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("library.editTitle")}</DialogTitle>
          <DialogDescription>
            {item
              ? t("library.editBody", {
                  name: item.display_name || item.target_id,
                })
              : t("library.editBody", { name: "…" })}
          </DialogDescription>
        </DialogHeader>

        {item ? (
          <div className="space-y-4">
            <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3">
              <div className="text-[13px] font-medium text-[hsl(var(--foreground))]">
                {item.display_name || item.target_id}
              </div>
              <div className="mt-1 font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                {item.target_id}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="secondary">
                  {t(typeMeta(normalizeFavoriteType(item.type)).labelKey)}
                </Badge>
                <Badge variant="muted">{item.list_name}</Badge>
                {item.note_updated_at ? (
                  <Badge variant="muted">
                    {t("library.noteUpdatedAt", {
                      date: formatDate(item.note_updated_at),
                    })}
                  </Badge>
                ) : null}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[12px] font-medium text-[hsl(var(--foreground))]">
                <FileText className="size-3.5" />
                {t("library.noteLabel")}
              </div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("library.notePlaceholder")}
                className={cn(
                  "min-h-[130px] w-full resize-y rounded-[var(--radius-md)] border border-[hsl(var(--border))]",
                  "bg-[hsl(var(--canvas))] px-3 py-2 text-[12px] text-[hsl(var(--foreground))]",
                  "placeholder:text-[hsl(var(--muted-foreground))]",
                  "focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]",
                )}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[12px] font-medium text-[hsl(var(--foreground))]">
                <Tag className="size-3.5" />
                {t("library.tagsLabel")}
              </div>
              <Input
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder={t("library.tagsPlaceholder")}
                className="text-[12px]"
              />
              <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
                {t("library.tagsHint")}
              </div>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!item || pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Edit3 className="size-4" />}
            {pending ? t("library.detailsSaving") : t("library.saveDetails")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LibraryItemCard({
  item,
  onOpen,
  onRemove,
  onEdit,
}: {
  item: FavoriteItem;
  onOpen: (item: FavoriteItem) => void;
  onRemove: (item: FavoriteItem) => void;
  onEdit: (item: FavoriteItem) => void;
}) {
  const { t } = useTranslation();
  const type = normalizeFavoriteType(item.type);
  const meta = typeMeta(type);

  return (
    <Card className="overflow-hidden">
      <LibraryThumb item={item} />
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-[hsl(var(--foreground))]">
                {item.display_name || item.target_id}
              </div>
              <div className="truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                {item.target_id}
              </div>
            </div>
            <Badge variant="secondary" className="shrink-0">
              {t(meta.labelKey)}
            </Badge>
          </div>
          <div className="text-[10px] text-[hsl(var(--muted-foreground))]">
            {t("library.addedAt", { date: formatDate(item.added_at) })}
          </div>
        </div>

        <div className="space-y-2">
          <LibraryTagChips tags={item.tags} />
          <div className="min-h-10 rounded-[var(--radius-sm)] border border-dashed border-[hsl(var(--border)/0.8)] bg-[hsl(var(--surface))] px-3 py-2 text-[11px] text-[hsl(var(--muted-foreground))]">
            {item.note ? (
              <div className="line-clamp-3 whitespace-pre-wrap text-[hsl(var(--foreground))]">
                {item.note}
              </div>
            ) : (
              t("library.noteEmpty")
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpen(item)}
          >
            <ExternalLink />
            {t("library.open")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              navigator.clipboard
                .writeText(item.target_id)
                .then(() => toast.success(t("library.copyOk")))
                .catch((e: unknown) => {
                  const message = e instanceof Error ? e.message : String(e);
                  toast.error(t("library.copyFailed", { error: message }));
                });
            }}
          >
            <Copy />
            {t("common.copy")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(item)}
          >
            <Edit3 />
            {t("library.edit")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-[hsl(var(--destructive))] hover:text-[hsl(var(--destructive))]"
            onClick={() => onRemove(item)}
          >
            <Trash2 />
            {t("library.remove")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Library() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { status: authStatus } = useAuth();
  const { mergedLists, isLoading: listsLoading } = useFavoriteLists();
  const [selectedListName, setSelectedListName] = useState(LIBRARY_LIST_NAME);
  const [search, setSearch] = useState("");
  const [layoutMode, setLayoutMode] = useLayoutMode("library");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<FavoriteItem | null>(null);
  const [syncingOfficial, setSyncingOfficial] = useState(false);
  const [lastOfficialSyncAt, setLastOfficialSyncAt] = useState<string | null>(null);
  const officialSyncTriggeredRef = useRef(false);
  const { items, isLoading: itemsLoading } = useFavoriteItems(selectedListName, !!selectedListName);
  const { removeFavorite, saveFavoriteDetails, pending } = useFavoriteActions();

  useEffect(() => {
    if (mergedLists.length === 0) return;
    if (mergedLists.some((row) => row.list_name === selectedListName)) return;
    setSelectedListName(mergedLists[0].list_name);
  }, [mergedLists, selectedListName]);

  useEffect(() => {
    if (!tagFilter) return;
    const stillExists = items.some((item) => item.tags.includes(tagFilter));
    if (!stillExists) {
      setTagFilter(null);
    }
  }, [items, tagFilter]);

  const counts = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        const type = normalizeFavoriteType(item.type);
        acc.total += 1;
        acc[type] += 1;
        return acc;
      },
      {
        total: 0,
        avatar: 0,
        world: 0,
        user: 0,
        other: 0,
      },
    );
  }, [items]);

  const libraryListRow =
    mergedLists.find((row) => row.list_name === LIBRARY_LIST_NAME) ?? null;
  const otherLists = mergedLists.filter((row) => row.list_name !== LIBRARY_LIST_NAME);
  const totalSaved = mergedLists.reduce((sum, row) => sum + row.item_count, 0);
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const tag of item.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort((a, b) =>
      b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0]),
    );
  }, [items]);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      const type = normalizeFavoriteType(item.type);
      if (typeFilter !== "all" && type !== typeFilter) return false;
      if (tagFilter && !item.tags.includes(tagFilter)) return false;
      if (!q) return true;
      return (
        item.target_id.toLowerCase().includes(q) ||
        (item.display_name?.toLowerCase().includes(q) ?? false) ||
        item.list_name.toLowerCase().includes(q) ||
        (item.note?.toLowerCase().includes(q) ?? false) ||
        item.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [items, search, typeFilter, tagFilter]);

  async function handleRemove(item: FavoriteItem) {
    try {
      await removeFavorite({
        type: item.type ?? "other",
        target_id: item.target_id,
        list_name: item.list_name,
      });
      toast.success(t("library.removeOk"));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(t("library.removeFailed", { error: message }));
    }
  }

  function handleOpen(item: FavoriteItem) {
    const type = normalizeFavoriteType(item.type);
    if (type === "avatar") {
      navigate(`/avatars?select=${encodeURIComponent(item.target_id)}`);
      return;
    }
    if (type === "world") {
      navigate(`/worlds?select=${encodeURIComponent(item.target_id)}`);
      return;
    }
    if (type === "user") {
      navigate("/friends");
      return;
    }
    navigate("/");
  }

  async function handleSaveDetails(payload: { note: string; tags: string[] }) {
    if (!editingItem) return;
    try {
      await saveFavoriteDetails({
        type: editingItem.type ?? "other",
        target_id: editingItem.target_id,
        list_name: editingItem.list_name,
        note: payload.note,
        tags: payload.tags,
      });
      toast.success(t("library.detailsSaved"));
      setEditingItem(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(t("library.detailsSaveFailed", { error: message }));
    }
  }

  const selectedList =
    mergedLists.find((row) => row.list_name === selectedListName) ?? null;

  useEffect(() => {
    if (!authStatus.authed) {
      officialSyncTriggeredRef.current = false;
      return;
    }
    if (officialSyncTriggeredRef.current) return;
    officialSyncTriggeredRef.current = true;
    void handleSyncOfficialFavorites(false);
  }, [authStatus.authed]);

  async function handleSyncOfficialFavorites(showToast = true) {
    if (!authStatus.authed || syncingOfficial) return;

    setSyncingOfficial(true);
    try {
      const result = await ipc.favoriteSyncOfficial();
      setLastOfficialSyncAt(result.synced_at);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["favorites.lists"] }),
        queryClient.invalidateQueries({ queryKey: ["favorites.items"] }),
      ]);
      if (showToast) {
        toast.success(
          t("library.officialSyncSuccess", {
            count: result.imported,
            avatars: result.avatars,
            worlds: result.worlds,
          }),
        );
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (showToast) {
        toast.error(t("library.officialSyncFailed", { error: message }));
      }
    } finally {
      setSyncingOfficial(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight">
            {t("library.title")}
          </h1>
          <p className="mt-1.5 text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("library.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {authStatus.authed ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleSyncOfficialFavorites(true)}
              disabled={syncingOfficial}
            >
              {syncingOfficial ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {syncingOfficial
                ? t("library.officialSyncing")
                : t("library.officialSync")}
            </Button>
          ) : null}
          <Badge variant="tonal" className="gap-1.5">
            <Heart className="size-3" />
            {t("library.totalSaved", { count: totalSaved })}
          </Badge>
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("library.cards.total")}</CardDescription>
            <CardTitle className="text-[22px]">{counts.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("library.cards.avatars")}</CardDescription>
            <CardTitle className="text-[22px]">{counts.avatar}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("library.cards.worlds")}</CardDescription>
            <CardTitle className="text-[22px]">{counts.world}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("library.cards.collections")}</CardDescription>
            <CardTitle className="text-[22px]">{mergedLists.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[260px_1fr]">
        <Card elevation="flat" className="flex flex-col overflow-hidden p-0">
          <div className="unity-panel-header flex items-center justify-between">
            <span>{t("library.collections")}</span>
            <span className="font-mono text-[10px] normal-case tracking-normal">
              {mergedLists.length}
            </span>
          </div>
          <div className="flex flex-col gap-px p-2">
            <button
              type="button"
              onClick={() => setSelectedListName(LIBRARY_LIST_NAME)}
              className={cn(
                "flex items-center justify-between rounded-[var(--radius-sm)] border px-3 py-2 text-left transition-colors",
                selectedListName === LIBRARY_LIST_NAME
                  ? "border-[hsl(var(--primary)/0.55)] bg-[hsl(var(--primary)/0.16)]"
                  : "border-transparent hover:bg-[hsl(var(--surface-raised))]",
              )}
            >
              <div className="min-w-0">
              <div className="text-[12px] font-medium text-[hsl(var(--foreground))]">
                  {t("library.defaultCollection")}
                </div>
                <div className="text-[10px] text-[hsl(var(--muted-foreground))]">
                  {t("library.defaultCollectionHint")}
                </div>
              </div>
              <Badge variant="secondary">
                {libraryListRow?.item_count ?? (selectedListName === LIBRARY_LIST_NAME ? counts.total : 0)}
              </Badge>
            </button>

            {listsLoading ? (
              <div className="flex items-center gap-2 px-3 py-4 text-[11px] text-[hsl(var(--muted-foreground))]">
                <Loader2 className="size-3.5 animate-spin" />
                <span>{t("common.loading")}</span>
              </div>
            ) : mergedLists.length === 0 ? (
              <div className="px-3 py-4 text-[11px] text-[hsl(var(--muted-foreground))]">
                {t("library.emptyCollections")}
              </div>
            ) : (
              otherLists.map((row) => (
                <button
                  key={row.list_name}
                  type="button"
                  onClick={() => setSelectedListName(row.list_name)}
                  className={cn(
                    "flex items-center justify-between rounded-[var(--radius-sm)] border px-3 py-2 text-left transition-colors",
                    selectedListName === row.list_name
                      ? "border-[hsl(var(--primary)/0.55)] bg-[hsl(var(--primary)/0.16)]"
                      : "border-transparent hover:bg-[hsl(var(--surface-raised))]",
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-medium text-[hsl(var(--foreground))]">
                      {row.name}
                    </div>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {row.types.map((type) => (
                        <Badge key={`${row.list_name}-${type}`} variant="muted" className="text-[10px]">
                          {t(typeMeta(type).labelKey)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Badge variant="secondary">{row.item_count}</Badge>
                </button>
              ))
            )}
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card elevation="flat" className="p-0">
            <CardHeader className="gap-3 pb-3">
              <div className="flex flex-col gap-1">
                <CardTitle>{selectedList?.name ?? t("library.defaultCollection")}</CardTitle>
                <CardDescription>
                  {t("library.collectionMeta", {
                    count: items.length,
                    date: formatDate(selectedList?.latest_added_at ?? items[items.length - 1]?.added_at),
                  })}
                </CardDescription>
                {lastOfficialSyncAt ? (
                  <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
                    {t("library.officialLastSync", { date: formatDate(lastOfficialSyncAt) })}
                  </div>
                ) : null}
              </div>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="relative md:max-w-sm md:flex-1">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("library.searchPlaceholder")}
                    className="h-8 pl-7 text-[12px]"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(["all", "avatar", "world", "user"] as const).map((type) => (
                    <Button
                      key={type}
                      variant={typeFilter === type ? "tonal" : "ghost"}
                      size="sm"
                      onClick={() => setTypeFilter(type)}
                    >
                      {t(
                        type === "all"
                          ? "library.filters.all"
                          : typeMeta(type).labelKey,
                      )}
                    </Button>
                  ))}
                  <LayoutModeSwitcher
                    value={layoutMode}
                    onChange={setLayoutMode}
                    className="ml-auto"
                  />
                </div>
              </div>
              {tagCounts.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant={tagFilter === null ? "tonal" : "ghost"}
                    size="sm"
                    onClick={() => setTagFilter(null)}
                  >
                    {t("library.allTags")}
                  </Button>
                  {tagCounts.slice(0, 12).map(([tag, count]) => (
                    <Button
                      key={tag}
                      variant={tagFilter === tag ? "tonal" : "outline"}
                      size="sm"
                      onClick={() => setTagFilter(tag)}
                      className="gap-1.5"
                    >
                      <Tag className="size-3" />
                      {tag}
                      <span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                        {count}
                      </span>
                    </Button>
                  ))}
                </div>
              ) : null}
            </CardHeader>
          </Card>

          {itemsLoading ? (
            <Card>
              <CardContent className="flex items-center justify-center gap-2 py-8 text-[12px] text-[hsl(var(--muted-foreground))]">
                <Loader2 className="size-4 animate-spin" />
                <span>{t("common.loading")}</span>
              </CardContent>
            </Card>
          ) : visibleItems.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                <Heart className="size-6 text-[hsl(var(--muted-foreground))]" />
                <div className="text-[13px] font-medium text-[hsl(var(--foreground))]">
                  {items.length === 0 ? t("library.emptyTitle") : t("library.noMatch")}
                </div>
                <div className="max-w-md text-[11px] text-[hsl(var(--muted-foreground))]">
                  {items.length === 0 ? t("library.emptyBody") : t("library.noMatchBody")}
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className={LIBRARY_LAYOUT_CLASS[layoutMode]}>
              {visibleItems.map((item) => (
                <LibraryItemCard
                  key={`${item.list_name}:${item.type}:${item.target_id}`}
                  item={item}
                  onOpen={handleOpen}
                  onRemove={handleRemove}
                  onEdit={setEditingItem}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <LibraryEditDialog
        item={editingItem}
        open={editingItem !== null}
        pending={pending}
        onOpenChange={(open) => {
          if (!open) {
            setEditingItem(null);
          }
        }}
        onSave={handleSaveDetails}
      />

      {pending || syncingOfficial ? (
        <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
          {syncingOfficial ? t("library.officialSyncing") : t("library.syncing")}
        </div>
      ) : null}
    </div>
  );
}

export default Library;
