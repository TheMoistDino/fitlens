import { useCallback, useEffect, useRef, useState } from 'react';
import { useCameraStream, type FrameCallback } from '@/services/camera/useCameraStream';
import { CameraViewport } from '@/ui/CameraViewport';
import { Badge, Button, Card } from '@/ui/primitives';
import { PoseLandmarkerService } from '@/ml/pose/PoseLandmarkerService';
import { fitnessStore, useFitnessState } from './fitnessStateMachine';
import { GYM_LIST, GYM_PROFILES } from './exercises/exerciseProfiles';
import { useMachineScanner } from './machine/useMachineScanner';
import { useWeightScanner, WEIGHT_ROI } from './ocr/useWeightScanner';
import { useFitnessTracker } from './engine/useFitnessTracker';
import { FitnessHUD } from './components/FitnessHUD';
import { MachinePipCard, MachineTarget } from './components/MachineScanOverlay';
import { WeightAdjuster, WeightRoiOverlay } from './components/WeightScanOverlay';
import { SetSummaryCard } from './components/SetSummaryCard';
import { SetupHint } from './components/SetupHint';
import type { FitnessMode, WeightUnit } from './types';

const MODE_LABEL: Record<FitnessMode, string> = {
  IDLE: 'Ready',
  SCAN_MACHINE: 'Scanning machine',
  SCAN_WEIGHT: 'Reading weight',
  ACTIVE_SET: 'Set in progress',
  SET_SUMMARY: 'Set complete',
};

/** Scans use the rear camera; the set itself faces the user (phone propped up in front of them). */
const facingFor = (mode: FitnessMode): 'user' | 'environment' => (mode === 'ACTIVE_SET' ? 'user' : 'environment');

