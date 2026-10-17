import { useSyncExternalStore } from 'react';
import type { FitnessContext, FitnessEvent, FitnessMode } from './types';

/**
 * Fitness mode FSM.
 *
 *   IDLE ──START_MACHINE_SCAN──▶ SCAN_MACHINE ──CONFIRM_MACHINE──▶ SCAN_WEIGHT ──START_SET──▶ ACTIVE_SET
 *    ▲  └──MACHINE_SELECTED (manual pick)────────────────────────▶     ▲                         │
 *    │                                                                 │                      END_SET
 *    └──────────────── RESET (from anywhere) ◀── SET_SUMMARY ──NEXT_SET┘◀────────────────────────┘
 *
 * `transition` is a pure reducer: an event that isn't legal in the current mode returns the *same*
 * object, so callers can detect "rejected" with `===`. Async results carry the `epoch` they were
 * started in; once the mode changes the epoch moves on and late results are ignored. That is what
 * keeps a slow OCR read or machine classification from landing in the wrong mode.
 */

export const initialFitnessContext: FitnessContext = {
  mode: 'IDLE',
  epoch: 0,
  machine: null,
  machineBox: null,
  machineConfidence: 0,
  load: null,
  setStartedAt: null,
  lastSummary: null,
};

/** Which event types each mode accepts (RESET is accepted everywhere). */
const ACCEPTS: Record<FitnessMode, ReadonlyArray<FitnessEvent['type']>> = {
  IDLE: ['START_MACHINE_SCAN', 'MACHINE_SELECTED'],
  SCAN_MACHINE: ['MACHINE_DETECTED', 'MACHINE_SELECTED', 'CONFIRM_MACHINE'],
  SCAN_WEIGHT: ['WEIGHT_LOCKED', 'WEIGHT_SET_MANUAL', 'WEIGHT_RESCAN', 'START_SET', 'CHANGE_MACHINE'],
  ACTIVE_SET: ['END_SET'],
  SET_SUMMARY: ['NEXT_SET', 'CHANGE_MACHINE'],
};

function enter(ctx: FitnessContext, mode: FitnessMode, patch: Partial<FitnessContext> = {}): FitnessContext {
  return { ...ctx, ...patch, mode, epoch: ctx.epoch + 1 };
}

export function canTransition(ctx: FitnessContext, event: FitnessEvent): boolean {
  return transition(ctx, event) !== ctx;
}

export function transition(ctx: FitnessContext, event: FitnessEvent): FitnessContext {
  if (event.type === 'RESET') return { ...initialFitnessContext, epoch: ctx.epoch + 1, lastSummary: ctx.lastSummary };
  if (!ACCEPTS[ctx.mode].includes(event.type)) return ctx;

  switch (event.type) {
    case 'START_MACHINE_SCAN':
      return enter(ctx, 'SCAN_MACHINE', { machine: null, machineBox: null, machineConfidence: 0 });

    case 'MACHINE_DETECTED':
      // Stale result from a previous scan session → drop. Same mode, so no epoch bump.
      if (event.epoch !== ctx.epoch) return ctx;
      return { ...ctx, machine: event.machine, machineBox: event.box, machineConfidence: event.confidence };

    case 'MACHINE_SELECTED':
      // Manual pick skips straight to weight scanning.
      return enter(ctx, 'SCAN_WEIGHT', { machine: event.machine, machineBox: null, machineConfidence: 1, load: null });

    case 'CONFIRM_MACHINE':
      if (!ctx.machine) return ctx;
      return enter(ctx, 'SCAN_WEIGHT', { load: null });

    case 'WEIGHT_LOCKED':
      if (event.epoch !== ctx.epoch) return ctx;
      // A manual value always wins over a later OCR lock.
      if (ctx.load?.source === 'manual') return ctx;
      return { ...ctx, load: { value: event.value, unit: event.unit, source: 'ocr' } };

    case 'WEIGHT_SET_MANUAL':
      if (!(event.value > 0)) return ctx;
      return { ...ctx, load: { value: event.value, unit: event.unit, source: 'manual' } };

    case 'WEIGHT_RESCAN':
      return ctx.load ? { ...ctx, load: null } : ctx;

    case 'START_SET':
      if (!ctx.machine) return ctx;
      return enter(ctx, 'ACTIVE_SET', { setStartedAt: event.t });

    case 'END_SET':
      return enter(ctx, 'SET_SUMMARY', { setStartedAt: null, lastSummary: event.summary });

    case 'NEXT_SET':
      // Same machine, keep the load as a starting point (user can re-scan or adjust).
      return enter(ctx, 'SCAN_WEIGHT');

    case 'CHANGE_MACHINE':
      return enter(ctx, 'SCAN_MACHINE', { machine: null, machineBox: null, machineConfidence: 0, load: null });

    default:
      return ctx;
  }
}

// ---------------------------------------------------------------- store + hook

type Listener = (ctx: FitnessContext) => void;

/** Tiny observable store around the reducer (same pattern as sessionLog / glassesController). */
export class FitnessStore {
  private ctx: FitnessContext = initialFitnessContext;
  private listeners = new Set<Listener>();

  get snapshot(): FitnessContext {
    return this.ctx;
  }

  /** Returns true when the event was accepted. */
  send = (event: FitnessEvent): boolean => {
    const next = transition(this.ctx, event);
    if (next === this.ctx) return false;
    this.ctx = next;
    this.listeners.forEach((l) => l(next));
    return true;
  };

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export const fitnessStore = new FitnessStore();

export function useFitnessState(store: FitnessStore = fitnessStore): FitnessContext {
  return useSyncExternalStore(store.subscribe, () => store.snapshot);
}
