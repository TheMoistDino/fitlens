import * as Sentry from '@sentry/react';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '@/app/providers';
import type { MacroItem, MacroSummary } from '@/core/events/events';
import { sessionLog } from '@/features/dashboard/useSessionLog';
import { FoodOverlayCanvas, FoodTooltipCard, FoodImageUploader } from '@/features/food-scanner/components';
import {
  FoodDetectionService,
  FrameSampler,
  StepFunFoodAdapter,
  foodScannerBus,
  isLiquidContainer,
  BEVERAGE_PRESETS,
  generateCanWebSearchUrl,
  type BoundingBox2D,
  type DetectedFoodItem,
  type MealLoggedPayload,
  type StepFunFoodItem,
  type ProcessedImageResult,
  type VisualAnalysisResult,
} from '@/features/food-scanner/services';
import { useFoodLogStore, useNutritionHUD } from '@/features/food-scanner/store';
import { sponsorBus } from '@/lib/sponsors/SponsorEventBus';
import { glassesController } from '@/lib/sponsors/smart-glasses/glassesPlugin';
import { useCameraStream, type FrameCallback } from '@/services/camera/useCameraStream';
import { CameraViewport } from '@/ui/CameraViewport';
import { Badge, Button, Card, StatPill } from '@/ui/primitives';

const ANALYZE_TIMEOUT_MS = 20_000;
const RATE_LIMIT_COOLDOWN_MS = 15_000;
const LOW_LIGHT_LUMINANCE_THRESHOLD = 32; // [0..255]

interface AdjustedNutritionValues {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  weight: number;
  confidence: number;
  isCloudVerified: boolean;
}

interface ManualAdjustState {
  item: DetectedFoodItem;
  nutrition: AdjustedNutritionValues;
}

/**
 * Cross-version Sentry performance transaction / span telemetry helper.
 * Supports Sentry.startTransaction if polyfilled/configured, and falls back to Sentry.startSpan.
 */
export async function trackTelemetryMetric<T>(
  name: string,
  op: string,
  tags: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  const startTime = performance.now();
  const sentryObj = Sentry as unknown as {
    startTransaction?: (ctx: { name: string; op: string; tags?: Record<string, unknown> }) => {
      finish: () => void;
      setTag: (k: string, v: unknown) => void;
    };
  };

  if (typeof sentryObj.startTransaction === 'function') {
    const tx = sentryObj.startTransaction({ name, op, tags });
    try {
      const result = await fn();
      tx.setTag('duration_ms', performance.now() - startTime);
      tx.finish();
      return result;
    } catch (err) {
      tx.setTag('error', true);
      tx.finish();
      throw err;
    }
  }

  return Sentry.startSpan(
    {
      name,
      op,
      attributes: {
        ...tags,
        'telemetry.provider': 'fitlens.webar',
      },
    },
    async (span) => {
      try {
        const result = await fn();
        span.setAttribute('duration_ms', performance.now() - startTime);
        return result;
      } catch (err) {
        span.setAttribute('error', true);
        throw err;
      }
    },
  );
}

/**
 * FoodScannerRoute
 *
 * Senior WebAR Computer Vision Architecture:
 * - Dual-Frequency State Pattern:
 *   - 60 FPS hot path: On-device MediaPipe ObjectDetector via FoodDetectionService,
 *     mutating boxesRef directly and projecting 3D spatial coordinates into WebGL
 *     without triggering costly React component re-renders.
 *   - 0.2–0.5 FPS cold path: Optical motion stability tracking via FrameSampler,
 *     triggering StepFun `step-5-preview` multimodal cloud analysis asynchronously.
 * - Defensive Engineering & Graceful Degradation:
 *   - Permission denials: Comprehensive contextual recovery UI with retry controls.
 *   - Offline resilience: Automatic switch to local heuristics with offline indicator.
 *   - Low-light detection: Sub-sampled frame luminance monitoring to warn of dark scenes.
 *   - Rate limiting: Defensive 15s backoff cooldown upon HTTP 429 with local fallbacks.
 *   - Manual fallback input: When cloud estimation fails or confidence < 0.60,
 *     users can fine-tune nutrients and commit directly.
 * - End-to-End Sponsor Telemetry:
 *   - Dispatches logged meal data synchronously to both the local React dashboard
 *     store (useFoodLogStore / sessionLog) and the active SmartGlassesAdapter.
 */
