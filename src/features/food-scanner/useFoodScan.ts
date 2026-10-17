import { useCallback, useEffect, useRef, useState } from 'react';
import type { MacroSummary } from '@/core/events/events';
import { useFoodLogStore } from './store';
import type { FrameCallback } from '@/services/camera/useCameraStream';
import {
  FoodDetectionService,
  FrameSampler,
  StepFunFoodAdapter,
  foodScannerBus,
  type BoundingBox2D,
  type DetectedFoodItem,
  type StepFunFoodItem,
} from './services';

const ANALYZE_TIMEOUT_MS = 25_000;

export interface UseFoodScanOptions {
  autoSampleOnStability?: boolean;
}

/**
 * useFoodScan hook coordinates the dual-frequency Food Scanner Vision Pipeline:
 *  - 60 FPS hot path: FoodDetectionService runs on-device MediaPipe inference,
 *    updating boxesRef and 3D spatial coordinates without triggering React renders.
 *  - 0.2–0.5 FPS cold path: FrameSampler evaluates motion stability vectors,
 *    triggering StepFun multimodal nutrition estimation via StepFunFoodAdapter.
 */
export function useFoodScan(options: UseFoodScanOptions = {}) {
  const { autoSampleOnStability = false } = options;

  const detectorRef = useRef<FoodDetectionService | null>(null);
  const samplerRef = useRef<FrameSampler>(new FrameSampler());
  const adapterRef = useRef<StepFunFoodAdapter>(new StepFunFoodAdapter());

  const boxesRef = useRef<DetectedFoodItem[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [detectorReady, setDetectorReady] = useState<boolean | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [macros, setMacros] = useState<MacroSummary | null>(null);
  const [detailedItems, setDetailedItems] = useState<StepFunFoodItem[]>([]);
  const [stabilityDetected, setStabilityDetected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize FoodDetectionService
  useEffect(() => {
    const service = new FoodDetectionService();
    detectorRef.current = service;

    service.init().then(
      () => setDetectorReady(true),
      (err: unknown) => {
        console.warn('[FoodScanner] Local detector unavailable — cloud-only fallback', err);
        setDetectorReady(false);
      },
    );

    return () => service.dispose();
  }, []);

  // Listen to FoodScannerBus state transitions
  useEffect(() => {
    const offNutrition = foodScannerBus.on(
      'NUTRITION_ESTIMATED',
      ({ items, macroSummary }) => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setMacros(macroSummary);
        setDetailedItems(items);
        setAnalyzing(false);
        setError(null);
      },
      { owner: 'ui:food-scanner' },
    );

    const offFailed = foodScannerBus.on(
      'NUTRITION_FAILED',
      ({ error: errMsg }) => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setAnalyzing(false);
        setError(errMsg);
      },
      { owner: 'ui:food-scanner' },
    );

    return () => {
      offNutrition();
      offFailed();
    };
  }, []);

  // Hot path: runs per frame at 30–60 FPS
  const onFrame = useCallback<FrameCallback>(
    (video, { now, frameIndex }) => {
      videoRef.current = video;

      // Run local detector on alternating frames to balance FPS and power efficiency
      if (frameIndex % 2 === 0 && detectorRef.current?.ready) {
        const viewport = {
          width: video.clientWidth || video.videoWidth || 640,
          height: video.clientHeight || video.videoHeight || 480,
        };
        const detected = detectorRef.current.detect(video, now, viewport, false);
        boxesRef.current = detected;

        // Dual-frequency stability detection
        const primaryBox = detected[0]?.box2d ?? null;
        const trigger = samplerRef.current.shouldSample(primaryBox, now);

        if (trigger === 'stability') {
          setStabilityDetected(true);
          if (autoSampleOnStability && !analyzing) {
            void triggerScan(primaryBox, 'stability');
          }
        } else if (trigger === null) {
          setStabilityDetected(false);
        }
      }
    },
    [analyzing, autoSampleOnStability],
  );

  // Cold path: StepFun multimodal cloud analysis
  const triggerScan = useCallback(
    async (targetBox: BoundingBox2D | null = boxesRef.current[0]?.box2d ?? null, reason: 'stability' | 'interval' | 'manual' = 'manual') => {
      const video = videoRef.current;
      if (!video || analyzing) return;

      const sample = await samplerRef.current.extractKeyframe(video, targetBox, reason);
      if (!sample) return;

      setAnalyzing(true);
      setError(null);

      const labels = boxesRef.current.map((b) => b.label).join(', ');
      const context = labels ? `Detected items: ${labels}` : undefined;

      timeoutRef.current = setTimeout(() => {
        setAnalyzing(false);
        setError('Analysis timed out. Please check your connection.');
      }, ANALYZE_TIMEOUT_MS);

      await adapterRef.current.estimateNutrition(sample.dataUrl, context);
    },
    [analyzing],
  );

  const analyze = useCallback(() => triggerScan(boxesRef.current[0]?.box2d ?? null, 'manual'), [triggerScan]);

  const logMeal = useCallback(() => {
    if (!macros) return;
    const totals = macros.items.reduce(
      (acc, item) => ({
        p: acc.p + (item.protein || 0),
        c: acc.c + (item.carbs || 0),
        f: acc.f + (item.fat || 0),
      }),
      { p: 0, c: 0, f: 0 },
    );

    const mealName = macros.items.map((i) => i.name).filter(Boolean).join(', ') || 'Plate Meal';
    const primaryItem = detailedItems[0];

    useFoodLogStore.getState().addMeal({
      name: mealName,
      calories: macros.totalKcal,
      protein: totals.p,
      carbs: totals.c,
      fat: totals.f,
      weightGrams: primaryItem?.estimatedWeightGrams,
      confidence: primaryItem?.confidenceScore,
      source: macros.source === 'stepfun' ? 'stepfun' : 'mock',
    });

    setMacros(null);
    setDetailedItems([]);
  }, [macros, detailedItems]);

  useEffect(() => () => void (timeoutRef.current && clearTimeout(timeoutRef.current)), []);

  return {
    onFrame,
    boxesRef,
    detectorReady,
    analyzing,
    macros,
    detailedItems,
    stabilityDetected,
    error,
    analyze,
    logMeal,
  };
}
