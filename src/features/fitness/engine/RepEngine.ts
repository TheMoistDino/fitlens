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
 *  - phase durations are measured *after* the rep from its recorded trace, between the actual
 *    turnarounds (top → bottom → top), not from when a threshold was first crossed. The trace starts
 *    ~1.5 s before the rep, so the real starting point is included even when reps run back-to-back
 *    without a pause. One early threshold crossing can no longer make a slow eccentric look fast.
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
/** READY frames kept so a rep's trace includes the moment movement really began. */
const PRE_TRACE = 45;
/**
 * A turnaround counts as "reached" within this fraction of the rep's actual range of motion. Relative,
 * so standing jitter can't anchor the start to an earlier wobble, and ~85% of the motion is timed.
 */
const TURN_FRACTION = 0.08;

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
  /** Rolling buffer of recent READY samples (see PRE_TRACE). */
  private preTrace: Array<[number, number]> = [];
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

    if (this.phase === 'READY' || this.phase === 'REP_COMPLETED') {
      this.preTrace.push([t, p]);
      if (this.preTrace.length > PRE_TRACE) this.preTrace.shift();
    } else if (this.trace.length < MAX_TRACE) {
      this.trace.push([t, p]);
    }

    // REP_COMPLETED is a one-frame state so the HUD can flash; fall through to READY logic.
    if (this.phase === 'REP_COMPLETED') go('READY');

    switch (this.phase) {
      case 'READY':
        if (p <= d) {
          this.lastAtStart = t;
        } else {
          this.beginRep(Math.max(this.lastAtStart, t - 1000), [...this.preTrace, [t, p]]);
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
            // The next rep really began at the turnaround (lowest point of this return), not now.
            const turnIdx = indexOfMin(this.trace);
            const carried = this.trace.slice(turnIdx);
            const turnT = carried[0]?.[0] ?? t;
            if (this.timing.minProgressInSecond <= TWITCH_BANDS * d) {
              // Close enough (within ~20°): count it, but flag the short range at the start.
              this.completeRep(turnT, true, events, turnIdx);
            } else {
              this.partials += 1;
              events.push({ type: 'partial', at: 'start', t });
            }
            this.beginRep(turnT, carried);
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

  private beginRep(start: number, trace: Array<[number, number]>): void {
    this.timing = this.freshTiming(start);
    this.timing.maxProgress = trace.reduce((m, [, p]) => Math.max(m, p), 0);
    this.trace = trace;
  }

  /**
   * Phase durations from the recorded trace, between the real turnarounds:
   *   start  = last moment near the starting extreme before the peak (top of a squat, arm hanging…)
   *   peak   = first arrival near the far extreme;  leave = last moment there
   * ("near" = within TURN_FRACTION of the rep's own range)
   *   first phase = start → peak,  pause = peak → leave,  second phase = leave → completion
   * `endIdx` limits the trace (used when a rep ends at a turnaround instead of the start band).
   */
  private completeRep(t: number, shortAtStart: boolean, events: RepEngineEvent[], endIdx?: number): void {
    const tm = this.timing;
    const trace = endIdx === undefined ? this.trace : this.trace.slice(0, endIdx + 1);
    if (trace.length === 0) return;
    const peak = trace.reduce((m, [, p]) => Math.max(m, p), -Infinity);
    const low = trace.reduce((m, [, p]) => Math.min(m, p), Infinity);
    const eps = Math.max(1e-6, (peak - low) * TURN_FRACTION);
    const peakIdx = trace.findIndex(([, p]) => p >= peak - eps);
    let leaveIdx = peakIdx;
    for (let i = peakIdx; i < trace.length; i++) if (trace[i]![1] >= peak - eps) leaveIdx = i;
    let lowBefore = Infinity;
    for (let i = 0; i <= peakIdx; i++) lowBefore = Math.min(lowBefore, trace[i]![1]);
    let startIdx = 0;
    for (let i = 0; i <= peakIdx; i++) if (trace[i]![1] <= lowBefore + eps) startIdx = i;

    const startT = trace[startIdx]![0];
    if (t - startT < MIN_REP_MS || t - tm.repStart < MIN_REP_MS) return; // too fast to be real
    const firstMs = trace[peakIdx]![0] - startT;
    const pauseMs = trace[leaveIdx]![0] - trace[peakIdx]![0];
    const secondMs = Math.max(0, t - trace[leaveIdx]![0]);
    const eccentricFirst = this.firstPhase === 'ECCENTRIC';
    this.reps += 1;
    const rep: RepRecord = {
      index: this.reps,
      startedAt: startT,
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

function indexOfMin(trace: Array<[number, number]>): number {
  let idx = 0;
  for (let i = 1; i < trace.length; i++) if (trace[i]![1] < trace[idx]![1]) idx = i;
  return idx;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
