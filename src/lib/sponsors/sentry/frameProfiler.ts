import * as Sentry from '@sentry/react';
import { sponsorBus } from '../SponsorEventBus';

/**
 * Watches the per-frame cost of the on-device ML step (MediaPipe WASM + rules).
 *
 * - Slow frame (> SLOW_FRAME_MS): retroactive `ml.frame` span + rate-limited breadcrumb.
 * - Sustained low FPS (< MIN_FPS for SUSTAIN_MS): emits `perf:frame-drop` on the bus (so the UI can,
 *   e.g., lower model resolution) and a rate-limited Sentry warning with the stats.
 *
 * All Sentry calls are inert when Sentry isn't initialised, so this is safe to call unconditionally.
 */
const SLOW_FRAME_MS = 50;
const MIN_FPS = 24;
const SUSTAIN_MS = 2000;
const REPORT_COOLDOWN_MS = 60_000;
const WINDOW = 90;

class FrameProfiler {
  private durations: number[] = [];
  private stamps: number[] = [];
  private lowSince: number | null = null;
  private lastReport = 0;
  private lastBreadcrumb = 0;

  /** Called by useCameraStream after every processed frame. */
  record(durationMs: number): void {
    const now = performance.now();
    this.durations.push(durationMs);
    this.stamps.push(now);
    if (this.durations.length > WINDOW) {
      this.durations.shift();
      this.stamps.shift();
    }

    if (durationMs > SLOW_FRAME_MS) this.onSlowFrame(durationMs, now);

    const fps = this.fps;
    if (this.stamps.length >= 30 && fps < MIN_FPS) {
      this.lowSince ??= now;
      if (now - this.lowSince > SUSTAIN_MS) this.onSustainedDrop(now);
    } else {
      this.lowSince = null;
    }
  }

  reportError(err: unknown): void {
    console.error('[frame] processing error', err);
    Sentry.withScope((scope) => {
      scope.setTag('loop', 'frame');
      scope.setLevel('error');
      Sentry.captureException(err);
    });
  }

  get fps(): number {
    const n = this.stamps.length;
    if (n < 2) return 0;
    const span = this.stamps[n - 1]! - this.stamps[0]!;
    return span > 0 ? ((n - 1) * 1000) / span : 0;
  }

  get avgMs(): number {
    return this.durations.length ? this.durations.reduce((a, b) => a + b, 0) / this.durations.length : 0;
  }

  private onSlowFrame(durationMs: number, now: number): void {
    const startMs = performance.timeOrigin + now - durationMs;
    Sentry.startInactiveSpan({
      name: 'ml.frame.slow',
      op: 'ml.frame',
      startTime: startMs / 1000,
      attributes: { 'frame.duration_ms': durationMs },
    }).end((performance.timeOrigin + now) / 1000);

    if (now - this.lastBreadcrumb > 5000) {
      this.lastBreadcrumb = now;
      Sentry.addBreadcrumb({ category: 'perf', level: 'warning', message: `Slow ML frame ${durationMs.toFixed(1)}ms` });
    }
  }

  private onSustainedDrop(now: number): void {
    const stats = { avgMs: +this.avgMs.toFixed(1), fps: +this.fps.toFixed(1), worstMs: +Math.max(...this.durations).toFixed(1) };
    sponsorBus.emit('perf:frame-drop', stats);
    this.lowSince = now; // re-arm

    if (now - this.lastReport > REPORT_COOLDOWN_MS) {
      this.lastReport = now;
      Sentry.withScope((scope) => {
        scope.setContext('frame_stats', stats);
        Sentry.captureMessage('Sustained WASM frame drops', 'warning');
      });
    }
  }
}

export const frameProfiler = new FrameProfiler();
