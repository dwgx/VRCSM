import { describe, it, expect } from "vitest";
import { discordPresenceVisibility } from "../useDiscordPresence";

// Privacy gate for Discord Rich Presence. Only genuinely public instances
// may expose instance details; every private bucket (friends / invite /
// group …) must hide them so the owner's usr_ id (embedded in the raw
// `~private(usr_…)` location) never leaks into the Discord panel.
describe("discordPresenceVisibility", () => {
  it("exposes instance details only for public instances", () => {
    const pub = discordPresenceVisibility(
      "wrld_11111111-2222-3333-4444-555555555555:12345~region(us)",
    );
    expect(pub).toEqual({ showWorld: true, exposeInstanceDetails: true });
  });

  it("exposes details for group-public instances", () => {
    const v = discordPresenceVisibility(
      "wrld_aaaa1111-2222-3333-4444-555555555555:9~group(grp_x)~groupAccessType(public)~region(eu)",
    );
    expect(v.showWorld).toBe(true);
    expect(v.exposeInstanceDetails).toBe(true);
  });

  it("hides instance details for friends+ (hidden) instances", () => {
    const v = discordPresenceVisibility(
      "wrld_11111111-2222-3333-4444-555555555555:12345~hidden(usr_abc)~region(us)",
    );
    expect(v.showWorld).toBe(true);
    expect(v.exposeInstanceDetails).toBe(false);
  });

  it("hides instance details for friends-only instances", () => {
    const v = discordPresenceVisibility(
      "wrld_11111111-2222-3333-4444-555555555555:12345~friends(usr_abc)",
    );
    expect(v).toEqual({ showWorld: true, exposeInstanceDetails: false });
  });

  it("hides instance details for invite / invite+ instances", () => {
    const invite = discordPresenceVisibility(
      "wrld_11111111-2222-3333-4444-555555555555:12345~private(usr_abc)",
    );
    expect(invite.exposeInstanceDetails).toBe(false);
    const invitePlus = discordPresenceVisibility(
      "wrld_11111111-2222-3333-4444-555555555555:12345~private(usr_abc)~canRequestInvite",
    );
    expect(invitePlus.exposeInstanceDetails).toBe(false);
  });

  it("hides instance details for group and group-plus instances", () => {
    const group = discordPresenceVisibility(
      "wrld_11111111-2222-3333-4444-555555555555:7~group(grp_x)",
    );
    expect(group.exposeInstanceDetails).toBe(false);
    const groupPlus = discordPresenceVisibility(
      "wrld_11111111-2222-3333-4444-555555555555:7~group(grp_x)~groupAccessType(plus)",
    );
    expect(groupPlus.exposeInstanceDetails).toBe(false);
  });

  it("shows nothing when offline / private / traveling / unknown", () => {
    for (const loc of ["offline", "private", "traveling", null, ""]) {
      const v = discordPresenceVisibility(loc as string | null);
      expect(v).toEqual({ showWorld: false, exposeInstanceDetails: false });
    }
  });
});
