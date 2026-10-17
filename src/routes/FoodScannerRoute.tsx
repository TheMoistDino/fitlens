import * as Sentry from '@sentry/react';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '@/app/providers';
import type { MacroItem, MacroSummary } from '@/core/events/events';
import { sessionLog } from '@/features/dashboard/useSessionLog';
import { FoodOverlayCanvas, FoodImageUploader } from '@/features/food-scanner/components';
import {
  FoodDetectionService,
  FrameSampler,
  StepFunFoodAdapter,
  foodScannerBus,
  type BoundingBox2D,
  type DetectedFoodItem,
  type MealLoggedPayload,
  type StepFunFoodItem,
} from '@/features/food-scanner/services';
import { useFoodLogStore } from '@/features/food-scanner/store';
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
    async (imageDataUrl: string) => {
      if (analyzing) return;

      if (rateLimitCooldown !== null && rateLimitCooldown > 0) {
        toast(`Cloud AI rate limited. Cooldown active for ${rateLimitCooldown}s.`, 'warn');
        return;
      }

      setAnalyzing(true);
      setScanError(null);

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
              'Uploaded food photo. Identify food items, portion weights, calories, and macros.',
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
      {/* Route Header */}
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">WebAR Macro Tracker</h1>
          <p className="text-sm text-neutral-400">
            {activeMode === 'camera'
              ? 'Point at your plate, hold steady or tap Deep Scan'
              : 'Upload or drag & drop a food photo for AI caloric estimation'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeMode === 'camera' && stabilityDetected && <Badge tone="good">Frame Stable</Badge>}
          {!isOnline && <Badge tone="warn">Offline Mode</Badge>}
          {activeMode === 'camera' && isLowLight && <Badge tone="warn">Low Light</Badge>}
          {rateLimitCooldown !== null && (
            <Badge tone="warn">Rate Limited ({rateLimitCooldown}s)</Badge>
          )}
          {activeMode === 'camera' ? (
            <Badge tone={detectorReady ? 'good' : detectorReady === false ? 'warn' : 'neutral'}>
              Local ML: {detectorReady === null ? 'Loading…' : detectorReady ? '60 FPS' : 'Fallback'}
            </Badge>
          ) : (
            <Badge tone="good">Mode: Photo Upload</Badge>
          )}
        </div>
      </header>

      {/* Mode Switcher Tabs */}
      <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
        <div className="flex gap-1 rounded-xl bg-neutral-900 p-1">
          <button
            type="button"
            onClick={() => handleSwitchMode('camera')}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              activeMode === 'camera'
                ? 'bg-emerald-500 text-black shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
            Live AR Camera
          </button>
          <button
            type="button"
            onClick={() => handleSwitchMode('upload')}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              activeMode === 'upload'
                ? 'bg-emerald-500 text-black shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
            Upload Photo
          </button>
        </div>

        {activeMode === 'upload' && uploadedImageUrl && (
          <span className="text-xs text-neutral-400 hidden sm:inline">Photo loaded</span>
        )}
      </div>

      {/* Defensive Alerts */}
      {!isOnline && (
        <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <span>Offline mode active: estimates will use local heuristics without cloud AI.</span>
        </div>
      )}

      {activeMode === 'camera' && isLowLight && (
        <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <span>Low ambient light detected. Please ensure food is illuminated for optimal detection.</span>
        </div>
      )}

      {/* Main Viewport: Camera or Image Upload */}
      {activeMode === 'camera' ? (
        <>
          <CameraViewport
            videoRef={camera.videoRef}
            status={camera.status}
            error={camera.error}
            mirror={mirror}
            onRetry={() => void camera.start()}
          >
            <FoodOverlayCanvas
              boxesRef={boxesRef}
              macros={macros}
              detailedItems={detailedItems}
              mirror={mirror}
              analyzing={analyzing}
              onAnalyze={() => void triggerCloudScan(boxesRef.current[0]?.box2d ?? null, 'manual')}
              onMealLogged={(meal) => void handleLogMeal(meal)}
              onAdjustMacros={handleOpenManualAdjust}
            />
          </CameraViewport>

          {/* Graceful Fallback Prompt if Camera Permission Denied or Failed */}
          {camera.status === 'error' && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-700 bg-neutral-900/90 p-4">
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

          {/* Camera Control Actions Bar */}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void triggerCloudScan(boxesRef.current[0]?.box2d ?? null, 'manual')}
              disabled={camera.status !== 'streaming' || analyzing || rateLimitCooldown !== null}
            >
              {analyzing ? 'Analyzing with StepFun…' : 'Deep Scan Plate'}
            </Button>
            <Button variant="secondary" onClick={() => void camera.switchCamera()}>
              Flip Camera
            </Button>
            <Button variant="secondary" onClick={() => handleSwitchMode('upload')}>
              Upload Photo Instead
            </Button>
            {macros && (
              <Button variant="secondary" onClick={() => void handleLogMeal()}>
                Log Entire Plate
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Upload Photo Dropzone / Preview */}
          <FoodImageUploader
            previewUrl={uploadedImageUrl}
            analyzing={analyzing}
            onImageProcessed={(result) => {
              setUploadedImageUrl(result.dataUrl);
              void triggerImageUploadScan(result.dataUrl);
            }}
            onClear={() => {
              setUploadedImageUrl(null);
              setMacros(null);
              setDetailedItems([]);
              setScanError(null);
            }}
          />

          {/* Upload Mode Actions Bar */}
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
        </>
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
              <div>
                <label className="block text-xs font-medium text-neutral-300">Food Name</label>
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
