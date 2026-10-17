import type { DeviceStatus, HudPayload } from '@/core/events/events';

export type { DeviceStatus, HudPayload };

/**
 * Hardware-agnostic contract for any heads-up display.
 *
 * Rules every implementation must follow (the controller relies on them):
 *  1. `isSupported()` is cheap, synchronous and side-effect free (feature detection only).
 *  2. `connect()` may reject; `sendHud()` may reject — the controller catches both.
 *  3. Status changes are pushed via `onStatusChange` (e.g. BLE disconnect) so the controller can reconnect.
 */
export interface SmartGlassesAdapter {
  readonly id: string;
  readonly label: string;
  isSupported(): boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendHud(payload: HudPayload): Promise<void>;
  onStatusChange(cb: (status: DeviceStatus, detail?: string) => void): () => void;
}
