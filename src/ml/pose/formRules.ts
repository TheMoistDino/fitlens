import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { ExerciseKind, FormAlert } from '@/core/events/events';
import { LM, angle, vis } from './geometry';

type Rule = (l: NormalizedLandmark[]) => FormAlert | null;

/** Returns the requested landmarks only if all are confidently visible, else null. */
function pick(l: NormalizedLandmark[], ...ids: number[]): NormalizedLandmark[] | null {
  const pts = ids.map((i) => l[i]);
  return pts.every((p) => p && vis(p) > 0.5) ? (pts as NormalizedLandmark[]) : null;
}

/** Torso angle from vertical in degrees (0 = upright). */
function torsoLean(l: NormalizedLandmark[]): number | null {
  const p = pick(l, LM.leftShoulder, LM.leftHip);
  if (!p) return null;
  const [s, h] = p as [NormalizedLandmark, NormalizedLandmark];
  return Math.abs((Math.atan2(s.x - h.x, h.y - s.y) * 180) / Math.PI);
}

const RULES: Record<ExerciseKind, Rule[]> = {
  squat: [
    (l) => {
      const lean = torsoLean(l);
      return lean !== null && lean > 50
        ? { code: 'chest_up', message: 'Chest up — back is leaning', severity: 'warn' }
        : null;
    },
    (l) => {
      const p = pick(l, LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle);
      if (!p) return null;
      const [lk, rk, la, ra] = p as [NormalizedLandmark, NormalizedLandmark, NormalizedLandmark, NormalizedLandmark];
      const kneeW = Math.abs(lk.x - rk.x), ankleW = Math.abs(la.x - ra.x);
      return ankleW > 0.05 && kneeW < ankleW * 0.75
        ? { code: 'knees_cave', message: 'Push knees out', severity: 'critical' }
        : null;
    },
  ],
  curl: [
    (l) => {
      const p = pick(l, LM.leftShoulder, LM.leftElbow, LM.leftHip);
      if (!p) return null;
      const [s, e, h] = p as [NormalizedLandmark, NormalizedLandmark, NormalizedLandmark];
      // Elbow should stay pinned near the torso: angle hip-shoulder-elbow stays small.
      return angle(h, s, e) > 35 ? { code: 'elbow_swing', message: 'Pin your elbows', severity: 'warn' } : null;
    },
  ],
  pushup: [
    (l) => {
      const p = pick(l, LM.leftShoulder, LM.leftHip, LM.leftAnkle);
      if (!p) return null;
      const [s, h, a] = p as [NormalizedLandmark, NormalizedLandmark, NormalizedLandmark];
      return angle(s, h, a) < 155 ? { code: 'hip_sag', message: 'Keep hips in line', severity: 'warn' } : null;
    },
  ],
};

/**
 * Evaluates rules per frame but only reports *changes* after the condition persists
 * for `holdFrames` — prevents flicker on the HUD and spam on the event bus.
 */
export class FormEvaluator {
  private current: FormAlert | null = null;
  private candidate: string | null = null;
  private streak = 0;

  constructor(private readonly exercise: ExerciseKind, private readonly holdFrames = 8) {}

  /** Returns `undefined` when nothing changed, otherwise the new alert (or null = cleared). */
  update(l: NormalizedLandmark[]): FormAlert | null | undefined {
    let found: FormAlert | null = null;
    for (const rule of RULES[this.exercise]) {
      found = rule(l);
      if (found) break;
    }
    const code = found?.code ?? null;

    if (code === (this.current?.code ?? null)) {
      this.candidate = null;
      this.streak = 0;
      return undefined;
    }
    if (code !== this.candidate) {
      this.candidate = code;
      this.streak = 1;
      return undefined;
    }
    if (++this.streak < this.holdFrames) return undefined;

    this.current = found;
    this.candidate = null;
    this.streak = 0;
    return found;
  }

  get alert(): FormAlert | null {
    return this.current;
  }
}
