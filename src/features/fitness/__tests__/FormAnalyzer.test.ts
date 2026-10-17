import { describe, expect, it } from 'vitest';
import { FormAnalyzer } from '../engine/FormAnalyzer';
import { MACHINE_PROFILES } from '../exercises/machineProfiles';

const profile = MACHINE_PROFILES.lat_pulldown;

function settle(f: FormAnalyzer, trunk = 5) {
  for (let i = 0; i < 20; i++) f.update({ t: i * 33, trunkAngle: trunk, leftAngle: 160, rightAngle: 160, phase: 'READY' });
}

describe('FormAnalyzer', () => {
  it('flags torso swing relative to the set baseline, not absolute vertical', () => {
    const f = new FormAnalyzer(profile);
    settle(f, 20); // camera tilted: baseline 20°
    for (let i = 0; i < 10; i++) f.update({ t: 1000 + i * 33, trunkAngle: 28, leftAngle: 120, rightAngle: 120, phase: 'CONCENTRIC' });
    expect(f.snapshot.active).toBeNull(); // 8° deviation is fine
    for (let i = 0; i < 20; i++) f.update({ t: 2000 + i * 33, trunkAngle: 42, leftAngle: 120, rightAngle: 120, phase: 'CONCENTRIC' });
    expect(f.snapshot.active?.code).toBe('torso_swing');
    expect(f.snapshot.bones.torso).not.toBe('good');
  });

  it('flags sustained bilateral asymmetry > 12° only while moving', () => {
    const f = new FormAnalyzer(profile);
    settle(f);
    for (let i = 0; i < 10; i++) f.update({ t: i * 33, trunkAngle: 5, leftAngle: 140, rightAngle: 120, phase: 'READY' });
    expect(f.snapshot.active).toBeNull();
    for (let i = 0; i < 10; i++) f.update({ t: 500 + i * 33, trunkAngle: 5, leftAngle: 140, rightAngle: 120, phase: 'ECCENTRIC' });
    expect(f.snapshot.active?.code).toBe('asymmetry');
    expect(f.snapshot.bones.leftArm).toBe('warn');
  });

  it('cues a rushed eccentric and attaches flags to the rep', () => {
    const f = new FormAnalyzer(profile);
    const cue = f.onRepEvent({
      type: 'rep',
      rep: { index: 1, startedAt: 0, endedAt: 1200, eccentricMs: 400, concentricMs: 700, pauseMs: 100, rangeOfMotion: 1, flags: [] },
    });
    expect(cue?.code).toBe('fast_eccentric');
    expect(f.takeRepFlags()).toContain('fast_eccentric');
    expect(f.flagCounts.fast_eccentric).toBe(1);
  });

  it('uses the machine-specific cue for a short range of motion', () => {
    const f = new FormAnalyzer(MACHINE_PROFILES.leg_extension);
    expect(f.onRepEvent({ type: 'partial', at: 'end', t: 0 })?.message).toBe('Full extension at top');
  });
});
