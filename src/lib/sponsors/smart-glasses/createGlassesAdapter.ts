import { env } from '@/config/env';
import type { SmartGlassesAdapter } from './SmartGlassesAdapter';
import { NullSmartGlassesAdapter } from './NullSmartGlassesAdapter';
import { EvenRealitiesAdapter } from './EvenRealitiesAdapter';

/**
 * Factory: decides which HUD driver to use at boot.
 * Returns the Null adapter unless the flag is on AND the device/bridge is actually present.
 */
export function createGlassesAdapter(): { adapter: SmartGlassesAdapter; reason?: string } {
  const fallback = new NullSmartGlassesAdapter(env.isDev);
  if (!env.features.evenRealities) return { adapter: fallback };

  try {
    const even = new EvenRealitiesAdapter();
    if (even.isSupported()) return { adapter: even };
    return { adapter: fallback, reason: 'Even Realities enabled but no device/bridge detected' };
  } catch (err) {
    return { adapter: fallback, reason: `Even Realities adapter failed: ${String(err)}` };
  }
}
