import { describe, expect, it } from 'vitest';
import { RepEngine } from '../engine/RepEngine';
import { BODYWEIGHT_PROFILES, GYM_PROFILES } from '../exercises/exerciseProfiles';
import type { RepEngineEvent } from '../types';

const FPS = 30;
const DT = 1000 / FPS;

/** Drive the engine with a piecewise-linear angle trace: [angle, seconds to get there]. */
function run(engine: RepEngine, start: number, segments: Array<[number, number]>, t0 = 0) {
  const events: RepEngineEvent[] = [];
  let t = t0;
  let a = start;
  for (let i = 0; i < 10; i++, t += DT) events.push(...engine.update(a, t)); // settle EMA
  for (const [target, secs] of segments) {
    const n = Math.max(1, Math.round(secs * FPS));
    const from = a;
    for (let i = 1; i <= n; i++, t += DT) {
      a = from + ((target - from) * i) / n;
      events.push(...engine.update(a, t));
    }
  }
  return { events, t };
}

const phases = (ev: RepEngineEvent[]) => ev.filter((e) => e.type === 'phase').map((e) => (e as { phase: string }).phase);

describe('RepEngine', () => {
  it('counts a full lat-pulldown rep with concentric first', () => {
    const e = new RepEngine(GYM_PROFILES.lat_pulldown); // 160 → 80
    const { events } = run(e, 160, [[80, 1], [80, 0.5], [160, 2], [160, 0.5]]);
    expect(e.snapshot.repCount).toBe(1);
    expect(phases(events)).toEqual(['CONCENTRIC', 'INFLECTION', 'ECCENTRIC', 'REP_COMPLETED', 'READY']);
    const rep = events.find((x) => x.type === 'rep');
    expect(rep && rep.type === 'rep' && rep.rep.eccentricMs).toBeGreaterThan(1200);
    expect(rep && rep.type === 'rep' && rep.rep.concentricMs).toBeLessThan(1200);
  });

  it('uses eccentric-first ordering for chest press', () => {
    const e = new RepEngine(GYM_PROFILES.chest_press); // 160 → 90
    const { events } = run(e, 160, [[90, 2], [90, 0.3], [160, 1], [160, 0.3]]);
    expect(e.snapshot.repCount).toBe(1);
    expect(phases(events).slice(0, 3)).toEqual(['ECCENTRIC', 'INFLECTION', 'CONCENTRIC']);
  });

  it('handles increasing-angle machines (leg extension)', () => {
    const e = new RepEngine(GYM_PROFILES.leg_extension); // 95 → 160
    run(e, 95, [[165, 1], [165, 0.3], [95, 2], [95, 0.3], [165, 1], [165, 0.3], [95, 2], [95, 0.3]]);
    expect(e.snapshot.repCount).toBe(2);
  });

  it('ignores jitter inside the ±10° deadband', () => {
    const e = new RepEngine(GYM_PROFILES.lat_pulldown);
    const { events } = run(e, 160, Array.from({ length: 20 }, (_, i) => [i % 2 ? 167 : 153, 0.15] as [number, number]));
    expect(events).toHaveLength(0);
    expect(e.snapshot.repCount).toBe(0);
  });

  it('does not count a half rep, but reports it as partial', () => {
    const e = new RepEngine(GYM_PROFILES.lat_pulldown);
    const { events } = run(e, 160, [[115, 1], [160, 1], [160, 0.5]]);
    expect(e.snapshot.repCount).toBe(0);
    expect(e.snapshot.partialReps).toBe(1);
    expect(events.some((x) => x.type === 'partial' && x.at === 'end')).toBe(true);
  });

  it('does not chatter at the inflection point', () => {
    const e = new RepEngine(GYM_PROFILES.lat_pulldown);
    // Hover around the bottom (80°) ±6°: should stay in INFLECTION, not flip phases.
    const { events } = run(e, 160, [[80, 1], [86, 0.2], [76, 0.2], [86, 0.2], [80, 0.2]]);
    expect(phases(events)).toEqual(['CONCENTRIC', 'INFLECTION']);
  });

  it('rejects reps faster than the minimum duration', () => {
    const e = new RepEngine(GYM_PROFILES.lat_pulldown);
    run(e, 160, [[80, 0.1], [160, 0.1], [160, 0.5]]);
    expect(e.snapshot.repCount).toBe(0);
  });

  it('counts consecutive reps', () => {
    const e = new RepEngine(GYM_PROFILES.seated_row);
    const rep: Array<[number, number]> = [[80, 1], [80, 0.3], [155, 2], [155, 0.3]];
    run(e, 155, [...rep, ...rep, ...rep]);
    expect(e.snapshot.repCount).toBe(3);
    expect(e.repRecords.map((r) => r.index)).toEqual([1, 2, 3]);
  });

  it('counts bicep curls (concentric first, deep flexion)', () => {
    const e = new RepEngine(GYM_PROFILES.bicep_curl); // 155 → 55
    const rep: Array<[number, number]> = [[50, 1], [50, 0.3], [155, 2], [155, 0.3]];
    run(e, 155, [...rep, ...rep]);
    expect(e.snapshot.repCount).toBe(2);
  });

  it('counts squats to ~parallel and rejects quarter squats', () => {
    const e = new RepEngine(BODYWEIGHT_PROFILES.squat); // 165 → 105
    run(e, 170, [[100, 2], [100, 0.3], [170, 1], [170, 0.3], [140, 1], [170, 1], [170, 0.3]]);
    expect(e.snapshot.repCount).toBe(1);
    expect(e.snapshot.partialReps).toBe(1);
  });

  it('counts push-ups (eccentric first)', () => {
    const e = new RepEngine(BODYWEIGHT_PROFILES.pushup); // 160 → 95
    const rep: Array<[number, number]> = [[90, 1.5], [90, 0.2], [165, 1], [165, 0.3]];
    const { events } = run(e, 165, [...rep, ...rep, ...rep]);
    expect(e.snapshot.repCount).toBe(3);
    expect(events.find((x) => x.type === 'phase')).toMatchObject({ phase: 'ECCENTRIC' });
  });

  describe('pose-tracking glitches', () => {
    // Seeded noise + occasional ±35° single-frame spikes (a wrist landmark jumping), as seen on-device.
    function noisy(engine: RepEngine, start: number, segs: Array<[number, number]>) {
      let seed = 42;
      const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
      const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());
      const events: RepEngineEvent[] = [];
      let t = 0, a = start;
      for (const [target, secs] of segs) {
        const n = Math.round(secs * FPS), from = a;
        for (let i = 1; i <= n; i++, t += DT) {
          a = from + ((target - from) * i) / n;
          const spike = rand() < 0.04 ? (rand() < 0.5 ? -35 : 35) : 0;
          events.push(...engine.update(a + gauss() * 4 + spike, t));
        }
      }
      return events.filter((e) => e.type === 'rep').map((e) => (e as Extract<RepEngineEvent, { type: 'rep' }>).rep);
    }

    it('slow curls: every rep counted, slow eccentric measured as slow', () => {
      const e = new RepEngine(GYM_PROFILES.bicep_curl);
      const rep: Array<[number, number]> = [[50, 1.2], [50, 0.4], [160, 3], [160, 0.6]];
      const reps = noisy(e, 160, [[160, 1], ...rep, ...rep, ...rep, ...rep]);
      expect(reps).toHaveLength(4);
      expect(e.snapshot.partialReps).toBe(0);
      for (const r of reps) expect(r.eccentricMs).toBeGreaterThan(1500);
    });

    it('slow squats: an early glitch near the bottom does not shorten the eccentric', () => {
      const e = new RepEngine(BODYWEIGHT_PROFILES.squat);
      const rep: Array<[number, number]> = [[95, 3], [95, 0.4], [170, 1.2], [170, 0.6]];
      const reps = noisy(e, 170, [[170, 1], ...rep, ...rep, ...rep, ...rep]);
      expect(reps).toHaveLength(4);
      expect(e.snapshot.partialReps).toBe(0);
      for (const r of reps) expect(r.eccentricMs).toBeGreaterThan(1500);
    });

    it('a genuinely dropped rep is still measured as fast', () => {
      const e = new RepEngine(BODYWEIGHT_PROFILES.squat);
      const reps = noisy(e, 170, [[170, 1], [95, 0.35], [95, 0.3], [170, 1], [170, 0.6]]);
      expect(reps).toHaveLength(1);
      expect(reps[0]!.eccentricMs).toBeLessThan(600);
    });
  });
});
