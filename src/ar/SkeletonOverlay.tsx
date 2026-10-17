import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Landmarks } from '@/ml/pose/PoseLandmarkerService';
import { SKELETON_EDGES } from '@/ml/pose/geometry';
import { toWorld } from './ArCanvas';

const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const OK_COLOR = new THREE.Color('#34d399');
const ALERT_COLOR = new THREE.Color('#f87171');

interface Props {
  /** Written by the ML loop every frame; read here in useFrame. */
  landmarksRef: React.RefObject<Landmarks | null>;
  /** True while a form alert is active (ref, so toggling doesn't re-render). */
  alertRef: React.RefObject<boolean>;
  mirror: boolean;
}

/** GPU-side skeleton: one LineSegments + one Points, buffers mutated in place each frame. */
export function SkeletonOverlay({ landmarksRef, alertRef, mirror }: Props) {
  const size = useThree((s) => s.size);
  const lines = useRef<THREE.LineSegments>(null);
  const points = useRef<THREE.Points>(null);

  const { lineGeom, pointGeom } = useMemo(() => {
    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SKELETON_EDGES.length * 2 * 3), 3));
    const pointGeom = new THREE.BufferGeometry();
    pointGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(JOINTS.length * 3), 3));
    return { lineGeom, pointGeom };
  }, []);

  const lineMat = useMemo(() => new THREE.LineBasicMaterial({ color: OK_COLOR, transparent: true, opacity: 0.9 }), []);
  const pointMat = useMemo(() => new THREE.PointsMaterial({ color: '#ffffff', size: 8, sizeAttenuation: false }), []);

  useFrame(() => {
    const lms = landmarksRef.current;
    const visible = !!lms;
    if (lines.current) lines.current.visible = visible;
    if (points.current) points.current.visible = visible;
    if (!lms) return;

    const lp = lineGeom.getAttribute('position') as THREE.BufferAttribute;
    SKELETON_EDGES.forEach(([a, b], i) => {
      const A = lms[a], B = lms[b];
      if (!A || !B) return;
      const [ax, ay] = toWorld(A.x, A.y, size.width, size.height, mirror);
      const [bx, by] = toWorld(B.x, B.y, size.width, size.height, mirror);
      lp.setXYZ(i * 2, ax, ay, 0);
      lp.setXYZ(i * 2 + 1, bx, by, 0);
    });
    lp.needsUpdate = true;

    const pp = pointGeom.getAttribute('position') as THREE.BufferAttribute;
    JOINTS.forEach((j, i) => {
      const L = lms[j];
      if (!L) return;
      const [x, y] = toWorld(L.x, L.y, size.width, size.height, mirror);
      pp.setXYZ(i, x, y, 1);
    });
    pp.needsUpdate = true;

    lineMat.color.copy(alertRef.current ? ALERT_COLOR : OK_COLOR);
  });

  return (
    <>
      <lineSegments ref={lines} geometry={lineGeom} material={lineMat} frustumCulled={false} />
      <points ref={points} geometry={pointGeom} material={pointMat} frustumCulled={false} />
    </>
  );
}
