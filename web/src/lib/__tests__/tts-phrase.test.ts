import { describe, expect, it } from "vitest";
import { formatTtsPhrase } from "../tts";

describe("formatTtsPhrase", () => {
  it("uses the display name and never interpolates the user id", () => {
    const phrase = formatTtsPhrase("friendOnline", {
      displayName: "Nova",
      userId: "usr_abc",
    });
    expect(phrase).toBe("Nova is now online");
    expect(phrase).not.toContain("usr_");
    expect(phrase).not.toContain("usr_abc");
  });

  it("drops nameless friend-online events", () => {
    expect(formatTtsPhrase("friendOnline", { userId: "usr_abc" })).toBeNull();
    expect(formatTtsPhrase("friendOnline", { displayName: "  ", userId: "usr_abc" })).toBeNull();
  });

  it("formats invite and friend-request from the sender name only", () => {
    expect(
      formatTtsPhrase("invite", {
        senderUsername: "Pix",
        userId: "usr_pix",
      }),
    ).toBe("Invite from Pix");
    expect(
      formatTtsPhrase("friendRequest", {
        senderUsername: "Pix",
        userId: "usr_pix",
      }),
    ).toBe("Friend request from Pix");
  });

  it("falls back to Someone without leaking a user id", () => {
    const phrase = formatTtsPhrase("invite", { userId: "usr_nobody" });
    expect(phrase).toBe("Invite from Someone");
    expect(phrase).not.toContain("usr_");
  });
});
