import { Html } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import type { MacroSummary } from '@/core/events/events';
import { isLiquidContainer } from '../services/beverageProfiles';
import { formatMinimalReticleLabel, isFoodHidingContents } from '../services/compositeFoodProfiles';
import type { DetectedFoodItem, MealLoggedPayload, StepFunFoodItem } from '../services/types';

const MAX_TRACKED_SLOTS = 3;
const LERP_FACTOR = 0.22; // Frame-to-frame damping factor to suppress jitter

const FALLBACK_MACRO_KCAL: Record<string, number> = {
  apple: 95,
  banana: 105,
  sandwich: 420,
  burrito: 680,
  wrap: 520,
  burger: 550,
  calzone: 780,
  'pot pie': 620,
  dumpling: 280,
  dumplings: 280,
  taco: 230,
  tacos: 230,
  quesadilla: 580,
  orange: 62,
  broccoli: 55,
  carrot: 41,
  'hot dog': 290,
  pizza: 285,
  donut: 250,
  cake: 350,
  bowl: 380,
  cup: 2,
  bottle: 0,
  'wine glass': 125,
};

export interface FoodOverlayCanvasProps {
  /** Mutable reference containing real-time detected food items from FoodDetectionService */
  boxesRef: React.RefObject<DetectedFoodItem[]>;
  /** Frozen snapshot of detected food items in review mode */
  frozenBoxes?: DetectedFoodItem[];
  /** Whether the camera feed is paused in review mode */
  isReviewMode?: boolean;
  /** Currently selected food item ID for detailed inspection */
  selectedItemId?: string | null;
  /** Callback fired when user selects a food item in review mode */
  onSelectItem?: (id: string) => void;
  /** StepFun multimodal macro summary (updated asynchronously via FoodScannerBus) */
  macros?: MacroSummary | null;
  /** Granular food item insights from StepFun API */
  detailedItems?: StepFunFoodItem[];
  /** Mirror X coordinates when front-facing camera is active */
  mirror?: boolean;
  /** Video intrinsic aspect ratio (width / height) to compensate object-cover cropping */
  videoAspect?: number;
  /** Whether StepFun API is actively estimating nutrition */
  analyzing?: boolean;
  /** Callback to trigger cloud analysis on demand */
  onAnalyze?: () => void;
  /** Callback fired when a meal is logged */
  onMealLogged?: (meal: MealLoggedPayload) => void;
  /** Callback fired when user triggers manual macro adjustment */
  onAdjustMacros?: (
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
  ) => void;
  /** Optional additional 3D scene elements */
  children?: ReactNode;
}

/**
 * Computes the displayed dimensions of video rendered with CSS `object-fit: cover`
 * inside a container of dimensions (containerWidth, containerHeight).
 *
 * If container is wider than video (containerAspect > videoAspect):
 * - Video width fills container: width = containerWidth
 * - Video height overflows & crops: height = containerWidth / videoAspect
 *
 * If container is taller than video (containerAspect <= videoAspect):
 * - Video height fills container: height = containerHeight
 * - Video width overflows & crops: width = containerHeight * videoAspect
 */
export function computeCoverDimensions(
  containerWidth: number,
  containerHeight: number,
  videoAspect?: number,
): { width: number; height: number } {
  if (!videoAspect || videoAspect <= 0 || containerWidth <= 0 || containerHeight <= 0) {
    return { width: containerWidth, height: containerHeight };
  }
  const containerAspect = containerWidth / containerHeight;
  if (containerAspect > videoAspect) {
    return {
      width: containerWidth,
      height: containerWidth / videoAspect,
    };
  } else {
    return {
      width: containerHeight * videoAspect,
      height: containerHeight,
    };
  }
}

interface SlotInterpolationState {
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  activeItem: DetectedFoodItem | null;
}

/**
 * 3D Scene containing AR spatial anchors, futuristic tracking reticles, and minimal AR pills / review targets.
 */