export default function FoodScannerRoute() {
  const toast = useToast();
  const [, startTransition] = useTransition();

  // Core Service Singletons (Stable references across renders)
  const detectorRef = useRef<FoodDetectionService | null>(null);
  const samplerRef = useRef<FrameSampler>(new FrameSampler({ cooldownMs: 2000, intervalMs: 2500 }));
  const adapterRef = useRef<StepFunFoodAdapter>(new StepFunFoodAdapter());
  const boxesRef = useRef<DetectedFoodItem[]>([]);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const luminanceCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Vision Pipeline State
  const [detectorReady, setDetectorReady] = useState<boolean | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [macros, setMacros] = useState<MacroSummary | null>(null);
  const [detailedItems, setDetailedItems] = useState<StepFunFoodItem[]>([]);
  const [stabilityDetected, setStabilityDetected] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const initialMode = searchParams.get('mode') === 'upload' ? 'upload' : 'camera';
  const [activeMode, setActiveMode] = useState<'camera' | 'upload'>(initialMode);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [uploadedVisuals, setUploadedVisuals] = useState<VisualAnalysisResult | null>(null);

  // Camera Stream Mode & Review State (R3)
  const [streamMode, setStreamMode] = useState<'live' | 'review'>('live');
  const [frozenFrame, setFrozenFrame] = useState<string | null>(null);
  const [frozenBoxes, setFrozenBoxes] = useState<DetectedFoodItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const streamModeRef = useRef<'live' | 'review'>('live');
  streamModeRef.current = streamMode;

  // Real-time Daily Nutrition Log & Goals (Accessible below viewport)
  const {
    todayLogs,
    dailyGoals,
    totals: dailyTotals,
    remaining: dailyRemaining,
    removeMeal,
  } = useNutritionHUD();

  // Video aspect ratio tracking for object-cover Three.js alignment
  const [videoAspect, setVideoAspect] = useState<number>(16 / 9);
  const videoAspectRef = useRef<number>(16 / 9);

  // Defensive Degradation States
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [isLowLight, setIsLowLight] = useState(false);
  const [rateLimitCooldown, setRateLimitCooldown] = useState<number | null>(null);
  const [manualAdjustModal, setManualAdjustModal] = useState<ManualAdjustState | null>(null);

  // Initialize on-device MediaPipe ObjectDetector (WASM / WebGL)
  useEffect(() => {
    const service = new FoodDetectionService();
    detectorRef.current = service;

    service.init().then(
      () => setDetectorReady(true),
      (err: unknown) => {
        console.warn('[FoodScannerRoute] Local detector unavailable — cloud/heuristic fallback active', err);
        setDetectorReady(false);
      },
    );

    return () => {
      service.dispose();
      detectorRef.current = null;
    };
  }, []);

  // Monitor network connectivity for graceful degradation
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast('Network connected. Cloud AI analysis restored.', 'info');
    };
    const handleOffline = () => {
      setIsOnline(false);
      toast('Network offline. Switching to local food estimation heuristics.', 'warn');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [toast]);

  // Rate limit cooldown countdown timer
  useEffect(() => {
    if (rateLimitCooldown === null || rateLimitCooldown <= 0) return;
    const timer = setInterval(() => {
      setRateLimitCooldown((prev) => {
        if (prev === null || prev <= 1) return null;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [rateLimitCooldown]);

  // Listen to FoodScannerBus state transitions
  useEffect(() => {
    const offNutrition = foodScannerBus.on(
      'NUTRITION_ESTIMATED',
      ({ items, macroSummary }) => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        startTransition(() => {
          setMacros(macroSummary);
          setDetailedItems(items);
          setAnalyzing(false);
          setScanError(null);
        });
      },
      { owner: 'route:food-scanner' },
    );

    const offFailed = foodScannerBus.on(
      'NUTRITION_FAILED',
      ({ error: errMsg }) => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        startTransition(() => {
          setAnalyzing(false);
          setScanError(errMsg);
        });
      },
      { owner: 'route:food-scanner' },
    );

    return () => {
      offNutrition();
      offFailed();
    };
  }, []);

  // Measures frame luminance (downsampled 8x8 buffer) to detect low-light scenes
  const measureFrameLuminance = useCallback((video: HTMLVideoElement): number => {
    try {
      if (!luminanceCanvasRef.current) {
        luminanceCanvasRef.current = document.createElement('canvas');
        luminanceCanvasRef.current.width = 8;
        luminanceCanvasRef.current.height = 8;
      }
      const canvas = luminanceCanvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx || video.videoWidth === 0 || video.videoHeight === 0) return 128;

      ctx.drawImage(video, 0, 0, 8, 8);
      const imgData = ctx.getImageData(0, 0, 8, 8).data;
      let totalLuminance = 0;
      const pixelCount = 64;

      for (let i = 0; i < imgData.length; i += 4) {
        const r = imgData[i] ?? 0;
        const g = imgData[i + 1] ?? 0;
        const b = imgData[i + 2] ?? 0;
        // Standard Rec. 601 perceptual luminance formula
        totalLuminance += 0.299 * r + 0.587 * g + 0.114 * b;
      }

      return totalLuminance / pixelCount;
    } catch {
      return 128; // Defensive fallback if canvas security or context fails
    }
  }, []);

  // Cold path: Multimodal StepFun AI Estimation
  const triggerCloudScan = useCallback(
    async (
      targetBox: BoundingBox2D | null = boxesRef.current[0]?.box2d ?? null,
      reason: 'stability' | 'interval' | 'manual' = 'manual',
    ) => {
      const video = videoElementRef.current;
      if (!video || analyzing) return;

      // Check rate limit cooldown
      if (rateLimitCooldown !== null && rateLimitCooldown > 0) {
        toast(`Cloud AI rate limited. Cooldown active for ${rateLimitCooldown}s.`, 'warn');
        return;
      }

      const sample = await samplerRef.current.extractKeyframe(video, targetBox, reason);
      if (!sample) return;

      setAnalyzing(true);
      setScanError(null);

      const labels = boxesRef.current.map((b) => b.label).join(', ');
      const context = labels ? `Detected items: ${labels}` : undefined;

      timeoutRef.current = setTimeout(() => {
        setAnalyzing(false);
        setScanError('Analysis timed out. Displaying local heuristic fallback.');
      }, ANALYZE_TIMEOUT_MS);

      await trackTelemetryMetric(
        'food_scanner.multimodal_analyze',
        'ai.multimodal.inference',
        {
          'ai.model': 'step-5-preview',
          'ai.trigger_reason': reason,
          'device.online': isOnline,
        },
        async () => {
          try {
            const result = await adapterRef.current.estimateNutrition(sample.dataUrl, context);
            if (!result.ok) {
              const errMsg = result.error.message.toLowerCase();
              if (errMsg.includes('429') || errMsg.includes('rate limit')) {
                setRateLimitCooldown(RATE_LIMIT_COOLDOWN_MS / 1000);
                toast('StepFun API rate limit reached. Backing off for 15s.', 'warn');
              }
            }
          } catch (err) {
            console.error('[FoodScannerRoute] Cloud estimation error:', err);
          }
        },
      );
    },
    [analyzing, isOnline, rateLimitCooldown, toast],
  );

  // Cold path: Multimodal StepFun AI Nutrition Estimation for Uploaded Photos
  const triggerImageUploadScan = useCallback(
    async (imageDataUrl: string, processedResult?: ProcessedImageResult) => {
      if (analyzing) return;

      if (rateLimitCooldown !== null && rateLimitCooldown > 0) {
        toast(`Cloud AI rate limited. Cooldown active for ${rateLimitCooldown}s.`, 'warn');
        return;
      }

      setAnalyzing(true);
      setScanError(null);

      // Run on-device detector on the uploaded image element if available
      let detectedLabels = '';
      if (processedResult?.imageElement && detectorRef.current?.ready) {
        try {
          const detected = detectorRef.current.detect(
            processedResult.imageElement,
            Date.now(),
            { width: processedResult.width, height: processedResult.height },
            false,
          );
          boxesRef.current = detected;
          detectedLabels = detected.map((b) => b.label).join(', ');
        } catch (err) {
          console.warn('[FoodScannerRoute] On-device image detection dropped:', err);
        }
      }

      // Build rich context from detected labels, can text, and visual cues
      const contextParts: string[] = [];
      if (detectedLabels) {
        contextParts.push(`Detected items: ${detectedLabels}`);
      }
      if (processedResult?.visuals) {
        setUploadedVisuals(processedResult.visuals);
        const { detectedText, isLightLiquid, isCanLike, detectedCategoryHint } = processedResult.visuals;
        if (detectedText) {
          contextParts.push(`Can label text reads: "${detectedText}"`);
        }
        if (isLightLiquid) {
          contextParts.push(`Visual appearance: White creamy liquid in container (milk/dairy)`);
        }
        if (isCanLike) {
          contextParts.push(`Container appearance: Tall cylindrical can or bottle`);
        }
        if (detectedCategoryHint && detectedCategoryHint !== 'meal') {
          contextParts.push(`Category hint: ${detectedCategoryHint}`);
        }
      }

      const context =
        contextParts.length > 0
          ? contextParts.join('. ')
          : 'Uploaded food photo. Identify food items, portion weights, calories, and macros.';

      timeoutRef.current = setTimeout(() => {
        setAnalyzing(false);
        setScanError('Analysis timed out. Displaying local heuristic fallback.');
      }, ANALYZE_TIMEOUT_MS);

      await trackTelemetryMetric(
        'food_scanner.upload_analyze',
        'ai.multimodal.inference',
        {
          'ai.model': 'step-5-preview',
          'ai.trigger_reason': 'upload',
          'device.online': isOnline,
        },
        async () => {
          try {
            const result = await adapterRef.current.estimateNutrition(
              imageDataUrl,
              context,
            );
            if (!result.ok) {
              const errMsg = result.error.message.toLowerCase();
              if (errMsg.includes('429') || errMsg.includes('rate limit')) {
                setRateLimitCooldown(RATE_LIMIT_COOLDOWN_MS / 1000);
                toast('StepFun API rate limit reached. Backing off for 15s.', 'warn');
              }
            }
          } catch (err) {
            console.error('[FoodScannerRoute] Upload estimation error:', err);
          }
        },
      );
    },
    [analyzing, isOnline, rateLimitCooldown, toast],
  );

  // Hot path: Runs per camera frame at 30–60 FPS
  const onFrame = useCallback<FrameCallback>(
    (video, { now, frameIndex }) => {
      videoElementRef.current = video;

      // Track video aspect ratio for object-cover Three.js alignment
      if (video.videoWidth && video.videoHeight) {
        const currentAspect = video.videoWidth / video.videoHeight;
        if (Math.abs(currentAspect - videoAspectRef.current) > 0.01) {
          videoAspectRef.current = currentAspect;
          setVideoAspect(currentAspect);
        }
      }

      // In review mode, suspend MediaPipe inference and luminance sampling
      if (streamModeRef.current === 'review') {
        return;
      }

      // Sample luminance every ~60 frames (approx. once per second)
      if (frameIndex % 60 === 0) {
        const luminance = measureFrameLuminance(video);
        setIsLowLight(luminance < LOW_LIGHT_LUMINANCE_THRESHOLD);
      }

      // Alternate frames for MediaPipe local inference to balance power & thermal budget
      if (frameIndex % 2 === 0 && detectorRef.current?.ready) {
        const viewport = {
          width: video.clientWidth || video.videoWidth || 640,
          height: video.clientHeight || video.videoHeight || 480,
        };

        const detected = detectorRef.current.detect(video, now, viewport, false);
        boxesRef.current = detected;

        // Optical stability evaluation (FrameSampler)
        const primaryBox = detected[0]?.box2d ?? null;
        const trigger = samplerRef.current.shouldSample(primaryBox, now);

        if (trigger === 'stability') {
          setStabilityDetected(true);
          if (!analyzing && isOnline && rateLimitCooldown === null) {
            void triggerCloudScan(primaryBox, 'stability');
          }
        } else if (trigger === null) {
          setStabilityDetected(false);
        }
      }
    },
    [analyzing, isOnline, measureFrameLuminance, rateLimitCooldown, triggerCloudScan],
  );

  // Initialize camera stream (only autoStarts if in camera mode)
  const camera = useCameraStream({
    facingMode: 'environment',
    onFrame,
    autoStart: initialMode === 'camera',
  });

  // Mode switcher handler with camera resource management
  const handleSwitchMode = useCallback(
    (newMode: 'camera' | 'upload') => {
      setActiveMode(newMode);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (newMode === 'upload') {
            next.set('mode', 'upload');
          } else {
            next.delete('mode');
          }
          return next;
        },
        { replace: true },
      );

      if (newMode === 'upload') {
        camera.stop();
      } else {
        void camera.start();
      }
    },
    [camera, setSearchParams],
  );

  // Sync mode state if URL search params change externally
  useEffect(() => {
    const modeParam = searchParams.get('mode');
    if (modeParam === 'upload' && activeMode !== 'upload') {
      setActiveMode('upload');
      camera.stop();
    } else if (modeParam !== 'upload' && activeMode !== 'camera') {
      setActiveMode('camera');
      void camera.start();
    }
  }, [searchParams, activeMode, camera]);

  const mirror = camera.facingMode === 'user';
  const totals = macros?.items.reduce(
    (t, i) => ({ p: t.p + i.protein, c: t.c + i.carbs, f: t.f + i.fat }),
    { p: 0, c: 0, f: 0 },
  );

  // Freeze camera feed and snapshot frame for review mode (R3)
  const handleTakeImageAndInspect = useCallback(() => {
    const video = videoElementRef.current;
    if (!video || !video.videoWidth) {
      toast('Camera feed not ready to capture', 'warn');
      return;
    }

    // 1. Snapshot video frame to HTML5 canvas Data URL
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      if (mirror) {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frameUrl = canvas.toDataURL('image/jpeg', 0.92);
      setFrozenFrame(frameUrl);
    }

    // 2. Snapshot current detected boxes
    const currentDetections = [...boxesRef.current];
    setFrozenBoxes(currentDetections);

    // 3. Pause video playback (freezes video without stopping MediaStream tracks)
    try {
      video.pause();
    } catch (err) {
      console.warn('[FoodScannerRoute] Video pause error:', err);
    }

    // 4. Enter review mode
    setStreamMode('review');

    // 5. Auto-select first item if detected so inspection options are immediately available
    if (currentDetections.length > 0 && currentDetections[0]) {
      setSelectedItemId(currentDetections[0].id);
    }

    toast('Live feed paused. Tap any food item to inspect or customize fillings.', 'info');
  }, [mirror, toast]);

  // Resume continuous live scanning (R3)
  const handleResumeLive = useCallback(() => {
    const video = videoElementRef.current;
    if (video) {
      try {
        void video.play();
      } catch (err) {
        console.warn('[FoodScannerRoute] Video play error:', err);
      }
    }

    setStreamMode('live');
    setFrozenFrame(null);
    setFrozenBoxes([]);
    setSelectedItemId(null);
    toast('Resumed continuous 60 FPS live scanning', 'info');
  }, [toast]);

  // Selected item in review mode
  const selectedItem = useMemo(() => {
    if (streamMode !== 'review') return null;
    if (selectedItemId) {
      const match = frozenBoxes.find((b) => b.id === selectedItemId);
      if (match) return match;
    }
    return frozenBoxes.length > 0 && frozenBoxes[0] ? frozenBoxes[0] : null;
  }, [streamMode, selectedItemId, frozenBoxes]);

  /**
   * End-to-End Meal Logging:
   * Dispatches meal record to:
   * 1. Local React dashboard store (useFoodLogStore & sessionLog)
   * 2. Active Smart Glasses Adapter (glassesController.updateHud & sponsorBus)
   * 3. FoodScannerBus event stream
   */
  const handleLogMeal = useCallback(
    async (payloadInput?: MealLoggedPayload) => {
      let payload: MealLoggedPayload;

      if (payloadInput) {
        payload = payloadInput;
      } else if (macros && totals) {
        const primary = macros.items[0];
        payload = {
          id: crypto.randomUUID(),
          name: primary?.name ?? 'Assorted Plate',
          calories: macros.totalKcal,
          macros: {
            protein: Math.round(totals.p),
            carbs: Math.round(totals.c),
            fat: Math.round(totals.f),
          },
          weightGrams: detailedItems[0]?.estimatedWeightGrams ?? 200,
          confidence: primary?.confidence ?? 0.85,
          timestamp: Date.now(),
          source: activeMode === 'upload' ? 'upload' : macros.source === 'stepfun' ? 'stepfun' : 'mock',
        };
      } else {
        return;
      }

      await trackTelemetryMetric(
        'food_scanner.meal_logged',
        'telemetry.sponsor.dispatch',
        {
          'meal.source': payload.source,
          'meal.calories': payload.calories,
          'device.glasses_status': glassesController.snapshot.status,
        },
        async () => {
          // 1. Commit to Local React Dashboard Stores (IndexedDB & State)
          useFoodLogStore.getState().addMeal({
            id: payload.id,
            name: payload.name,
            calories: payload.calories,
            protein: payload.macros.protein,
            carbs: payload.macros.carbs,
            fat: payload.macros.fat,
            weightGrams: payload.weightGrams,
            confidence: payload.confidence,
            source: payload.source,
            timestamp: payload.timestamp,
          });

          const macroItem: MacroItem = {
            name: payload.name,
            kcal: payload.calories,
            protein: payload.macros.protein,
            carbs: payload.macros.carbs,
            fat: payload.macros.fat,
            confidence: payload.confidence,
          };

          const summary: MacroSummary = {
            items: [macroItem],
            totalKcal: payload.calories,
            source: payload.source === 'stepfun' || payload.source === 'upload' ? 'stepfun' : 'mock',
          };

          sessionLog.add({
            kind: 'meal',
            id: payload.id,
            endedAt: payload.timestamp,
            macros: summary,
          });

          // 2. Dispatch to Smart Glasses Adapter & Global Sponsor Bus
          glassesController.updateHud({ macroSummary: summary });
          sponsorBus.emit('macro:result', summary);

          // 3. Emit to FoodScannerBus
          foodScannerBus.emitMealLogged(payload);

          toast(`Successfully logged ${payload.name} (${payload.calories} kcal)`, 'info');

          // Reset scan state after logging
          setMacros(null);
          setDetailedItems([]);
          setUploadedImageUrl(null);
        },
      );
    },
    [activeMode, detailedItems, macros, toast, totals],
  );

  // Manual Macro Adjustment Handler
  const handleOpenManualAdjust = useCallback(
    (
      item: DetectedFoodItem,
      currentNutrition: {
        name: string;
        calories: number;
        protein: number;
        carbs: number;
        fat: number;
        weight: number;
        confidence: number;
        isCloudVerified: boolean;
      },
    ) => {
      setManualAdjustModal({
        item,
        nutrition: { ...currentNutrition },
      });
    },
    [],
  );

  const handleSaveManualAdjust = useCallback(() => {
    if (!manualAdjustModal) return;
    const { nutrition } = manualAdjustModal;

    const payload: MealLoggedPayload = {
      id: crypto.randomUUID(),
      name: nutrition.name,
      calories: Math.max(0, Math.round(nutrition.calories)),
      macros: {
        protein: Math.max(0, Math.round(nutrition.protein)),
        carbs: Math.max(0, Math.round(nutrition.carbs)),
        fat: Math.max(0, Math.round(nutrition.fat)),
      },
      weightGrams: Math.max(1, Math.round(nutrition.weight)),
      confidence: 1.0, // User verified
      timestamp: Date.now(),
      source: 'manual',
    };

    void handleLogMeal(payload);
    setManualAdjustModal(null);
  }, [handleLogMeal, manualAdjustModal]);

  return (
    <div className="space-y-4">
      {/* Main Viewport: Camera with Floating HUDs, or Image Upload */}
      {activeMode === 'camera' ? (
        <div className="relative">
          <CameraViewport
            videoRef={camera.videoRef}
            status={camera.status}
            error={camera.error}
            mirror={mirror}
            onRetry={() => void camera.start()}
          >
            {/* Frozen Frame Snapshot Overlay during Review Mode */}
            {streamMode === 'review' && frozenFrame && (
              <img
                src={frozenFrame}
                alt="Captured meal preview"
                className="absolute inset-0 h-full w-full object-cover pointer-events-none z-10"
              />
            )}

            <FoodOverlayCanvas
              boxesRef={boxesRef}
              frozenBoxes={streamMode === 'review' ? frozenBoxes : undefined}
              isReviewMode={streamMode === 'review'}
              selectedItemId={selectedItemId}
              onSelectItem={(id) => setSelectedItemId(id)}
              macros={macros}
              detailedItems={detailedItems}
              mirror={mirror}
              videoAspect={videoAspect}
              analyzing={analyzing}
              onAnalyze={() => void triggerCloudScan(boxesRef.current[0]?.box2d ?? null, 'manual')}
              onMealLogged={(meal) => void handleLogMeal(meal)}
              onAdjustMacros={handleOpenManualAdjust}
            />

            {/* Floating Top HUD (Status Badges & Mode Switch - R1 & R2) */}
            <div className="absolute top-3 inset-x-3 z-30 pointer-events-none flex items-center justify-between gap-2">
              {/* Mode Switcher Glass Pill */}
              <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/10 bg-neutral-950/80 p-1 shadow-lg backdrop-blur-md">
                <button
                  type="button"
                  onClick={() => handleSwitchMode('camera')}
                  className="flex items-center gap-1.5 rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-black shadow-sm transition"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                  <span>Live AR</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchMode('upload')}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-neutral-300 hover:text-white transition"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                    />
                  </svg>
                  <span>Upload</span>
                </button>
              </div>

              {/* Status Badges & Flip Camera Pill */}
              <div className="flex items-center gap-1.5">
                {stabilityDetected && (
                  <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-neutral-950/80 px-2.5 py-1 text-[11px] font-medium text-emerald-300 backdrop-blur-md">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Frame Stable
                  </span>
                )}
                {!isOnline && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-neutral-950/80 px-2.5 py-1 text-[11px] font-medium text-amber-300 backdrop-blur-md">
                    Offline
                  </span>
                )}
                {isLowLight && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-neutral-950/80 px-2.5 py-1 text-[11px] font-medium text-amber-300 backdrop-blur-md">
                    Low Light
                  </span>
                )}
                {rateLimitCooldown !== null && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-neutral-950/80 px-2.5 py-1 text-[11px] font-medium text-amber-300 backdrop-blur-md">
                    Rate Limited ({rateLimitCooldown}s)
                  </span>
                )}
                <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-neutral-950/80 px-2.5 py-1 text-[11px] font-medium text-neutral-200 backdrop-blur-md">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${detectorReady ? 'bg-emerald-400' : 'bg-amber-400'}`}
                  />
                  {detectorReady === null ? 'Loading ML' : detectorReady ? '60 FPS' : 'Fallback'}
                </span>
                <button
                  type="button"
                  onClick={() => void camera.switchCamera()}
                  title="Flip camera"
                  aria-label="Flip camera"
                  className="pointer-events-auto rounded-full border border-white/10 bg-neutral-950/80 p-1.5 text-neutral-300 hover:text-white transition shadow-lg backdrop-blur-md active:scale-95 cursor-pointer"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {/* Paused Review Item Detailed Inspection Card (R3 & R4) */}
            {streamMode === 'review' && selectedItem && (
              <div className="absolute bottom-20 inset-x-3 z-30 flex justify-center pointer-events-none">
                <div className="pointer-events-auto max-h-[65vh] overflow-y-auto w-full max-w-sm rounded-2xl shadow-2xl">
                  <FoodTooltipCard
                    item={selectedItem}
                    macroItem={
                      macros?.items.find((_, i) => frozenBoxes[i]?.id === selectedItem.id) ?? null
                    }
                    detailedItem={
                      detailedItems.find((_, i) => frozenBoxes[i]?.id === selectedItem.id) ?? null
                    }
                    analyzing={analyzing}
                    onAnalyze={() => void triggerCloudScan(selectedItem.box2d ?? null, 'manual')}
                    onLogged={(meal) => void handleLogMeal(meal)}
                    onAdjust={handleOpenManualAdjust}
                    onClose={() => setSelectedItemId(null)}
                  />
                </div>
              </div>
            )}

            {/* Floating Bottom Shutter Bar (R1, R2, R3) */}
            <div className="absolute bottom-4 inset-x-4 z-30 pointer-events-none flex flex-wrap items-center justify-center gap-3">
              {streamMode === 'live' ? (
                <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/15 bg-neutral-950/85 p-1.5 shadow-2xl backdrop-blur-md">
                  <button
                    type="button"
                    onClick={() => handleSwitchMode('upload')}
                    title="Upload photo mode"
                    aria-label="Upload photo mode"
                    className="rounded-full bg-white/5 p-2.5 text-neutral-300 hover:bg-white/15 hover:text-white transition cursor-pointer"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                      />
                    </svg>
                  </button>

                  {/* Prominent Center Shutter Button */}
                  <button
                    type="button"
                    onClick={handleTakeImageAndInspect}
                    disabled={camera.status !== 'streaming'}
                    aria-label="Take Image and Inspect"
                    className="flex items-center gap-2 rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 px-5 py-2.5 text-sm font-bold text-black shadow-[0_0_25px_rgba(16,185,129,0.5)] hover:from-emerald-400 hover:to-teal-300 active:scale-95 transition disabled:opacity-50 cursor-pointer"
                  >
                    <span className="text-base">📸</span>
                    <span>Take Image / Inspect</span>
                  </button>

                  {/* Deep Scan Plate Button */}
                  <button
                    type="button"
                    onClick={() => void triggerCloudScan(boxesRef.current[0]?.box2d ?? null, 'manual')}
                    disabled={camera.status !== 'streaming' || analyzing || rateLimitCooldown !== null}
                    title="Deep Scan with StepFun AI"
                    aria-label="Deep Scan Plate"
                    className="flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-2.5 text-xs font-semibold text-neutral-200 hover:bg-white/20 hover:text-white transition disabled:opacity-50 cursor-pointer"
                  >
                    <span>⚡</span>
                    <span className="hidden sm:inline">{analyzing ? 'Analyzing…' : 'Deep Scan'}</span>
                  </button>

                  {/* Log Plate shortcut if macros present */}
                  {macros && (
                    <button
                      type="button"
                      onClick={() => void handleLogMeal()}
                      title="Log Entire Plate"
                      aria-label="Log Entire Plate"
                      className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500 transition cursor-pointer"
                    >
                      <span>🥗</span>
                      <span className="hidden sm:inline">Log Plate</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/15 bg-neutral-950/90 p-1.5 shadow-2xl backdrop-blur-md">
                  {/* Retake / Resume Live Button */}
                  <button
                    type="button"
                    onClick={handleResumeLive}
                    aria-label="Retake and Resume Live"
                    className="flex items-center gap-2 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-2 text-xs sm:text-sm font-bold text-white shadow-[0_0_20px_rgba(6,182,212,0.4)] hover:from-cyan-400 hover:to-blue-400 active:scale-95 transition cursor-pointer"
                  >
                    <span>🔄</span>
                    <span>Retake / Live</span>
                  </button>

                  {frozenBoxes.length > 0 && !selectedItemId && (
                    <button
                      type="button"
                      onClick={() => setSelectedItemId(frozenBoxes[0]?.id ?? null)}
                      className="rounded-full bg-white/10 px-3 py-2 text-xs font-semibold text-neutral-200 hover:bg-white/20 transition cursor-pointer"
                    >
                      Inspect {frozenBoxes[0]?.label}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => void triggerCloudScan(frozenBoxes[0]?.box2d ?? null, 'manual')}
                    disabled={analyzing || rateLimitCooldown !== null}
                    className="rounded-full bg-white/10 px-3 py-2 text-xs font-semibold text-neutral-200 hover:bg-white/20 transition disabled:opacity-50 cursor-pointer"
                  >
                    ⚡ {analyzing ? 'Analyzing…' : 'Deep Scan'}
                  </button>

                  {macros && (
                    <button
                      type="button"
                      onClick={() => void handleLogMeal()}
                      className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition cursor-pointer"
                    >
                      <span>🥗</span>
                      <span>Log Plate</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </CameraViewport>

          {/* Graceful Fallback Prompt if Camera Permission Denied or Failed */}
          {camera.status === 'error' && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-700 bg-neutral-900/90 p-4">
              <div>
                <p className="text-sm font-semibold text-neutral-200">Camera unavailable?</p>
                <p className="text-xs text-neutral-400">
                  You can still track your calories accurately by uploading a photo of your meal.
                </p>
              </div>
              <Button onClick={() => handleSwitchMode('upload')}>
                Upload Photo Instead
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Upload Mode Header & Switcher */}
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-bold tracking-tight">Photo Upload Mode</h1>
              <p className="text-sm text-neutral-400">
                Upload or drag & drop a food photo for AI caloric estimation
              </p>
            </div>
            <div className="flex gap-1 rounded-xl bg-neutral-900 p-1">
              <button
                type="button"
                onClick={() => handleSwitchMode('camera')}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-neutral-400 hover:text-white transition"
              >
                Live AR Camera
              </button>
              <button
                type="button"
                onClick={() => handleSwitchMode('upload')}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-black shadow-sm transition"
              >
                Upload Photo
              </button>
            </div>
          </header>

          <FoodImageUploader
            previewUrl={uploadedImageUrl}
            analyzing={analyzing}
            onImageProcessed={(result) => {
              setUploadedImageUrl(result.dataUrl);
              setUploadedVisuals(result.visuals ?? null);
              void triggerImageUploadScan(result.dataUrl, result);
            }}
            onClear={() => {
              setUploadedImageUrl(null);
              setUploadedVisuals(null);
              setMacros(null);
              setDetailedItems([]);
              setScanError(null);
            }}
          />

          <div className="flex flex-wrap gap-2">
            {uploadedImageUrl && (
              <Button
                onClick={() => uploadedImageUrl && void triggerImageUploadScan(uploadedImageUrl)}
                disabled={analyzing || rateLimitCooldown !== null}
              >
                {analyzing ? 'Analyzing with StepFun…' : 'Re-analyze Photo'}
              </Button>
            )}
            {macros && (
              <Button onClick={() => void handleLogMeal()}>
                Log Entire Meal
              </Button>
            )}
            <Button variant="secondary" onClick={() => handleSwitchMode('camera')}>
              Switch to Live Camera
            </Button>
          </div>
        </div>
      )}

      {scanError && <p className="text-sm text-rose-300">{scanError}</p>}

      {/* Aggregated Nutrition Macro Card */}
      {macros && totals && (
        <Card
          title="Detected Macros"
          action={
            <Badge tone={macros.source === 'stepfun' ? 'good' : 'warn'}>
              {activeMode === 'upload'
                ? macros.source === 'stepfun'
                  ? 'StepFun AI (Photo)'
                  : 'Local Heuristics (Photo)'
                : macros.source === 'stepfun'
                  ? 'StepFun AI'
                  : 'Local Heuristics'}
            </Badge>
          }
        >
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatPill label="Calories" value={`${macros.totalKcal} kcal`} tone="good" />
            <StatPill label="Protein" value={`${Math.round(totals.p)}g`} />
            <StatPill label="Carbs" value={`${Math.round(totals.c)}g`} />
            <StatPill label="Fat" value={`${Math.round(totals.f)}g`} />
          </div>

          {uploadedVisuals?.detectedText && (
            <div className="mb-3 flex items-center justify-between rounded-xl border border-cyan-500/30 bg-cyan-950/40 px-3 py-2 text-xs text-cyan-200">
              <div className="flex items-center gap-2">
                <span className="font-semibold">🥫 Can / Label OCR:</span>
                <span className="rounded bg-black/40 px-2 py-0.5 font-mono text-cyan-300">
                  &ldquo;{uploadedVisuals.detectedText}&rdquo;
                </span>
              </div>
              <a
                href={generateCanWebSearchUrl(uploadedVisuals.detectedText)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded bg-cyan-600/30 px-2 py-1 text-[11px] font-medium text-cyan-300 hover:bg-cyan-600/50 hover:text-white transition"
              >
                🔍 Search Nutrition
              </a>
            </div>
          )}

          <ul className="divide-y divide-neutral-800 text-sm">
            {macros.items.map((item, idx) => {
              const detailed = detailedItems[idx];
              return (
                <li key={`${item.name}-${idx}`} className="flex items-center justify-between py-2">
                  <div>
                    <span className="font-medium text-white">{item.name}</span>
                    {detailed && (
                      <span className="ml-2 text-xs text-neutral-400">
                        {detailed.estimatedWeightGrams}g · {Math.round(detailed.confidenceScore * 100)}% conf
                      </span>
                    )}
                    {(isLiquidContainer(item.name) ||
                      item.name.toLowerCase().includes('cup') ||
                      item.name.toLowerCase().includes('bottle') ||
                      item.name.toLowerCase().includes('beverage')) && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-cyan-500/20 px-1.5 py-0.5 text-[10px] text-cyan-300 border border-cyan-500/30">
                        Drink / Liquid
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums text-neutral-300">{Math.round(item.kcal)} kcal</span>
                    <button
                      type="button"
                      onClick={() =>
                        handleOpenManualAdjust(
                          boxesRef.current[idx] ?? {
                            id: `food-${idx}`,
                            label: item.name,
                            confidence: item.confidence ?? 0.8,
                            score: item.confidence ?? 0.8,
                            x: 0,
                            y: 0,
                            w: 0,
                            h: 0,
                            box2d: { x: 0, y: 0, w: 0, h: 0 },
                            spatial3d: {
                              center: [0, 0, 0],
                              size: [0, 0, 0],
                              ndc: [0, 0],
                              estimatedDepth: 1,
                              bounds2D: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
                            },
                            detectedAt: Date.now(),
                          },
                          {
                            name: item.name,
                            calories: item.kcal,
                            protein: item.protein,
                            carbs: item.carbs,
                            fat: item.fat,
                            weight: detailed?.estimatedWeightGrams ?? 150,
                            confidence: item.confidence ?? 0.8,
                            isCloudVerified: macros.source === 'stepfun',
                          },
                        )
                      }
                      className="text-xs text-cyan-400 underline underline-offset-2 hover:text-cyan-300"
                    >
                      Adjust
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* Downstream Scrollable Content: Daily Summary & Activity History (R1 & R4) */}
      <div className="space-y-4 pt-2">
        <Card
          title="Today's Nutrition Summary"
          action={
            <Badge tone={dailyTotals.calories > dailyGoals.calories ? 'warn' : 'good'}>
              {dailyTotals.calories} / {dailyGoals.calories} kcal
            </Badge>
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatPill
              label="Calories Left"
              value={`${Math.max(0, dailyRemaining.calories)} kcal`}
              tone={dailyRemaining.calories <= 0 ? 'warn' : 'good'}
            />
            <StatPill label="Protein" value={`${dailyTotals.protein}g / ${dailyGoals.protein}g`} />
            <StatPill label="Carbs" value={`${dailyTotals.carbs}g / ${dailyGoals.carbs}g`} />
            <StatPill label="Fat" value={`${dailyTotals.fat}g / ${dailyGoals.fat}g`} />
          </div>
        </Card>

        <Card
          title="Today's Activity Log"
          action={
            <Badge tone={todayLogs.length > 0 ? 'good' : 'neutral'}>
              {todayLogs.length} {todayLogs.length === 1 ? 'Meal' : 'Meals'}
            </Badge>
          }
        >
          {todayLogs.length === 0 ? (
            <div className="py-6 text-center text-sm text-neutral-400">
              <p>No meals logged today yet.</p>
              <p className="mt-1 text-xs text-neutral-500">
                Point at your plate in Live AR and tap 📸 Take Image / Inspect to log.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-neutral-800 text-sm">
              {todayLogs.map((meal) => (
                <li key={meal.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">{meal.name}</span>
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-neutral-400">
                        {new Date(meal.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {meal.source && (
                        <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300 border border-emerald-500/20">
                          {meal.source === 'stepfun' ? 'AI' : meal.source === 'upload' ? 'Upload' : 'Manual'}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-neutral-400">
                      P: {meal.protein}g · C: {meal.carbs}g · F: {meal.fat}g
                      {meal.weightGrams ? ` · ${meal.weightGrams}g` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums font-semibold text-neutral-200">
                      {meal.calories} kcal
                    </span>
                    <button
                      type="button"
                      onClick={() => removeMeal(meal.id)}
                      title="Remove entry"
                      aria-label={`Remove ${meal.name}`}
                      className="rounded p-1 text-xs text-neutral-500 hover:text-rose-400 transition cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Manual Fallback Override Dialog */}
      {manualAdjustModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="manual-adjust-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-md rounded-2xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl">
            <h2 id="manual-adjust-title" className="text-lg font-bold text-white">
              Adjust Calories & Macros
            </h2>
            <p className="mt-1 text-xs text-neutral-400">
              Manual fallback override for low confidence or offline estimates.
            </p>

            <div className="mt-4 space-y-3 text-sm">
              {/* Quick Beverage Presets for liquid containers and drinks */}
              {(isLiquidContainer(manualAdjustModal.item.label) ||
                manualAdjustModal.nutrition.name.toLowerCase().includes('cup') ||
                manualAdjustModal.nutrition.name.toLowerCase().includes('bottle') ||
                manualAdjustModal.nutrition.name.toLowerCase().includes('can') ||
                manualAdjustModal.nutrition.name.toLowerCase().includes('drink') ||
                manualAdjustModal.nutrition.name.toLowerCase().includes('milk') ||
                manualAdjustModal.nutrition.name.toLowerCase().includes('beverage')) && (
                <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/40 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="block text-xs font-semibold text-cyan-200">
                      🥤 Quick Drink Presets (Milk, Cans, Coffee, Tea, Soda)
                    </span>
                    <a
                      href={generateCanWebSearchUrl(manualAdjustModal.nutrition.name || 'beverage')}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-cyan-400 underline hover:text-cyan-300"
                    >
                      Web Search Nutrition ↗
                    </a>
                  </div>
                  <p className="mt-0.5 text-[11px] text-neutral-300">
                    Tap to auto-populate exact nutrition profile:
                  </p>
                  <div className="mt-2 flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
                    {BEVERAGE_PRESETS.map((bev) => (
                      <button
                        key={bev.id}
                        type="button"
                        onClick={() => {
                          setManualAdjustModal((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  nutrition: {
                                    name: bev.name,
                                    calories: bev.calories,
                                    protein: bev.protein,
                                    carbs: bev.carbs,
                                    fat: bev.fat,
                                    weight: bev.servingSizeGrams,
                                    confidence: 1.0,
                                    isCloudVerified: true,
                                  },
                                }
                              : null,
                          );
                        }}
                        className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-neutral-200 hover:bg-white/15 hover:text-white transition"
                      >
                        {bev.icon} {bev.shortName} ({bev.calories} kcal)
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-neutral-300">Food / Drink Name</label>
                  {manualAdjustModal.nutrition.name && (
                    <a
                      href={generateCanWebSearchUrl(manualAdjustModal.nutrition.name)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-cyan-400 underline hover:text-cyan-300"
                    >
                      🔍 Search USDA / Web
                    </a>
                  )}
                </div>
                <input
                  type="text"
                  value={manualAdjustModal.nutrition.name}
                  onChange={(e) =>
                    setManualAdjustModal((prev) =>
                      prev
                        ? {
                            ...prev,
                            nutrition: { ...prev.nutrition, name: e.target.value },
                          }
                        : null,
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-neutral-300">Calories (kcal)</label>
                  <input
                    type="number"
                    min="0"
                    value={manualAdjustModal.nutrition.calories}
                    onChange={(e) =>
                      setManualAdjustModal((prev) =>
                        prev
                          ? {
                              ...prev,
                              nutrition: {
                                ...prev.nutrition,
                                calories: Number(e.target.value) || 0,
                              },
                            }
                          : null,
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-white focus:border-cyan-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-300">Est. Weight (g)</label>
                  <input
                    type="number"
                    min="1"
                    value={manualAdjustModal.nutrition.weight}
                    onChange={(e) =>
                      setManualAdjustModal((prev) =>
                        prev
                          ? {
                              ...prev,
                              nutrition: {
                                ...prev.nutrition,
                                weight: Number(e.target.value) || 0,
                              },
                            }
                          : null,
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-white focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-medium text-emerald-400">Protein (g)</label>
                  <input
                    type="number"
                    min="0"
                    value={manualAdjustModal.nutrition.protein}
                    onChange={(e) =>
                      setManualAdjustModal((prev) =>
                        prev
                          ? {
                              ...prev,
                              nutrition: {
                                ...prev.nutrition,
                                protein: Number(e.target.value) || 0,
                              },
                            }
                          : null,
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-amber-400">Carbs (g)</label>
                  <input
                    type="number"
                    min="0"
                    value={manualAdjustModal.nutrition.carbs}
                    onChange={(e) =>
                      setManualAdjustModal((prev) =>
                        prev
                          ? {
                              ...prev,
                              nutrition: {
                                ...prev.nutrition,
                                carbs: Number(e.target.value) || 0,
                              },
                            }
                          : null,
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-white focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-rose-400">Fat (g)</label>
                  <input
                    type="number"
                    min="0"
                    value={manualAdjustModal.nutrition.fat}
                    onChange={(e) =>
                      setManualAdjustModal((prev) =>
                        prev
                          ? {
                              ...prev,
                              nutrition: {
                                ...prev.nutrition,
                                fat: Number(e.target.value) || 0,
                              },
                            }
                          : null,
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-white focus:border-rose-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setManualAdjustModal(null)}>
                Cancel
              </Button>
              <Button onClick={handleSaveManualAdjust}>Save & Log Meal</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
