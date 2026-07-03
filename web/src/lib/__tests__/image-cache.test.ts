import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcCallMock = vi.fn();

vi.mock("../ipc", () => ({
  ipc: {
    call: ipcCallMock,
  },
}));

describe("image-cache local URL handling", () => {
  beforeEach(async () => {
    ipcCallMock.mockReset();
    const { invalidateCachedImages } = await import("../image-cache");
    invalidateCachedImages();
  });

  it("reuses existing thumb.local URLs without sending them back to IPC", async () => {
    const { cacheImageUrl } = await import("../image-cache");
    const url = "https://thumb.local/avatar-123.webp";

    await expect(cacheImageUrl("profile-avatar:usr_123", url)).resolves.toBe(url);

    expect(ipcCallMock).not.toHaveBeenCalled();
  });
});
