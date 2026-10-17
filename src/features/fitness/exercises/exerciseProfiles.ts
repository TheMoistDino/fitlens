import type { BodyweightExercise, ExerciseProfile, GymExercise, TrackedExercise } from '../types';

/**
 * Per-exercise tracking parameters.
 *
 * Angles are interior joint angles from 3D world landmarks (180° = straight limb). They're
 * deliberately forgiving (few people fully lock out); the rep engine adds a ±10° deadband on top.
 *
 * `cameraView` matters: a joint that bends *toward* the lens is foreshortened and measures badly,
 * so squats, push-ups and seated machines are tracked from the side.
 *
 * `reference` poses are a side-view stick figure in a 100×100 SVG box (reference loop animation).
 */

const NO_SWING = { torsoSwing: false } as const;
const SWING = { torsoSwing: true } as const;

export const GYM_PROFILES: Record<GymExercise, ExerciseProfile> = {
  bicep_curl: {
    id: 'bicep_curl',
    name: 'Bicep Curl',
    muscles: 'Biceps · forearms',
    cameraView: 'front',
    angleMethod: 'forearmProjection',
    setupHint: 'Face the camera, ~2 m away, waist-up with both arms in frame',
    checks: SWING,
    joint: 'elbow',
    startAngle: 155,
    endAngle: 55,
    firstPhase: 'CONCENTRIC',
    shortAtEndCue: 'Curl all the way up',
    shortAtStartCue: 'Lower all the way — full extension',
    tempo: { eccentric: 2, pause: 0.5, concentric: 1 },
    kcalPerRep: 0.15,
    reference: {
      start: { head: [50, 14], shoulder: [50, 26], elbow: [51, 42], wrist: [52, 57], hip: [50, 58], knee: [50, 76], ankle: [50, 94] },
      end: { head: [50, 14], shoulder: [50, 26], elbow: [51, 42], wrist: [60, 29], hip: [50, 58], knee: [50, 76], ankle: [50, 94] },
    },
  },
  lat_pulldown: {
    id: 'lat_pulldown',
    name: 'Lat Pulldown',
    muscles: 'Lats · biceps · rear delts',
    cameraView: 'front',
    setupHint: 'Camera in front of or behind you, both arms and the bar in frame',
    checks: SWING,
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
    cameraView: 'side',
    setupHint: 'Camera to your side at shoulder height, whole arm in frame',
    checks: SWING,
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
    cameraView: 'side',
    setupHint: 'Camera to your side, torso and the full arm in frame',
    checks: SWING,
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
    cameraView: 'side',
    setupHint: 'Camera to your side at knee height — hip, knee and ankle in frame',
    checks: NO_SWING, // seated with back pad: torso barely moves, baseline drift caused false cues
    joint: 'knee',
    startAngle: 95,
    endAngle: 160,
    firstPhase: 'CONCENTRIC',
    shortAtEndCue: 'Full extension at top',
    shortAtStartCue: 'Lower all the way down',
    tempo: { eccentric: 2, pause: 0.5, concentric: 1 },
    kcalPerRep: 0.22,
    reference: {
      start: { head: [38, 20], shoulder: [38, 32], elbow: [42, 46], wrist: [50, 58], hip: [40, 60], knee: [62, 60], ankle: [62, 84] },
      end: { head: [38, 20], shoulder: [38, 32], elbow: [42, 46], wrist: [50, 58], hip: [40, 60], knee: [62, 60], ankle: [84, 54] },
    },
  },
};

export const BODYWEIGHT_PROFILES: Record<BodyweightExercise, ExerciseProfile> = {
  squat: {
    id: 'squat',
    name: 'Squat',
    muscles: 'Quads · glutes · hamstrings',
    cameraView: 'side',
    setupHint: 'Camera to your side (or 45°) at hip height, ~2.5 m away, head to feet in frame',
    // Squats lean forward by design, so no "swing" check — only an absolute lean limit.
    checks: { torsoSwing: false, maxTorsoLeanDeg: 55 },
    joint: 'knee',
    startAngle: 165,
    endAngle: 105,
    firstPhase: 'ECCENTRIC',
    shortAtEndCue: 'Go deeper — aim for thighs parallel',
    shortAtStartCue: 'Stand all the way up',
    tempo: { eccentric: 2, pause: 0.3, concentric: 1 },
    kcalPerRep: 0.32,
    reference: {
      start: { head: [45, 12], shoulder: [45, 24], elbow: [56, 30], wrist: [66, 30], hip: [45, 54], knee: [47, 74], ankle: [45, 94] },
      end: { head: [54, 36], shoulder: [50, 47], elbow: [61, 52], wrist: [71, 50], hip: [34, 72], knee: [56, 72], ankle: [45, 94] },
    },
  },
  pushup: {
    id: 'pushup',
    name: 'Push-up',
    muscles: 'Chest · triceps · core',
    cameraView: 'side',
    orientation: 'landscape',
    setupHint: 'Phone on the floor, turned sideways (landscape), to your side ~2 m away, head to feet in frame',
    checks: { torsoSwing: false, bodyLine: { sag: 0.04, pike: 0.06 } }, // ~9° sag / ~14° pike
    joint: 'elbow',
    startAngle: 160,
    endAngle: 95,
    firstPhase: 'ECCENTRIC',
    shortAtEndCue: 'Lower your chest closer to the floor',
    shortAtStartCue: 'Press all the way up',
    tempo: { eccentric: 2, pause: 0.3, concentric: 1 },
    kcalPerRep: 0.36,
    reference: {
      start: { head: [84, 50], shoulder: [74, 54], elbow: [74, 67], wrist: [74, 80], hip: [48, 62], knee: [30, 68], ankle: [10, 74] },
      end: { head: [86, 66], shoulder: [76, 70], elbow: [64, 72], wrist: [74, 80], hip: [48, 73], knee: [30, 75], ankle: [10, 78] },
    },
  },
};

export const EXERCISE_PROFILES: Record<TrackedExercise, ExerciseProfile> = { ...GYM_PROFILES, ...BODYWEIGHT_PROFILES };

export const GYM_LIST = Object.values(GYM_PROFILES) as Array<ExerciseProfile & { id: GymExercise }>;
export const BODYWEIGHT_LIST = Object.values(BODYWEIGHT_PROFILES) as Array<ExerciseProfile & { id: BodyweightExercise }>;

export function isGymExercise(v: unknown): v is GymExercise {
  return typeof v === 'string' && v in GYM_PROFILES;
}
