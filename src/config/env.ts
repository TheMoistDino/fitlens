/**
 * Single source of truth for client-side configuration and feature flags.
 * Everything is parsed defensively: a missing or malformed var falls back to a safe default
 * so the app always boots in "pure browser / mock" mode.
 */

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const env = {
  isDev: import.meta.env?.DEV ?? false,
  sentry: {
    dsn: import.meta.env?.VITE_SENTRY_DSN || undefined,
    environment: import.meta.env?.VITE_SENTRY_ENVIRONMENT || import.meta.env?.MODE,
  },
  features: {
    /** Even Realities HUD. Off by default; the Null adapter is used when off or unavailable. */
    evenRealities: bool(import.meta.env?.VITE_ENABLE_EVEN_REALITIES),
  },
  stepfun: {
    keyframeIntervalMs: num(import.meta.env?.VITE_STEPFUN_KEYFRAME_INTERVAL_S, 8) * 1000,
  },
} as const;

export type Env = typeof env;
