import { useEffect, useRef } from 'react';
import type { MachineProfile, StickPose } from '../types';

/**
 * Lightweight animated vector skeleton demonstrating textbook range and tempo for a machine.
 * Interpolates between the profile's start/end poses on a requestAnimationFrame loop and writes
 * SVG attributes directly — no React re-render per frame.
 *
 * Cycle: first phase → pause → second phase → short rest, timed from profile.tempo.
 */
const BONES: Array<[keyof StickPose, keyof StickPose]> = [
  ['head', 'shoulder'],
  ['shoulder', 'elbow'],
  ['elbow', 'wrist'],
  ['shoulder', 'hip'],
  ['hip', 'knee'],
  ['knee', 'ankle'],
];
const REST_S = 0.4;
const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

function lerpPose(a: StickPose, b: StickPose, k: number): StickPose {
  const out = {} as StickPose;
  for (const key of Object.keys(a) as Array<keyof StickPose>) {
    out[key] = [a[key][0] + (b[key][0] - a[key][0]) * k, a[key][1] + (b[key][1] - a[key][1]) * k];
  }
  return out;
}

export function ReferenceLoop({ profile, className }: { profile: MachineProfile; className?: string }) {
  const linesRef = useRef<(SVGLineElement | null)[]>([]);
  const headRef = useRef<SVGCircleElement>(null);
  const labelRef = useRef<SVGTextElement>(null);

  useEffect(() => {
    const { tempo, firstPhase, reference } = profile;
    const first = firstPhase === 'ECCENTRIC' ? tempo.eccentric : tempo.concentric;
    const second = firstPhase === 'ECCENTRIC' ? tempo.concentric : tempo.eccentric;
    const secondName = firstPhase === 'ECCENTRIC' ? 'CONCENTRIC' : 'ECCENTRIC';
    const total = first + tempo.pause + second + REST_S;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const t0 = performance.now();

    const render = (pose: StickPose, label: string) => {
      BONES.forEach(([a, b], i) => {
        const el = linesRef.current[i];
        if (!el) return;
        el.setAttribute('x1', String(pose[a][0]));
        el.setAttribute('y1', String(pose[a][1]));
        el.setAttribute('x2', String(pose[b][0]));
        el.setAttribute('y2', String(pose[b][1]));
      });
      headRef.current?.setAttribute('cx', String(pose.head[0]));
      headRef.current?.setAttribute('cy', String(pose.head[1]));
      if (labelRef.current && labelRef.current.textContent !== label) labelRef.current.textContent = label;
    };

    if (reduceMotion) {
      render(reference.end, `${tempo.eccentric}-${tempo.pause}-${tempo.concentric}`);
      return;
    }

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const s = ((now - t0) / 1000) % total;
      let k: number;
      let label: string;
      if (s < first) {
        k = ease(s / first);
        label = `${firstPhase} ${first}s`;
      } else if (s < first + tempo.pause) {
        k = 1;
        label = `PAUSE ${tempo.pause}s`;
      } else if (s < first + tempo.pause + second) {
        k = 1 - ease((s - first - tempo.pause) / second);
        label = `${secondName} ${second}s`;
      } else {
        k = 0;
        label = 'READY';
      }
      render(lerpPose(reference.start, reference.end, k), label);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [profile]);

  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label={`${profile.name} reference form`}>
      <rect x="0" y="0" width="100" height="100" rx="8" className="fill-neutral-950" />
      {BONES.map((_, i) => (
        <line key={i} ref={(el) => void (linesRef.current[i] = el)} stroke="#34d399" strokeWidth="3.5" strokeLinecap="round" />
      ))}
      <circle ref={headRef} r="5" fill="#34d399" />
      <text ref={labelRef} x="50" y="97" textAnchor="middle" fontSize="7" className="fill-neutral-400 font-mono" />
    </svg>
  );
}
