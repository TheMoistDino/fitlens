import { useCallback, useEffect, useRef, useState } from 'react';
import { useCameraStream, type FrameCallback } from '@/services/camera/useCameraStream';
import { CameraViewport } from '@/ui/CameraViewport';
import { Badge, Button, Card } from '@/ui/primitives';
import { useBusEvent } from '@/app/hooks';
import type { SponsorEventMap } from '@/core/events/events';
import { PoseLandmarkerService } from '@/ml/pose/PoseLandmarkerService';
import { BODYWEIGHT_LIST, BODYWEIGHT_PROFILES } from '@/features/fitness/exercises/exerciseProfiles';
import { useFitnessTracker } from '@/features/fitness/engine/useFitnessTracker';
import { FitnessHUD } from '@/features/fitness/components/FitnessHUD';
import { SetupHint } from '@/features/fitness/components/SetupHint';
import { SetSummaryCard } from '@/features/fitness/components/SetSummaryCard';
import type { BodyweightExercise, SetSummary } from '@/features/fitness/types';
import { HudPanel } from './components/HudPanel';

type Stage = 'setup' | 'active' | 'summary';

/**
 * Bodyweight sets (squat, push-up) on the same 3D rep engine + HUD as Gym Coach — no machine or
 * weight scan, just pick, position the phone, and go.
 */
export default function WorkoutPage() {
  const [exercise, setExercise] = useState<BodyweightExercise>('squat');
  const [stage, setStage] = useState<Stage>('setup');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [summary, setSummary] = useState<SetSummary | null>(null);
  const [coach, setCoach] = useState<SponsorEventMap['coach:feedback'] | null>(null);
  const profile = BODYWEIGHT_PROFILES[exercise];

  const poseServiceRef = useRef<PoseLandmarkerService | null>(null);
  const [poseStatus, setPoseStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    const svc = new PoseLandmarkerService();
    poseServiceRef.current = svc;
    svc.init().then(
      () => setPoseStatus('ready'),
      () => setPoseStatus('error'),
    );
    return () => svc.dispose();
  }, []);

  const tracker = useFitnessTracker(poseServiceRef);
  const activeRef = useRef(false);
  activeRef.current = stage === 'active';
  const trackRef = useRef(tracker.processFrame);
  trackRef.current = tracker.processFrame;
  const onFrame = useCallback<FrameCallback>((video, { now }) => {
    if (activeRef.current) trackRef.current(video, now);
  }, []);

  const camera = useCameraStream({ facingMode: 'user', onFrame });
  const mirror = camera.facingMode === 'user';

  useBusEvent('coach:feedback', useCallback((fb: SponsorEventMap['coach:feedback']) => setCoach(fb), []));

  const start = () => {
    const t = performance.now();
    tracker.start(profile, t);
    setStartedAt(t);
    setCoach(null);
    setStage('active');
  };

  const end = useCallback(() => {
    setSummary(tracker.finish(null, performance.now()));
    setStartedAt(null);
    setStage('summary');
  }, [tracker]);

  // Leaving mid-set still records it.
  const endRef = useRef(end);
  endRef.current = end;
  useEffect(() => () => void (activeRef.current && endRef.current()), []);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Bodyweight</h1>
          <p className="text-sm text-neutral-400">Live rep counting and form cues for squats and push-ups</p>
        </div>
        <Badge tone={poseStatus === 'ready' ? 'good' : poseStatus === 'error' ? 'bad' : 'warn'}>Pose: {poseStatus}</Badge>
      </header>

      <CameraViewport videoRef={camera.videoRef} status={camera.status} error={camera.error} mirror={mirror} onRetry={() => void camera.start()}>
        {stage === 'active' && (
          <FitnessHUD
            poseRef={tracker.poseRef}
            formRef={tracker.formRef}
            mirror={mirror}
            repCount={tracker.ui.repCount}
            phase={tracker.ui.phase}
            cue={tracker.ui.cue}
            load={null}
            startedAt={startedAt}
            machineName={profile.name}
          />
        )}
      </CameraViewport>

      {stage === 'setup' && (
        <Card title="Set up">
          <div className="mb-3 flex flex-wrap gap-2">
            {BODYWEIGHT_LIST.map((p) => (
              <Button key={p.id} variant={exercise === p.id ? 'primary' : 'secondary'} onClick={() => setExercise(p.id)}>
                {p.name}
              </Button>
            ))}
          </div>
          <SetupHint profile={profile} />
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={start} disabled={poseStatus !== 'ready' || camera.status !== 'streaming'}>Start set</Button>
            {poseStatus === 'error' && <span className="text-xs text-rose-300">Pose tracking unavailable on this device.</span>}
          </div>
        </Card>
      )}

      {stage === 'active' && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-neutral-400">
            {tracker.ui.partialReps > 0 ? `${tracker.ui.partialReps} partial rep(s) not counted` : profile.setupHint}
          </span>
          <Button variant="danger" onClick={end}>End set</Button>
        </div>
      )}

      {stage === 'summary' && (
        <>
          {summary && <SetSummaryCard summary={summary} />}
          <Button onClick={() => setStage('setup')}>New set</Button>
        </>
      )}

      <Card title="Live HUD (glasses mirror)">
        <HudPanel />
      </Card>

      {coach && (
        <Card title="Coach" action={<Badge>{coach.source}</Badge>}>
          <p className="text-sm text-neutral-200">{coach.text}</p>
        </Card>
      )}
    </div>
  );
}

