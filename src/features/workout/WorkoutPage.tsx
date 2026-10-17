import { useCallback, useState } from 'react';
import { useCameraStream } from '@/services/camera/useCameraStream';
import { ArCanvas } from '@/ar/ArCanvas';
import { SkeletonOverlay } from '@/ar/SkeletonOverlay';
import { CameraViewport } from '@/ui/CameraViewport';
import { Badge, Button, Card } from '@/ui/primitives';
import { useBusEvent } from '@/app/hooks';
import type { ExerciseKind, SponsorEventMap } from '@/core/events/events';
import { useWorkoutSession } from './useWorkoutSession';
import { HudPanel } from './components/HudPanel';

const EXERCISES: { id: ExerciseKind; label: string }[] = [
  { id: 'squat', label: 'Squat' },
  { id: 'curl', label: 'Bicep curl' },
  { id: 'pushup', label: 'Push-up' },
];

export default function WorkoutPage() {
  const [facing] = useState<'user' | 'environment'>('user');
  const mirror = facing === 'user';
  const session = useWorkoutSession(mirror);
  const camera = useCameraStream({ facingMode: facing, onFrame: session.onFrame });
  const [coach, setCoach] = useState<SponsorEventMap['coach:feedback'] | null>(null);

  useBusEvent('coach:feedback', useCallback((fb: SponsorEventMap['coach:feedback']) => setCoach(fb), []));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Pose Form Coach</h1>
          <p className="text-sm text-neutral-400">On-device pose tracking · cloud coaching every few seconds</p>
        </div>
        <Badge tone={session.modelStatus === 'ready' ? 'good' : session.modelStatus === 'error' ? 'bad' : 'warn'}>
          Pose model: {session.modelStatus}
        </Badge>
      </header>

      <CameraViewport videoRef={camera.videoRef} status={camera.status} error={camera.error} mirror={mirror} onRetry={() => void camera.start()}>
        <ArCanvas>
          <SkeletonOverlay landmarksRef={session.landmarksRef} alertRef={session.alertRef} mirror={mirror} />
        </ArCanvas>
      </CameraViewport>

      {session.modelStatus === 'error' && (
        <p className="text-sm text-amber-300">Tracking unavailable on this device — the camera still works, and you can log workouts manually.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {EXERCISES.map((e) => (
          <Button key={e.id} variant={session.exercise === e.id ? 'primary' : 'secondary'} disabled={session.active} onClick={() => session.setExercise(e.id)}>
            {e.label}
          </Button>
        ))}
        <div className="ml-auto">
          {session.active ? (
            <Button variant="danger" onClick={session.end}>End set</Button>
          ) : (
            <Button onClick={session.start} disabled={camera.status !== 'streaming'}>Start set</Button>
          )}
        </div>
      </div>

      <Card title="Live HUD">
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
