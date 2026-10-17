import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { ExerciseKind } from '@/core/events/events';
import { LM, angle, ema, pickSide, vis } from './geometry';

interface ExerciseSpec {
  /** Joint triplets [a, b(vertex), c] for left and right side. */
  left: [number, number, number];
  right: [number, number, number];
  /** Angle below which we are in the "contracted"/bottom phase. */
  downBelow: number;
  /** Angle above which we are back in the "extended"/top phase. */
  upAbove: number;
  /** Rough kcal per rep for a ~70 kg adult. Good enough for a demo HUD. */
  kcalPerRep: number;
}

export const EXERCISES: Record<ExerciseKind, ExerciseSpec> = {
  squat: { left: [LM.leftHip, LM.leftKnee, LM.leftAnkle], right: [LM.rightHip, LM.rightKnee, LM.rightAnkle], downBelow: 100, upAbove: 160, kcalPerRep: 0.32 },
  curl: { left: [LM.leftShoulder, LM.leftElbow, LM.leftWrist], right: [LM.rightShoulder, LM.rightElbow, LM.rightWrist], downBelow: 55, upAbove: 145, kcalPerRep: 0.15 },
  pushup: { left: [LM.leftShoulder, LM.leftElbow, LM.leftWrist], right: [LM.rightShoulder, LM.rightElbow, LM.rightWrist], downBelow: 90, upAbove: 155, kcalPerRep: 0.36 },
};

export interface RepUpdate {
  repCount: number;
  calories: number;
  angle: number;
  phase: 'up' | 'down';
  /** True on the exact frame a rep completes — the only time we emit to the bus. */
  repCompleted: boolean;
}

/**
 * Hysteresis-based state machine. A rep is counted on the down→up transition,
 * with a minimum rep duration to reject jitter.
 */
export class RepCounter {
  private phase: 'up' | 'down' = 'up';
  private reps = 0;
  private lastRepAt = 0;
  private smooth = ema(0.4);
  private readonly spec: ExerciseSpec;

  constructor(readonly exercise: ExerciseKind, private readonly minRepMs = 400) {
    this.spec = EXERCISES[exercise];
  }

  update(lms: NormalizedLandmark[], now: number): RepUpdate | null {
    const [a, b, c] = pickSide(lms, this.spec.left, this.spec.right) as [number, number, number];
    const A = lms[a], B = lms[b], C = lms[c];
    if (!A || !B || !C || Math.min(vis(A), vis(B), vis(C)) < 0.5) return null;

    const theta = this.smooth(angle(A, B, C));
    let repCompleted = false;

    if (this.phase === 'up' && theta < this.spec.downBelow) {
      this.phase = 'down';
    } else if (this.phase === 'down' && theta > this.spec.upAbove) {
      this.phase = 'up';
      if (now - this.lastRepAt >= this.minRepMs) {
        this.reps += 1;
        this.lastRepAt = now;
        repCompleted = true;
      }
    }

    return { repCount: this.reps, calories: this.calories, angle: theta, phase: this.phase, repCompleted };
  }

  get calories(): number {
    return +(this.reps * this.spec.kcalPerRep).toFixed(2);
  }

  get count(): number {
    return this.reps;
  }

  reset(): void {
    this.phase = 'up';
    this.reps = 0;
    this.lastRepAt = 0;
    this.smooth = ema(0.4);
  }
}
