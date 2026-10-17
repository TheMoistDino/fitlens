import { Html } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import type { MacroSummary } from '@/core/events/events';
import type { DetectedFoodItem, MealLoggedPayload, StepFunFoodItem } from '../services/types';
import { FoodTooltipCard } from './FoodTooltipCard';

const MAX_TRACKED_SLOTS = 3;
const LERP_FACTOR = 0.22; // Frame-to-frame damping factor to suppress jitter

export interface FoodOverlayCanvasProps {
  /** Mutable reference containing real-time detected food items from FoodDetectionService */
  boxesRef: React.RefObject<DetectedFoodItem[]>;
  /** StepFun multimodal macro summary (updated asynchronously via FoodScannerBus) */
  macros?: MacroSummary | null;
  /** Granular food item insights from StepFun API */
  detailedItems?: StepFunFoodItem[];
  /** Mirror X coordinates when front-facing camera is active */
  mirror?: boolean;
  /** Whether StepFun API is actively estimating nutrition */
  analyzing?: boolean;
  /** Callback to trigger cloud analysis on demand */
  onAnalyze?: () => void;
  /** Callback fired when a meal is logged */
  onMealLogged?: (meal: MealLoggedPayload) => void;
  /** Optional additional 3D scene elements */
  children?: ReactNode;
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
 * 3D Scene containing AR spatial anchors, futuristic tracking reticles, and floating UI tooltips.
 */
export function FoodSpatialScene({
  boxesRef,
  macros,
  detailedItems = [],
  mirror = false,
  analyzing = false,
  onAnalyze,
  onMealLogged,
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

  // Shared glowing reticle material
  const reticleMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: '#10b981', // Emerald glow
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      }),
    [],
  );

  // Hot path: Runs at 60 FPS inside WebGL render loop
  useFrame(({ clock }) => {
    const detections = boxesRef.current ?? [];
    const pulse = 0.65 + 0.35 * Math.sin(clock.elapsedTime * 4.5);
    reticleMaterial.opacity = pulse;

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

        const targetWorldX = (correctedNormX - 0.5) * size.width;
        const targetWorldY = (0.5 - normCenterY) * size.height;
        const targetWorldW = target.w * size.width;
        const targetWorldH = target.h * size.height;

        // Smooth position and dimension dampening (lerp)
        state.x += (targetWorldX - state.x) * LERP_FACTOR;
        state.y += (targetWorldY - state.y) * LERP_FACTOR;
        state.w += (targetWorldW - state.w) * LERP_FACTOR;
        state.h += (targetWorldH - state.h) * LERP_FACTOR;
        state.opacity = Math.min(1, state.opacity + 0.1);

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
    };
  }, [reticleGeometry, reticleMaterial]);

  return (
    <>
      {Array.from({ length: MAX_TRACKED_SLOTS }, (_, index) => {
        const item = slotItems[index];
        const macro = macros?.items[index] ?? null;
        const detailed = detailedItems[index] ?? null;

        return (
          <group
            key={`spatial-slot-${index}`}
            ref={(el) => void (groupsRef.current[index] = el)}
            visible={false}
          >
            {/* 3D AR Corner Bracket Reticle */}
            <lineSegments
              ref={(el) => void (reticlesRef.current[index] = el)}
              geometry={reticleGeometry}
              material={reticleMaterial}
            />

            {/* Spatial Connector Line: Links reticle top edge to floating tooltip */}
            <line>
              <bufferGeometry
                attach="geometry"
                onUpdate={(geom) => {
                  const pts = new Float32Array([0, 0, 0, 0, 24, 0]);
                  geom.setAttribute('position', new THREE.BufferAttribute(pts, 3));
                }}
              />
              <lineBasicMaterial
                attach="material"
                color="#06b6d4"
                transparent
                opacity={0.6}
              />
            </line>

            {/* Floating Spatial HTML Tooltip Card */}
            {item && (
              <Html
                position={[0, 36, 0]}
                center
                zIndexRange={[100, 10]}
                style={{
                  pointerEvents: 'auto',
                  transform: 'translate3d(-50%, -100%, 0)',
                }}
              >
                <FoodTooltipCard
                  item={item}
                  macroItem={macro}
                  detailedItem={detailed}
                  analyzing={analyzing}
                  onAnalyze={onAnalyze}
                  onLogged={onMealLogged}
                />
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
 * Projects 2D vision detections into 3D world/screen coordinates to attach
 * floating spatial tooltip cards directly over detected food items.
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
        pointerEvents: 'none',
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
