import { useEffect, useState, useSyncExternalStore } from 'react';
import { sponsorBus, getPluginHealth, onPluginHealthChange, glassesController } from '@/lib/sponsors';
import type { SponsorEventMap } from '@/core/events/events';
import type { Listener } from '@/core/events/EventBus';
import { frameProfiler } from '@/lib/sponsors/sentry/frameProfiler';

/** Subscribe a component to a bus event for its lifetime. */
export function useBusEvent<K extends keyof SponsorEventMap>(event: K, handler: Listener<SponsorEventMap[K]>): void {
  useEffect(() => sponsorBus.on(event, handler, { owner: `ui:${String(event)}` }), [event, handler]);
}

/** Live glasses/HUD state — the browser HUD mirrors exactly what the glasses receive. */
export function useGlassesState() {
  return useSyncExternalStore(
    (cb) => glassesController.subscribe(cb),
    () => glassesController.snapshot,
  );
}

export function usePluginHealth() {
  const [health, setHealth] = useState(getPluginHealth);
  useEffect(() => onPluginHealthChange(() => setHealth(getPluginHealth())), []);
  return health;
}

/** Samples the profiler at 2 Hz for display — never per-frame React state. */
export function useFps(): { fps: number; avgMs: number } {
  const [s, setS] = useState({ fps: 0, avgMs: 0 });
  useEffect(() => {
    const id = setInterval(() => setS({ fps: Math.round(frameProfiler.fps), avgMs: +frameProfiler.avgMs.toFixed(1) }), 500);
    return () => clearInterval(id);
  }, []);
  return s;
}
