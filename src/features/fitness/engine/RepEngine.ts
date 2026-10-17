import { createEma } from '../math/vector3';
import type { ExerciseProfile, RepEngineEvent, RepEngineSnapshot, RepPhase, RepRecord } from '../types';

/**
 * Repetition state machine:  READY → (first phase) → INFLECTION → (second phase) → REP_COMPLETED → READY
 *
 * The first phase is ECCENTRIC or CONCENTRIC depending on the exercise (see ExerciseProfile.firstPhase).
 * The joint angle is normalised to `progress` (0 = start position, 1 = far end of the range) and all
 * thresholds use a ±DEADBAND_DEG band around the targets:
 *
 *   leave READY            progress > d            (moved ≥10° away from the start)
 *   reach INFLECTION       progress ≥ 1 − d        (within 10° of the far end)
 *   leave INFLECTION       progress < 1 − 2d       (backed off ≥10° more — hysteresis, no chatter)
 *   complete rep           progress ≤ d            (back within 10° of the start)
 *
 * Robustness against pose-tracking glitches (a wrist that jumps for a frame or two):
 *  - raw angles pass through a 5-frame median before the EMA, so 1–2 frame spikes vanish;
 *  - reaching the far end and completing a rep must hold for CONFIRM_FRAMES consecutive frames;
 *  - phase durations are measured *after* the rep from its recorded trace (time of first arrival at,
 *    and last departure from, the actual turnaround), not from when a threshold was first crossed.
 *    One early threshold crossing can therefore no longer make a slow eccentric look fast.
 *
 * A first phase that turns around before INFLECTION is a partial rep (not counted). Tiny wobbles that
 * never get past 2d are ignored entirely, which kills "twitch" false positives.
 */
export const DEADBAND_DEG = 10;
const MIN_REP_MS = 500;
/** Ignore direction changes smaller than this many deadbands (jitter). */
const TWITCH_BANDS = 2;
/** Consecutive frames a far-end arrival / rep completion must hold. */
const CONFIRM_FRAMES = 3;
const MEDIAN_WINDOW = 5;
/** Safety cap on the per-rep trace (≈ 20 s at 30 fps). */
const MAX_TRACE = 600;

interface Timing {
  /** Last frame the user was still at the start position — the true start of the movement. */
  repStart: number;
  maxProgress: number;
  minProgressInSecond: number;
}

export class RepEngine {
  private phase: RepPhase = 'READY';
  private reps = 0;
  private partials = 0;
  private records: RepRecord[] = [];
  private ema = createEma(0.5);
  private window: number[] = [];
  private timing: Timing = this.freshTiming(0);
  /** (t, progress) samples of the rep in progress — used to measure phase durations afterwards. */
  private trace: Array<[number, number]> = [];
  private lastAngle = NaN;
  private lastProgress = 0;
  /** Last time progress was inside the start band. */
  private lastAtStart = 0;
  private endStreak = 0;
  private startStreak = 0;
  private readonly d: number;

  constructor(private readonly profile: ExerciseProfile) {
    this.d = DEADBAND_DEG / Math.abs(profile.endAngle - profile.startAngle);
  }

  get firstPhase(): 'ECCENTRIC' | 'CONCENTRIC' {
    return this.profile.firstPhase;
  }

  get secondPhase(): 'ECCENTRIC' | 'CONCENTRIC' {
    return this.profile.firstPhase === 'ECCENTRIC' ? 'CONCENTRIC' : 'ECCENTRIC';
  }

  get snapshot(): RepEngineSnapshot {
    return { phase: this.phase, repCount: this.reps, partialReps: this.partials, angle: this.lastAngle, progress: this.lastProgress };
  }

  get repRecords(): readonly RepRecord[] {
    return this.records;
  }

  /** Forget smoothing history (call after tracking was lost so a stale angle can't fake a rep). */
  resetSmoothing(): void {
    this.ema.reset();
    this.window = [];
  }

