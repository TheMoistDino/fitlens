import { Card, StatPill } from '@/ui/primitives';
import { EXERCISE_PROFILES } from '../exercises/exerciseProfiles';
import type { FormFlagCode, SetSummary } from '../types';

const FLAG_LABEL: Record<FormFlagCode, string> = {
  torso_swing: 'Torso swing',
  torso_lean: 'Leaning forward',
  hip_sag: 'Hips out of line',
  asymmetry: 'Uneven sides',
  fast_eccentric: 'Rushed eccentric',
  short_rom_end: 'Short range (end)',
  short_rom_start: 'Short range (start)',
};

export function SetSummaryCard({ summary }: { summary: SetSummary }) {
  const profile = EXERCISE_PROFILES[summary.exercise];
  const flags = Object.entries(summary.formFlags) as Array<[FormFlagCode, number]>;
  const secs = Math.round(summary.durationMs / 1000);
  return (
    <Card title={`Set summary · ${profile.name}`}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatPill label="Reps" value={summary.reps} tone="good" />
        <StatPill label="Load" value={summary.load ? `${summary.load.value} ${summary.load.unit}` : '—'} />
        <StatPill
          label="Tempo E-P-C"
          value={summary.reps ? `${summary.tempo.eccentric}-${summary.tempo.pause}-${summary.tempo.concentric}` : '—'}
        />
        <StatPill label="s / rep" value={summary.meanRepSeconds || '—'} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-400">
        <span>Duration {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>
        <span>Partial reps {summary.partialReps}</span>
        <span>~{summary.calories} kcal</span>
      </div>
      <div className="mt-3">
        {flags.length === 0 ? (
          <p className="text-sm text-emerald-300">Clean set — no form flags.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {flags.map(([code, n]) => (
              <li key={code} className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs text-amber-200">
                {FLAG_LABEL[code]} × {n}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
