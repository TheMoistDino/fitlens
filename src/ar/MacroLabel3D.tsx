import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { FoodBox } from '@/ml/food/ObjectDetectorService';
import type { MacroSummary } from '@/core/events/events';
import { toWorld } from './ArCanvas';

const SLOTS = 3;

interface Props {
  boxesRef: React.RefObject<FoodBox[]>;
  macros: MacroSummary | null;
}

/**
 * Anchors a pulsing 3D frame + floating macro label to each detected food item.
 * Box positions come from a ref (updated by the local detector every frame);
 * the label text comes from React state (updated only when StepFun answers).
 */
export function MacroLabel3D({ boxesRef, macros }: Props) {
  const size = useThree((s) => s.size);
  const groups = useRef<(THREE.Group | null)[]>([]);
  const frames = useRef<(THREE.LineLoop | null)[]>([]);

  const frameGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    return g;
  }, []);
  const frameMat = useMemo(() => new THREE.LineBasicMaterial({ color: '#facc15', transparent: true }), []);

  useFrame(({ clock }) => {
    const boxes = boxesRef.current ?? [];
    frameMat.opacity = 0.6 + 0.4 * Math.sin(clock.elapsedTime * 4);
    for (let i = 0; i < SLOTS; i++) {
      const g = groups.current[i];
      const f = frames.current[i];
      const b = boxes[i];
      if (!g || !f) continue;
      g.visible = !!b;
      if (!b) continue;
      const [cx, cy] = toWorld(b.x + b.w / 2, b.y + b.h / 2, size.width, size.height, false);
      g.position.set(cx, cy, 0);
      f.scale.set(b.w * size.width, b.h * size.height, 1);
    }
  });

  return (
    <>
      {Array.from({ length: SLOTS }, (_, i) => {
        const item = macros?.items[i];
        return (
          <group key={i} ref={(el) => void (groups.current[i] = el)} visible={false}>
            <lineLoop ref={(el) => void (frames.current[i] = el)} geometry={frameGeom} material={frameMat} />
            <Html center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
              <div className="whitespace-nowrap rounded-lg bg-black/70 px-2 py-1 text-xs text-white backdrop-blur">
                {item ? (
                  <>
                    <span className="font-semibold">{item.name}</span> · {Math.round(item.kcal)} kcal
                    <div className="text-[10px] text-neutral-300">
                      P {Math.round(item.protein)}g · C {Math.round(item.carbs)}g · F {Math.round(item.fat)}g
                    </div>
                  </>
                ) : (
                  <span className="text-neutral-300">Food detected · tap Analyze</span>
                )}
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}
