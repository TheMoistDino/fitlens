import { useCallback, useEffect, useRef, useState } from 'react';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { env } from '@/config/env';
import { sponsorBus } from '@/lib/sponsors';
import { captureKeyframe } from '@/services/camera/captureKeyframe';
import { sessionLog } from '@/features/dashboard/useSessionLog';
import { LM } from '@/ml/pose/geometry';
import type { PoseLandmarkerService } from '@/ml/pose/PoseLandmarkerService';
import { angleBetween, forearmProjectionAngle, jointAngle, signedHipOffset, sub, trunkAngleFromVertical, UP } from '../math/vector3';
import { RepEngine } from './RepEngine';
import { FormAnalyzer } from './FormAnalyzer';
import { CueDispatcher } from '../feedback/cues';
import type { FormCue, FormSnapshot, ExerciseProfile, PoseFrame, RepEngineSnapshot, RepPhase, SetSummary, Vec3, WeightUnit } from '../types';

/** Front view: both sides must be clearly visible to be averaged. */
const MIN_VISIBILITY_FRONT = 0.5;
/** Side view: only the near side is used; allow a bit lower confidence (pads/handles occlude joints). */
const MIN_VISIBILITY_SIDE = 0.35;
/** Only switch tracked side when the other side is clearly more visible (prevents frame-to-frame flips). */
const SIDE_SWITCH_MARGIN = 0.6;
/** After this long without a usable pose, smoothing resets so a stale angle can't complete a rep. */
const LOST_TRACKING_MS = 800;

type Side = 'left' | 'right';

const JOINTS = {
  elbow: { left: [LM.leftShoulder, LM.leftElbow, LM.leftWrist], right: [LM.rightShoulder, LM.rightElbow, LM.rightWrist] },
  knee: { left: [LM.leftHip, LM.leftKnee, LM.leftAnkle], right: [LM.rightHip, LM.rightKnee, LM.rightAnkle] },
} as const;

const BODY_LINE = {
  left: [LM.leftShoulder, LM.leftHip, LM.leftAnkle],
  right: [LM.rightShoulder, LM.rightHip, LM.rightAnkle],
} as const;

const vis = (frame: PoseFrame, i: number) => frame.image[i]?.visibility ?? 0;

/** Wrist confidence collapses when it crosses in front of the shoulder at the top of a curl. */
const MIN_WRIST_VISIBILITY_CURL = 0.1;

/** Front-view curl angle: needs shoulder + elbow solidly, tolerates a poorly-seen wrist. */
function forearmAngleAt(frame: PoseFrame, ids: readonly [number, number, number]): number | null {
  const [s, e, w] = ids;
  if (vis(frame, s) < MIN_VISIBILITY_FRONT || vis(frame, e) < MIN_VISIBILITY_FRONT || vis(frame, w) < MIN_WRIST_VISIBILITY_CURL) return null;
  const S = frame.image[s], E = frame.image[e], W = frame.image[w];
  if (!S || !E || !W) return null;
  const deg = forearmProjectionAngle(S, E, W, frame.aspect);
  return Number.isFinite(deg) ? deg : null;
}

function angleAt(frame: PoseFrame, ids: readonly [number, number, number], minVis: number): number | null {
  // Visibility lives on the image landmarks; geometry comes from metric world landmarks.
  if (ids.some((i) => vis(frame, i) < minVis)) return null;
  const [a, b, c] = ids;
  const A = frame.world[a], B = frame.world[b], C = frame.world[c];
  if (!A || !B || !C) return null;
  const deg = jointAngle(A, B, C);
  return Number.isFinite(deg) ? deg : null;
}

function sideScore(frame: PoseFrame, ids: readonly number[]): number {
  return ids.reduce((s, i) => s + vis(frame, i), 0);
}

/** Signed hip offset from the shoulder→ankle line in image space (side view); see signedHipOffset. */
function bodyLineOffset(frame: PoseFrame, ids: readonly [number, number, number]): number | null {
  if (ids.some((i) => vis(frame, i) < MIN_VISIBILITY_SIDE)) return null;
  const [s, h, a] = ids;
  const S = frame.image[s], H = frame.image[h], A = frame.image[a];
  if (!S || !H || !A) return null;
  const off = signedHipOffset(S, H, A, frame.aspect);
  return Number.isFinite(off) ? off : null;
}

