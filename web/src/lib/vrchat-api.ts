import { ipc } from "@/lib/ipc";
import type {
  AvatarDetails,
  AvatarSearchResult,
  FriendsListResult,
  UserSearchResult,
  VrcSavedMessagesResult,
  VrcSavedMessageType,
  VrcVisitsResult,
  VrcUserProfile,
  VrcStatus,
  WorldDetails,
  WorkspaceGroupsResult,
  WorkspaceModerationsResult,
} from "@/lib/types";

export interface ProfileResult {
  profile: VrcUserProfile | null;
}

export interface AvatarDetailsResult {
  details: AvatarDetails | null;
}

export interface WorldDetailsResult {
  details: WorldDetails | null;
}

export interface UpdateProfileRequest {
  status?: VrcStatus;
  statusDescription?: string;
  bio?: string;
  bioLinks?: string[];
  pronouns?: string;
  userIcon?: string;
  profilePicOverride?: string;
  tags?: string[];
}

export interface OkResult {
  ok: boolean;
}

export function listFriends(): Promise<FriendsListResult> {
  return ipc.call<undefined, FriendsListResult>("friends.list");
}

export function listGroups(): Promise<WorkspaceGroupsResult> {
  return ipc.call<undefined, WorkspaceGroupsResult>("groups.list", undefined);
}

export function listModerations(): Promise<WorkspaceModerationsResult> {
  return ipc.call<undefined, WorkspaceModerationsResult>("moderations.list");
}

export function listVisits(): Promise<VrcVisitsResult> {
  return ipc.visitsList() as Promise<VrcVisitsResult>;
}

export function getUserProfile(userId: string): Promise<ProfileResult> {
  return ipc.call<{ userId: string }, ProfileResult>("user.getProfile", { userId });
}

export function updateProfile(patch: UpdateProfileRequest): Promise<void> {
  return ipc.call<UpdateProfileRequest, void>("user.updateProfile", patch);
}

export function getAvatarDetails(id: string): Promise<AvatarDetailsResult> {
  return ipc.call<{ id: string }, AvatarDetailsResult>("avatar.details", { id });
}

export function getWorldDetails(id: string): Promise<WorldDetailsResult> {
  return ipc.call<{ id: string }, WorldDetailsResult>("world.details", { id });
}

export function searchAvatars(
  query: string,
  count = 20,
  offset = 0,
): Promise<{ avatars: AvatarSearchResult[] }> {
  return ipc.searchAvatars(query, count, offset);
}

export function searchUsers(
  query: string,
  count = 10,
  offset = 0,
): Promise<{ users: UserSearchResult[] }> {
  return ipc.searchUsers(query, count, offset);
}

export function selectAvatar(avatarId: string): Promise<unknown> {
  return ipc.call("avatar.select", { avatarId });
}

export function sendFriendRequest(userId: string): Promise<OkResult> {
  return ipc.friendsRequest(userId);
}

export function removeFriend(userId: string): Promise<OkResult> {
  return ipc.friendsUnfriend(userId);
}

export function muteUser(userId: string): Promise<unknown> {
  return ipc.muteUser(userId);
}

export function unmuteUser(moderationId: string): Promise<OkResult> {
  return ipc.unmuteUser(moderationId);
}

export function blockUser(userId: string): Promise<unknown> {
  return ipc.blockUser(userId);
}

export function unblockUser(moderationId: string): Promise<OkResult> {
  return ipc.unblockUser(moderationId);
}

export function inviteSelf(location: string): Promise<OkResult> {
  return ipc.inviteSelf(location);
}

export function inviteUser(userId: string, location: string, slot = 0): Promise<OkResult> {
  return ipc.inviteUser(userId, location, slot);
}

export function requestInvite(userId: string, slot = 0): Promise<OkResult> {
  return ipc.requestInvite(userId, slot);
}

export function getSavedMessages(
  type: VrcSavedMessageType = "requestInvite",
): Promise<VrcSavedMessagesResult> {
  return ipc.getSavedMessages(type) as Promise<VrcSavedMessagesResult>;
}

export function sendUserMessage(userId: string, message: string): Promise<OkResult> {
  return ipc.sendMessage(userId, message);
}
