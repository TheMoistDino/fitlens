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
