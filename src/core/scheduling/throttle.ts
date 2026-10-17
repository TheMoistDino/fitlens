/** Leading + trailing throttle. Guarantees the most recent call is eventually delivered. */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, waitMs: number) {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  const invoke = (args: A) => {
    last = Date.now();
    pending = null;
    fn(...args);
  };

  const throttled = (...args: A) => {
    const remaining = waitMs - (Date.now() - last);
    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      invoke(args);
    } else {
      pending = args;
      timer ??= setTimeout(() => {
        timer = null;
        if (pending) invoke(pending);
      }, remaining);
    }
  };

  throttled.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return throttled;
}

/**
 * Runs at most one async job at a time. While a job is in flight, new submissions replace
 * any queued one (latest-only) — stale keyframes are dropped instead of building a backlog.
 */
export class LatestOnlyQueue<T> {
  private running = false;
  private next: T | null = null;

  constructor(private readonly worker: (item: T) => Promise<void>) {}

  push(item: T): void {
    if (this.running) {
      this.next = item;
      return;
    }
    void this.run(item);
  }

  private async run(item: T): Promise<void> {
    this.running = true;
    try {
      await this.worker(item);
    } catch {
      // Worker is responsible for reporting; the queue must keep draining.
    } finally {
      this.running = false;
      const queued = this.next;
      this.next = null;
      if (queued !== null) void this.run(queued);
    }
  }
}

/** fetch() with a hard timeout via AbortController. */
export async function fetchWithTimeout(input: RequestInfo, init: RequestInit = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
