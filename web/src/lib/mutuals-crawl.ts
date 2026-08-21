export type MutualsCrawlFetchOne = (userId: string) => Promise<{ hidden?: boolean }>;

export type MutualsCrawlProgress = {
  done: number;
  total: number;
  userId: string;
  hidden: boolean;
  error?: string;
};

export type MutualsCrawlResult = {
  fetched: number;
  hidden: number;
  errors: number;
  cancelled: boolean;
};

/** Sequential official GET crawl. Caller supplies fetchOne. Not a startup job. */
export async function crawlMutuals(
  userIds: string[],
  fetchOne: MutualsCrawlFetchOne,
  opts?: {
    delayMs?: number;
    shouldCancel?: () => boolean;
    onProgress?: (p: MutualsCrawlProgress) => void;
  },
): Promise<MutualsCrawlResult> {
  const ids = [...new Set(userIds.filter((id) => id.startsWith("usr_")))];
  const delayMs = Math.max(0, opts?.delayMs ?? 400);
  const result: MutualsCrawlResult = {
    fetched: 0,
    hidden: 0,
    errors: 0,
    cancelled: false,
  };

  for (let i = 0; i < ids.length; i += 1) {
    if (opts?.shouldCancel?.()) {
      result.cancelled = true;
      break;
    }
    const userId = ids[i];
    try {
      const row = await fetchOne(userId);
      result.fetched += 1;
      if (row.hidden) result.hidden += 1;
      opts?.onProgress?.({
        done: i + 1,
        total: ids.length,
        userId,
        hidden: Boolean(row.hidden),
      });
    } catch (e) {
      result.errors += 1;
      opts?.onProgress?.({
        done: i + 1,
        total: ids.length,
        userId,
        hidden: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    if (i + 1 < ids.length && delayMs > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      });
    }
  }
  return result;
}
