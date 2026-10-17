import * as Sentry from '@sentry/react';
import { env } from '@/config/env';
import { sponsorBus } from '../SponsorEventBus';

/**
 * Sentry bootstrap: errors, performance tracing, session replay and JS self-profiling.
 * With no DSN this is a complete no-op — every Sentry call elsewhere becomes inert.
 *
 * Note: browser profiling needs the `Document-Policy: js-profiling` response header
 * (set in vite.config.ts for dev; add it on your host for prod).
 */
let enabled = false;

export function isSentryEnabled(): boolean {
  return enabled;
}

export function initSentry(): void {
  if (!env.sentry.dsn) {
    if (env.isDev) console.info('[Sentry] No DSN set — telemetry disabled.');
    return;
  }

  try {
    Sentry.init({
      dsn: env.sentry.dsn,
      environment: env.sentry.environment,
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.browserProfilingIntegration(),
        // Camera frames + faces are PII: mask text and block all media in replays.
        Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
      ],
      tracesSampleRate: env.isDev ? 1.0 : 0.3,
      profileSessionSampleRate: env.isDev ? 1.0 : 0.3,
      profileLifecycle: 'trace',
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
      tracePropagationTargets: [/^\/api\//],
    });
    enabled = true;
  } catch (err) {
    console.warn('[Sentry] init failed, continuing without telemetry', err);
    return;
  }

  // Every isolated listener failure on the bus gets reported with the plugin as a tag.
  sponsorBus.setErrorReporter((error, { event, owner }) => {
    console.error(`[bus] ${owner} failed on ${event}`, error);
    Sentry.withScope((scope) => {
      scope.setTag('plugin', owner);
      scope.setTag('bus.event', event);
      Sentry.captureException(error);
    });
  });
}

export { Sentry };
