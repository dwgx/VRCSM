/**
 * Lightweight throttle queue for VRChat API fanout. Prevents rooms
 * like "Seen Avatars" (50+ rows each wanting `avatar.details`) from
 * tripping VRChat's per-user rate limit (observed ~10 req/s hard cap,
 * bursts beyond that return 429).
 *
 * Contract: `vrcApiThrottle(() => ipc.call(...))` returns the inner
 * promise's eventual value, delayed just enough to respect the global
 * limits. Errors bubble unchanged so React Query's retry logic works.
 *
 * No external deps — p-queue would add 3 KB for behaviour we need 40
 * lines for. If we outgrow this and need pause/resume, deadlining, or
 * priority tiers, swap it for p-queue then.
 */

type Task<T> = () => Promise<T>;

export interface ThrottleOptions {
  /** Max in-flight promises. */
  concurrency: number;
  /** Sliding window size (ms) for the rate cap. */
  intervalMs: number;
  /** Max starts within the sliding window. */
  maxPerInterval: number;
}

export function createThrottle(opts: ThrottleOptions) {
  const { concurrency, intervalMs, maxPerInterval } = opts;
  let inFlight = 0;
  const queue: Array<() => void> = [];
  const starts: number[] = [];

  function trim(now: number) {
    while (starts.length > 0 && starts[0] <= now - intervalMs) {
      starts.shift();
    }
  }

  function waitMs(): number {
    const now = Date.now();
    trim(now);
    if (starts.length < maxPerInterval) return 0;
    // starts[0] is the oldest still-counting start. Wait until it ages
    // out of the window, plus a small buffer so we don't immediately
    // trigger the same check again.
    return intervalMs - (now - starts[0]) + 5;
  }

  function pump() {
    if (inFlight >= concurrency) return;
    if (queue.length === 0) return;
    const wait = waitMs();
    if (wait > 0) {
      setTimeout(pump, wait);
      return;
    }
    const run = queue.shift();
    if (!run) return;
    inFlight += 1;
    starts.push(Date.now());
    run();
  }

  return function enqueue<T>(task: Task<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task().then(resolve, reject).finally(() => {
          inFlight -= 1;
          pump();
        });
      });
      pump();
    });
  };
}

/**
 * Shared throttle for any handler that calls VRChat's REST API. 3
 * in-flight at a time, at most 5 starts per second, which keeps us
 * well under the observed 10 req/s limit while still feeling snappy on
 * the first 15–20 rows of any list.
 */
export const vrcApiThrottle = createThrottle({
  concurrency: 3,
  intervalMs: 1000,
  maxPerInterval: 5,
});
