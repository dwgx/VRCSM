import { describe, expect, it, vi } from "vitest";
import { crawlMutuals } from "@/lib/mutuals-crawl";

describe("crawlMutuals", () => {
  it("fetches unique usr_ ids in order and counts hidden", async () => {
    const seen: string[] = [];
    const out = await crawlMutuals(
      ["usr_a", "usr_a", "not-a-user", "usr_b"],
      async (id) => {
        seen.push(id);
        return { hidden: id === "usr_b" };
      },
      { delayMs: 0 },
    );
    expect(seen).toEqual(["usr_a", "usr_b"]);
    expect(out).toEqual({ fetched: 2, hidden: 1, errors: 0, cancelled: false });
  });

  it("stops when shouldCancel becomes true", async () => {
    let n = 0;
    const out = await crawlMutuals(
      ["usr_1", "usr_2", "usr_3"],
      async () => {
        n += 1;
        return { hidden: false };
      },
      { delayMs: 0, shouldCancel: () => n >= 1 },
    );
    expect(out.fetched).toBe(1);
    expect(out.cancelled).toBe(true);
  });

  it("counts fetch errors without aborting the rest", async () => {
    const out = await crawlMutuals(
      ["usr_ok", "usr_bad", "usr_ok2"],
      async (id) => {
        if (id === "usr_bad") throw new Error("429");
        return { hidden: false };
      },
      { delayMs: 0 },
    );
    expect(out.fetched).toBe(2);
    expect(out.errors).toBe(1);
    expect(out.cancelled).toBe(false);
  });

  it("reports progress", async () => {
    const progress = vi.fn();
    await crawlMutuals(["usr_x"], async () => ({ hidden: true }), {
      delayMs: 0,
      onProgress: progress,
    });
    expect(progress).toHaveBeenCalledWith({
      done: 1,
      total: 1,
      userId: "usr_x",
      hidden: true,
    });
  });
});
