import type { MachineExercise, MachineProfile } from '../types';

/**
 * Per-machine tracking parameters.
 *
 * Angles are interior joint angles from 3D world landmarks (180° = straight limb). They're
 * deliberately forgiving (few people fully lock out on machines); the ±10° deadband in the rep
 * engine is applied on top of these targets.
 *
 * `reference` poses are a side-view stick figure in a 100×100 SVG box used by the PiP reference loop.
 */
export const MACHINE_PROFILES: Record<MachineExercise, MachineProfile> = {
  lat_pulldown: {
    id: 'lat_pulldown',
    name: 'Lat Pulldown',
    muscles: 'Lats · biceps · rear delts',
    joint: 'elbow',
    startAngle: 160,
    endAngle: 80,
    firstPhase: 'CONCENTRIC',
    shortAtEndCue: 'Pull the bar to your upper chest',
    shortAtStartCue: 'Full extension at top',
    tempo: { eccentric: 2, pause: 0.5, concentric: 1 },
    kcalPerRep: 0.25,
    reference: {
      start: { head: [50, 28], shoulder: [50, 40], elbow: [53, 24], wrist: [55, 8], hip: [50, 68], knee: [70, 68], ankle: [70, 90] },
      end: { head: [50, 28], shoulder: [50, 40], elbow: [45, 55], wrist: [54, 40], hip: [50, 68], knee: [70, 68], ankle: [70, 90] },
    },
  },
  chest_press: {
    id: 'chest_press',
    name: 'Chest Press',
    muscles: 'Chest · triceps · front delts',
    joint: 'elbow',
    startAngle: 160,
    endAngle: 90,
    firstPhase: 'ECCENTRIC',
    shortAtEndCue: 'Bring the handles back to chest level',
    shortAtStartCue: 'Full extension — press all the way out',
    tempo: { eccentric: 2, pause: 0.5, concentric: 1 },
    kcalPerRep: 0.3,
    reference: {
      start: { head: [38, 28], shoulder: [40, 40], elbow: [56, 42], wrist: [72, 42], hip: [40, 70], knee: [62, 70], ankle: [62, 90] },
      end: { head: [38, 28], shoulder: [40, 40], elbow: [30, 50], wrist: [44, 43], hip: [40, 70], knee: [62, 70], ankle: [62, 90] },
    },
  },
  seated_row: {
    id: 'seated_row',
    name: 'Seated Row',
    muscles: 'Mid-back · lats · biceps',
    joint: 'elbow',
    startAngle: 155,
    endAngle: 80,
    firstPhase: 'CONCENTRIC',
    shortAtEndCue: 'Squeeze — pull handles to your torso',
    shortAtStartCue: 'Full extension — let your arms reach forward',
    tempo: { eccentric: 2, pause: 0.5, concentric: 1 },
    kcalPerRep: 0.28,
    reference: {
      start: { head: [40, 28], shoulder: [40, 40], elbow: [56, 43], wrist: [72, 46], hip: [40, 70], knee: [64, 62], ankle: [82, 70] },
      end: { head: [38, 28], shoulder: [40, 40], elbow: [26, 48], wrist: [42, 50], hip: [40, 70], knee: [64, 62], ankle: [82, 70] },
    },
  },
  leg_extension: {
    id: 'leg_extension',
    name: 'Leg Extension',
    muscles: 'Quadriceps',
    joint: 'knee',
    startAngle: 95,
    endAngle: 165,
    firstPhase: 'CONCENTRIC',
    shortAtEndCue: 'Full extension at top',
    shortAtStartCue: 'Lower all the way down',
    tempo: { eccentric: 2, pause: 0.5, concentric: 1 },
    kcalPerRep: 0.22,
    reference: {
      start: { head: [38, 20], shoulder: [38, 32], elbow: [42, 46], wrist: [50, 58], hip: [40, 60], knee: [62, 60], ankle: [62, 84] },
      end: { head: [38, 20], shoulder: [38, 32], elbow: [42, 46], wrist: [50, 58], hip: [40, 60], knee: [62, 60], ankle: [85, 57] },
    },
  },
};

export const MACHINE_LIST = Object.values(MACHINE_PROFILES);

export function isMachineExercise(v: unknown): v is MachineExercise {
  return typeof v === 'string' && v in MACHINE_PROFILES;
}
