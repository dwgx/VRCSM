import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Crown,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCcw,
  Sticker,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useAuth } from "@/lib/auth-context";
import { useIpcQuery } from "@/hooks/useIpcQuery";
import { useCachedImageUrl } from "@/lib/image-cache";
import { cn } from "@/lib/utils";
import {
  deleteFile,
  deletePrint,
  evaluateImageUploadGate,
  fileImageUrl,
  isVrcPlusSupporter,
  listFiles,
  listInventory,
  listPrints,
  printImageUrl,
  uploadAnimatedEmojiFile,
  uploadImageFile,
  uploadPrint,
} from "@/lib/vrc-media";
import { isJsonRecord, stringArrayField } from "@/pages/workspace/workspace-utils";
import type {
  AuthUserDetailsResult,
  VrcFile,
  VrcImagePurpose,
  VrcInventoryItem,
  VrcPrint,
} from "@/lib/types";
import { LoginForm } from "@/components/LoginForm";

type TabId = "prints" | "gallery" | "icons" | "emoji" | "stickers" | "inventory";

const GALLERY_TAG = "gallery";
const ICON_TAG = "icon";

export default function VrcPlus() {
  const { t } = useTranslation();
  const { status } = useAuth();
  const [tab, setTab] = useState<TabId>("prints");
  const [loginOpen, setLoginOpen] = useState(false);

  if (!status.authed) {
    return (
      <div className="flex flex-col gap-4 animate-fade-in">
        <header>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight flex items-center gap-2">
            <Crown className="size-5 text-amber-400" />
            {t("vrcPlus.title", { defaultValue: "VRC+ Media" })}
          </h1>
        </header>
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

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "prints", label: t("vrcPlus.tab.prints", { defaultValue: "Prints" }) },
    { id: "gallery", label: t("vrcPlus.tab.gallery", { defaultValue: "Gallery" }) },
    { id: "icons", label: t("vrcPlus.tab.icons", { defaultValue: "Icons" }) },
    { id: "emoji", label: t("vrcPlus.tab.emoji", { defaultValue: "Emoji" }) },
    { id: "stickers", label: t("vrcPlus.tab.stickers", { defaultValue: "Stickers" }) },
    { id: "inventory", label: t("vrcPlus.tab.inventory", { defaultValue: "Inventory" }) },
  ];

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight flex items-center gap-2">
            <Crown className="size-5 text-amber-400" />
            {t("vrcPlus.title", { defaultValue: "VRC+ Media" })}
          </h1>
          <p className="mt-1.5 text-[13px] text-[hsl(var(--muted-foreground))]">
            {t("vrcPlus.subtitle", {
              defaultValue:
                "Manage your prints, gallery, profile icons and inventory. Uploads and deletes hit VRChat directly.",
            })}
          </p>
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {tabs.map((it) => (
          <Button
            key={it.id}
            variant={tab === it.id ? "default" : "outline"}
            size="sm"
            className="h-8 text-[12px]"
            onClick={() => setTab(it.id)}
          >
            {it.label}
          </Button>
        ))}
      </div>

      {tab === "prints" && <PrintsTab />}
      {tab === "gallery" && <FilesTab tag={GALLERY_TAG} purpose="gallery" />}
      {tab === "icons" && <FilesTab tag={ICON_TAG} purpose="icon" matchingDimensions />}
      {tab === "emoji" && <EmojiTab />}
      {tab === "stickers" && <FilesTab tag="sticker" purpose="sticker" />}
      {tab === "inventory" && <InventoryTab />}
    </div>
  );
}

// ── Prints ─────────────────────────────────────────────────────────────────

function PrintsTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<VrcPrint | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["prints.list"],
    queryFn: listPrints,
  });

  const onPick = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        await uploadPrint(file, { timestamp: new Date().toISOString() });
        toast.success(t("vrcPlus.printUploaded", { defaultValue: "Print uploaded" }));
        void qc.invalidateQueries({ queryKey: ["prints.list"] });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setUploading(false);
      }
    },
    [qc, t],
  );

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deletePrint(deleteTarget.id);
      toast.success(t("vrcPlus.printDeleted", { defaultValue: "Print deleted" }));
      void qc.invalidateQueries({ queryKey: ["prints.list"] });
      setDeleteTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  const prints = data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onPick(f);
            e.target.value = "";
          }}
        />
        <Button
          variant="tonal"
          size="sm"
          className="h-8 text-[12px] gap-1.5"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          {t("vrcPlus.uploadPrint", { defaultValue: "Upload print" })}
        </Button>
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
      </div>

      {isLoading ? (
        <CenterSpinner />
      ) : isError ? (
        <ErrorNote message={error instanceof Error ? error.message : String(error)} />
      ) : prints.length === 0 ? (
        <EmptyNote
          icon={<ImageIcon className="size-6" />}
          text={t("vrcPlus.noPrints", { defaultValue: "No prints yet." })}
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {prints.map((p) => {
            const url = printImageUrl(p);
            return (
              <div
                key={p.id}
                className="group relative overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--surface))]"
              >
                {url ? (
                  <CachedTileImage
                    id={p.id}
                    src={url}
                    alt={p.note ?? p.id}
                    imgClassName="aspect-[4/3] w-full object-cover"
                    fallbackClassName="aspect-[4/3]"
                    fallbackIcon={<ImageIcon className="size-6" />}
                  />
                ) : (
                  <div className="aspect-[4/3] grid place-items-center text-[hsl(var(--muted-foreground))]">
                    <ImageIcon className="size-6" />
                  </div>
                )}
                <button
                  type="button"
                  title={t("vrcPlus.deletePrint", { defaultValue: "Delete print" })}
                  className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[hsl(var(--destructive))]"
                  onClick={() => setDeleteTarget(p)}
                >
                  <Trash2 className="size-3.5" />
                </button>
                {p.note ? (
                  <div className="truncate px-2 py-1 text-[11px] text-[hsl(var(--muted-foreground))]">{p.note}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t("vrcPlus.deletePrintTitle", { defaultValue: "Delete this print?" })}
        description={t("vrcPlus.deletePrintBody", {
          defaultValue:
            "This permanently removes the print from your VRChat account. This cannot be undone.",
        })}
        confirmLabel={t("common.delete", { defaultValue: "Delete" })}
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        tone="destructive"
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

// ── Files (gallery / icons) ──────────────────────────────────────────────────

function FilesTab({
  tag,
  purpose,
  matchingDimensions = false,
}: {
  tag: string;
  purpose: "gallery" | "icon" | "emoji" | "sticker";
  matchingDimensions?: boolean;
}) {
  const { t } = useTranslation();
  const { status: authStatus } = useAuth();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<VrcFile | null>(null);
  const [deleting, setDeleting] = useState(false);

  const queryKey = ["files.list", tag];
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () => listFiles(tag),
  });

  // VRC+ supporter status drives the pre-upload gate (B5/B6). gallery/icon
  // uploads are supporter-only; we surface a friendly message before the
  // request instead of waiting for the API to reject it.
  const userQuery = useIpcQuery<undefined, AuthUserDetailsResult>(
    "auth.user",
    undefined,
    { enabled: authStatus.authed },
  );
  const userTags = useMemo(() => {
    const u = userQuery.data?.user;
    return isJsonRecord(u) ? stringArrayField(u, "tags") : [];
  }, [userQuery.data]);
  const isSupporter = useMemo(() => isVrcPlusSupporter(userTags), [userTags]);

  async function onPick(file: File) {
    // Strict gate first (supporter tag is VERIFIED). Slot counts are advisory
    // soft caps; gallery/icon have none so currentCount is informational.
    const gate = evaluateImageUploadGate(
      purpose as VrcImagePurpose,
      isSupporter,
      (data ?? []).length,
    );
    if (!gate.allowed) {
      if (gate.reason === "supporter_required") {
        toast.error(
          t("vrcPlus.supporterRequired", {
            defaultValue: "This needs an active VRC+ subscription.",
          }),
        );
      } else {
        toast.error(
          t("vrcPlus.limitReached", {
            limit: gate.limit,
            defaultValue: "You've reached the VRC+ limit of {{limit}} for this slot.",
          }),
        );
      }
      return;
    }
    setUploading(true);
    try {
      await uploadImageFile(file, purpose, matchingDimensions);
      toast.success(t("vrcPlus.imageUploaded", { defaultValue: "Image uploaded" }));
      void qc.invalidateQueries({ queryKey });
    } catch (e) {
      // Fallback: the server is the source of truth if our (volatile) limits
      // drift — surface its rejection verbatim.
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteFile(deleteTarget.id);
      toast.success(t("vrcPlus.imageDeleted", { defaultValue: "Image deleted" }));
      void qc.invalidateQueries({ queryKey });
      setDeleteTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  const files = data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onPick(f);
            e.target.value = "";
          }}
        />
        <Button
          variant="tonal"
          size="sm"
          className="h-8 text-[12px] gap-1.5"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          {purpose === "icon"
            ? t("vrcPlus.uploadIcon", { defaultValue: "Upload icon" })
            : purpose === "emoji"
            ? t("vrcPlus.uploadEmoji", { defaultValue: "Upload emoji" })
            : purpose === "sticker"
            ? t("vrcPlus.uploadSticker", { defaultValue: "Upload sticker" })
            : t("vrcPlus.uploadImage", { defaultValue: "Upload image" })}
        </Button>
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
      </div>

      {isLoading ? (
        <CenterSpinner />
      ) : isError ? (
        <ErrorNote message={error instanceof Error ? error.message : String(error)} />
      ) : files.length === 0 ? (
        <EmptyNote
          icon={<ImageIcon className="size-6" />}
          text={t("vrcPlus.noFiles", { defaultValue: "Nothing here yet." })}
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {files.map((f) => {
            const url = fileImageUrl(f);
            return (
              <div
                key={f.id}
                className="group relative overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--surface))]"
              >
                {url ? (
                  <CachedTileImage
                    id={f.id}
                    src={url}
                    alt={f.name ?? f.id}
                    imgClassName={cn(
                      "w-full object-cover",
                      purpose === "icon" || purpose === "emoji" || purpose === "sticker"
                        ? "aspect-square"
                        : "aspect-[3/4]",
                    )}
                    fallbackClassName="aspect-square"
                    fallbackIcon={<ImageIcon className="size-6" />}
                  />
                ) : (
                  <div className="aspect-square grid place-items-center text-[hsl(var(--muted-foreground))]">
                    <ImageIcon className="size-6" />
                  </div>
                )}
                <button
                  type="button"
                  title={t("vrcPlus.deleteImage", { defaultValue: "Delete" })}
                  className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[hsl(var(--destructive))]"
                  onClick={() => setDeleteTarget(f)}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t("vrcPlus.deleteImageTitle", { defaultValue: "Delete this image?" })}
        description={t("vrcPlus.deleteImageBody", {
          defaultValue:
            "This permanently removes the image from your VRChat account. This cannot be undone.",
        })}
        confirmLabel={t("common.delete", { defaultValue: "Delete" })}
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        tone="destructive"
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

// ── Emoji (static + animated) ────────────────────────────────────────────────

// VRChat's animated-emoji playback styles. VERIFIED against the in-game emoji
// uploader; "stop" holds the last frame, the rest loop with the named motion.
const EMOJI_ANIMATION_STYLES = [
  "stop",
  "loop",
  "bounce",
  "once",
] as const;
type EmojiAnimationStyle = (typeof EMOJI_ANIMATION_STYLES)[number];

function EmojiTab() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"static" | "animated">("static");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        <Button
          variant={mode === "static" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 text-[11px]"
          onClick={() => setMode("static")}
        >
          {t("vrcPlus.emoji.static", { defaultValue: "Static" })}
        </Button>
        <Button
          variant={mode === "animated" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 text-[11px]"
          onClick={() => setMode("animated")}
        >
          {t("vrcPlus.emoji.animated", { defaultValue: "Animated" })}
        </Button>
      </div>

      {mode === "static" ? (
        <FilesTab tag="emoji" purpose="emoji" matchingDimensions />
      ) : (
        <AnimatedEmojiTab />
      )}
    </div>
  );
}

function AnimatedEmojiTab() {
  const { t } = useTranslation();
  const { status: authStatus } = useAuth();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<VrcFile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const [frames, setFrames] = useState(4);
  const [framesOverTime, setFramesOverTime] = useState(4);
  const [animationStyle, setAnimationStyle] = useState<EmojiAnimationStyle>("loop");

  const queryKey = ["files.list", "emojianimated"];
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () => listFiles("emojianimated"),
  });

  const userQuery = useIpcQuery<undefined, AuthUserDetailsResult>(
    "auth.user",
    undefined,
    { enabled: authStatus.authed },
  );
  const userTags = useMemo(() => {
    const u = userQuery.data?.user;
    return isJsonRecord(u) ? stringArrayField(u, "tags") : [];
  }, [userQuery.data]);
  const isSupporter = useMemo(() => isVrcPlusSupporter(userTags), [userTags]);

  async function confirmUpload() {
    if (!pending) return;
    const gate = evaluateImageUploadGate("emojianimated", isSupporter, (data ?? []).length);
    if (!gate.allowed) {
      toast.error(
        gate.reason === "supporter_required"
          ? t("vrcPlus.supporterRequired", {
              defaultValue: "This needs an active VRC+ subscription.",
            })
          : t("vrcPlus.limitReached", {
              limit: gate.limit,
              defaultValue: "You've reached the VRC+ limit of {{limit}} for this slot.",
            }),
      );
      return;
    }
    if (frames < 1 || framesOverTime < 1) {
      toast.error(
        t("vrcPlus.emoji.badFrames", {
          defaultValue: "Frames and fps must both be at least 1.",
        }),
      );
      return;
    }
    setUploading(true);
    try {
      await uploadAnimatedEmojiFile(pending, { frames, framesOverTime, animationStyle });
      toast.success(t("vrcPlus.emoji.uploaded", { defaultValue: "Animated emoji uploaded" }));
      setPending(null);
      void qc.invalidateQueries({ queryKey });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteFile(deleteTarget.id);
      toast.success(t("vrcPlus.imageDeleted", { defaultValue: "Image deleted" }));
      void qc.invalidateQueries({ queryKey });
      setDeleteTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  const files = data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <Card elevation="flat">
        <CardContent className="flex flex-col gap-3 py-4">
          <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("vrcPlus.emoji.explainer", {
              defaultValue:
                "Animated emoji are a vertical sprite sheet — stack each frame top-to-bottom in one square PNG, then set the frame count and playback speed.",
            })}
          </p>
          <input
            ref={fileInput}
            type="file"
            accept="image/png"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setPending(f);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap items-end gap-3">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-[12px]"
              onClick={() => fileInput.current?.click()}
            >
              <ImageIcon className="size-3.5" />
              {pending
                ? pending.name
                : t("vrcPlus.emoji.pickSheet", { defaultValue: "Choose sprite sheet" })}
            </Button>
            <label className="flex flex-col gap-1 text-[11px] text-[hsl(var(--muted-foreground))]">
              {t("vrcPlus.emoji.frames", { defaultValue: "Frames" })}
              <input
                type="number"
                min={1}
                max={64}
                value={frames}
                onChange={(e) => setFrames(Math.max(1, Number(e.target.value) || 1))}
                className="h-8 w-20 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 text-[12px] text-[hsl(var(--foreground))]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[hsl(var(--muted-foreground))]">
              {t("vrcPlus.emoji.fps", { defaultValue: "FPS" })}
              <input
                type="number"
                min={1}
                max={64}
                value={framesOverTime}
                onChange={(e) => setFramesOverTime(Math.max(1, Number(e.target.value) || 1))}
                className="h-8 w-20 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 text-[12px] text-[hsl(var(--foreground))]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[hsl(var(--muted-foreground))]">
              {t("vrcPlus.emoji.style", { defaultValue: "Style" })}
              <select
                value={animationStyle}
                onChange={(e) => setAnimationStyle(e.target.value as EmojiAnimationStyle)}
                className="h-8 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 text-[12px] text-[hsl(var(--foreground))]"
              >
                {EMOJI_ANIMATION_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="tonal"
              size="sm"
              className="h-8 gap-1.5 text-[12px]"
              disabled={uploading || !pending}
              onClick={() => void confirmUpload()}
            >
              {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              {t("vrcPlus.emoji.upload", { defaultValue: "Upload animated emoji" })}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
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
      </div>

      {isLoading ? (
        <CenterSpinner />
      ) : isError ? (
        <ErrorNote message={error instanceof Error ? error.message : String(error)} />
      ) : files.length === 0 ? (
        <EmptyNote
          icon={<ImageIcon className="size-6" />}
          text={t("vrcPlus.emoji.empty", { defaultValue: "No animated emoji yet." })}
        />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {files.map((f) => {
            const url = fileImageUrl(f);
            return (
              <div
                key={f.id}
                className="group relative overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--surface))]"
              >
                {url ? (
                  <CachedTileImage
                    id={f.id}
                    src={url}
                    alt={f.name ?? f.id}
                    imgClassName="aspect-square w-full object-cover"
                    fallbackClassName="aspect-square"
                    fallbackIcon={<ImageIcon className="size-6" />}
                  />
                ) : (
                  <div className="aspect-square grid place-items-center text-[hsl(var(--muted-foreground))]">
                    <ImageIcon className="size-6" />
                  </div>
                )}
                <button
                  type="button"
                  title={t("vrcPlus.deleteImage", { defaultValue: "Delete" })}
                  className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[hsl(var(--destructive))]"
                  onClick={() => setDeleteTarget(f)}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t("vrcPlus.deleteImageTitle", { defaultValue: "Delete this image?" })}
        description={t("vrcPlus.deleteImageBody", {
          defaultValue:
            "This permanently removes the image from your VRChat account. This cannot be undone.",
        })}
        confirmLabel={t("common.delete", { defaultValue: "Delete" })}
        cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
        tone="destructive"
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

// ── Inventory ────────────────────────────────────────────────────────────────

function InventoryTab() {
  const { t } = useTranslation();
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["inventory.list"],
    queryFn: () => listInventory(),
  });

  const items: VrcInventoryItem[] = data?.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
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
      </div>

      {isLoading ? (
        <CenterSpinner />
      ) : isError ? (
        <ErrorNote message={error instanceof Error ? error.message : String(error)} />
      ) : items.length === 0 ? (
        <EmptyNote
          icon={<Sticker className="size-6" />}
          text={t("vrcPlus.noInventory", { defaultValue: "Inventory is empty." })}
        />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {items.map((it) => {
            const url = it.thumbnailImageUrl || it.imageUrl;
            return (
              <div
                key={it.id}
                className="overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--surface))]"
                title={it.name}
              >
                {url ? (
                  <CachedTileImage
                    id={it.id}
                    src={url}
                    alt={it.name ?? it.id}
                    imgClassName="aspect-square w-full object-contain p-2"
                    fallbackClassName="aspect-square"
                    fallbackIcon={<Sticker className="size-6" />}
                  />
                ) : (
                  <div className="aspect-square grid place-items-center text-[hsl(var(--muted-foreground))]">
                    <Sticker className="size-6" />
                  </div>
                )}
                <div className="truncate px-2 py-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                  {it.name ?? it.itemType}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

/**
 * Image tile that routes the source URL through the account-scoped image-cache
 * (same path Avatars/ProfileCard use) so VRC+ media is fetched once, persisted,
 * and reused — instead of letting WebView2 re-fetch every remote URL per paint.
 * The cache key is the stable VRChat id; the source URL can rotate without
 * orphaning the cached blob. Renders a plain <img> so each call site keeps its
 * exact object-fit/aspect styling, with the same icon fallback as before.
 */
function CachedTileImage({
  id,
  src,
  alt,
  imgClassName,
  fallbackClassName,
  fallbackIcon,
}: {
  id: string;
  src: string | null | undefined;
  alt: string;
  imgClassName: string;
  fallbackClassName: string;
  fallbackIcon: React.ReactNode;
}) {
  const { localUrl } = useCachedImageUrl(id, src ?? null);
  const resolved = localUrl ?? (src || null);
  if (!resolved) {
    return (
      <div className={cn("grid place-items-center text-[hsl(var(--muted-foreground))]", fallbackClassName)}>
        {fallbackIcon}
      </div>
    );
  }
  return <img src={resolved} alt={alt} className={imgClassName} loading="lazy" decoding="async" />;
}

function CenterSpinner() {
  return (
    <div className="grid place-items-center py-16 text-[hsl(var(--muted-foreground))]">
      <Loader2 className="size-6 animate-spin" />
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-[hsl(var(--destructive)/0.4)] bg-[hsl(var(--destructive)/0.08)] px-4 py-3 text-[12px] text-[hsl(var(--destructive))]">
      {message}
    </div>
  );
}

function EmptyNote({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-[hsl(var(--muted-foreground))]">
      {icon}
      <span className="text-[13px]">{text}</span>
    </div>
  );
}
