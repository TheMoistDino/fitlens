import { describe, expect, it } from 'vitest';
import { angleBetween, jointAngle, trunkAngleFromVertical, vec } from '../math/vector3';

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
});
