import { useCallback, useEffect, useRef, useState } from 'react';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { sponsorBus } from '@/lib/sponsors';
import { sessionLog } from '@/features/dashboard/useSessionLog';
import { LM } from '@/ml/pose/geometry';
import type { PoseLandmarkerService } from '@/ml/pose/PoseLandmarkerService';
import { jointAngle, trunkAngleFromVertical } from '../math/vector3';
import { RepEngine } from './RepEngine';
import { FormAnalyzer } from './FormAnalyzer';
import { CueDispatcher } from '../feedback/cues';
import type { FormCue, FormSnapshot, MachineProfile, PoseFrame, RepEngineSnapshot, RepPhase, SetSummary, Vec3, WeightUnit } from '../types';

const MIN_VISIBILITY = 0.5;
/** After this long without a usable pose, smoothing resets so a stale angle can't complete a rep. */
const LOST_TRACKING_MS = 800;

const JOINTS = {
  elbow: { left: [LM.leftShoulder, LM.leftElbow, LM.leftWrist], right: [LM.rightShoulder, LM.rightElbow, LM.rightWrist] },
  knee: { left: [LM.leftHip, LM.leftKnee, LM.leftAnkle], right: [LM.rightHip, LM.rightKnee, LM.rightAnkle] },
} as const;

function sideAngle(frame: PoseFrame, ids: readonly [number, number, number]): number | null {
  const [a, b, c] = ids;
  // Visibility lives on the image landmarks; geometry comes from world landmarks.
  if (ids.some((i) => (frame.image[i]?.visibility ?? 0) < MIN_VISIBILITY)) return null;
  const A = frame.world[a], B = frame.world[b], C = frame.world[c];
  if (!A || !B || !C) return null;
  const deg = jointAngle(A, B, C);
  return Number.isFinite(deg) ? deg : null;
}

function trunkAngle(frame: PoseFrame): number {
  const w = frame.world;
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
  const profileRef = useRef<MachineProfile | null>(null);
  const startedAtRef = useRef(0);
  const lastSeenRef = useRef(0);
  const cuesRef = useRef(new CueDispatcher());
  const lastAlertCodeRef = useRef<string | null>(null);

  const [ui, setUi] = useState<TrackerUi>({ repCount: 0, phase: 'READY', cue: null, partialReps: 0 });

  useEffect(() => {
    const cues = cuesRef.current;
    return () => cues.dispose();
  }, []);

  const start = useCallback((profile: MachineProfile, t: number) => {
    profileRef.current = profile;
    engineRef.current = new RepEngine(profile);
    formAnalyzerRef.current = new FormAnalyzer(profile);
    startedAtRef.current = t;
    lastSeenRef.current = t;
    lastAlertCodeRef.current = null;
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
      const frame: PoseFrame = { t: now, image: detected.image as NormalizedLandmark[], world: detected.world.map(toVec3) };
      poseRef.current = frame;
      if (!engine || !form || !profile) return;

      const joint = JOINTS[profile.joint];
      const left = sideAngle(frame, joint.left);
      const right = sideAngle(frame, joint.right);
      const combined = left !== null && right !== null ? (left + right) / 2 : (left ?? right);
      if (combined === null) return;

      const events = engine.update(combined, now);
      const snap = form.update({ t: now, trunkAngle: trunkAngle(frame), leftAngle: left, rightAngle: right, phase: engine.snapshot.phase });

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
      if (active && (active.code === 'torso_swing' || active.code === 'asymmetry')) cuesRef.current.fire(active, now);
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
      machine: profile.id,
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
