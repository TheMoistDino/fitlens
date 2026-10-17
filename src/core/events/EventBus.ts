/**
 * Minimal, strictly typed pub/sub.
 *
 * Two dispatch modes per listener:
 *  - 'sync'  : runs inline inside emit(). Reserved for cheap hot-path consumers (e.g. HUD coalescing).
 *  - 'async' : (default) deferred via queueMicrotask so slow / failing cold-path consumers
 *              (network plugins) can never stall or throw into the 60 FPS frame loop.
 *
 * Every listener is wrapped in try/catch; errors are routed to an injectable reporter (Sentry).
 */

export type EventMap = Record<string, unknown>;
export type Listener<T> = (payload: T) => void | Promise<void>;
export type Unsubscribe = () => void;
export type DispatchMode = 'sync' | 'async';

export interface ListenerOptions {
  mode?: DispatchMode;
  /** Tag used when reporting errors (e.g. the sponsor plugin id). */
  owner?: string;
}

interface Entry<T> {
  fn: Listener<T>;
  mode: DispatchMode;
  owner: string;
}

export type ErrorReporter = (error: unknown, context: { event: string; owner: string }) => void;

export class EventBus<TMap extends EventMap> {
  private listeners = new Map<keyof TMap, Set<Entry<never>>>();
  private reportError: ErrorReporter = (error, ctx) =>
    console.error(`[EventBus] listener "${ctx.owner}" failed on "${ctx.event}"`, error);

  setErrorReporter(reporter: ErrorReporter): void {
    this.reportError = reporter;
  }

  on<K extends keyof TMap>(event: K, fn: Listener<TMap[K]>, opts: ListenerOptions = {}): Unsubscribe {
    const entry: Entry<TMap[K]> = { fn, mode: opts.mode ?? 'async', owner: opts.owner ?? 'anonymous' };
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(entry as Entry<never>);
    return () => {
      set.delete(entry as Entry<never>);
    };
  }

  once<K extends keyof TMap>(event: K, fn: Listener<TMap[K]>, opts: ListenerOptions = {}): Unsubscribe {
    const off = this.on(
      event,
      (payload) => {
        off();
        return fn(payload);
      },
      opts,
    );
    return off;
  }

  emit<K extends keyof TMap>(event: K, payload: TMap[K]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    // Snapshot so listeners that unsubscribe during dispatch don't mutate the iteration.
    for (const entry of [...set] as Entry<TMap[K]>[]) {
      if (entry.mode === 'sync') this.invoke(entry, event, payload);
      else queueMicrotask(() => this.invoke(entry, event, payload));
    }
  }

  listenerCount<K extends keyof TMap>(event: K): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  clear(): void {
    this.listeners.clear();
  }

  private invoke<K extends keyof TMap>(entry: Entry<TMap[K]>, event: K, payload: TMap[K]): void {
    const ctx = { event: String(event), owner: entry.owner };
    try {
      const result = entry.fn(payload);
      if (result instanceof Promise) result.catch((err: unknown) => this.reportError(err, ctx));
    } catch (err) {
      this.reportError(err, ctx);
    }
  }
}