/** Trunk angle from vertical: both-side midline in front view, near-side shoulder→hip in side view. */
function trunkAngle(frame: PoseFrame, side: Side | null): number {
  const w = frame.world;
  if (side) {
    const s = w[side === 'left' ? LM.leftShoulder : LM.rightShoulder];
    const h = w[side === 'left' ? LM.leftHip : LM.rightHip];
    return s && h ? angleBetween(sub(s, h), UP) : NaN;
  }
  const ls = w[LM.leftShoulder], rs = w[LM.rightShoulder], lh = w[LM.leftHip], rh = w[LM.rightHip];
  return ls && rs && lh && rh ? trunkAngleFromVertical(ls, rs, lh, rh) : NaN;
}

const toVec3 = (l: { x: number; y: number; z: number }): Vec3 => ({ x: l.x, y: l.y, z: l.z });

export interface TrackerUi {
  repCount: number;
  phase: RepPhase;
  cue: FormCue | null;
  partialReps: number;
}

/**
 * ACTIVE_SET pipeline. `processFrame` runs inside the camera loop; per-frame results go into refs
 * (`poseRef`, `formRef`, `repRef`) that the HUD canvas reads in its own rAF loop. React state only
 * changes on rep / phase / cue transitions — a handful of times per rep, never per frame.
 */
