import { useSyncExternalStore } from 'react';
import type { MacroSummary, WorkoutSummary } from '@/core/events/events';

export type LogEntry =
  | ({ kind: 'workout' } & WorkoutSummary)
  | { kind: 'meal'; id: string; endedAt: number; macros: MacroSummary };

const KEY = 'fitlens.log.v1';
const MAX = 200;
const listeners = new Set<() => void>();

function read(): LogEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as LogEntry[]) : [];
  } catch {
    return [];
  }
}

let cache: LogEntry[] = read();

export const sessionLog = {
  add(entry: LogEntry) {
    cache = [entry, ...cache].slice(0, MAX);
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch {
      /* quota / private mode: keep in memory only */
    }
    listeners.forEach((l) => l());
  },
  clear() {
    cache = [];
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* noop */
    }
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => cache,
};

export function useSessionLog(): LogEntry[] {
  return useSyncExternalStore(sessionLog.subscribe, sessionLog.get);
}
