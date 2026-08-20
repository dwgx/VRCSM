import { describe, expect, it } from "vitest";
import {
  clampSlotMessage,
  codePointLength,
  insertChip,
  isAllowedChipId,
  isInviteSlotType,
  sendCooldownRemainingMs,
  SLOT_MESSAGE_MAX,
  slotTypeLabelKey,
  type InviteSlotType,
} from "../invite-slots";

describe("clampSlotMessage", () => {
  it("turns amber at 60 and hard-blocks after 64 code points", () => {
    const at59 = "a".repeat(59);
    const at60 = "a".repeat(60);
    const at64 = "a".repeat(64);
    const at65 = "a".repeat(65);
    expect(clampSlotMessage(at59).amber).toBe(false);
    expect(clampSlotMessage(at59).blocked).toBe(false);
    expect(clampSlotMessage(at60).amber).toBe(true);
    expect(clampSlotMessage(at60).blocked).toBe(false);
    expect(clampSlotMessage(at64).amber).toBe(true);
    expect(clampSlotMessage(at64).blocked).toBe(false);
    expect(clampSlotMessage(at65).blocked).toBe(true);
    expect(clampSlotMessage(at65).length).toBe(65);
  });

  it("counts combining characters as one code point each ([...str].length)", () => {
    const combining = "e\u0301";
    expect(codePointLength(combining)).toBe(2);
    expect(codePointLength("é")).toBe(1);
    const wave = "👋";
    expect(codePointLength(wave)).toBe(1);
    expect(clampSlotMessage(wave.repeat(64)).blocked).toBe(false);
    expect(clampSlotMessage(wave.repeat(65)).blocked).toBe(true);
  });

  it("treats empty-after-trim as empty, not blocked-by-length", () => {
    const empty = clampSlotMessage("   ");
    expect(empty.empty).toBe(true);
    expect(empty.blocked).toBe(false);
  });
});

describe("chip insert", () => {
  it("inserts wrld_/avtr_/usr_ ids and full location strings", () => {
    const world = "wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const loc = `${world}:12345~region(us)`;
    expect(isAllowedChipId(world)).toBe(true);
    expect(isAllowedChipId(loc)).toBe(true);
    expect(isAllowedChipId("avtr_11111111-2222-3333-4444-555555555555")).toBe(true);
    expect(isAllowedChipId("usr_deadbeef")).toBe(true);
    expect(insertChip("hi", world)).toBe(`hi ${world}`);
  });

  it("does not insert https://evil as an id chip", () => {
    expect(isAllowedChipId("https://evil")).toBe(false);
    expect(isAllowedChipId("http://example.com/wrld_x")).toBe(false);
    expect(insertChip("hello", "https://evil")).toBe("hello");
  });

  it("refuses a chip that would exceed 64 code points", () => {
    const draft = "a".repeat(SLOT_MESSAGE_MAX - 2);
    const chip = "wrld_too-long-to-fit-here";
    expect(insertChip(draft, chip)).toBe(draft);
  });
});

describe("type guard", () => {
  it("is exhaustive over live VRCSM names and rejects OpenAPI aliases", () => {
    const live: InviteSlotType[] = [
      "invite",
      "inviteResponse",
      "requestInvite",
      "requestInviteResponse",
    ];
    for (const type of live) {
      expect(isInviteSlotType(type)).toBe(true);
      expect(slotTypeLabelKey(type).startsWith("inviteSlots.type.")).toBe(true);
    }
    expect(isInviteSlotType("message")).toBe(false);
    expect(isInviteSlotType("response")).toBe(false);
    expect(isInviteSlotType("request")).toBe(false);
    expect(isInviteSlotType("requestResponse")).toBe(false);
    expect(isInviteSlotType("Messenger")).toBe(false);
  });
});

describe("send cooldown helper", () => {
  it("reports remaining milliseconds within the 8s window", () => {
    expect(sendCooldownRemainingMs(null, 10_000)).toBe(0);
    expect(sendCooldownRemainingMs(10_000, 10_000)).toBe(8000);
    expect(sendCooldownRemainingMs(10_000, 14_000)).toBe(4000);
    expect(sendCooldownRemainingMs(10_000, 18_000)).toBe(0);
  });
});
