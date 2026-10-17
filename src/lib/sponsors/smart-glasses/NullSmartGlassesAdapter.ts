import type { DeviceStatus, HudPayload, SmartGlassesAdapter } from './SmartGlassesAdapter';

/**
 * Null Object default. Always "supported", always succeeds, does nothing.
 * In dev it logs at most once per second so you can see what *would* go to the glasses.
 */
export class NullSmartGlassesAdapter implements SmartGlassesAdapter {
  readonly id = 'null';
  readonly label = 'No glasses (browser only)';
  private lastLog = 0;

  constructor(private readonly debug = false) {}

  isSupported(): boolean {
    return true;
  }

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  async sendHud(payload: HudPayload): Promise<void> {
    if (!this.debug) return;
    const now = Date.now();
    if (now - this.lastLog < 1000) return; // drop frames silently
    this.lastLog = now;
    console.debug('[HUD:null]', payload);
  }

  onStatusChange(cb: (status: DeviceStatus, detail?: string) => void): () => void {
    cb('disabled');
    return () => {};
  }
}
