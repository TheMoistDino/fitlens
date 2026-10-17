/**
 * The app-wide event contract. Producers (camera/ML loop, pages) and consumers
 * (sponsor plugins, HUD) only ever agree on this file — never on each other.
 */

export type ExerciseKind = 'squat' | 'curl' | 'pushup';
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
  exercise?: ExerciseKind;
  calories?: number;
  formAlert?: FormAlert | null;
  macroSummary?: MacroSummary | null;
}

export interface WorkoutSummary {
  id: string;
  exercise: ExerciseKind;
  reps: number;
  durationMs: number;
  calories: number;
  alerts: FormAlert[];
  endedAt: number;
}

export type SponsorEventMap = {
  /** Fired on every rep completed (state change, not per-frame). */
  'rep:completed': { exercise: ExerciseKind; repCount: number; calories: number };
  /** Fired when the form classification changes (null = form OK again). */
  'form:alert': FormAlert | null;
  /** Low-frequency keyframe for cloud multimodal analysis. */
  'keyframe:captured': { image: Blob; mode: 'food' | 'pose'; context?: string };
  /** Result of a cloud food analysis. */
  'macro:result': MacroSummary;
  /** Free-form coaching text from cloud pose analysis. */
  'coach:feedback': { text: string; source: 'stepfun' | 'fetchai' | 'mock' };
  'workout:started': { exercise: ExerciseKind };
  'workout:ended': WorkoutSummary;
  /** Rolled-up HUD snapshot (emitted by the glasses plugin after coalescing). */
  'hud:update': HudPayload;
  'device:status': { adapter: string; status: DeviceStatus; detail?: string };
  /** Performance signal from the frame profiler. */
  'perf:frame-drop': { avgMs: number; fps: number; worstMs: number };
};
