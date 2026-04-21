import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Bell,
  BellDot,
  Check,
  UserPlus,
  MessageSquare,
  Mail,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ipc } from "@/lib/ipc";
import { useAuth } from "@/lib/auth-context";
import { subscribePipelineEvent } from "@/lib/pipeline-events";

function formatDistanceShort(date: Date): string {
  const diff = Date.now() - date.getTime();
  if (diff < 0) return "now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return date.toLocaleDateString();
}

/**
 * VRChat notification — the raw shape VRChat returns from
 * `/api/1/auth/user/notifications` and pushes over the Pipeline
 * WebSocket as `notification` events. We keep the type loose because
 * VRChat occasionally adds fields and the UI only renders a curated
 * subset.
 */
interface NotificationEntry {
  id: string;
  senderUserId?: string;
  senderUsername?: string;
  type: string;
  message?: string;
  details?: Record<string, unknown> | string | null;
  seen?: boolean;
  created_at?: string;
}

function notificationIcon(type: string) {
  switch (type) {
    case "friendRequest":
      return <UserPlus className="size-3.5" />;
    case "invite":
    case "requestInvite":
    case "requestInviteResponse":
    case "inviteResponse":
      return <Mail className="size-3.5" />;
    case "message":
      return <MessageSquare className="size-3.5" />;
    default:
      return <Bell className="size-3.5" />;
  }
}

/**
 * Bell icon + dropdown showing the VRChat notifications inbox. Bootstraps
 * with a fresh fetch on sign-in, then keeps itself current by
 * subscribing to Pipeline `notification` / `notification-v2` events so
 * new invites appear without the user touching anything.
 */
