import { describe, expect, it, vi, beforeEach } from "vitest";

const oscSendMock = vi.fn();

vi.mock("@/lib/ipc", () => ({
  ipc: {
    oscSend: oscSendMock,
  },
}));

describe("osc-api chatbox payload", () => {
  beforeEach(() => {
    oscSendMock.mockReset();
    oscSendMock.mockResolvedValue({ ok: true });
  });

  it("sends /chatbox/input args in VRChat order", async () => {
    const { sendChatbox } = await import("../osc-api");

    await sendChatbox("VRCSM", { host: "127.0.0.1", port: 9000 }, true, false);

    expect(oscSendMock).toHaveBeenCalledWith(
      "/chatbox/input",
      ["VRCSM", true, false],
      { host: "127.0.0.1", port: 9000 },
    );
  });
});
