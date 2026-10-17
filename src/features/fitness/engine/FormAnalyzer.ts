import { createEma } from '../math/vector3';
import type { BoneGroup, BoneStatus, ExerciseProfile, FormCue, FormFlagCode, FormSnapshot, RepEngineEvent, RepPhase } from '../types';

/**
 * Dynamic form heuristics. Which checks run is decided per exercise (`profile.checks`), because a
 * fault on one lift is correct technique on another (squats *should* lean forward).
 *
 * Per frame:
 *  - torso swing (checks.torsoSwing): trunk movement vs. rest posture during a rep (15°/25° side, 20°/30° front)
 *  - torso lean (checks.maxTorsoLeanDeg): absolute trunk angle from vertical over the limit
 *  - hip sag (checks.minHipLineDeg): shoulder–hip–ankle line drops 15° below the user's own top position
 *  - bilateral asymmetry (front view only): |left − right| primary joint angle > 12°, sustained
 * Per rep (from RepEngine events):
 *  - eccentric faster than half the target tempo → "Control the eccentric"
 *  - short range at either end → the profile's cue
 *
 * Every per-frame fault must persist for a few frames before it shows, so one bad landmark frame
 * can't flash a cue.
 */
/** Torso swing limits; front view gets more slack because forward/back motion there is all depth (noisy). */
export const TORSO_LIMITS = { side: { warn: 15, bad: 25 }, front: { warn: 20, bad: 30 } } as const;
export const ASYMMETRY_DEG = 12;
/** Push-up: flag when the body line drops this far below the user's own line at the top. */
export const HIP_DROP_DEG = 15;
/** …and always flag a line this bent, whatever the baseline. */
export const HIP_LINE_FLOOR_DEG = 135;
const SUSTAIN_FRAMES = 6;
const SWING_SUSTAIN_FRAMES = 8;
/** Slow EMA for rest-position baselines: re-learned every time the user is at the start between reps. */
const BASELINE_ALPHA = 0.1;
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
  constructor(private readonly frames = SUSTAIN_FRAMES) {}
  update(on: boolean): boolean {
    this.n = on ? this.n + 1 : 0;
    return this.n >= this.frames;
  }
}

export class FormAnalyzer {
  /**
   * Baselines come from frames at the rest position (phase READY), not the first frames after Start,
   * when the user is often still stepping into place. Clothing that shifts landmarks (baggy pants
   * moving the hip point) is baked into the baseline, so only *changes* during a rep are flagged.
   */
  private restTrunk = createEma(BASELINE_ALPHA);
  private restHipLine = createEma(BASELINE_ALPHA);
  private torsoEma = createEma(0.2);
  private leanEma = createEma(0.3);
  private hipEma = createEma(0.3);
  private swing = new Streak(SWING_SUSTAIN_FRAMES);
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

    // --- torso swing vs. the user's own rest posture (independent of phone tilt)
    if (!moving && Number.isFinite(trunkAngle)) this.restTrunk.next(trunkAngle);
    const restTrunk = this.restTrunk.value;
    let torsoDeviation = 0;
    if (moving && restTrunk !== null && Number.isFinite(trunkAngle)) torsoDeviation = this.torsoEma.next(Math.abs(trunkAngle - restTrunk));
    else this.torsoEma.reset();
    const limits = TORSO_LIMITS[cameraView];
    if (checks.torsoSwing && this.swing.update(torsoDeviation > limits.warn)) {
      const bad = torsoDeviation > limits.bad;
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

    // --- hip line (push-up sag): relative to the user's own line at the top, plus a hard floor
    if (checks.minHipLineDeg !== undefined && hipLineAngle != null && Number.isFinite(hipLineAngle)) {
      if (!moving) this.restHipLine.next(hipLineAngle);
      const line = this.hipEma.next(hipLineAngle);
      const rest = this.restHipLine.value;
      const dropped = rest !== null && line < rest - HIP_DROP_DEG && line < checks.minHipLineDeg;
      if (this.sag.update(dropped || line < HIP_LINE_FLOOR_DEG)) {
        frameCues.push({ code: 'hip_sag', message: 'Hips sagging — brace your core', severity: 'warn' });
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
      // Only flag clearly dropped reps. Even a controlled 1–1.5 s lowering is fine; < ~0.6 s is a drop.
      const minEccentricMs = Math.max(600, this.profile.tempo.eccentric * 300);
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
