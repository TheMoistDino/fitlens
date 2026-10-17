/**
 * The app-wide event contract. Producers (camera/ML loop, pages) and consumers
 * (sponsor plugins, HUD) only ever agree on this file — never on each other.
 */

/** Bodyweight exercises (Bodyweight page). */
export type BodyweightExercise = 'squat' | 'pushup';
/** Gym exercises (Gym Coach page): machines plus free-weight curls. */
export type GymExercise = 'lat_pulldown' | 'chest_press' | 'seated_row' | 'leg_extension' | 'bicep_curl';
export type AnyExercise = BodyweightExercise | GymExercise;
export type WeightUnit = 'lb' | 'kg';
export type Severity = 'info' | 'warn' | 'critical';

export interface FormAlert {
  code: string; // e.g. 'knees_cave', 'back_rounding'
  message: string; // short, HUD-friendly
  severity: Severity;
}

export interface MacroItem {
  name: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence?: number;
}

export interface MacroSummary {
  items: MacroItem[];
  totalKcal: number;
  source: 'stepfun' | 'mock';
}

export type DeviceStatus = 'disabled' | 'connecting' | 'connected' | 'disconnected' | 'unsupported' | 'error';

export interface HudPayload {
  repCount: number;
  exercise?: AnyExercise;
  calories?: number;
  formAlert?: FormAlert | null;
  macroSummary?: MacroSummary | null;
}

export interface WorkoutSummary {
  id: string;
  exercise: AnyExercise;
  reps: number;
  durationMs: number;
  calories: number;
  alerts: FormAlert[];
  endedAt: number;
  /** Confirmed machine load, when known. */
  load?: { value: number; unit: WeightUnit };
}

export type SponsorEventMap = {
  /** Fired on every rep completed (state change, not per-frame). */
  'rep:completed': { exercise: AnyExercise; repCount: number; calories: number };
  /** Fired when the form classification changes (null = form OK again). */
  'form:alert': FormAlert | null;
  /** Low-frequency keyframe for cloud multimodal analysis. */
  'keyframe:captured': { image: Blob; mode: 'food' | 'pose' | 'machine'; context?: string; requestId?: number };
  /** Result of a cloud food analysis. */
  'macro:result': MacroSummary;
  /** Free-form coaching text from cloud pose analysis. */
  'coach:feedback': { text: string; source: 'stepfun' | 'fetchai' | 'mock' };
  /** Gym machine classification for a `machine` keyframe (echoes its requestId). */
  'machine:result': {
    requestId?: number;
    machine: GymExercise | 'unknown';
    confidence: number;
    /** Normalised [0..1] box around the machine, when the model returned one. */
    box?: { x: number; y: number; w: number; h: number };
    source: 'stepfun' | 'mock';
  };
  'workout:started': { exercise: AnyExercise };
  'workout:ended': WorkoutSummary;
  /** Rolled-up HUD snapshot (emitted by the glasses plugin after coalescing). */
  'hud:update': HudPayload;
  'device:status': { adapter: string; status: DeviceStatus; detail?: string };
  /** Performance signal from the frame profiler. */
  'perf:frame-drop': { avgMs: number; fps: number; worstMs: number };
};
