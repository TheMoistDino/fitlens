/**
 * Fitness engine contracts: FSM states/events, per-frame payloads, rep + form metrics, set summary.
 * Pure types only, so every engine file (and the tests) can depend on this without pulling in React.
 */
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { MachineExercise, Severity, WeightUnit } from '@/core/events/events';

export type { MachineExercise, WeightUnit };

// ---------------------------------------------------------------- geometry

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Normalised [0..1] rectangle in video space. */
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------- frame payloads

/** One processed pose frame. Lives in a mutable ref; never stored in React state. */
export interface PoseFrame {
  /** performance.now() timestamp of the source frame. */
  t: number;
  /** Image-space landmarks (drawing). */
  image: NormalizedLandmark[];
  /** Metric, hip-centred landmarks (3D angle math). Falls back to image landmarks when absent. */
  world: Vec3[];
}

export interface WeightReading {
  value: number;
  unit: WeightUnit;
  /** Tesseract confidence 0..100. */
  confidence: number;
}

export interface OcrFrameResult {
  t: number;
  rawText: string;
  reading: WeightReading | null;
}

// ---------------------------------------------------------------- exercise profiles

export type JointName = 'elbow' | 'knee';
export type BoneGroup = 'torso' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';
export type BoneStatus = 'good' | 'warn' | 'bad';

/** 2D side-view stick figure for the reference loop (SVG units, 100×100 box). */
export interface StickPose {
  head: [number, number];
  shoulder: [number, number];
  elbow: [number, number];
  wrist: [number, number];
  hip: [number, number];
  knee: [number, number];
  ankle: [number, number];
}

export interface MachineProfile {
  id: MachineExercise;
  name: string;
  muscles: string;
  /** Joint whose angle drives rep counting. */
  joint: JointName;
  /** Angle (deg) at the start/rest position of a rep. */
  startAngle: number;
  /** Angle (deg) at the far end of the range of motion. */
  endAngle: number;
  /**
   * Which phase moves *away* from the start position. Chest press starts extended and lowers first
   * (ECCENTRIC); a lat pulldown starts extended and pulls first (CONCENTRIC).
   */
  firstPhase: 'ECCENTRIC' | 'CONCENTRIC';
  /** Cue when a rep turns around before reaching the far end. */
  shortAtEndCue: string;
  /** Cue when a rep restarts before returning fully to the start. */
  shortAtStartCue: string;
  /** Textbook tempo in seconds (reference loop + "too fast" checks). */
  tempo: { eccentric: number; pause: number; concentric: number };
  reference: { start: StickPose; end: StickPose };
  kcalPerRep: number;
}

// ---------------------------------------------------------------- rep + form metrics

export type RepPhase = 'READY' | 'ECCENTRIC' | 'INFLECTION' | 'CONCENTRIC' | 'REP_COMPLETED';

export interface RepRecord {
  index: number;
  startedAt: number;
  endedAt: number;
  eccentricMs: number;
  concentricMs: number;
  pauseMs: number;
  /** Fraction of target range actually covered (≥ 1 for a full rep). */
  rangeOfMotion: number;
  flags: FormFlagCode[];
}

export interface RepEngineSnapshot {
  phase: RepPhase;
  repCount: number;
  partialReps: number;
  /** Smoothed primary joint angle (deg). */
  angle: number;
  /** 0 at start position, 1 at the far end. */
  progress: number;
}

export type RepEngineEvent =
  | { type: 'phase'; phase: RepPhase; t: number }
  | { type: 'rep'; rep: RepRecord }
  | { type: 'partial'; at: 'start' | 'end'; t: number };

export type FormFlagCode = 'torso_swing' | 'asymmetry' | 'fast_eccentric' | 'short_rom_end' | 'short_rom_start' | 'lost_tracking';

export interface FormCue {
  code: FormFlagCode;
  message: string;
  severity: Severity;
}

export interface FormSnapshot {
  /** Trunk deviation from the set's baseline (deg). */
  torsoDeviation: number;
  /** |left − right| primary joint angle (deg), or null when one side isn't visible. */
  asymmetry: number | null;
  bones: Record<BoneGroup, BoneStatus>;
  /** The most severe active cue, if any. */
  active: FormCue | null;
}

// ---------------------------------------------------------------- set summary

export interface SetSummary {
  id: string;
  machine: MachineExercise;
  load: { value: number; unit: WeightUnit } | null;
  reps: number;
  partialReps: number;
  durationMs: number;
  /** Mean seconds per completed rep. */
  meanRepSeconds: number;
  /** Mean eccentric / pause / concentric seconds, e.g. 2.1-0.4-1.0. */
  tempo: { eccentric: number; pause: number; concentric: number };
  formFlags: Partial<Record<FormFlagCode, number>>;
  calories: number;
  repRecords: RepRecord[];
  endedAt: number;
}

// ---------------------------------------------------------------- state machine

export type FitnessMode = 'IDLE' | 'SCAN_MACHINE' | 'SCAN_WEIGHT' | 'ACTIVE_SET' | 'SET_SUMMARY';

export interface FitnessContext {
  mode: FitnessMode;
  /**
   * Bumped on every accepted transition. Async producers (machine classifier, OCR) stamp their
   * events with the epoch they started in; events from an older epoch are dropped.
   */
  epoch: number;
  machine: MachineExercise | null;
  machineBox: NormRect | null;
  machineConfidence: number;
  load: { value: number; unit: WeightUnit; source: 'ocr' | 'manual' } | null;
  setStartedAt: number | null;
  lastSummary: SetSummary | null;
}

export type FitnessEvent =
  | { type: 'START_MACHINE_SCAN' }
  | { type: 'MACHINE_DETECTED'; epoch: number; machine: MachineExercise; confidence: number; box: NormRect | null }
  | { type: 'MACHINE_SELECTED'; machine: MachineExercise }
  | { type: 'CONFIRM_MACHINE' }
  | { type: 'WEIGHT_LOCKED'; epoch: number; value: number; unit: WeightUnit }
  | { type: 'WEIGHT_SET_MANUAL'; value: number; unit: WeightUnit }
  /** Clear the load (including a manual one) so the next OCR lock is accepted. */
  | { type: 'WEIGHT_RESCAN' }
  | { type: 'START_SET'; t: number }
  | { type: 'END_SET'; summary: SetSummary }
  | { type: 'NEXT_SET' }
  | { type: 'CHANGE_MACHINE' }
  | { type: 'RESET' };
