export const SLOT_MESSAGE_AMBER = 60;
export const SLOT_MESSAGE_MAX = 64;
export const SLOT_SEND_COOLDOWN_SEC = 8;

export const INVITE_SLOT_TYPES = [
  "invite",
  "inviteResponse",
  "requestInvite",
  "requestInviteResponse",
] as const;

export type InviteSlotType = (typeof INVITE_SLOT_TYPES)[number];

export interface InviteSlot {
  slot: number;
  message: string;
  remainingCooldownMinutes: number;
  canBeUpdated: boolean;
  updatedAt?: string;
}

export function codePointLength(text: string): number {
  return [...text].length;
}

export function clampSlotMessage(text: string): {
  text: string;
  length: number;
  amber: boolean;
  blocked: boolean;
  empty: boolean;
} {
  const length = codePointLength(text);
  const empty = text.trim().length === 0;
  return {
    text,
    length,
    amber: length >= SLOT_MESSAGE_AMBER && length <= SLOT_MESSAGE_MAX,
    blocked: length > SLOT_MESSAGE_MAX,
    empty,
  };
}

export function isInviteSlotType(value: string): value is InviteSlotType {
  return (INVITE_SLOT_TYPES as readonly string[]).includes(value);
}

export function slotTypeLabelKey(type: InviteSlotType): string {
  switch (type) {
    case "invite":
      return "inviteSlots.type.invite";
    case "inviteResponse":
      return "inviteSlots.type.inviteResponse";
    case "requestInvite":
      return "inviteSlots.type.requestInvite";
    case "requestInviteResponse":
      return "inviteSlots.type.requestInviteResponse";
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

export function isAllowedChipId(chip: string): boolean {
  const value = chip.trim();
  if (!value) return false;
  if (value.startsWith("https:") || value.startsWith("http:") || value.includes("://")) {
    return false;
  }
  return value.startsWith("wrld_") || value.startsWith("avtr_") || value.startsWith("usr_");
}

export function insertChip(draft: string, chip: string): string {
  if (!isAllowedChipId(chip)) return draft;
  const id = chip.trim();
  const prefix = draft.length > 0 && !draft.endsWith(" ") && !draft.endsWith("\n") ? " " : "";
  const next = `${draft}${prefix}${id}`;
  if (codePointLength(next) > SLOT_MESSAGE_MAX) return draft;
  return next;
}

export function sendCooldownRemainingMs(lastSentAt: number | null, now = Date.now()): number {
  if (lastSentAt == null) return 0;
  const elapsed = now - lastSentAt;
  const remain = SLOT_SEND_COOLDOWN_SEC * 1000 - elapsed;
  return remain > 0 ? remain : 0;
}
