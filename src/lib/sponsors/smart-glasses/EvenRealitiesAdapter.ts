import type { DeviceStatus, HudPayload, SmartGlassesAdapter } from './SmartGlassesAdapter';

/**
 * Even Realities (G1/G2) HUD driver — SHELL.
 *
 * The display is a narrow monochrome text area, so we render the HUD as a few short lines.
 * All SDK I/O is isolated behind `EvenHubTransport`; once the glasses + SDK docs are in hand at
 * LA Hacks, implement the transport (see TODO(sdk) blocks) and nothing else in the app changes.
 *
 * Enable with `VITE_ENABLE_EVEN_REALITIES=true`, or at runtime:
 *   registerGlassesAdapter(new EvenRealitiesAdapter())
 */

/** Minimal surface we need from the Even Hub SDK / bridge. */
export interface EvenHubTransport {
  isAvailable(): boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Push a full-screen text page (lines are pre-truncated by the adapter). */
  showText(lines: string[]): Promise<void>;
  onDisconnect(cb: (reason?: string) => void): () => void;
}

/** Max chars per line / lines per page on the glasses display. Tune once hardware is available. */
const MAX_COLS = 28;
const MAX_LINES = 4;

export function formatHud(p: HudPayload): string[] {
  const clip = (s: string) => (s.length > MAX_COLS ? `${s.slice(0, MAX_COLS - 1)}…` : s);
  const lines: string[] = [];
  const ex = p.exercise ? p.exercise.toUpperCase() : 'REPS';
  lines.push(`${ex}  ${p.repCount}${p.calories !== undefined ? `   ${p.calories.toFixed(1)} kcal` : ''}`);
  if (p.formAlert) lines.push(`${p.formAlert.severity === 'critical' ? '!! ' : '! '}${p.formAlert.message}`);
  if (p.macroSummary) {
    const top = p.macroSummary.items[0];
    lines.push(`Meal ${p.macroSummary.totalKcal} kcal`);
    if (top) lines.push(`P${Math.round(top.protein)} C${Math.round(top.carbs)} F${Math.round(top.fat)} ${top.name}`);
  }
  return lines.slice(0, MAX_LINES).map(clip);
}

/**
 * Default transport — detects an injected Even Hub bridge.
 * TODO(sdk): replace the body with real SDK calls, e.g.
 *   // import { EvenHub } from '<even-hub-sdk>';
 *   // const hub = await EvenHub.init();
 *   // await hub.display.text({ lines });
 */
class EvenHubBridgeTransport implements EvenHubTransport {
  private get bridge(): Record<string, unknown> | undefined {
    return (globalThis as { EvenHub?: Record<string, unknown> }).EvenHub;
  }

  isAvailable(): boolean {
    return typeof this.bridge === 'object';
  }

  async connect(): Promise<void> {
    if (!this.isAvailable()) throw new Error('Even Hub bridge not found (open the app inside Even Hub, or add the SDK).');
    // TODO(sdk): await this.bridge.connect();
  }

  async disconnect(): Promise<void> {
    // TODO(sdk): await this.bridge?.disconnect();
  }

  async showText(lines: string[]): Promise<void> {
    void lines;
    // TODO(sdk): await this.bridge.display.showText(lines.join('\n'));
  }

  onDisconnect(cb: (reason?: string) => void): () => void {
    void cb;
    // TODO(sdk): const off = this.bridge.on('disconnect', cb); return off;
    return () => {};
  }
}

export class EvenRealitiesAdapter implements SmartGlassesAdapter {
  readonly id = 'even-realities';
  readonly label = 'Even Realities';
  private listeners = new Set<(s: DeviceStatus, d?: string) => void>();
  private offDisconnect: (() => void) | null = null;
  private lastSent = '';

  constructor(private readonly transport: EvenHubTransport = new EvenHubBridgeTransport()) {}

  isSupported(): boolean {
    try {
      return this.transport.isAvailable();
    } catch {
      return false;
    }
  }

  async connect(): Promise<void> {
    this.emit('connecting');
    await this.transport.connect();
    this.offDisconnect = this.transport.onDisconnect((reason) => this.emit('disconnected', reason));
    this.emit('connected');
  }

  async disconnect(): Promise<void> {
    this.offDisconnect?.();
    this.offDisconnect = null;
    await this.transport.disconnect();
    this.emit('disconnected');
  }

  async sendHud(payload: HudPayload): Promise<void> {
    const lines = formatHud(payload);
    const key = lines.join('\n');
    if (key === this.lastSent) return; // BLE bandwidth is precious: skip identical frames
    await this.transport.showText(lines);
    this.lastSent = key;
  }

  onStatusChange(cb: (status: DeviceStatus, detail?: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(status: DeviceStatus, detail?: string): void {
    this.listeners.forEach((cb) => cb(status, detail));
  }
}
