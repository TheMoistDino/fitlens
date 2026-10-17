import { createEma } from '../math/vector3';
import type { MachineProfile, RepEngineEvent, RepEngineSnapshot, RepPhase, RepRecord } from '../types';

/**
 * Repetition state machine:  READY → (first phase) → INFLECTION → (second phase) → REP_COMPLETED → READY
 *
 * The first phase is ECCENTRIC or CONCENTRIC depending on the machine (see MachineProfile.firstPhase).
 * The joint angle is normalised to `progress` (0 = start position, 1 = far end of the range) and all
 * thresholds use a ±DEADBAND_DEG band around the targets:
 *
 *   leave READY            progress > d            (moved ≥10° away from the start)
 *   reach INFLECTION       progress ≥ 1 − d        (within 10° of the far end)
 *   leave INFLECTION       progress < 1 − 2d       (backed off ≥10° more — hysteresis, no chatter)
 *   complete rep           progress ≤ d            (back within 10° of the start)
 *
 * A first phase that turns around before INFLECTION is a partial rep (not counted). Tiny wobbles that
 * never get past 2d are ignored entirely, which kills "twitch" false positives.
 */
export const DEADBAND_DEG = 10;
const MIN_REP_MS = 500;
/** Ignore direction changes smaller than this many deadbands (jitter). */
const TWITCH_BANDS = 2;

interface Timing {
  repStart: number;
  firstEnd: number;
  inflectionStart: number;
  secondStart: number;
  maxProgress: number;
  minProgressInSecond: number;
}

export class RepEngine {
  private phase: RepPhase = 'READY';
  private reps = 0;
  private partials = 0;
  private records: RepRecord[] = [];
  private ema = createEma(0.5);
  private timing: Timing = this.freshTiming(0);
  private lastAngle = NaN;
  private lastProgress = 0;
  private readonly d: number;

  constructor(private readonly profile: MachineProfile) {
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
  }

  /**
   * Feed one frame. `rawAngle` is the primary joint angle (deg), already combined across sides.
   * Returns the events produced by this frame (usually none).
   */
  update(rawAngle: number, t: number): RepEngineEvent[] {
    if (!Number.isFinite(rawAngle)) return [];
    const angle = this.ema.next(rawAngle);
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

    // REP_COMPLETED is a one-frame state so the HUD can flash; fall through to READY logic.
    if (this.phase === 'REP_COMPLETED') go('READY');

    switch (this.phase) {
      case 'READY':
        if (p > d) {
          this.timing = this.freshTiming(t);
          this.timing.maxProgress = p;
          go(this.firstPhase);
        }
        break;

      case 'ECCENTRIC':
      case 'CONCENTRIC': {
        const inFirst = this.phase === this.firstPhase;
        if (inFirst) {
          this.timing.maxProgress = Math.max(this.timing.maxProgress, p);
          if (p >= 1 - d) {
            this.timing.firstEnd = t;
            this.timing.inflectionStart = t;
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
          if (p <= d) {
            this.completeRep(t, false, events);
            go('REP_COMPLETED');
          } else if (p >= 1 - d) {
            // Went back to the far end (pause / twitch): resume the inflection hold.
            this.timing.inflectionStart = t;
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
            this.timing = this.freshTiming(t);
            this.timing.maxProgress = p;
            go(this.firstPhase);
          }
        }
        break;
      }

      case 'INFLECTION':
        if (p < 1 - 2 * d) {
          this.timing.secondStart = t;
          go(this.secondPhase);
        }
        break;
    }

    return events;
  }

  private completeRep(t: number, shortAtStart: boolean, events: RepEngineEvent[]): void {
    const tm = this.timing;
    if (t - tm.repStart < MIN_REP_MS) return; // too fast to be real
    const firstMs = tm.firstEnd - tm.repStart;
    const pauseMs = Math.max(0, tm.secondStart - tm.inflectionStart);
    const secondMs = t - tm.secondStart;
    const eccentricFirst = this.firstPhase === 'ECCENTRIC';
    this.reps += 1;
    const rep: RepRecord = {
      index: this.reps,
      startedAt: tm.repStart,
      endedAt: t,
      eccentricMs: eccentricFirst ? firstMs : secondMs,
      concentricMs: eccentricFirst ? secondMs : firstMs,
      pauseMs,
      rangeOfMotion: +tm.maxProgress.toFixed(2),
      flags: shortAtStart ? ['short_rom_start'] : [],
    };
    this.records.push(rep);
    events.push({ type: 'rep', rep });
  }

  private freshTiming(t: number): Timing {
    return { repStart: t, firstEnd: t, inflectionStart: t, secondStart: t, maxProgress: 0, minProgressInSecond: Infinity };
  }
}
