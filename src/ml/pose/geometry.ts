import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

/** BlazePose landmark indices we care about. */
export const LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

/** Bone pairs for drawing the skeleton overlay. */
export const SKELETON_EDGES: ReadonlyArray<readonly [number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
];

/** Interior angle ABC in degrees, using x/y only (image plane). */
export function angle(a: NormalizedLandmark, b: NormalizedLandmark, c: NormalizedLandmark): number {
  const ab = Math.atan2(a.y - b.y, a.x - b.x);
  const cb = Math.atan2(c.y - b.y, c.x - b.x);
  let deg = Math.abs(((ab - cb) * 180) / Math.PI);
  if (deg > 180) deg = 360 - deg;
  return deg;
}

export const vis = (l: NormalizedLandmark | undefined) => l?.visibility ?? 0;

/** Pick the side (left/right) whose joints are more visible to the camera. */
export function pickSide(lms: NormalizedLandmark[], left: number[], right: number[]): number[] {
  const score = (ids: number[]) => ids.reduce((s, i) => s + vis(lms[i]), 0);
  return score(left) >= score(right) ? left : right;
}

/** Exponential moving average for jitter reduction. */
export function ema(alpha: number) {
  let v: number | null = null;
  return (x: number) => (v = v === null ? x : v + alpha * (x - v));
}