export function FoodSpatialScene({
  boxesRef,
  frozenBoxes,
  isReviewMode = false,
  selectedItemId = null,
  onSelectItem,
  macros,
  detailedItems = [],
  mirror = false,
  videoAspect,
  children,
}: FoodOverlayCanvasProps) {
  const size = useThree((s) => s.size);
  const groupsRef = useRef<(THREE.Group | null)[]>([]);
  const reticlesRef = useRef<(THREE.LineSegments | null)[]>([]);

  // Local state for slots to safely synchronize React HTML overlay rendering
  const [slotItems, setSlotItems] = useState<(DetectedFoodItem | null)[]>(() =>
    Array(MAX_TRACKED_SLOTS).fill(null),
  );

  // Per-slot smooth interpolation state to isolate 60 FPS GPU updates from React re-renders
  const interpStates = useRef<SlotInterpolationState[]>(
    Array.from({ length: MAX_TRACKED_SLOTS }, () => ({
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      opacity: 0,
      activeItem: null,
    })),
  );

  // Futuristic AR corner-bracket reticle geometry (unit size [-0.5..0.5])
  const reticleGeometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    // 8 pairs of 3D points forming corner brackets
    const vertices = new Float32Array([
      // Top-Left corner
      -0.5, 0.25, 0, -0.5, 0.5, 0,
      -0.5, 0.5, 0, -0.25, 0.5, 0,
      // Top-Right corner
      0.25, 0.5, 0, 0.5, 0.5, 0,
      0.5, 0.5, 0, 0.5, 0.25, 0,
      // Bottom-Right corner
      0.5, -0.25, 0, 0.5, -0.5, 0,
      0.5, -0.5, 0, 0.25, -0.5, 0,
      // Bottom-Left corner
      -0.25, -0.5, 0, -0.5, -0.5, 0,
      -0.5, -0.5, 0, -0.5, -0.25, 0,
    ]);
    geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    return geom;
  }, []);

  // Shared glowing reticle material (Emerald for standard tracking)
  const reticleMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: '#10b981', // Emerald glow
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    [],
  );

  // Selected item reticle material (Cyan for inspected item in review mode)
  const selectedReticleMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: '#06b6d4', // Cyan glow
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      }),
    [],
  );

  // Hot path: Runs at 60 FPS inside WebGL render loop
  useFrame(({ clock }) => {
    // In review mode, use frozen boxes snapshot so reticles remain perfectly stationary
    const detections =
      isReviewMode && frozenBoxes !== undefined ? frozenBoxes : (boxesRef.current ?? []);
    const pulse = 0.65 + 0.35 * Math.sin(clock.elapsedTime * 4.5);
    reticleMaterial.opacity = pulse;

    // Compensate displayed video dimensions under object-cover
    const { width: displayedWidth, height: displayedHeight } = computeCoverDimensions(
      size.width,
      size.height,
      videoAspect,
    );

    let itemsChanged = false;

    for (let i = 0; i < MAX_TRACKED_SLOTS; i++) {
      const group = groupsRef.current[i];
      const reticle = reticlesRef.current[i];
      const state = interpStates.current[i];
      const target = detections[i] ?? null;

      if (!group || !state) continue;

      if (target) {
        // Project 2D bounding box [0..1] to Three.js Ortho World Coordinates
        const normCenterX = target.x + target.w / 2;
        const normCenterY = target.y + target.h / 2;
        const correctedNormX = mirror ? 1 - normCenterX : normCenterX;

        const targetWorldX = (correctedNormX - 0.5) * displayedWidth;
        const targetWorldY = (0.5 - normCenterY) * displayedHeight;
        const targetWorldW = target.w * displayedWidth;
        const targetWorldH = target.h * displayedHeight;

        if (isReviewMode) {
          // In review mode, lock directly onto stationary coordinates without lag
          state.x = targetWorldX;
          state.y = targetWorldY;
          state.w = targetWorldW;
          state.h = targetWorldH;
          state.opacity = 1;
        } else {
          // Smooth position and dimension dampening (lerp) during live tracking
          state.x += (targetWorldX - state.x) * LERP_FACTOR;
          state.y += (targetWorldY - state.y) * LERP_FACTOR;
          state.w += (targetWorldW - state.w) * LERP_FACTOR;
          state.h += (targetWorldH - state.h) * LERP_FACTOR;
          state.opacity = Math.min(1, state.opacity + 0.1);
        }

        group.position.set(state.x, state.y, 0);
        group.visible = true;

        if (reticle) {
          reticle.scale.set(Math.max(20, state.w), Math.max(20, state.h), 1);
        }

        if (state.activeItem?.id !== target.id) {
          state.activeItem = target;
          itemsChanged = true;
        }
      } else {
        // Fade out when item leaves camera frame
        state.opacity = Math.max(0, state.opacity - 0.15);
        if (state.opacity <= 0.01) {
          group.visible = false;
          if (state.activeItem !== null) {
            state.activeItem = null;
            itemsChanged = true;
          }
        }
      }
    }

    // Synchronize active item references to React state when tracking identity changes
    if (itemsChanged) {
      setSlotItems(interpStates.current.map((s) => s.activeItem));
    }
  });

  // Clean up materials and geometries on unmount
  useEffect(() => {
    return () => {
      reticleGeometry.dispose();
      reticleMaterial.dispose();
      selectedReticleMaterial.dispose();
    };
  }, [reticleGeometry, reticleMaterial, selectedReticleMaterial]);

  return (
    <>
      {Array.from({ length: MAX_TRACKED_SLOTS }, (_, index) => {
        const item = slotItems[index];
        const state = interpStates.current[index];
        const macro = macros?.items[index] ?? null;
        const detailed = detailedItems[index] ?? null;

        if (!item || !state) return null;

        const isSelected = Boolean(isReviewMode && selectedItemId && selectedItemId === item.id);
        const normLabel = item.label.toLowerCase();
        const knownKcal =
          macro?.kcal !== undefined
            ? Math.round(macro.kcal)
            : (detailed?.calories ?? FALLBACK_MACRO_KCAL[normLabel]);

        const minimalLabel = formatMinimalReticleLabel({
          label: item.label,
          calories: knownKcal,
          isLiquid: isLiquidContainer(item.label),
          isComposite: isFoodHidingContents(item.label),
        });

        return (
          <group
            key={`spatial-slot-${index}-${item.id}`}
            ref={(el) => void (groupsRef.current[index] = el)}
            visible={false}
          >
            {/* 3D AR Corner Bracket Reticle */}
            <lineSegments
              ref={(el) => void (reticlesRef.current[index] = el)}
              geometry={reticleGeometry}
              material={isSelected ? selectedReticleMaterial : reticleMaterial}
            />

            {/* LIVE CONTINUOUS SCANNING (R2): Minimal compact pill ONLY, pointer-events: none */}
            {!isReviewMode && (
              <Html
                position={[0, state.h / 2 + 14, 0]}
                center
                zIndexRange={[100, 10]}
                style={{
                  pointerEvents: 'none',
                  transform: 'translate3d(-50%, -100%, 0)',
                }}
              >
                <div
                  role="status"
                  aria-label={minimalLabel}
                  className="rounded-full border border-emerald-500/40 bg-neutral-900/85 px-3 py-1 text-xs font-medium text-white shadow-lg backdrop-blur-md flex items-center gap-1.5 whitespace-nowrap pointer-events-none select-none"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>{minimalLabel}</span>
                </div>
              </Html>
            )}

            {/* PAUSED REVIEW MODE (R3): Stationary interactive reticle with clickable touch target */}
            {isReviewMode && (
              <Html
                position={[0, 0, 0]}
                center
                zIndexRange={[100, 10]}
                style={{
                  pointerEvents: 'auto',
                }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={`Inspect ${item.label}`}
                  onClick={() => onSelectItem?.(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectItem?.(item.id);
                    }
                  }}
                  style={{
                    width: Math.max(48, state.w),
                    height: Math.max(48, state.h),
                    transform: 'translate(-50%, -50%)',
                    pointerEvents: 'auto',
                  }}
                  className={`absolute cursor-pointer rounded-xl border-2 transition-all select-none ${
                    isSelected
                      ? 'border-cyan-400 bg-cyan-500/15 ring-2 ring-cyan-400/40 shadow-[0_0_20px_rgba(6,182,212,0.4)]'
                      : 'border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-400/70 hover:bg-emerald-500/15'
                  }`}
                >
                  {/* Stationary Interactive Pill pinned above the box */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: '50%',
                      transform: 'translate(-50%, -120%)',
                    }}
                    className="pointer-events-auto"
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectItem?.(item.id);
                      }}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold shadow-xl backdrop-blur-md flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer ${
                        isSelected
                          ? 'border-cyan-400 bg-cyan-950/90 text-cyan-200 ring-2 ring-cyan-400/50 scale-105'
                          : 'border-emerald-500/50 bg-neutral-900/90 text-white hover:border-emerald-400 hover:bg-neutral-800'
                      }`}
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${
                          isSelected ? 'bg-cyan-400 animate-ping' : 'bg-emerald-400'
                        }`}
                      />
                      <span>{minimalLabel}</span>
                      <span className="text-[10px] text-neutral-400">
                        {isSelected ? '● Inspected' : 'Tap to Inspect'}
                      </span>
                    </button>
                  </div>
                </div>
              </Html>
            )}
          </group>
        );
      })}
      {children}
    </>
  );
}

/**
 * Spatial 3D Overlay (`FoodOverlayCanvas.tsx`)
 *
 * Full-screen `@react-three/fiber` overlay synchronized with the camera viewport.
 * Projects 2D vision detections into 3D world/screen coordinates.
 * - Live continuous mode: Clean minimal AR pill reticles ({guess} · ~{kcal} kcal) with pointer-events: none.
 * - Review mode: Stationary interactive reticles allowing item inspection on tap.
 */
export function FoodOverlayCanvas(props: FoodOverlayCanvasProps) {
  return (
    <Canvas
      orthographic
      gl={{
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
      }}
      dpr={[1, 2]}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: props.isReviewMode ? 'auto' : 'none',
      }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
      }}
      fallback={
        /* Defensive WebGL Fallback: Renders nothing if hardware WebGL is unavailable */
        null
      }
    >
      <FoodSpatialScene {...props} />
    </Canvas>
  );
}
