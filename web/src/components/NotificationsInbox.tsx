import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Bell,
  BellDot,
  Check,
  User,
  UserPlus,
  MessageSquare,
  Mail,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FriendDetailDialog } from "@/components/FriendDetailDialog";
import { useAuth } from "@/lib/auth-context";
import { subscribePipelineEvent } from "@/lib/pipeline-events";
import {
  acceptNotification,
  clearNotifications,
  hideNotification,
  listNotifications,
  markNotificationSeen,
  respondToNotification,
} from "@/lib/social";
import type { Friend, NotificationEntry } from "@/lib/types";

/**
 * Build the minimal `Friend` shape `FriendDetailDialog` needs from a
 * notification's sender. The dialog re-fetches the full profile via
 * `user.getProfile` off `friend.id`, so only the identity fields have to be
 * real; the rest are honest nulls until that query resolves.
 */
function friendFromNotification(n: NotificationEntry): Friend | null {
  const id = n.senderUserId;
  if (!id || !id.startsWith("usr_")) return null;
  return {
    id,
    displayName: n.senderUsername || id,
    currentAvatarImageUrl: null,
    currentAvatarThumbnailImageUrl: null,
    statusDescription: null,
    status: null,
    location: null,
    last_platform: null,
    bio: null,
    developerType: null,
    last_login: null,
    last_activity: null,
    profilePicOverride: null,
    userIcon: null,
    tags: [],
  };
}

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
  const [detailFriend, setDetailFriend] = useState<Friend | null>(null);
  // A friendRequest sender is NOT a friend yet, so friend-only actions
  // (Unfriend, Boop/requestInvite) must be suppressed until the request is
  // accepted. Tracks whether the currently-open detail dialog is such a case.
  const [detailReadOnly, setDetailReadOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bellRef = useRef<HTMLButtonElement | null>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; right: number } | null>(null);

  const updatePanelPos = useCallback(() => {
    if (!bellRef.current) return;
    const r = bellRef.current.getBoundingClientRect();
    setPanelPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePanelPos();
    window.addEventListener("resize", updatePanelPos);
    return () => window.removeEventListener("resize", updatePanelPos);
  }, [open, updatePanelPos]);

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
      const res = await listNotifications(100);
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
    Promise.allSettled(unseen.map((n) => markNotificationSeen(n.id)))
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

  // A notification can go stale between render and action: the user may have
  // already accepted the friend request / invite inside VRChat, or the sender
  // cancelled it. VRChat then answers with a "could not be found" style error.
  // In that case the entry is already gone server-side, so drop it locally and
  // re-sync rather than leaving a dead row the user can't get rid of.
  function isStaleNotificationError(err: unknown): boolean {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return (
      msg.includes("could not be found") ||
      msg.includes("not found") ||
      msg.includes("404") ||
      msg.includes("already")
    );
  }

  async function accept(id: string) {
    try {
      await acceptNotification(id);
      setItems((prev) => prev.filter((n) => n.id !== id));
      toast.success(t("notifications.accepted"));
    } catch (err) {
      if (isStaleNotificationError(err)) {
        setItems((prev) => prev.filter((n) => n.id !== id));
        void refresh();
        return;
      }
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function hide(id: string) {
    try {
      await hideNotification(id);
      setItems((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      if (isStaleNotificationError(err)) {
        setItems((prev) => prev.filter((n) => n.id !== id));
        return;
      }
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function respondAccept(id: string) {
    try {
      await respondToNotification(id, t("notifications.inviteAccept"));
      setItems((prev) => prev.filter((n) => n.id !== id));
      toast.success(t("notifications.replied"));
    } catch (err) {
      if (isStaleNotificationError(err)) {
        setItems((prev) => prev.filter((n) => n.id !== id));
        void refresh();
        return;
      }
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function clearAll() {
    try {
      await clearNotifications();
      setItems([]);
      toast.success(t("notifications.cleared"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  if (!status.authed) return null;

  return (
    <div ref={containerRef}>
      <button
        ref={bellRef}
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

      {open && panelPos ? (
        <div
          className="fixed z-[9999] w-[360px] rounded-[var(--radius-md)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface-raised))] shadow-[0_10px_30px_rgba(0,0,0,0.28)]"
          style={{ top: panelPos.top, right: panelPos.right }}
        >
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
                {items.map((n) => {
                  const friend = friendFromNotification(n);
                  // A friendRequest sender isn't a friend yet — open their
                  // profile read-only so friend-only actions stay hidden.
                  const readOnly = n.type === "friendRequest";
                  const openDetail = () => {
                    if (!friend) return;
                    // Close the inbox BEFORE opening the dialog: the inbox
                    // panel is z-[9999] and the dialog is z-50, so leaving it
                    // mounted lets the dropdown cover/intercept the dialog.
                    setOpen(false);
                    setDetailReadOnly(readOnly);
                    setDetailFriend(friend);
                  };
                  return (
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
                      {friend ? (
                        <button
                          type="button"
                          onClick={openDetail}
                          title={t("notifications.openProfile", { defaultValue: "Open profile" })}
                          className="group -mx-1 -mt-0.5 block w-[calc(100%+0.5rem)] rounded-[var(--radius-sm)] px-1 pb-0.5 pt-0.5 text-left transition-colors hover:bg-[hsl(var(--surface-bright))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <div className="truncate text-[12px] font-medium group-hover:text-[hsl(var(--primary))]">
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
                        </button>
                      ) : (
                        <>
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
                        </>
                      )}
                      <div className="mt-1 flex items-center gap-1">
                        {n.type === "friendRequest" ? (
                          <Button
                            size="sm"
                            variant="tonal"
                            className="h-6 px-2 text-[11px]"
                            onClick={(e) => { e.stopPropagation(); void accept(n.id); }}
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
                            onClick={(e) => { e.stopPropagation(); void respondAccept(n.id); }}
                          >
                            <Check className="size-3" />
                            {t("notifications.reply")}
                          </Button>
                        ) : null}
                        {friend ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[11px]"
                            onClick={(e) => { e.stopPropagation(); openDetail(); }}
                          >
                            <User className="size-3" />
                            {t("notifications.viewProfile", { defaultValue: "Profile" })}
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px]"
                          onClick={(e) => { e.stopPropagation(); void hide(n.id); }}
                        >
                          <X className="size-3" />
                          {t("notifications.hide")}
                        </Button>
                      </div>
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </ScrollArea>
        </div>
      ) : null}

      <FriendDetailDialog
        friend={detailFriend}
        readOnly={detailReadOnly}
        onClose={() => setDetailFriend(null)}
      />
    </div>
  );
}
