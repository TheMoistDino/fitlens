import type { Vec3 } from '../types';

/**
 * Small, allocation-light 3D vector helpers for joint-angle math.
 * All angles are returned in degrees.
 */

const RAD2DEG = 180 / Math.PI;

export const vec = (x: number, y: number, z = 0): Vec3 => ({ x, y, z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const norm = (a: Vec3): number => Math.sqrt(dot(a, a));
export const midpoint = (a: Vec3, b: Vec3): Vec3 => scale(add(a, b), 0.5);

/**
 * Angle between two vectors: θ = arccos( (u·v) / (‖u‖‖v‖) ).
 * Returns NaN for a zero-length vector so callers can skip the frame instead of using a bogus 0°/90°.
 */
export function angleBetween(u: Vec3, v: Vec3): number {
  const denom = norm(u) * norm(v);
  if (denom < 1e-9) return NaN;
  // Clamp: floating-point error can push the cosine slightly outside [-1, 1] → NaN from acos.
  const cos = Math.min(1, Math.max(-1, dot(u, v) / denom));
  return Math.acos(cos) * RAD2DEG;
}

/** Interior angle at joint B formed by A–B–C (e.g. shoulder–elbow–wrist). 180° = straight limb. */
export function jointAngle(a: Vec3, b: Vec3, c: Vec3): number {
  return angleBetween(sub(a, b), sub(c, b));
}

/**
 * MediaPipe world + image coordinates are y-down, so "up" is −y.
 * Trunk angle = angle between hip→shoulder midline and vertical (0° = upright).
 */
export const UP: Vec3 = { x: 0, y: -1, z: 0 };

export function trunkAngleFromVertical(leftShoulder: Vec3, rightShoulder: Vec3, leftHip: Vec3, rightHip: Vec3): number {
  const trunk = sub(midpoint(leftShoulder, rightShoulder), midpoint(leftHip, rightHip));
  return angleBetween(trunk, UP);
}

/** Exponential moving average; `reset()` forgets history (e.g. after tracking loss). */
export function createEma(alpha: number) {
  let v: number | null = null;
  return {
    next(x: number): number {
      if (!Number.isFinite(x)) return v ?? x;
      v = v === null ? x : v + alpha * (x - v);
      return v;
    },
    reset() {
      v = null;
    },
    get value() {
      return v;
    },
  };
}

/** Typical forearm (elbow→wrist landmark) length as a fraction of the upper arm (shoulder→elbow). */
export const FOREARM_TO_UPPER_ARM = 0.8;

/**
 * Elbow angle from a *front-facing* camera without trusting depth.
 *
 * In a front-view curl the forearm swings toward the lens, so its 2D image length collapses and the
 * model's z estimate is noisy. But the forearm's projection onto the upper-arm axis still tracks the
 * true angle: cos θ = −(forearm · û) / L, where û points shoulder→elbow and L is the forearm's real
 * length, estimated from the (unforeshortened) upper arm. θ = 180° hanging, ~90° forearm level,
 * ~40° fully curled.
 *
 * Inputs are normalised image coords; `aspect` = videoWidth / videoHeight restores square pixels.
 */
export function forearmProjectionAngle(
  shoulder: { x: number; y: number },
  elbow: { x: number; y: number },
  wrist: { x: number; y: number },
  aspect: number,
): number {
  const ux = (elbow.x - shoulder.x) * aspect, uy = elbow.y - shoulder.y;
  const upperLen = Math.hypot(ux, uy);
  if (upperLen < 1e-6) return NaN;
  const fx = (wrist.x - elbow.x) * aspect, fy = wrist.y - elbow.y;
  const proj = (fx * ux + fy * uy) / upperLen;
  // Interior angle is measured against elbow→shoulder (−û), hence the minus sign.
  const cos = Math.min(1, Math.max(-1, -proj / (upperLen * FOREARM_TO_UPPER_ARM)));
  return Math.acos(cos) * RAD2DEG;
}

/**
 * Signed distance of the hip from the shoulder→ankle line, as a fraction of that line's length,
 * in image space (side view). Positive = hip *below* the line (toward the floor → sag);
 * negative = hip above it (pike / downward dog). Unlike the unsigned shoulder–hip–ankle angle, this
 * tells the two faults apart. ~0.04 ≈ a 9° bend at the hips.
 */
export function signedHipOffset(
  shoulder: { x: number; y: number },
  hip: { x: number; y: number },
  ankle: { x: number; y: number },
  aspect: number,
): number {
  const dx = (ankle.x - shoulder.x) * aspect, dy = ankle.y - shoulder.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return NaN;
  const hx = (hip.x - shoulder.x) * aspect, hy = hip.y - shoulder.y;
  // Image y points down, so with the line drawn left→right a positive cross product means "below".
  const cross = dx * hy - dy * hx;
  return (Math.sign(dx) || 1) * cross / len2;
}