export function NotificationsInbox() {
  const { t } = useTranslation();
  const { status } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const unread = useMemo(
    () => items.filter((n) => !n.seen).length,
    [items],
  );

  const refresh = useCallback(async () => {
    if (!status.authed) {
      setItems([]);
      return;
    }
    try {
      setLoading(true);
      const res = await ipc.notificationsList(100);
      setItems(res.notifications ?? []);
    } catch (err) {
      console.warn("notifications.list failed", err);
    } finally {
      setLoading(false);
    }
  }, [status.authed]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live updates: new notification — push to top; delete — remove; mark
  // seen — flip flag. Each event's `content` is the full notification
  // object, matching what `/notifications` returns.
  useEffect(() => {
    if (!status.authed) return;

    const unsubAdd = subscribePipelineEvent<NotificationEntry>(
      "notification",
      (content) => {
        if (!content?.id) return;
        setItems((prev) => {
          const rest = prev.filter((n) => n.id !== content.id);
          return [{ ...content, seen: false }, ...rest];
        });
        toast(
          content.senderUsername
            ? `${content.senderUsername}: ${content.type}`
            : content.message || content.type,
          { icon: notificationIcon(content.type) },
        );
      },
    );
    const unsubV2Add = subscribePipelineEvent<NotificationEntry>(
      "notification-v2",
      (content) => {
        if (!content?.id) return;
        setItems((prev) => {
          const rest = prev.filter((n) => n.id !== content.id);
          return [{ ...content, seen: false }, ...rest];
        });
      },
    );
    const unsubSeen = subscribePipelineEvent<{ id?: string }>(
      "see-notification",
      (content) => {
        if (!content?.id) return;
        setItems((prev) =>
          prev.map((n) => (n.id === content.id ? { ...n, seen: true } : n)),
        );
      },
    );
    const unsubClear = subscribePipelineEvent("clear-notification", () => {
      setItems([]);
    });
    const unsubDelete = subscribePipelineEvent<{ id?: string; ids?: string[] }>(
      "notification-v2-delete",
      (content) => {
        if (!content) return;
        const ids = new Set<string>();
        if (content.id) ids.add(content.id);
        if (Array.isArray(content.ids)) content.ids.forEach((i) => ids.add(i));
        if (ids.size === 0) return;
        setItems((prev) => prev.filter((n) => !ids.has(n.id)));
      },
    );
    // response-notification fires when an invite/request was answered
    // (by us or another client) — drop it from the inbox since the
    // action is no longer pending.
    const unsubResponse = subscribePipelineEvent<{ notificationId?: string }>(
      "response-notification",
      (content) => {
        if (!content?.notificationId) return;
        setItems((prev) => prev.filter((n) => n.id !== content.notificationId));
      },
    );

    return () => {
      unsubAdd();
      unsubV2Add();
      unsubSeen();
      unsubClear();
      unsubDelete();
      unsubResponse();
    };
  }, [status.authed]);

  // When the drawer opens, fan out PUT /notifications/{id}/see for
  // every unseen entry so the bell badge resets on every device. The
  // local `seen` flag is flipped optimistically — failures are
  // swallowed because a missed `see` is purely cosmetic.
  useEffect(() => {
    if (!open) return;
    const unseen = items.filter((n) => !n.seen);
    if (unseen.length === 0) return;
    setItems((prev) => prev.map((n) => (n.seen ? n : { ...n, seen: true })));
    Promise.allSettled(unseen.map((n) => ipc.notificationSee(n.id)))
      .catch(() => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Click-outside close behaviour mirrors AuthChip so the two menus
  // behave identically in the toolbar.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  async function accept(id: string) {
    try {
      await ipc.notificationAccept(id);
      setItems((prev) => prev.filter((n) => n.id !== id));
      toast.success(t("notifications.accepted"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function hide(id: string) {
    try {
      await ipc.notificationHide(id);
      setItems((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function respondAccept(id: string) {
    try {
      await ipc.notificationRespond(id, t("notifications.inviteAccept"));
      setItems((prev) => prev.filter((n) => n.id !== id));
      toast.success(t("notifications.replied"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function clearAll() {
    try {
      await ipc.notificationsClear();
      setItems([]);
      toast.success(t("notifications.cleared"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  if (!status.authed) return null;

  return (
    <div ref={containerRef} className="relative z-20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("notifications.title")}
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface-bright))] text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--surface-raised))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
      >
        {unread > 0 ? (
          <BellDot className="size-3.5 text-[hsl(var(--primary))]" />
        ) : (
          <Bell className="size-3.5" />
        )}
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[hsl(var(--primary))] px-1 text-[9px] font-semibold text-[hsl(var(--primary-foreground))]">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-[360px] rounded-[var(--radius-md)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface-raised))] shadow-[0_10px_30px_rgba(0,0,0,0.28)]">
          <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-3 py-2">
            <div className="text-[12px] font-semibold tracking-wide">
              {t("notifications.title")}
              {unread > 0 ? (
                <span className="ml-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                  ({unread} {t("notifications.unread")})
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => void refresh()}
                disabled={loading}
              >
                {t("notifications.refresh")}
              </Button>
              {items.length > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => void clearAll()}
                >
                  {t("notifications.clearAll")}
                </Button>
              ) : null}
            </div>
          </div>

          <ScrollArea className="max-h-[440px]">
            {items.length === 0 ? (
              <div className="p-6 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
                {loading ? t("notifications.loading") : t("notifications.empty")}
              </div>
            ) : (
              <ul className="divide-y divide-[hsl(var(--border))]">
                {items.map((n) => (
                  <li
                    key={n.id}
                    className={`flex items-start gap-2 px-3 py-2 ${
                      !n.seen ? "bg-[hsl(var(--primary)/0.04)]" : ""
                    }`}
                  >
                    <div className="mt-0.5 text-[hsl(var(--muted-foreground))]">
                      {notificationIcon(n.type)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="truncate text-[12px] font-medium">
                          {n.senderUsername || n.senderUserId || n.type}
                        </div>
                        <div className="shrink-0 text-[10px] text-[hsl(var(--muted-foreground))]">
                          {n.created_at
                            ? formatDistanceShort(new Date(n.created_at))
                            : ""}
                        </div>
                      </div>
                      {n.message ? (
                        <div className="truncate text-[11px] text-[hsl(var(--muted-foreground))]">
                          {n.message}
                        </div>
                      ) : null}
                      <div className="mt-1 flex items-center gap-1">
                        {n.type === "friendRequest" ? (
                          <Button
                            size="sm"
                            variant="tonal"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => void accept(n.id)}
                          >
                            <Check className="size-3" />
                            {t("notifications.accept")}
                          </Button>
                        ) : null}
                        {n.type === "invite" || n.type === "requestInvite" ? (
                          <Button
                            size="sm"
                            variant="tonal"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => void respondAccept(n.id)}
                          >
                            <Check className="size-3" />
                            {t("notifications.reply")}
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => void hide(n.id)}
                        >
                          <X className="size-3" />
                          {t("notifications.hide")}
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </div>
      ) : null}
    </div>
  );
}
