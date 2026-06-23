import { ipc } from "@/lib/ipc";
import type { NotificationEntry, NotificationsResult } from "@/lib/types";
export {
  blockUser,
  getSavedMessages,
  inviteSelf,
  inviteUser,
  listFriends,
  listModerations,
  listVisits,
  muteUser,
  removeFriend,
  requestInvite,
  sendFriendRequest,
  sendUserMessage,
  unblockUser,
  unmuteUser,
} from "@/lib/vrchat-api";

export function listNotifications(count = 100): Promise<NotificationsResult> {
  return ipc.notificationsList(count) as Promise<NotificationsResult>;
}

export function acceptNotification(notificationId: string): Promise<{ ok: boolean }> {
  return ipc.notificationAccept(notificationId);
}

export function respondToNotification(
  notificationId: string,
  message: string,
  slot = 0,
): Promise<{ ok: boolean }> {
  return ipc.notificationRespond(notificationId, message, slot);
}

export function markNotificationSeen(notificationId: string): Promise<{ ok: boolean }> {
  return ipc.notificationSee(notificationId);
}

export function hideNotification(notificationId: string): Promise<{ ok: boolean }> {
  return ipc.notificationHide(notificationId);
}

export function clearNotifications(): Promise<{ ok: boolean }> {
  return ipc.notificationsClear();
}

export function getFriendNote(userId: string): Promise<{ note: string | null }> {
  return ipc.friendNoteGet(userId);
}

export function setFriendNote(userId: string, note: string): Promise<{ ok: boolean; updated_at: string }> {
  return ipc.friendNoteSet(userId, note);
}

export function isNotificationEntry(value: unknown): value is NotificationEntry {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      typeof (value as { id?: unknown }).id === "string" &&
      "type" in value &&
      typeof (value as { type?: unknown }).type === "string",
  );
}
