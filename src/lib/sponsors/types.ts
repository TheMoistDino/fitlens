import type { EventBus } from '@/core/events/EventBus';
import type { SponsorEventMap } from '@/core/events/events';

export type SponsorBus = EventBus<SponsorEventMap>;

export interface PluginHealth {
  ok: boolean;
  /** 'live' = talking to the real service, 'mock' = degraded/offline fallback. */
  mode: 'live' | 'mock' | 'disabled';
  detail?: string;
}

/**
 * A sponsor integration. Plugins only talk to the rest of the app through the bus,
 * so adding/removing one never touches core code.
 */
export interface SponsorPlugin {
  readonly id: string;
  readonly label: string;
  /** Subscribe to bus events. Must not throw; async work should be fire-and-forget. */
  init(bus: SponsorBus): void | Promise<void>;
  dispose(): void;
  health(): PluginHealth;
}
