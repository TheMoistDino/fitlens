import type { GymExercise, ExerciseProfile, NormRect } from '../types';
import { GYM_LIST } from '../exercises/exerciseProfiles';
import { ReferenceLoop } from './ReferenceLoop';

const DEFAULT_BOX: NormRect = { x: 0.15, y: 0.1, w: 0.7, h: 0.8 };

/** AR bracket target anchored over the detected machine (CSS-transitioned between detections). */
export function MachineTarget({ box, detected, scanning }: { box: NormRect | null; detected: boolean; scanning: boolean }) {
  const b = box ?? DEFAULT_BOX;
  const color = detected ? 'border-emerald-400' : 'border-white/70';
  const corner = `absolute h-8 w-8 ${color}`;
  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        className="absolute transition-all duration-500 ease-out"
        style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
      >
        <span className={`${corner} left-0 top-0 rounded-tl-lg border-l-4 border-t-4`} />
        <span className={`${corner} right-0 top-0 rounded-tr-lg border-r-4 border-t-4`} />
        <span className={`${corner} bottom-0 left-0 rounded-bl-lg border-b-4 border-l-4`} />
        <span className={`${corner} bottom-0 right-0 rounded-br-lg border-b-4 border-r-4`} />
        {scanning && !detected && <span className="absolute inset-x-2 top-1/2 h-0.5 animate-pulse bg-emerald-300/80" />}
      </div>
      {!detected && (
        <p className="absolute inset-x-0 bottom-3 text-center text-xs font-medium text-white drop-shadow">
          {scanning ? 'Identifying machine…' : 'Point the camera at the machine'}
        </p>
      )}
    </div>
  );
}

/** Floating PiP card: machine identity, muscles, animated reference loop and the primary CTA. */
export function MachinePipCard({
  profile,
  confidence,
  source,
  onConfirm,
  onPick,
}: {
  profile: ExerciseProfile;
  confidence: number;
  source: 'stepfun' | 'mock' | null;
  onConfirm: () => void;
  onPick: (m: GymExercise) => void;
}) {
  return (
    <div className="pointer-events-auto absolute bottom-2 right-2 max-h-[calc(100%-1rem)] w-60 overflow-auto rounded-2xl border border-neutral-700 bg-neutral-900/90 p-2 shadow-2xl backdrop-blur sm:w-72">
      <div className="flex gap-2">
        <ReferenceLoop profile={profile} className="h-20 w-20 shrink-0 sm:h-24 sm:w-24" />
        <div className="min-w-0">
          <p className="text-sm font-bold leading-tight text-white">{profile.name}</p>
          <p className="text-[11px] leading-snug text-neutral-400">{profile.muscles}</p>
          <p className="text-[10px] text-neutral-500">
            {Math.round(confidence * 100)}% match{source === 'mock' ? ' · demo' : ''}
          </p>
        </div>
      </div>
      <div className="mt-2 space-y-1.5">
        <button onClick={onConfirm} className="w-full rounded-lg bg-emerald-500 px-2 py-2 text-xs font-bold text-black hover:bg-emerald-400">
          Select Weight &amp; Start Set
        </button>
        <select
          aria-label="Pick a different machine"
          value=""
          onChange={(e) => e.target.value && onPick(e.target.value as GymExercise)}
          className="w-full rounded-lg bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300"
        >
          <option value="">Not this machine?</option>
          {GYM_LIST.filter((m) => m.id !== profile.id).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
