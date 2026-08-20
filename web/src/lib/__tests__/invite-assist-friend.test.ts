import { afterEach, describe, expect, it, vi } from "vitest";

const { ipcCallMock } = vi.hoisted(() => ({ ipcCallMock: vi.fn() }));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    call: (...args: unknown[]) => ipcCallMock(...args),
  },
}));

import {
  isOnInviteAssistAllowlist,
  parseInviteAssistGet,
  toggleInviteAssistMembership,
} from "../invite-assist-friend";

const USER_ID = "usr_11111111-2222-3333-4444-555555555555";

afterEach(() => {
  ipcCallMock.mockReset();
});

describe("isOnInviteAssistAllowlist", () => {
  it("matches the friend userId on the allowlist", () => {
    expect(
      isOnInviteAssistAllowlist([{ userId: USER_ID, displayName: "Nova" }], USER_ID),
    ).toBe(true);
    expect(isOnInviteAssistAllowlist([{ userId: "usr_other" }], USER_ID)).toBe(false);
    expect(isOnInviteAssistAllowlist([], USER_ID)).toBe(false);
    expect(isOnInviteAssistAllowlist(undefined, USER_ID)).toBe(false);
  });
});

describe("parseInviteAssistGet", () => {
  it("reads enabled and confirmedAt from get; ignores mock confirmed alias", () => {
    const snap = parseInviteAssistGet({
      enabled: true,
      confirmed: true,
      confirmedAt: "2026-08-20T00:00:00Z",
      allowlist: [{ userId: USER_ID, displayName: "Nova" }],
    });
    expect(snap.enabled).toBe(true);
    expect(snap.confirmedAt).toBe("2026-08-20T00:00:00Z");
    expect(snap.allowlist).toEqual([{ userId: USER_ID, displayName: "Nova" }]);

    expect(parseInviteAssistGet({ enabled: false, confirmed: true, allowlist: [] })).toEqual({
      enabled: false,
      confirmedAt: null,
      allowlist: [],
    });
  });
});

describe("toggleInviteAssistMembership", () => {
  it("Add calls inviteAssist.allowAdd with a usr_ id", async () => {
    ipcCallMock.mockResolvedValue({ allowlist: [{ userId: USER_ID, displayName: "Nova" }] });
    const result = await toggleInviteAssistMembership({
      userId: USER_ID,
      displayName: "Nova",
      allowlist: [],
      confirmedAt: "2026-08-20T00:00:00Z",
    });
    expect(result).toBe("added");
    expect(ipcCallMock).toHaveBeenCalledTimes(1);
    expect(ipcCallMock).toHaveBeenCalledWith("inviteAssist.allowAdd", {
      userId: USER_ID,
      displayName: "Nova",
    });
    expect(ipcCallMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ userId: expect.stringMatching(/^usr_/) }),
    );
  });

  it("Remove calls inviteAssist.allowRemove with the usr_ id", async () => {
    ipcCallMock.mockResolvedValue({ allowlist: [] });
    const result = await toggleInviteAssistMembership({
      userId: USER_ID,
      displayName: "Nova",
      allowlist: [{ userId: USER_ID, displayName: "Nova" }],
      confirmedAt: "2026-08-20T00:00:00Z",
    });
    expect(result).toBe("removed");
    expect(ipcCallMock).toHaveBeenCalledTimes(1);
    expect(ipcCallMock).toHaveBeenCalledWith("inviteAssist.allowRemove", { userId: USER_ID });
  });

  it("does not call allowAdd until Experimental confirmedAt is set", async () => {
    const result = await toggleInviteAssistMembership({
      userId: USER_ID,
      displayName: "Nova",
      allowlist: [],
      confirmedAt: null,
    });
    expect(result).toBe("confirmRequired");
    expect(ipcCallMock).not.toHaveBeenCalled();
  });

  it("adds while Invite Assist is off and never auto-enables", async () => {
    ipcCallMock.mockResolvedValue({ allowlist: [{ userId: USER_ID }] });
    const result = await toggleInviteAssistMembership({
      userId: USER_ID,
      displayName: "Nova",
      allowlist: [],
      confirmedAt: "2026-08-20T00:00:00Z",
    });
    expect(result).toBe("added");
    const methods = ipcCallMock.mock.calls.map((call) => call[0]);
    expect(methods).toEqual(["inviteAssist.allowAdd"]);
    expect(methods).not.toContain("inviteAssist.setEnabled");
    expect(methods).not.toContain("inviteAssist.confirm");
  });
});
