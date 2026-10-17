import { describe, expect, it } from 'vitest';
import { FormAnalyzer } from '../engine/FormAnalyzer';
import { BODYWEIGHT_PROFILES, GYM_PROFILES } from '../exercises/exerciseProfiles';

const profile = GYM_PROFILES.lat_pulldown;

function settle(f: FormAnalyzer, trunk = 5) {
  for (let i = 0; i < 20; i++) f.update({ t: i * 33, trunkAngle: trunk, leftAngle: 160, rightAngle: 160, phase: 'READY' });
}

describe('FormAnalyzer', () => {
  it('flags torso swing relative to the set baseline, not absolute vertical', () => {
    const f = new FormAnalyzer(profile);
    settle(f, 20); // camera tilted: rest posture reads 20°
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
    const rep = (eccentricMs: number) => ({ index: 1, startedAt: 0, endedAt: 1200, eccentricMs, concentricMs: 700, pauseMs: 100, rangeOfMotion: 1, flags: [] });
    expect(f.onRepEvent({ type: 'rep', rep: rep(1100) })).toBeNull(); // controlled ~1 s lowering is fine
    const cue = f.onRepEvent({ type: 'rep', rep: rep(400) });
    expect(cue?.code).toBe('fast_eccentric');
    expect(f.takeRepFlags()).toContain('fast_eccentric');
    expect(f.flagCounts.fast_eccentric).toBe(1);
  });

  it('uses the machine-specific cue for a short range of motion', () => {
    const f = new FormAnalyzer(GYM_PROFILES.leg_extension);
    expect(f.onRepEvent({ type: 'partial', at: 'end', t: 0 })?.message).toBe('Full extension at top');
  });

  const frames = (f: FormAnalyzer, n: number, input: Partial<Parameters<FormAnalyzer['update']>[0]>) => {
    for (let i = 0; i < n; i++) f.update({ t: i * 33, trunkAngle: 10, leftAngle: 150, rightAngle: null, phase: 'ECCENTRIC', ...input });
  };

  it('squat: natural forward lean is fine, folding over is flagged', () => {
    const f = new FormAnalyzer(BODYWEIGHT_PROFILES.squat);
    frames(f, 30, { trunkAngle: 40 }); // big change from standing baseline, but normal squat lean
    expect(f.snapshot.active).toBeNull();
    frames(f, 30, { trunkAngle: 70 });
    expect(f.snapshot.active?.code).toBe('torso_lean');
  });

  it('push-up: flags hips dropping below the user’s own top-position line', () => {
    const f = new FormAnalyzer(BODYWEIGHT_PROFILES.pushup);
    frames(f, 20, { trunkAngle: 85, hipLineAngle: 172, phase: 'READY' });
    frames(f, 20, { trunkAngle: 85, hipLineAngle: 168 });
    expect(f.snapshot.active).toBeNull();
    frames(f, 20, { trunkAngle: 85, hipLineAngle: 145 });
    expect(f.snapshot.active?.code).toBe('hip_sag');
    expect(f.snapshot.bones.torso).toBe('warn');
  });

  it('push-up: baggy clothing that bends the measured line at rest is not a sag', () => {
    const f = new FormAnalyzer(BODYWEIGHT_PROFILES.pushup);
    // Loose pants pull the detected hip point down: the line reads ~150° even with a straight body.
    frames(f, 20, { trunkAngle: 85, hipLineAngle: 150, phase: 'READY' });
    frames(f, 30, { trunkAngle: 85, hipLineAngle: 146 });
    expect(f.snapshot.active).toBeNull();
  });

  it('push-up: a badly bent line is flagged even without a baseline', () => {
    const f = new FormAnalyzer(BODYWEIGHT_PROFILES.pushup);
    frames(f, 20, { trunkAngle: 85, hipLineAngle: 125 });
    expect(f.snapshot.active?.code).toBe('hip_sag');
  });

  it('torso baseline ignores walking into position after Start', () => {
    const f = new FormAnalyzer(GYM_PROFILES.bicep_curl);
    // Stepping back toward the camera: trunk reads all over the place, but no rep is in progress.
    for (let i = 0; i < 15; i++) f.update({ t: i * 33, trunkAngle: 30 - i * 2, leftAngle: 150, rightAngle: 150, phase: 'READY' });
    // Settled and upright at rest, then a strict rep with the torso still.
    frames(f, 40, { trunkAngle: 4, leftAngle: 150, rightAngle: 150, phase: 'READY' });
    frames(f, 30, { trunkAngle: 7, leftAngle: 80, rightAngle: 82, phase: 'CONCENTRIC' });
    expect(f.snapshot.active).toBeNull();
  });

  it('front view tolerates more trunk noise than side view', () => {
    const front = new FormAnalyzer(GYM_PROFILES.bicep_curl);
    frames(front, 40, { trunkAngle: 5, leftAngle: 150, rightAngle: 150, phase: 'READY' });
    frames(front, 30, { trunkAngle: 22, leftAngle: 80, rightAngle: 80, phase: 'CONCENTRIC' }); // 17° — depth noise
    expect(front.snapshot.active).toBeNull();
    frames(front, 30, { trunkAngle: 40, leftAngle: 80, rightAngle: 80, phase: 'CONCENTRIC' }); // 35° — real swing
    expect(front.snapshot.active?.code).toBe('torso_swing');
  });

  it('side-view exercises never report asymmetry (far side is not trustworthy)', () => {
    const f = new FormAnalyzer(GYM_PROFILES.leg_extension);
    frames(f, 30, { leftAngle: 160, rightAngle: 100 });
    expect(f.snapshot.asymmetry).toBeNull();
    expect(f.snapshot.active).toBeNull();
  });

  it('leg extension does not flag torso swing', () => {
    const f = new FormAnalyzer(GYM_PROFILES.leg_extension);
    frames(f, 20, { trunkAngle: 10 });
    frames(f, 20, { trunkAngle: 45 });
    expect(f.snapshot.active).toBeNull();
  });

  it('a single bad frame does not flash a cue', () => {
    const f = new FormAnalyzer(BODYWEIGHT_PROFILES.pushup);
    frames(f, 20, { trunkAngle: 85, hipLineAngle: 172, phase: 'READY' });
    frames(f, 1, { trunkAngle: 85, hipLineAngle: 110 });
    expect(f.snapshot.active).toBeNull();
  });
});
