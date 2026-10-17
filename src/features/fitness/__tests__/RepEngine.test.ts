import { describe, expect, it } from 'vitest';
import { RepEngine } from '../engine/RepEngine';
import { MACHINE_PROFILES } from '../exercises/machineProfiles';
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
    const e = new RepEngine(MACHINE_PROFILES.lat_pulldown); // 160 → 80
    const { events } = run(e, 160, [[80, 1], [80, 0.5], [160, 2], [160, 0.5]]);
    expect(e.snapshot.repCount).toBe(1);
    expect(phases(events)).toEqual(['CONCENTRIC', 'INFLECTION', 'ECCENTRIC', 'REP_COMPLETED', 'READY']);
    const rep = events.find((x) => x.type === 'rep');
    expect(rep && rep.type === 'rep' && rep.rep.eccentricMs).toBeGreaterThan(1200);
    expect(rep && rep.type === 'rep' && rep.rep.concentricMs).toBeLessThan(1200);
  });

  it('uses eccentric-first ordering for chest press', () => {
    const e = new RepEngine(MACHINE_PROFILES.chest_press); // 160 → 90
    const { events } = run(e, 160, [[90, 2], [90, 0.3], [160, 1], [160, 0.3]]);
    expect(e.snapshot.repCount).toBe(1);
    expect(phases(events).slice(0, 3)).toEqual(['ECCENTRIC', 'INFLECTION', 'CONCENTRIC']);
  });

  it('handles increasing-angle machines (leg extension)', () => {
    const e = new RepEngine(MACHINE_PROFILES.leg_extension); // 95 → 165
    run(e, 95, [[165, 1], [165, 0.3], [95, 2], [95, 0.3], [165, 1], [165, 0.3], [95, 2], [95, 0.3]]);
    expect(e.snapshot.repCount).toBe(2);
  });

  it('ignores jitter inside the ±10° deadband', () => {
    const e = new RepEngine(MACHINE_PROFILES.lat_pulldown);
    const { events } = run(e, 160, Array.from({ length: 20 }, (_, i) => [i % 2 ? 167 : 153, 0.15] as [number, number]));
    expect(events).toHaveLength(0);
    expect(e.snapshot.repCount).toBe(0);
  });

  it('does not count a half rep, but reports it as partial', () => {
    const e = new RepEngine(MACHINE_PROFILES.lat_pulldown);
    const { events } = run(e, 160, [[115, 1], [160, 1], [160, 0.5]]);
    expect(e.snapshot.repCount).toBe(0);
    expect(e.snapshot.partialReps).toBe(1);
    expect(events.some((x) => x.type === 'partial' && x.at === 'end')).toBe(true);
  });

  it('does not chatter at the inflection point', () => {
    const e = new RepEngine(MACHINE_PROFILES.lat_pulldown);
    // Hover around the bottom (80°) ±6°: should stay in INFLECTION, not flip phases.
    const { events } = run(e, 160, [[80, 1], [86, 0.2], [76, 0.2], [86, 0.2], [80, 0.2]]);
    expect(phases(events)).toEqual(['CONCENTRIC', 'INFLECTION']);
  });

  it('rejects reps faster than the minimum duration', () => {
    const e = new RepEngine(MACHINE_PROFILES.lat_pulldown);
    run(e, 160, [[80, 0.1], [160, 0.1], [160, 0.5]]);
    expect(e.snapshot.repCount).toBe(0);
  });

  it('counts consecutive reps', () => {
    const e = new RepEngine(MACHINE_PROFILES.seated_row);
    const rep: Array<[number, number]> = [[80, 1], [80, 0.3], [155, 2], [155, 0.3]];
    run(e, 155, [...rep, ...rep, ...rep]);
    expect(e.snapshot.repCount).toBe(3);
    expect(e.repRecords.map((r) => r.index)).toEqual([1, 2, 3]);
  });
});
