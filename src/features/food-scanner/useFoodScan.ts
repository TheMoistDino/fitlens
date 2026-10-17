import { useCallback, useEffect, useRef, useState } from 'react';
import type { MacroSummary } from '@/core/events/events';
import { sponsorBus } from '@/lib/sponsors';
import { ObjectDetectorService, type FoodBox } from '@/ml/food/ObjectDetectorService';
import { captureKeyframe } from '@/services/camera/captureKeyframe';
import type { FrameCallback } from '@/services/camera/useCameraStream';
import { sessionLog } from '@/features/dashboard/useSessionLog';

const ANALYZE_TIMEOUT_MS = 25_000;

/**
 * Food scanner pipeline:
 *  - hot path: local ObjectDetector → boxesRef (AR anchors), every other frame to save battery
 *  - cold path: on demand, one keyframe → `keyframe:captured` → StepFun → `macro:result`
 */
export function useFoodScan() {
  const detectorRef = useRef<ObjectDetectorService | null>(null);
  const boxesRef = useRef<FoodBox[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [detectorReady, setDetectorReady] = useState<boolean | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [macros, setMacros] = useState<MacroSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = new ObjectDetectorService();
    detectorRef.current = d;
    d.init().then(
      () => setDetectorReady(true),
      (err: unknown) => {
        console.warn('[food] detector unavailable — StepFun-only mode', err);
        setDetectorReady(false);
      },
    );
    return () => d.dispose();
  }, []);

  useEffect(
    () =>
      sponsorBus.on(
        'macro:result',
        (m) => {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          setMacros(m);
          setAnalyzing(false);
          setError(null);
        },
        { owner: 'ui:food' },
      ),
    [],
  );

  const onFrame = useCallback<FrameCallback>((video, { now, frameIndex }) => {
    videoRef.current = video;
    if (frameIndex % 2 === 0) boxesRef.current = detectorRef.current?.detect(video, now) ?? [];
  }, []);

  const analyze = useCallback(async () => {
    const video = videoRef.current;
    if (!video || analyzing) return;
    const image = await captureKeyframe(video, { maxSide: 768 });
    if (!image) return;
    setAnalyzing(true);
    setError(null);
    const labels = boxesRef.current.map((b) => b.label).join(', ');
    sponsorBus.emit('keyframe:captured', { image, mode: 'food', context: labels ? `local detector saw: ${labels}` : undefined });
    timeoutRef.current = setTimeout(() => {
      setAnalyzing(false);
      setError('Analysis timed out — check your connection and try again.');
    }, ANALYZE_TIMEOUT_MS);
  }, [analyzing]);

  const logMeal = useCallback(() => {
    if (!macros) return;
    sessionLog.add({ kind: 'meal', id: crypto.randomUUID(), endedAt: Date.now(), macros });
    setMacros(null);
  }, [macros]);

  useEffect(() => () => void (timeoutRef.current && clearTimeout(timeoutRef.current)), []);

  return { onFrame, boxesRef, detectorReady, analyzing, macros, error, analyze, logMeal };
}
