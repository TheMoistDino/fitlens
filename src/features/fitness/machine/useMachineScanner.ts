import { useCallback, useEffect, useRef, useState } from 'react';
import { sponsorBus } from '@/lib/sponsors';
import { captureKeyframe } from '@/services/camera/captureKeyframe';
import { fitnessStore } from '../fitnessStateMachine';

/** Seconds between classification keyframes while SCAN_MACHINE is active. */
const SCAN_INTERVAL_MS = 2500;
const MIN_CONFIDENCE = 0.5;

/**
 * SCAN_MACHINE pipeline: every few seconds, ship one keyframe to StepFun (via the bus → stepfun plugin)
 * and feed the answer back into the FSM as MACHINE_DETECTED, stamped with the epoch the request was
 * made in. If the user moved on (confirmed, picked manually, reset) the stale answer is rejected by
 * the reducer instead of overwriting the current machine.
 */
export function useMachineScanner(enabled: boolean) {
  const lastSentRef = useRef(-Infinity);
  const nextIdRef = useRef(1);
  const pendingRef = useRef(new Map<number, number>()); // requestId → epoch
  const [scanning, setScanning] = useState(false);
  const [lastSource, setLastSource] = useState<'stepfun' | 'mock' | null>(null);

  useEffect(
    () =>
      sponsorBus.on(
        'machine:result',
        (res) => {
          if (res.requestId === undefined) return;
          const epoch = pendingRef.current.get(res.requestId);
          pendingRef.current.delete(res.requestId);
          if (epoch === undefined) return;
          setScanning(pendingRef.current.size > 0);
          setLastSource(res.source);
          if (res.machine === 'unknown' || res.confidence < MIN_CONFIDENCE) return;
          fitnessStore.send({ type: 'MACHINE_DETECTED', epoch, machine: res.machine, confidence: res.confidence, box: res.box ?? null });
        },
        { owner: 'fitness:machine' },
      ),
    [],
  );

  useEffect(() => {
    if (!enabled) {
      pendingRef.current.clear();
      setScanning(false);
      lastSentRef.current = -Infinity;
    }
  }, [enabled]);

  const processFrame = useCallback(
    (video: HTMLVideoElement, now: number) => {
      if (!enabled || now - lastSentRef.current < SCAN_INTERVAL_MS) return;
      lastSentRef.current = now;
      const requestId = nextIdRef.current++;
      const epoch = fitnessStore.snapshot.epoch;
      void captureKeyframe(video, { maxSide: 640 }).then((image) => {
        if (!image) return;
        pendingRef.current.set(requestId, epoch);
        setScanning(true);
        sponsorBus.emit('keyframe:captured', { image, mode: 'machine', requestId });
      });
    },
    [enabled],
  );

  return { processFrame, scanning, lastSource };
}
