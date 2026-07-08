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

  it("chunks a >64-item batch into multiple images.cache calls (host caps at 64)", async () => {
    const { cacheImageUrls } = await import("../image-cache");

    // The host processes at most 64 items per call; without FE chunking, items
    // 65+ get no result row and are wrongly negative-cached. Echo each
    // requested item back as a resolved local URL.
    ipcCallMock.mockImplementation(
      async (_method: string, params: { items: Array<{ id: string; url: string }> }) => ({
        results: params.items.map((it) => ({
          id: it.id,
          url: it.url,
          localUrl: `https://thumb.local/${it.id}.webp`,
          imageCached: true,
          source: "network",
          error: null,
        })),
      }),
    );

    const items = Array.from({ length: 130 }, (_, i) => ({
      id: `usr_${i}`,
      url: `https://api.example/${i}.png`,
    }));

    const out = await cacheImageUrls(items);

    // 130 items → 64 + 64 + 2 → three calls, none exceeding the 64 cap.
    expect(ipcCallMock).toHaveBeenCalledTimes(3);
    for (const call of ipcCallMock.mock.calls) {
      expect(call[0]).toBe("images.cache");
      expect(call[1].items.length).toBeLessThanOrEqual(64);
    }
    // Every item resolved — including the ones past the first 64.
    expect(out).toHaveLength(130);
    expect(out.every((r) => r.localUrl !== null)).toBe(true);
  });
});
