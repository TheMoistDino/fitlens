import { createEma } from '../math/vector3';
import type { BoneGroup, BoneStatus, ExerciseProfile, FormCue, FormFlagCode, FormSnapshot, RepEngineEvent, RepPhase } from '../types';

/**
 * Dynamic form heuristics. Which checks run is decided per exercise (`profile.checks`), because a
 * fault on one lift is correct technique on another (squats *should* lean forward).
 *
 * Per frame:
 *  - torso swing (checks.torsoSwing): trunk deviation from the set's own baseline > 15° / > 25°
 *  - torso lean (checks.maxTorsoLeanDeg): absolute trunk angle from vertical over the limit
 *  - hip sag (checks.minHipLineDeg): shoulder–hip–ankle line bent below the limit
 *  - bilateral asymmetry (front view only): |left − right| primary joint angle > 12°, sustained
 * Per rep (from RepEngine events):
 *  - eccentric faster than half the target tempo → "Control the eccentric"
 *  - short range at either end → the profile's cue
 *
 * Every per-frame fault must persist for a few frames before it shows, so one bad landmark frame
 * can't flash a cue.
 */
export const TORSO_WARN_DEG = 15;
export const TORSO_BAD_DEG = 25;
export const ASYMMETRY_DEG = 12;
const SUSTAIN_FRAMES = 6;
const BASELINE_FRAMES = 15;
/** How long an event-driven cue (fast eccentric, short ROM) stays on screen. */
const EVENT_CUE_MS = 2500;

const SEVERITY_RANK = { info: 0, warn: 1, critical: 2 } as const;

export interface FormFrameInput {
  t: number;
  /** Trunk angle from vertical (deg). */
  trunkAngle: number;
  leftAngle: number | null;
  rightAngle: number | null;
  /** Shoulder–hip–ankle angle on the tracked side (deg), when visible. */
  hipLineAngle?: number | null;
  phase: RepPhase;
}

/** Counts consecutive frames a condition holds. */
class Streak {
  private n = 0;
  update(on: boolean): boolean {
    this.n = on ? this.n + 1 : 0;
    return this.n >= SUSTAIN_FRAMES;
  }
}

export class FormAnalyzer {
  private baselineSamples: number[] = [];
  private baseline: number | null = null;
  private torsoEma = createEma(0.3);
  private leanEma = createEma(0.3);
  private hipEma = createEma(0.3);
  private swing = new Streak();
  private lean = new Streak();
  private sag = new Streak();
  private asym = new Streak();
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

  constructor(private readonly profile: ExerciseProfile) {}

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

  update({ t, trunkAngle, leftAngle, rightAngle, hipLineAngle, phase }: FormFrameInput): FormSnapshot {
    const { checks, cameraView } = this.profile;
    const moving = phase !== 'READY';
    const frameCues: FormCue[] = [];
    let torso: BoneStatus = 'good';
    let legs: BoneStatus = 'good';

    // --- torso swing vs. per-set baseline (independent of phone tilt)
    if (this.baseline === null && Number.isFinite(trunkAngle)) {
      this.baselineSamples.push(trunkAngle);
      if (this.baselineSamples.length >= BASELINE_FRAMES) {
        this.baseline = this.baselineSamples.reduce((a, b) => a + b, 0) / this.baselineSamples.length;
      }
    }
    const torsoDeviation =
      this.baseline !== null && Number.isFinite(trunkAngle) ? this.torsoEma.next(Math.abs(trunkAngle - this.baseline)) : 0;
    if (checks.torsoSwing && this.swing.update(torsoDeviation > TORSO_WARN_DEG)) {
      const bad = torsoDeviation > TORSO_BAD_DEG;
      frameCues.push({ code: 'torso_swing', message: bad ? 'Stop swinging — stay tall' : 'Control the momentum — torso still', severity: bad ? 'critical' : 'warn' });
      torso = bad ? 'bad' : 'warn';
    }

    // --- absolute forward lean (squat)
    if (checks.maxTorsoLeanDeg !== undefined && Number.isFinite(trunkAngle)) {
      const lean = this.leanEma.next(trunkAngle);
      if (this.lean.update(moving && lean > checks.maxTorsoLeanDeg)) {
        frameCues.push({ code: 'torso_lean', message: 'Chest up — you’re folding forward', severity: 'warn' });
        torso = 'warn';
      }
    }

    // --- hip line (push-up sag / pike)
    if (checks.minHipLineDeg !== undefined && hipLineAngle != null && Number.isFinite(hipLineAngle)) {
      const line = this.hipEma.next(hipLineAngle);
      if (this.sag.update(line < checks.minHipLineDeg)) {
        frameCues.push({ code: 'hip_sag', message: 'Keep hips in line with shoulders', severity: 'warn' });
        torso = 'warn';
        legs = 'warn';
      }
    }

    // --- bilateral asymmetry: only meaningful when both sides are actually visible (front view),
    // and only while moving (at rest people often hold handles unevenly).
    const asymmetry = cameraView === 'front' && leftAngle !== null && rightAngle !== null ? Math.abs(leftAngle - rightAngle) : null;
    const asymActive = this.asym.update(moving && asymmetry !== null && asymmetry > ASYMMETRY_DEG);
    if (asymActive) frameCues.push({ code: 'asymmetry', message: 'Uneven sides — keep both even', severity: 'warn' });

    this.trackRisingEdges(new Set(frameCues.map((c) => c.code)));

    // --- bones
    const limb: BoneStatus = asymActive ? 'warn' : 'good';
    const bones: Record<BoneGroup, BoneStatus> =
      this.profile.joint === 'knee'
        ? { torso, leftArm: 'good', rightArm: 'good', leftLeg: limb === 'good' ? legs : limb, rightLeg: limb === 'good' ? legs : limb }
        : { torso, leftArm: limb, rightArm: limb, leftLeg: legs, rightLeg: legs };

    // --- most severe cue wins (event cues stay visible for a moment)
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
