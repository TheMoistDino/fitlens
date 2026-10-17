import { describe, expect, it } from 'vitest';
import { FOREARM_TO_UPPER_ARM, angleBetween, forearmProjectionAngle, jointAngle, signedHipOffset, trunkAngleFromVertical, vec } from '../math/vector3';

describe('vector3', () => {
  it('computes interior joint angles via the dot product', () => {
    expect(jointAngle(vec(0, -1), vec(0, 0), vec(1, 0))).toBeCloseTo(90);
    expect(jointAngle(vec(-1, 0), vec(0, 0), vec(1, 0))).toBeCloseTo(180);
    expect(jointAngle(vec(1, 0, 0), vec(0, 0, 0), vec(1, 0, 1))).toBeCloseTo(45);
  });

  it('works in 3D, not just the image plane', () => {
    // Forearm pointing straight at the camera: 2D projection would read ~0°, true angle is 90°.
    expect(jointAngle(vec(0, -1, 0), vec(0, 0, 0), vec(0, 0, -1))).toBeCloseTo(90);
  });

  it('returns NaN for degenerate vectors instead of a bogus angle', () => {
    expect(angleBetween(vec(0, 0, 0), vec(1, 0, 0))).toBeNaN();
  });

  it('clamps floating-point cosine drift', () => {
    expect(angleBetween(vec(1e8, 1, 0), vec(1e8, 1, 0))).toBeCloseTo(0);
  });

  it('measures trunk angle from vertical (y-down coordinates)', () => {
    const upright = trunkAngleFromVertical(vec(-0.2, -0.5), vec(0.2, -0.5), vec(-0.1, 0), vec(0.1, 0));
    expect(upright).toBeCloseTo(0);
    const leaning = trunkAngleFromVertical(vec(0.3, -0.5), vec(0.7, -0.5), vec(-0.1, 0), vec(0.1, 0));
    expect(leaning).toBeCloseTo(45);
  });

  describe('forearmProjectionAngle (front-view curl, no depth)', () => {
    const shoulder = { x: 0.5, y: 0.3 };
    const elbow = { x: 0.5, y: 0.5 }; // upper arm 0.2 tall, hanging straight down
    const L = 0.2 * FOREARM_TO_UPPER_ARM;
    it('reads ~180° with the arm hanging', () => {
      expect(forearmProjectionAngle(shoulder, elbow, { x: 0.5, y: 0.5 + L }, 1)).toBeCloseTo(180, 0);
    });
    it('reads ~90° when the forearm points at the camera (2D length ~0)', () => {
      expect(forearmProjectionAngle(shoulder, elbow, { x: 0.5, y: 0.5 }, 1)).toBeCloseTo(90, 0);
    });
    it('reads a deep curl when the wrist rises toward the shoulder', () => {
      expect(forearmProjectionAngle(shoulder, elbow, { x: 0.5, y: 0.5 - 0.77 * L }, 1)).toBeLessThan(45);
    });
    it('corrects for non-square video', () => {
      // Same physical pose on a 16:9 frame: horizontal offsets shrink in normalised x.
      const k = 16 / 9;
      // Diagonal upper arm (aspect only matters when the arm isn't axis-aligned).
      const sq = { s: { x: 0.35, y: 0.3 }, e: { x: 0.5, y: 0.45 }, w: { x: 0.62, y: 0.47 } };
      const wide = { s: { x: 0.5 - 0.15 / k, y: 0.3 }, e: { x: 0.5, y: 0.45 }, w: { x: 0.5 + 0.12 / k, y: 0.47 } };
      const a = forearmProjectionAngle(sq.s, sq.e, sq.w, 1);
      expect(forearmProjectionAngle(wide.s, wide.e, wide.w, k)).toBeCloseTo(a, 5);
      // Ignoring the aspect ratio would give a noticeably different angle:
      expect(Math.abs(forearmProjectionAngle(wide.s, wide.e, wide.w, 1) - a)).toBeGreaterThan(5);
    });
  });

  describe('signedHipOffset (plank line, image y-down)', () => {
    it('is ~0 for a straight plank', () => {
      expect(signedHipOffset({ x: 0.8, y: 0.5 }, { x: 0.5, y: 0.55 }, { x: 0.2, y: 0.6 }, 1)).toBeCloseTo(0, 5);
    });
    it('is positive when the hips sag toward the floor, whichever way the user faces', () => {
      const facingLeft = signedHipOffset({ x: 0.2, y: 0.5 }, { x: 0.5, y: 0.6 }, { x: 0.8, y: 0.5 }, 1);
      const facingRight = signedHipOffset({ x: 0.8, y: 0.5 }, { x: 0.5, y: 0.6 }, { x: 0.2, y: 0.5 }, 1);
      expect(facingLeft).toBeGreaterThan(0.1);
      expect(facingRight).toBeCloseTo(facingLeft, 6);
    });
    it('is negative when the hips pike up (downward dog)', () => {
      expect(signedHipOffset({ x: 0.2, y: 0.6 }, { x: 0.5, y: 0.3 }, { x: 0.8, y: 0.6 }, 1)).toBeLessThan(-0.3);
    });
  });
});
