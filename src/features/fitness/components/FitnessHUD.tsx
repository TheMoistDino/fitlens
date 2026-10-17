import { useEffect, useRef } from 'react';
import type { BoneGroup, BoneStatus, FormCue, FormSnapshot, PoseFrame, RepPhase, WeightUnit } from '../types';

/**
 * ACTIVE_SET overlay, stacked on the camera <video> at the same aspect ratio.
 *
 * Two layers, two frequencies:
 *  - <canvas>: skeleton drawn in its own requestAnimationFrame loop from mutable refs (poseRef/formRef).
 *    No React render per frame. The set timer is written straight to a DOM node in the same loop.
 *  - DOM badges (reps, phase, load, cue toast): React props that change only on rep/phase/cue events.
 */

const BONES: Record<BoneGroup, ReadonlyArray<readonly [number, number]>> = {
  torso: [[11, 12], [11, 23], [12, 24], [23, 24]],
  leftArm: [[11, 13], [13, 15]],
  rightArm: [[12, 14], [14, 16]],
  leftLeg: [[23, 25], [25, 27]],
  rightLeg: [[24, 26], [26, 28]],
};
const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const COLOR: Record<BoneStatus, string> = { good: '#34d399', warn: '#f59e0b', bad: '#ef4444' };

const PHASE_LABEL: Record<RepPhase, { text: string; cls: string }> = {
  READY: { text: 'Pause', cls: 'bg-neutral-700/80 text-neutral-200' },
  ECCENTRIC: { text: 'Eccentric', cls: 'bg-sky-500/80 text-white' },
  INFLECTION: { text: 'Pause', cls: 'bg-violet-500/80 text-white' },
  CONCENTRIC: { text: 'Concentric', cls: 'bg-emerald-500/80 text-black' },
  REP_COMPLETED: { text: 'Rep!', cls: 'bg-emerald-400 text-black' },
};

interface Props {
  poseRef: React.RefObject<PoseFrame | null>;
  formRef: React.RefObject<FormSnapshot | null>;
  mirror: boolean;
  repCount: number;
  phase: RepPhase;
  cue: FormCue | null;
  load: { value: number; unit: WeightUnit } | null;
  /** performance.now() when the set started. */
  startedAt: number | null;
  machineName: string;
}

export function FitnessHUD({ poseRef, formRef, mirror, repCount, phase, cue, load, startedAt, machineName }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<HTMLSpanElement>(null);
  const mirrorRef = useRef(mirror);
  const startedRef = useRef(startedAt);
  mirrorRef.current = mirror;
  startedRef.current = startedAt;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    // Keep the backing store matched to CSS size × DPR (crisp lines, correct coords).
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    let lastDrawnT = -1;
    let lastTimerText = '';
    const draw = () => {
      raf = requestAnimationFrame(draw);

      const started = startedRef.current;
      if (timerRef.current && started !== null) {
        const s = Math.max(0, Math.floor((performance.now() - started) / 1000));
        const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        if (text !== lastTimerText) timerRef.current.textContent = lastTimerText = text;
      }

      const frame = poseRef.current;
      if (frame?.t === lastDrawnT) return; // no new pose → nothing to redraw
      lastDrawnT = frame?.t ?? -1;
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      if (!frame) return;

      const lm = frame.image;
      const px = (i: number): [number, number] | null => {
        const p = lm[i];
        if (!p || (p.visibility ?? 1) < 0.4) return null;
        return [(mirrorRef.current ? 1 - p.x : p.x) * W, p.y * H];
      };
      const bones = formRef.current?.bones;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(3, W / 160);
      for (const group of Object.keys(BONES) as BoneGroup[]) {
        ctx.strokeStyle = COLOR[bones?.[group] ?? 'good'];
        ctx.beginPath();
        for (const [a, b] of BONES[group]) {
          const A = px(a), B = px(b);
          if (!A || !B) continue;
          ctx.moveTo(A[0], A[1]);
          ctx.lineTo(B[0], B[1]);
        }
        ctx.stroke();
      }
      ctx.fillStyle = '#ffffff';
      const r = Math.max(3, W / 220);
      for (const j of JOINTS) {
        const P = px(j);
        if (!P) continue;
        ctx.beginPath();
        ctx.arc(P[0], P[1], r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [poseRef, formRef]);

  const phaseInfo = PHASE_LABEL[phase];

  return (
    <div className="pointer-events-none absolute inset-0">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* top bar: machine · timer · load */}
      <div className="absolute inset-x-2 top-2 flex items-start justify-between gap-2 text-xs">
        <span className="rounded-lg bg-black/60 px-2 py-1 font-semibold text-white backdrop-blur">{machineName}</span>
        <span className="flex gap-2">
          <span ref={timerRef} className="rounded-lg bg-black/60 px-2 py-1 font-mono tabular-nums text-white backdrop-blur">0:00</span>
          {load && (
            <span className="rounded-lg bg-amber-400 px-2 py-1 font-bold text-black">
              {load.value} {load.unit}
            </span>
          )}
        </span>
      </div>

      {/* rep badge + phase */}
      <div className="absolute bottom-3 left-3 flex items-end gap-2">
        <div className="grid h-20 w-20 place-items-center rounded-2xl bg-black/70 backdrop-blur sm:h-24 sm:w-24">
          <span className="text-4xl font-black tabular-nums text-white sm:text-5xl">{repCount}</span>
        </div>
        <span className={`rounded-lg px-2 py-1 text-xs font-bold uppercase tracking-wide ${phaseInfo.cls}`}>{phaseInfo.text}</span>
      </div>

      {/* form toast */}
      {cue && (
        <div
          role="status"
          className={`absolute inset-x-0 top-12 mx-auto w-fit max-w-[90%] rounded-xl px-3 py-2 text-center text-sm font-semibold shadow-lg ${
            cue.severity === 'critical' ? 'bg-rose-600 text-white' : cue.severity === 'warn' ? 'bg-amber-400 text-black' : 'bg-neutral-800 text-white'
          }`}
        >
          {cue.message}
        </div>
      )}
    </div>
  );
}
