import { EventBus } from '@/core/events/EventBus';
import type { SponsorEventMap } from '@/core/events/events';
import type { PluginHealth, SponsorPlugin } from './types';

/** The app-wide bus. One instance; import it anywhere. */
export const sponsorBus = new EventBus<SponsorEventMap>();

const plugins = new Map<string, SponsorPlugin>();
type HealthListener = () => void;
const healthListeners = new Set<HealthListener>();

/**
 * Register plugins. Each one is initialised in isolation: a plugin that throws during init
 * is logged and skipped — the rest of the app (and other plugins) keep working.
 */
export async function registerPlugins(list: SponsorPlugin[]): Promise<void> {
  await Promise.all(
    list.map(async (plugin) => {
      if (plugins.has(plugin.id)) return;
      try {
        await plugin.init(sponsorBus);
        plugins.set(plugin.id, plugin);
      } catch (err) {
        console.error(`[plugins] "${plugin.id}" failed to init — skipping`, err);
      }
    }),
  );
  notifyHealthChanged();
}

export function unregisterPlugin(id: string): void {
  const p = plugins.get(id);
  if (!p) return;
  try {
    p.dispose();
  } catch (err) {
    console.warn(`[plugins] "${id}" dispose failed`, err);
  }
  plugins.delete(id);
  notifyHealthChanged();
}

export function getPluginHealth(): Array<{ id: string; label: string } & PluginHealth> {
  return [...plugins.values()].map((p) => {
    try {
      return { id: p.id, label: p.label, ...p.health() };
    } catch {
      return { id: p.id, label: p.label, ok: false, mode: 'disabled' as const, detail: 'health() threw' };
    }
  });
}

export function onPluginHealthChange(fn: HealthListener): () => void {
  healthListeners.add(fn);
  return () => healthListeners.delete(fn);
}

export function notifyHealthChanged(): void {
  healthListeners.forEach((fn) => fn());
}
