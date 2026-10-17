import { createEma } from '../math/vector3';
import type { BoneGroup, BoneStatus, FormCue, FormFlagCode, FormSnapshot, MachineProfile, RepEngineEvent, RepPhase } from '../types';

/**
 * Dynamic form heuristics, evaluated per frame:
 *  - torso swing: trunk deviation from the set's own baseline > 15° (warn) / > 25° (bad)
 *  - bilateral asymmetry: |left − right| primary joint angle > 12°, sustained (warn)
 * and per rep (from RepEngine events):
 *  - eccentric faster than half the target tempo → "Control the eccentric"
 *  - short range at either end → the profile's cue
 *
 * Using a per-set baseline for the trunk makes the check independent of how the phone is tilted.
 */
export const TORSO_WARN_DEG = 15;
export const TORSO_BAD_DEG = 25;
export const ASYMMETRY_DEG = 12;
const ASYMMETRY_FRAMES = 6;
const BASELINE_FRAMES = 15;
/** How long an event-driven cue (fast eccentric, short ROM) stays on screen. */
const EVENT_CUE_MS = 2500;

const SEVERITY_RANK = { info: 0, warn: 1, critical: 2 } as const;

export interface FormFrameInput {
  t: number;
  trunkAngle: number;
  leftAngle: number | null;
  rightAngle: number | null;
  phase: RepPhase;
}

export class FormAnalyzer {
  private baselineSamples: number[] = [];
  private baseline: number | null = null;
  private torsoEma = createEma(0.3);
  private asymStreak = 0;
  private eventCue: { cue: FormCue; until: number } | null = null;
  private repFlags = new Set<FormFlagCode>();
  private counts: Partial<Record<FormFlagCode, number>> = {};
  private activeCodes = new Set<FormFlagCode>();
  private snap: FormSnapshot = {
    torsoDeviation: 0,
    asymmetry: null,
    bones: { torso: 'good', leftArm: 'good', rightArm: 'good', leftLeg: 'good', rightLeg: 'good' },
    active: null,
  };

  constructor(private readonly profile: MachineProfile) {}

  get snapshot(): FormSnapshot {
    return this.snap;
  }

  get flagCounts(): Partial<Record<FormFlagCode, number>> {
    return { ...this.counts };
  }

  /** Flags raised since the last call — attached to the rep that just completed. */
  takeRepFlags(): FormFlagCode[] {
    const flags = [...this.repFlags];
    this.repFlags.clear();
    return flags;
  }

  update({ t, trunkAngle, leftAngle, rightAngle, phase }: FormFrameInput): FormSnapshot {
    // --- torso baseline (first frames of the set, while the user is settled)
    if (this.baseline === null && Number.isFinite(trunkAngle)) {
      this.baselineSamples.push(trunkAngle);
      if (this.baselineSamples.length >= BASELINE_FRAMES) {
        this.baseline = this.baselineSamples.reduce((a, b) => a + b, 0) / this.baselineSamples.length;
      }
    }
    const torsoDeviation =
      this.baseline !== null && Number.isFinite(trunkAngle) ? this.torsoEma.next(Math.abs(trunkAngle - this.baseline)) : 0;

    // --- bilateral asymmetry (only while moving: at rest people often hold the handles unevenly)
    const asymmetry = leftAngle !== null && rightAngle !== null ? Math.abs(leftAngle - rightAngle) : null;
    const moving = phase !== 'READY';
    this.asymStreak = moving && asymmetry !== null && asymmetry > ASYMMETRY_DEG ? this.asymStreak + 1 : 0;
    const asymActive = this.asymStreak >= ASYMMETRY_FRAMES;

    // --- per-frame cues
    const frameCues: FormCue[] = [];
    if (torsoDeviation > TORSO_WARN_DEG) {
      frameCues.push({
        code: 'torso_swing',
        message: torsoDeviation > TORSO_BAD_DEG ? 'Stop swinging — stay tall' : 'Control the momentum — torso still',
        severity: torsoDeviation > TORSO_BAD_DEG ? 'critical' : 'warn',
      });
    }
    if (asymActive) frameCues.push({ code: 'asymmetry', message: 'Uneven sides — keep both even', severity: 'warn' });

    this.trackRisingEdges(new Set(frameCues.map((c) => c.code)));

    // --- bones
    const limb: BoneStatus = asymActive ? 'warn' : 'good';
    const torso: BoneStatus = torsoDeviation > TORSO_BAD_DEG ? 'bad' : torsoDeviation > TORSO_WARN_DEG ? 'warn' : 'good';
    const bones: Record<BoneGroup, BoneStatus> =
      this.profile.joint === 'knee'
        ? { torso, leftArm: 'good', rightArm: 'good', leftLeg: limb, rightLeg: limb }
        : { torso, leftArm: limb, rightArm: limb, leftLeg: 'good', rightLeg: 'good' };

    // --- pick the most severe cue (event cues stay visible for a moment)
    if (this.eventCue && t > this.eventCue.until) this.eventCue = null;
    const candidates = this.eventCue ? [...frameCues, this.eventCue.cue] : frameCues;
    const active = candidates.reduce<FormCue | null>((best, c) => (!best || SEVERITY_RANK[c.severity] > SEVERITY_RANK[best.severity] ? c : best), null);

    this.snap = { torsoDeviation, asymmetry, bones, active };
    return this.snap;
  }

  /** Feed RepEngine events so per-rep checks (tempo, range) can raise cues. */
  onRepEvent(e: RepEngineEvent): FormCue | null {
    let cue: FormCue | null = null;
    if (e.type === 'partial') {
      cue =
        e.at === 'end'
          ? { code: 'short_rom_end', message: this.profile.shortAtEndCue, severity: 'warn' }
          : { code: 'short_rom_start', message: this.profile.shortAtStartCue, severity: 'warn' };
    } else if (e.type === 'rep') {
      const minEccentricMs = Math.max(800, this.profile.tempo.eccentric * 500);
      if (e.rep.eccentricMs < minEccentricMs) cue = { code: 'fast_eccentric', message: 'Control the eccentric — slow it down', severity: 'warn' };
      else if (e.rep.flags.includes('short_rom_start')) cue = { code: 'short_rom_start', message: this.profile.shortAtStartCue, severity: 'info' };
    }
    if (cue) {
      const t = e.type === 'rep' ? e.rep.endedAt : e.t;
      this.eventCue = { cue, until: t + EVENT_CUE_MS };
      this.bump(cue.code);
    }
    return cue;
  }

  private trackRisingEdges(current: Set<FormFlagCode>): void {
    for (const code of current) if (!this.activeCodes.has(code)) this.bump(code);
    this.activeCodes = current;
  }

  private bump(code: FormFlagCode): void {
    this.counts[code] = (this.counts[code] ?? 0) + 1;
    this.repFlags.add(code);
  }
}
