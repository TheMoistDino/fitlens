import type { NormRect, WeightUnit } from '../types';
import type { SmootherState } from '../ocr/weightParser';
import { LOCK_FRAMES, weightStep } from '../ocr/weightParser';

/** Centre ROI guide with a 3-dot lock indicator. Everything outside the box is dimmed. */
export function WeightRoiOverlay({ roi, progress, ocrStatus }: { roi: NormRect; progress: SmootherState; ocrStatus: string }) {
  const locked = !!progress.locked;
  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        className={`absolute rounded-xl border-4 transition-colors ${locked ? 'border-emerald-400' : 'border-white/80'}`}
        style={{
          left: `${roi.x * 100}%`,
          top: `${roi.y * 100}%`,
          width: `${roi.w * 100}%`,
          height: `${roi.h * 100}%`,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
        }}
      >
        {progress.candidate && (
          <span className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-black/70 px-2 py-0.5 text-sm font-bold text-white">
            {progress.candidate.value} {progress.candidate.unit}
          </span>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-3 flex flex-col items-center gap-1.5">
        <div className="flex gap-1.5">
          {Array.from({ length: LOCK_FRAMES }, (_, i) => (
            <span key={i} className={`h-2.5 w-2.5 rounded-full ${i < progress.streak ? 'bg-emerald-400' : 'bg-white/40'}`} />
          ))}
        </div>
        <p className="text-xs font-medium text-white drop-shadow">
          {locked
            ? 'Weight locked'
            : ocrStatus === 'loading'
              ? 'Loading text reader…'
              : ocrStatus === 'error'
                ? 'Scanner unavailable — set the weight below'
                : 'Line up the pinned weight number in the box'}
        </p>
      </div>
    </div>
  );
}

/** Inline manual adjustment: always available for glare / occlusion. */
export function WeightAdjuster({
  value,
  unit,
  source,
  onChange,
  onUnitChange,
  onRescan,
}: {
  value: number | null;
  unit: WeightUnit;
  source: 'ocr' | 'manual' | null;
  onChange: (value: number) => void;
  onUnitChange: (unit: WeightUnit) => void;
  onRescan: () => void;
}) {
  const step = weightStep(unit);
  const v = value ?? (unit === 'kg' ? 20 : 50);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center overflow-hidden rounded-xl border border-neutral-700">
        <button aria-label={`Decrease ${step} ${unit}`} className="px-4 py-2 text-lg font-bold hover:bg-neutral-800" onClick={() => onChange(Math.max(step, v - step))}>
          −
        </button>
        <span className="min-w-24 px-2 text-center text-lg font-bold tabular-nums">
          {value === null ? '—' : value} <span className="text-sm text-neutral-400">{unit}</span>
        </span>
        <button aria-label={`Increase ${step} ${unit}`} className="px-4 py-2 text-lg font-bold hover:bg-neutral-800" onClick={() => onChange(v + step)}>
          +
        </button>
      </div>
      <button
        className="rounded-xl bg-neutral-800 px-3 py-2 text-sm font-semibold hover:bg-neutral-700"
        onClick={() => onUnitChange(unit === 'lb' ? 'kg' : 'lb')}
        aria-label="Switch units"
      >
        {unit === 'lb' ? 'lb → kg' : 'kg → lb'}
      </button>
      <button className="rounded-xl px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800" onClick={onRescan}>
        Rescan
      </button>
      {source && <span className="text-xs text-neutral-500">{source === 'ocr' ? 'from scan' : 'set manually'}</span>}
    </div>
  );
}
