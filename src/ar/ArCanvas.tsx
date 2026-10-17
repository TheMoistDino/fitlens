import { Canvas } from '@react-three/fiber';
import type { ReactNode } from 'react';

/**
 * Transparent Three.js layer stacked on top of the <video>.
 * Uses R3F's default orthographic camera at zoom 1, so 1 world unit = 1 CSS pixel with the
 * origin at the centre. `toWorld()` maps normalised MediaPipe coords into that space.
 *
 * `frameloop="always"` keeps rendering in sync with the display; children read ML output from
 * refs inside `useFrame`, so React never re-renders at 60 FPS.
 */
export function ArCanvas({ children }: { children: ReactNode }) {
  return (
    <Canvas
      orthographic
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      dpr={[1, 2]}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      fallback={null /* WebGL unavailable → overlay simply doesn't render */}
    >
      {children}
    </Canvas>
  );
}

/** Normalised [0..1] video coords → ortho world coords. Mirrors X for the selfie camera. */
export function toWorld(x: number, y: number, width: number, height: number, mirror: boolean): [number, number] {
  const nx = mirror ? 1 - x : x;
  return [(nx - 0.5) * width, (0.5 - y) * height];
}