export function useFitnessTracker(pose: React.RefObject<PoseLandmarkerService | null>) {
  const poseRef = useRef<PoseFrame | null>(null);
  const formRef = useRef<FormSnapshot | null>(null);
  const repRef = useRef<RepEngineSnapshot | null>(null);
  const engineRef = useRef<RepEngine | null>(null);
  const formAnalyzerRef = useRef<FormAnalyzer | null>(null);
  const profileRef = useRef<ExerciseProfile | null>(null);
  const startedAtRef = useRef(0);
  const lastSeenRef = useRef(0);
  const cuesRef = useRef(new CueDispatcher());
  const lastAlertCodeRef = useRef<string | null>(null);
  const sideRef = useRef<Side>('left');
  const lastKeyframeRef = useRef(0);

  const [ui, setUi] = useState<TrackerUi>({ repCount: 0, phase: 'READY', cue: null, partialReps: 0 });

  useEffect(() => {
    const cues = cuesRef.current;
    return () => cues.dispose();
  }, []);

  const start = useCallback((profile: ExerciseProfile, t: number) => {
    profileRef.current = profile;
    engineRef.current = new RepEngine(profile);
    formAnalyzerRef.current = new FormAnalyzer(profile);
    startedAtRef.current = t;
    lastSeenRef.current = t;
    lastAlertCodeRef.current = null;
    lastKeyframeRef.current = t; // first coaching keyframe after one interval
    poseRef.current = null;
    cuesRef.current.unlock(); // called from the Start click → audio allowed
    setUi({ repCount: 0, phase: 'READY', cue: null, partialReps: 0 });
    sponsorBus.emit('workout:started', { exercise: profile.id });
  }, []);

  const processFrame = useCallback(
    (video: HTMLVideoElement, now: number) => {
      const engine = engineRef.current;
      const form = formAnalyzerRef.current;
      const profile = profileRef.current;
      const detected = pose.current?.detectWithWorld(video, now) ?? null;

      if (!detected) {
        poseRef.current = null;
        if (engine && now - lastSeenRef.current > LOST_TRACKING_MS) engine.resetSmoothing();
        return;
      }
      lastSeenRef.current = now;
      const frame: PoseFrame = {
        t: now,
        image: detected.image as NormalizedLandmark[],
        world: detected.world.map(toVec3),
        aspect: video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9,
      };
      poseRef.current = frame;
      if (!engine || !form || !profile) return;

      const joint = JOINTS[profile.joint];
      let left: number | null;
      let right: number | null;
      let primary: number | null;
      let trackedSide: Side | null = null;

      if (profile.cameraView === 'side') {
        // Side view: the far side is occluded and mostly hallucinated — use only the near side.
        const scoreL = sideScore(frame, joint.left), scoreR = sideScore(frame, joint.right);
        const current = sideRef.current;
        const other: Side = current === 'left' ? 'right' : 'left';
        if ((other === 'left' ? scoreL : scoreR) > (current === 'left' ? scoreL : scoreR) + SIDE_SWITCH_MARGIN) sideRef.current = other;
        trackedSide = sideRef.current;
        primary = angleAt(frame, joint[trackedSide], MIN_VISIBILITY_SIDE);
        left = trackedSide === 'left' ? primary : null;
        right = trackedSide === 'right' ? primary : null;
      } else if (profile.angleMethod === 'forearmProjection' && profile.joint === 'elbow') {
        left = forearmAngleAt(frame, JOINTS.elbow.left);
        right = forearmAngleAt(frame, JOINTS.elbow.right);
        primary = left !== null && right !== null ? (left + right) / 2 : (left ?? right);
      } else {
        left = angleAt(frame, joint.left, MIN_VISIBILITY_FRONT);
        right = angleAt(frame, joint.right, MIN_VISIBILITY_FRONT);
        primary = left !== null && right !== null ? (left + right) / 2 : (left ?? right);
      }
      if (primary === null) return;

      const lineSide: Side = trackedSide ?? (sideScore(frame, BODY_LINE.left) >= sideScore(frame, BODY_LINE.right) ? 'left' : 'right');
      const hipOffset = profile.checks.bodyLine ? bodyLineOffset(frame, BODY_LINE[lineSide]) : null;

      const events = engine.update(primary, now);
      const snap = form.update({
        t: now,
        trunkAngle: trunkAngle(frame, trackedSide),
        leftAngle: left,
        rightAngle: right,
        hipOffset,
        phase: engine.snapshot.phase,
      });

      // Cold path: one keyframe every few seconds → StepFun coaching (async, off the frame budget).
      if (now - lastKeyframeRef.current > env.stepfun.keyframeIntervalMs) {
        lastKeyframeRef.current = now;
        void captureKeyframe(video).then((image) => {
          if (image) sponsorBus.emit('keyframe:captured', { image, mode: 'pose', context: `exercise=${profile.name}` });
        });
      }

      let changed = false;
      for (const e of events) {
        if (e.type === 'phase') changed = true;
        if (e.type === 'rep') {
          e.rep.flags = [...new Set([...e.rep.flags, ...form.takeRepFlags()])];
          sponsorBus.emit('rep:completed', {
            exercise: profile.id,
            repCount: e.rep.index,
            calories: +(e.rep.index * profile.kcalPerRep).toFixed(2),
          });
          cuesRef.current.repBlip();
        }
        const cue = form.onRepEvent(e);
        if (cue) cuesRef.current.fire(cue, now);
      }

      // Instantaneous cues (torso, asymmetry) → haptic/audio + bus, on change only.
      const active = form.snapshot.active;
      if (active && (active.code === 'torso_swing' || active.code === 'torso_lean' || active.code === 'hip_sag' || active.code === 'hip_pike' || active.code === 'asymmetry')) {
        cuesRef.current.fire(active, now);
      }
      const code = active?.code ?? null;
      if (code !== lastAlertCodeRef.current) {
        lastAlertCodeRef.current = code;
        sponsorBus.emit('form:alert', active ? { code: active.code, message: active.message, severity: active.severity } : null);
        changed = true;
      }

      repRef.current = engine.snapshot;
      formRef.current = snap;
      if (changed) {
        const s = engine.snapshot;
        setUi({ repCount: s.repCount, phase: s.phase, cue: active, partialReps: s.partialReps });
      }
    },
    [pose],
  );

  /** Ends the set, publishes it (bus → glasses / Photon / Fetch.ai, local log) and returns the summary. */
  const finish = useCallback((load: { value: number; unit: WeightUnit } | null, t: number): SetSummary | null => {
    const engine = engineRef.current;
    const form = formAnalyzerRef.current;
    const profile = profileRef.current;
    if (!engine || !form || !profile) return null;

    const records = [...engine.repRecords];
    const n = records.length || 1;
    const mean = (f: (r: (typeof records)[number]) => number) => +(records.reduce((s, r) => s + f(r), 0) / n / 1000).toFixed(1);
    const summary: SetSummary = {
      id: crypto.randomUUID(),
      exercise: profile.id,
      load,
      reps: records.length,
      partialReps: engine.snapshot.partialReps,
      durationMs: Math.max(0, t - startedAtRef.current),
      meanRepSeconds: mean((r) => r.endedAt - r.startedAt),
      tempo: { eccentric: mean((r) => r.eccentricMs), pause: mean((r) => r.pauseMs), concentric: mean((r) => r.concentricMs) },
      formFlags: form.flagCounts,
      calories: +(records.length * profile.kcalPerRep).toFixed(2),
      repRecords: records,
      endedAt: Date.now(),
    };

    const alerts = Object.entries(summary.formFlags).map(([code]) => ({ code, message: code.replace(/_/g, ' '), severity: 'warn' as const }));
    const workout = {
      id: summary.id,
      exercise: profile.id,
      reps: summary.reps,
      calories: summary.calories,
      durationMs: summary.durationMs,
      alerts,
      endedAt: summary.endedAt,
      load: load ?? undefined,
    };
    sponsorBus.emit('form:alert', null);
    sponsorBus.emit('workout:ended', workout);
    sessionLog.add({ kind: 'workout', ...workout });

    engineRef.current = null;
    formAnalyzerRef.current = null;
    repRef.current = null;
    formRef.current = null;
    return summary;
  }, []);

  return { poseRef, formRef, repRef, ui, start, processFrame, finish, cues: cuesRef.current };
}
