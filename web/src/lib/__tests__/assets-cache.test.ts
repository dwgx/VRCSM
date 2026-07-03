import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcCallMock = vi.fn();

vi.mock("../ipc", () => ({
  ipc: {
    call: ipcCallMock,
    on: vi.fn(),
  },
}));

const baseNow = new Date("2026-06-25T00:00:00.000Z");

describe("assets-cache lifecycle", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(baseNow);
    ipcCallMock.mockReset();
    const { invalidateAssets } = await import("../assets-cache");
    invalidateAssets();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("honors backend expiresAt before falling back to fixed TTL", async () => {
    const { resolveAssets } = await import("../assets-cache");
    const item = { type: "world" as const, id: "wrld_123" };

    ipcCallMock.mockResolvedValueOnce({
      results: [
        {
          ...item,
          displayName: "Backend TTL",
          expiresAt: "2026-06-25T00:30:00.000Z",
        },
      ],
    });

    await resolveAssets([item]);
    await resolveAssets([item]);

    vi.setSystemTime(new Date("2026-06-25T00:11:00.000Z"));
    await resolveAssets([item]);

    expect(ipcCallMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes shortly after an expired backend expiresAt", async () => {
    const { resolveAssets } = await import("../assets-cache");
    const item = { type: "avatar" as const, id: "avtr_123" };

    ipcCallMock
      .mockResolvedValueOnce({
        results: [
          {
            ...item,
            displayName: "Expired",
            expiresAt: "2026-06-24T23:59:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        results: [{ ...item, displayName: "Refreshed" }],
      });

    await resolveAssets([item]);
    vi.setSystemTime(new Date("2026-06-25T00:00:00.500Z"));
    await resolveAssets([item]);
    vi.setSystemTime(new Date("2026-06-25T00:00:01.001Z"));
    await resolveAssets([item]);

    expect(ipcCallMock).toHaveBeenCalledTimes(2);
  });

  it("honors backend negativeUntil for negative rows", async () => {
    const { resolveAssets } = await import("../assets-cache");
    const item = { type: "user" as const, id: "usr_123" };

    ipcCallMock.mockResolvedValueOnce({
      results: [
        {
          ...item,
          negative: true,
          negativeUntil: "2026-06-25T00:20:00.000Z",
        },
      ],
    });

    await resolveAssets([item]);
    vi.setSystemTime(new Date("2026-06-25T00:06:00.000Z"));
    await resolveAssets([item]);

    expect(ipcCallMock).toHaveBeenCalledTimes(1);
  });

  it("invalidates backend before clearing the matching frontend memo entry", async () => {
    const { invalidateAssetsCoherent, resolveAssets } = await import("../assets-cache");
    const item = { type: "world" as const, id: "wrld_123" };

    ipcCallMock
      .mockResolvedValueOnce({
        results: [{ ...item, displayName: "Cached", expiresAt: "2026-06-25T00:30:00.000Z" }],
      })
      .mockImplementationOnce(async () => {
        expect(await resolveAssets([item])).toHaveLength(1);
        return { ok: true };
      })
      .mockResolvedValueOnce({
        results: [{ ...item, displayName: "After invalidate" }],
      });

    await resolveAssets([item]);
    await invalidateAssetsCoherent(item);
    await resolveAssets([item]);

    expect(ipcCallMock).toHaveBeenNthCalledWith(2, "assets.invalidate", item);
    expect(ipcCallMock).toHaveBeenCalledTimes(3);
  });
});
