import { useCallback, useEffect, useRef, useState } from 'react';
import { env } from '@/config/env';
import type { ExerciseKind, FormAlert } from '@/core/events/events';
import { sponsorBus } from '@/lib/sponsors';
import { PoseLandmarkerService, type Landmarks } from '@/ml/pose/PoseLandmarkerService';
import { RepCounter } from '@/ml/pose/repCounter';
import { FormEvaluator } from '@/ml/pose/formRules';
import { captureKeyframe } from '@/services/camera/captureKeyframe';
import type { FrameCallback } from '@/services/camera/useCameraStream';
import { sessionLog } from '@/features/dashboard/useSessionLog';

export type ModelStatus = 'loading' | 'ready' | 'error';

/**
 * Owns the hot path for the Workout page:
 *   camera frame → MediaPipe pose → refs (for Three.js) → rep/form state machines → bus (on change only)
 * and the cold path trigger: one keyframe every N seconds → `keyframe:captured` → StepFun.
 */
export function useWorkoutSession(mirror: boolean) {
  const poseRef = useRef<PoseLandmarkerService | null>(null);
  const landmarksRef = useRef<Landmarks | null>(null);
  const alertRef = useRef(false);
  const repCounterRef = useRef<RepCounter | null>(null);
  const formRef = useRef<FormEvaluator | null>(null);
  const activeRef = useRef(false);
  const lastKeyframeRef = useRef(0);
  const alertsRef = useRef<FormAlert[]>([]);
  const startedAtRef = useRef(0);

  const [modelStatus, setModelStatus] = useState<ModelStatus>('loading');
  const [exercise, setExercise] = useState<ExerciseKind>('squat');
  const [active, setActive] = useState(false);

  // Load the model once; the page still works (camera only) if it fails.
  useEffect(() => {
    const svc = new PoseLandmarkerService();
    poseRef.current = svc;
    svc.init().then(
      () => setModelStatus('ready'),
      (err: unknown) => {
        console.error('[workout] pose model failed', err);
        setModelStatus('error');
      },
    );
    return () => svc.dispose();
  }, []);

  const onFrame = useCallback<FrameCallback>(
    (video, { now }) => {
      const lms = poseRef.current?.detect(video, now) ?? null;
      landmarksRef.current = lms;
      if (!lms || !activeRef.current) return;

      const rep = repCounterRef.current?.update(lms, now);
      if (rep?.repCompleted && repCounterRef.current) {
        sponsorBus.emit('rep:completed', { exercise: repCounterRef.current.exercise, repCount: rep.repCount, calories: rep.calories });
      }

      const change = formRef.current?.update(lms);
      if (change !== undefined) {
        alertRef.current = !!change;
        if (change) alertsRef.current.push(change);
        sponsorBus.emit('form:alert', change);
      }

      // Cold path: throttled keyframe for cloud coaching. Capture is async and off the critical path.
      if (now - lastKeyframeRef.current > env.stepfun.keyframeIntervalMs) {
        lastKeyframeRef.current = now;
        const ex = repCounterRef.current?.exercise;
        void captureKeyframe(video, { mirror }).then((image) => {
          if (image) sponsorBus.emit('keyframe:captured', { image, mode: 'pose', context: `exercise=${ex}` });
        });
      }
    },
    [mirror],
  );

  const start = useCallback(() => {
    repCounterRef.current = new RepCounter(exercise);
    formRef.current = new FormEvaluator(exercise);
    alertsRef.current = [];
    alertRef.current = false;
    startedAtRef.current = Date.now();
    lastKeyframeRef.current = performance.now(); // first keyframe after one interval
    activeRef.current = true;
    setActive(true);
    sponsorBus.emit('workout:started', { exercise });
  }, [exercise]);

  const end = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setActive(false);
    alertRef.current = false;
    const counter = repCounterRef.current;
    const summary = {
      id: crypto.randomUUID(),
      exercise,
      reps: counter?.count ?? 0,
      calories: counter?.calories ?? 0,
      durationMs: Date.now() - startedAtRef.current,
      alerts: alertsRef.current,
      endedAt: Date.now(),
    };
    sponsorBus.emit('form:alert', null);
    sponsorBus.emit('workout:ended', summary);
    sessionLog.add({ kind: 'workout', ...summary });
  }, [exercise]);

  // End the session if the user navigates away mid-set.
  useEffect(() => () => end(), [end]);

  return { onFrame, landmarksRef, alertRef, modelStatus, exercise, setExercise, active, start, end };
}