export default function FitnessPage() {
  const state = useFitnessState();
  const { mode } = state;
  const profile = state.machine ? GYM_PROFILES[state.machine] : null;
  const [unit, setUnit] = useState<WeightUnit>('lb');

  // --- on-device pose model (shared by the tracker)
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

  // --- mode pipelines
  const machine = useMachineScanner(mode === 'SCAN_MACHINE');
  const weight = useWeightScanner({
    enabled: mode === 'SCAN_WEIGHT',
    unit,
    onLock: (value, u, epoch) => fitnessStore.send({ type: 'WEIGHT_LOCKED', epoch, value, unit: u }),
  });
  const tracker = useFitnessTracker(poseServiceRef);

  // One camera loop, routed by mode. Refs keep the callback stable so the stream never restarts.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const pipes = useRef({ machine: machine.processFrame, weight: weight.processFrame, track: tracker.processFrame });
  pipes.current = { machine: machine.processFrame, weight: weight.processFrame, track: tracker.processFrame };

  const onFrame = useCallback<FrameCallback>((video, { now }) => {
    switch (modeRef.current) {
      case 'SCAN_MACHINE':
        return pipes.current.machine(video, now);
      case 'SCAN_WEIGHT':
        return pipes.current.weight(video, now);
      case 'ACTIVE_SET':
        return pipes.current.track(video, now);
      default:
        return undefined;
    }
  }, []);

  const camera = useCameraStream({ facingMode: 'environment', onFrame });
  const mirror = camera.facingMode === 'user';

  // Switch cameras when the mode wants the other one (single-camera laptops simply keep theirs).
  const { switchCamera, facingMode, status: camStatus } = camera;
  useEffect(() => {
    if (camStatus === 'streaming' && facingMode !== facingFor(mode)) void switchCamera();
  }, [mode, facingMode, camStatus, switchCamera]);

  // --- actions
  const startSet = () => {
    if (!profile) return;
    const t = performance.now();
    if (fitnessStore.send({ type: 'START_SET', t })) tracker.start(profile, t);
  };
  const endSet = useCallback(() => {
    const summary = tracker.finish(fitnessStore.snapshot.load, performance.now());
    if (summary) fitnessStore.send({ type: 'END_SET', summary });
  }, [tracker]);

  // Leaving the page mid-set still records the set.
  const endSetRef = useRef(endSet);
  endSetRef.current = endSet;
  useEffect(() => () => void (fitnessStore.snapshot.mode === 'ACTIVE_SET' && endSetRef.current()), []);

  const load = state.load;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Gym Coach</h1>
          <p className="text-sm text-neutral-400">Scan a machine or dumbbells, lock the weight, and get live rep counting and form cues</p>
        </div>
        <div className="flex gap-2">
          <Badge tone={mode === 'ACTIVE_SET' ? 'good' : 'neutral'}>{MODE_LABEL[mode]}</Badge>
          <Badge tone={poseStatus === 'ready' ? 'good' : poseStatus === 'error' ? 'bad' : 'warn'}>Pose: {poseStatus}</Badge>
        </div>
      </header>

      <CameraViewport
        videoRef={camera.videoRef}
        status={camera.status}
        error={camera.error}
        mirror={mirror}
        onRetry={() => void camera.start()}
        className="relative mx-auto w-full h-[65vh] md:h-[calc(100dvh-16rem)] min-h-[380px] overflow-hidden rounded-2xl md:rounded-3xl bg-black shadow-2xl"
      >
        {mode === 'SCAN_MACHINE' && (
          <>
            <MachineTarget box={state.machineBox} detected={!!profile} scanning={machine.scanning} />
            {profile && (
              <MachinePipCard
                profile={profile}
                confidence={state.machineConfidence}
                source={machine.lastSource}
                onConfirm={() => fitnessStore.send({ type: 'CONFIRM_MACHINE' })}
                onPick={(m) => fitnessStore.send({ type: 'MACHINE_SELECTED', machine: m })}
              />
            )}
          </>
        )}
        {mode === 'SCAN_WEIGHT' && <WeightRoiOverlay roi={WEIGHT_ROI} progress={weight.progress} ocrStatus={weight.status} />}
        {mode === 'ACTIVE_SET' && profile && (
          <FitnessHUD
            poseRef={tracker.poseRef}
            formRef={tracker.formRef}
            mirror={mirror}
            repCount={tracker.ui.repCount}
            phase={tracker.ui.phase}
            cue={tracker.ui.cue}
            load={load}
            startedAt={state.setStartedAt}
            machineName={profile.name}
          />
        )}
      </CameraViewport>

      {/* ---- mode controls */}
      {mode === 'IDLE' && (
        <Card title="Start">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => fitnessStore.send({ type: 'START_MACHINE_SCAN' })}>Scan a machine</Button>
            {GYM_LIST.map((m) => (
              <Button key={m.id} variant="secondary" onClick={() => fitnessStore.send({ type: 'MACHINE_SELECTED', machine: m.id })}>
                {m.name}
              </Button>
            ))}
          </div>
        </Card>
      )}

      {mode === 'SCAN_MACHINE' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-neutral-400">Or pick it yourself:</span>
          {GYM_LIST.map((m) => (
            <Button key={m.id} variant="secondary" onClick={() => fitnessStore.send({ type: 'MACHINE_SELECTED', machine: m.id })}>
              {m.name}
            </Button>
          ))}
          <Button variant="ghost" onClick={() => fitnessStore.send({ type: 'RESET' })}>Cancel</Button>
        </div>
      )}

      {mode === 'SCAN_WEIGHT' && profile && (
        <Card title={`${profile.name} · weight`} action={<Button variant="ghost" onClick={() => fitnessStore.send({ type: 'CHANGE_MACHINE' })}>Change machine</Button>}>
          <WeightAdjuster
            value={load?.value ?? null}
            unit={load?.unit ?? unit}
            source={load?.source ?? null}
            onChange={(value) => fitnessStore.send({ type: 'WEIGHT_SET_MANUAL', value, unit: load?.unit ?? unit })}
            onUnitChange={(u) => {
              setUnit(u);
              weight.rescan();
              if (load) fitnessStore.send({ type: 'WEIGHT_SET_MANUAL', value: load.value, unit: u });
            }}
            onRescan={weight.rescan}
          />
          <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">Before you start — position the phone</p>
          <SetupHint profile={profile} />
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={startSet} disabled={poseStatus !== 'ready' || camera.status !== 'streaming'}>
              Start set
            </Button>
            {!load && <span className="text-xs text-neutral-500">No weight yet — you can start without one.</span>}
            {poseStatus === 'error' && <span className="text-xs text-rose-300">Pose tracking unavailable on this device.</span>}
          </div>
        </Card>
      )}

      {mode === 'ACTIVE_SET' && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-neutral-400">
            {tracker.ui.partialReps > 0 ? `${tracker.ui.partialReps} partial rep(s) not counted` : profile?.setupHint}
          </span>
          <Button variant="danger" onClick={endSet}>End set</Button>
        </div>
      )}

      {mode === 'SET_SUMMARY' && state.lastSummary && (
        <>
          <SetSummaryCard summary={state.lastSummary} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => fitnessStore.send({ type: 'NEXT_SET' })}>Next set</Button>
            <Button variant="secondary" onClick={() => fitnessStore.send({ type: 'CHANGE_MACHINE' })}>Different machine</Button>
            <Button variant="ghost" onClick={() => fitnessStore.send({ type: 'RESET' })}>Done</Button>
          </div>
        </>
      )}
    </div>
  );
}
