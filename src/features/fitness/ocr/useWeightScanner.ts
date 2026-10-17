import { useCallback, useEffect, useRef, useState } from 'react';
import type { NormRect, OcrFrameResult, WeightUnit } from '../types';
import { WeightOcrService } from './WeightOcrService';
import { WeightLockSmoother, parseWeightText, type SmootherState } from './weightParser';
import { fitnessStore } from '../fitnessStateMachine';

/** Centre ROI where the user lines up the pinned plate number. */
export const WEIGHT_ROI: NormRect = { x: 0.3, y: 0.4, w: 0.4, h: 0.2 };
/** OCR cadence. Tesseract is the slowest stage; ~4 Hz keeps the 3-frame lock under a second. */
const OCR_INTERVAL_MS = 250;

/**
 * SCAN_WEIGHT pipeline. `processFrame` is called from the camera loop; it throttles itself and
 * skips while a read is in flight. `onLock` fires once per scan session when the smoother locks.
 */
export function useWeightScanner({
  enabled,
  unit,
  onLock,
}: {
  enabled: boolean;
  unit: WeightUnit;
  /** `epoch` is the FSM epoch when the winning OCR read *started* — lets the reducer drop stale locks. */
  onLock: (value: number, unit: WeightUnit, epoch: number) => void;
}) {
  const ocrRef = useRef<WeightOcrService | null>(null);
  const smootherRef = useRef(new WeightLockSmoother());
  const lastRunRef = useRef(0);
  const lastResultRef = useRef<OcrFrameResult | null>(null);
  const onLockRef = useRef(onLock);
  const unitRef = useRef(unit);
  const [status, setStatus] = useState<WeightOcrService['status']>('idle');
  const [progress, setProgress] = useState<SmootherState>(smootherRef.current.current);

  onLockRef.current = onLock;
  unitRef.current = unit;

  // Lazy-load the OCR worker only while scanning; keep it around for the next set.
  useEffect(() => {
    if (!enabled) return;
    smootherRef.current.reset();
    setProgress(smootherRef.current.current);
    const svc = (ocrRef.current ??= new WeightOcrService());
    if (svc.status === 'ready') {
      setStatus('ready');
      return;
    }
    setStatus('loading');
    svc.init().then(
      () => setStatus('ready'),
      (err: unknown) => {
        console.warn('[ocr] unavailable — manual weight entry only', err);
        setStatus('error');
      },
    );
  }, [enabled]);

  useEffect(() => () => void ocrRef.current?.dispose(), []);

  const processFrame = useCallback(
    (video: HTMLVideoElement, now: number) => {
      const svc = ocrRef.current;
      if (!enabled || !svc || svc.status !== 'ready' || svc.isBusy) return;
      if (now - lastRunRef.current < OCR_INTERVAL_MS) return;
      lastRunRef.current = now;
      const epoch = fitnessStore.snapshot.epoch;

      void svc.readRoi(video, WEIGHT_ROI).then((res) => {
        if (!res) return;
        const reading = parseWeightText(res.text, res.confidence, unitRef.current);
        lastResultRef.current = { t: now, rawText: res.text.trim(), reading };
        const wasLocked = !!smootherRef.current.current.locked;
        const state = smootherRef.current.push(reading);
        setProgress(state);
        if (state.locked && !wasLocked) onLockRef.current(state.locked.value, state.locked.unit, epoch);
      });
    },
    [enabled],
  );

  const rescan = useCallback(() => {
    fitnessStore.send({ type: 'WEIGHT_RESCAN' });
    smootherRef.current.reset();
    setProgress(smootherRef.current.current);
  }, []);

  return { status, progress, processFrame, rescan, lastResultRef };
}
