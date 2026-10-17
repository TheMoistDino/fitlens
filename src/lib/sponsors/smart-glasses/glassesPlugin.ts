import * as Sentry from '@sentry/react';
import { throttle } from '@/core/scheduling/throttle';
import type { DeviceStatus, HudPayload } from '@/core/events/events';
import type { PluginHealth, SponsorBus, SponsorPlugin } from '../types';
import { notifyHealthChanged } from '../SponsorEventBus';
import type { SmartGlassesAdapter } from './SmartGlassesAdapter';
import { NullSmartGlassesAdapter } from './NullSmartGlassesAdapter';
import { createGlassesAdapter } from './createGlassesAdapter';

/**
 * Bridges the bus to whichever SmartGlassesAdapter is active.
 *
 *  - Coalesces rep/form/macro events into one HudPayload snapshot.
 *  - Sends at most HUD_HZ times per second, latest-only (no backlog while offline).
 *  - Never lets adapter errors escape: connect failures retry with exponential backoff,
 *    then fall back to the Null adapter. The browser UI keeps working throughout.
 */
const HUD_HZ = 4;
const MAX_CONNECT_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 30_000;

export interface GlassesState {
  adapterId: string;
  adapterLabel: string;
  status: DeviceStatus;
  detail?: string;
  hud: HudPayload;
}

type StateListener = (s: GlassesState) => void;

class GlassesController {
  private adapter: SmartGlassesAdapter = new NullSmartGlassesAdapter();
  private bus: SponsorBus | null = null;
  private offStatus: (() => void) | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private listeners = new Set<StateListener>();
  private state: GlassesState = { adapterId: 'null', adapterLabel: 'No glasses', status: 'disabled', hud: { repCount: 0 } };

  private readonly flush = throttle(() => {
    const payload = this.state.hud;
    this.bus?.emit('hud:update', payload);
    if (this.state.status !== 'connected' && this.adapter.id !== 'null') return; // drop while offline
    this.adapter.sendHud(payload).catch((err: unknown) => {
      Sentry.captureException(err, { tags: { plugin: 'glasses', adapter: this.adapter.id } });
    });
  }, 1000 / HUD_HZ);

  attach(bus: SponsorBus): void {
    this.bus = bus;
  }

  get snapshot(): GlassesState {
    return this.state;
  }

  subscribe(fn: StateListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  updateHud(patch: Partial<HudPayload>): void {
    this.setState({ hud: { ...this.state.hud, ...patch } });
    this.flush();
  }

  async use(adapter: SmartGlassesAdapter, reason?: string): Promise<void> {
    await this.teardown();
    this.adapter = adapter;
    this.attempts = 0;
    this.setState({ adapterId: adapter.id, adapterLabel: adapter.label, detail: reason });

    if (!adapter.isSupported()) {
      this.setStatus('unsupported', 'Device API not available');
      await this.use(new NullSmartGlassesAdapter(), `${adapter.label} unsupported in this browser`);
      return;
    }

    this.offStatus = adapter.onStatusChange((status, detail) => {
      this.setStatus(status, detail);
      if (status === 'disconnected' && adapter.id !== 'null') this.scheduleReconnect();
    });

    await this.tryConnect();
  }

  private async tryConnect(): Promise<void> {
    const adapter = this.adapter;
    try {
      await adapter.connect();
      this.attempts = 0;
      if (adapter.id === 'null') this.setStatus('disabled');
      this.flush(); // push current HUD immediately
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus('error', msg);
      Sentry.addBreadcrumb({ category: 'glasses', level: 'warning', message: `connect failed: ${msg}` });
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.retryTimer) return;
    this.attempts += 1;
    if (this.attempts > MAX_CONNECT_ATTEMPTS) {
      void this.use(new NullSmartGlassesAdapter(), `${this.adapter.label} unreachable — using browser HUD only`);
      return;
    }
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (this.attempts - 1));
    this.setStatus('connecting', `Retry ${this.attempts}/${MAX_CONNECT_ATTEMPTS} in ${delay / 1000}s`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.tryConnect();
    }, delay);
  }

  private async teardown(): Promise<void> {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.offStatus?.();
    this.offStatus = null;
    try {
      await this.adapter.disconnect();
    } catch {
      /* best effort */
    }
  }

  private setStatus(status: DeviceStatus, detail?: string): void {
    this.setState({ status, detail });
    this.bus?.emit('device:status', { adapter: this.adapter.id, status, detail });
  }

  private setState(patch: Partial<GlassesState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn(this.state));
    notifyHealthChanged();
  }

  async dispose(): Promise<void> {
    this.flush.cancel();
    await this.teardown();
  }
}

export const glassesController = new GlassesController();

/** Runtime hot-swap, e.g. from the dashboard once glasses are paired: zero core refactoring. */
export function registerGlassesAdapter(adapter: SmartGlassesAdapter): Promise<void> {
  return glassesController.use(adapter);
}

export function createGlassesPlugin(): SponsorPlugin {
  const offs: Array<() => void> = [];
  return {
    id: 'glasses',
    label: 'Smart glasses HUD',
    async init(bus) {
      glassesController.attach(bus);
      // Coalescing is O(1) — run it synchronously so the HUD reflects the exact emit order.
      offs.push(
        bus.on('workout:started', ({ exercise }) => glassesController.updateHud({ exercise, repCount: 0, calories: 0, formAlert: null }), { mode: 'sync', owner: 'glasses' }),
        bus.on('rep:completed', ({ repCount, calories, exercise }) => glassesController.updateHud({ repCount, calories, exercise }), { mode: 'sync', owner: 'glasses' }),
        bus.on('form:alert', (formAlert) => glassesController.updateHud({ formAlert }), { mode: 'sync', owner: 'glasses' }),
        bus.on('macro:result', (macroSummary) => glassesController.updateHud({ macroSummary }), { mode: 'sync', owner: 'glasses' }),
      );
      const { adapter, reason } = createGlassesAdapter();
      // Don't block app boot on BLE pairing.
      void glassesController.use(adapter, reason);
    },
    dispose() {
      offs.forEach((off) => off());
      void glassesController.dispose();
    },
    health(): PluginHealth {
      const s = glassesController.snapshot;
      if (s.adapterId === 'null') return { ok: true, mode: 'disabled', detail: s.detail ?? 'Browser-only HUD' };
      return { ok: s.status === 'connected', mode: 'live', detail: `${s.adapterLabel}: ${s.status}${s.detail ? ` — ${s.detail}` : ''}` };
    },
  };
}