  /**
   * Feed one frame. `rawAngle` is the primary joint angle (deg), already combined across sides.
   * Returns the events produced by this frame (usually none).
   */
  update(rawAngle: number, t: number): RepEngineEvent[] {
    if (!Number.isFinite(rawAngle)) return [];
    this.window.push(rawAngle);
    if (this.window.length > MEDIAN_WINDOW) this.window.shift();
    const angle = this.ema.next(median(this.window));
    const { startAngle, endAngle } = this.profile;
    const p = (angle - startAngle) / (endAngle - startAngle);
    this.lastAngle = angle;
    this.lastProgress = p;

    const d = this.d;
    const events: RepEngineEvent[] = [];
    const go = (phase: RepPhase) => {
      this.phase = phase;
      events.push({ type: 'phase', phase, t });
    };

    // Debounced threshold conditions.
    this.endStreak = p >= 1 - d ? this.endStreak + 1 : 0;
    this.startStreak = p <= d ? this.startStreak + 1 : 0;
    const atEnd = this.endStreak >= CONFIRM_FRAMES;
    const atStart = this.startStreak >= CONFIRM_FRAMES;

    if (this.phase !== 'READY' && this.phase !== 'REP_COMPLETED' && this.trace.length < MAX_TRACE) this.trace.push([t, p]);

    // REP_COMPLETED is a one-frame state so the HUD can flash; fall through to READY logic.
    if (this.phase === 'REP_COMPLETED') go('READY');

    switch (this.phase) {
      case 'READY':
        if (p <= d) {
          this.lastAtStart = t;
        } else {
          this.beginRep(Math.max(this.lastAtStart, t - 1000), t, p);
          go(this.firstPhase);
        }
        break;

      case 'ECCENTRIC':
      case 'CONCENTRIC': {
        const inFirst = this.phase === this.firstPhase;
        if (inFirst) {
          this.timing.maxProgress = Math.max(this.timing.maxProgress, p);
          if (atEnd) {
            go('INFLECTION');
          } else if (p < d * 0.5) {
            // Turned around early. Only a meaningful attempt counts as a partial; wobble is ignored.
            if (this.timing.maxProgress > TWITCH_BANDS * d) {
              this.partials += 1;
              events.push({ type: 'partial', at: 'end', t });
            }
            go('READY');
          }
        } else {
          this.timing.minProgressInSecond = Math.min(this.timing.minProgressInSecond, p);
          if (atStart) {
            this.completeRep(t, false, events);
            go('REP_COMPLETED');
          } else if (atEnd) {
            // Went back to the far end (pause / twitch): resume the inflection hold.
            go('INFLECTION');
          } else if (p > this.timing.minProgressInSecond + TWITCH_BANDS * d) {
            // Turned around before getting back to the start.
            if (this.timing.minProgressInSecond <= TWITCH_BANDS * d) {
              // Close enough (within ~20°): count it, but flag the short range at the start.
              this.completeRep(t, true, events);
            } else {
              this.partials += 1;
              events.push({ type: 'partial', at: 'start', t });
            }
            this.beginRep(t, t, p);
            go(this.firstPhase);
          }
        }
        break;
      }

      case 'INFLECTION':
        if (p < 1 - 2 * d) go(this.secondPhase);
        break;
    }

    return events;
  }

  private beginRep(start: number, t: number, p: number): void {
    this.timing = this.freshTiming(start);
    this.timing.maxProgress = p;
    this.trace = [[t, p]];
  }

  /**
   * Phase durations from the recorded trace, anchored on the real turnaround:
   *   first phase  = rep start → first arrival within d of the peak
   *   pause        = first arrival → last departure from within d of the peak
   *   second phase = last departure → completion
   */
  private completeRep(t: number, shortAtStart: boolean, events: RepEngineEvent[]): void {
    const tm = this.timing;
    if (t - tm.repStart < MIN_REP_MS) return; // too fast to be real
    const trace = this.trace;
    const peak = trace.reduce((m, [, p]) => Math.max(m, p), -Infinity);
    const near = peak - this.d;
    const firstArrival = trace.find(([, p]) => p >= near)?.[0] ?? tm.repStart;
    let lastDeparture = firstArrival;
    for (const [ts, p] of trace) if (p >= near) lastDeparture = ts;

    const firstMs = Math.max(0, firstArrival - tm.repStart);
    const pauseMs = Math.max(0, lastDeparture - firstArrival);
    const secondMs = Math.max(0, t - lastDeparture);
    const eccentricFirst = this.firstPhase === 'ECCENTRIC';
    this.reps += 1;
    const rep: RepRecord = {
      index: this.reps,
      startedAt: tm.repStart,
      endedAt: t,
      eccentricMs: eccentricFirst ? firstMs : secondMs,
      concentricMs: eccentricFirst ? secondMs : firstMs,
      pauseMs,
      rangeOfMotion: +peak.toFixed(2),
      flags: shortAtStart ? ['short_rom_start'] : [],
    };
    this.records.push(rep);
    events.push({ type: 'rep', rep });
  }

  private freshTiming(t: number): Timing {
    return { repStart: t, maxProgress: 0, minProgressInSecond: Infinity };
  }
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
