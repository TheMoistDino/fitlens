import { useGlassesState, useFps } from '@/app/hooks';
import { Badge, StatPill } from '@/ui/primitives';
import type { DeviceStatus } from '@/core/events/events';

const statusTone: Record<DeviceStatus, 'neutral' | 'good' | 'warn' | 'bad'> = {
  disabled: 'neutral',
  connecting: 'warn',
  connected: 'good',
  disconnected: 'warn',
  unsupported: 'neutral',
  error: 'bad',
};

/** Browser mirror of the smart-glasses HUD — rendered from the same coalesced payload. */
export function HudPanel() {
  const glasses = useGlassesState();
  const { fps, avgMs } = useFps();
  const { hud } = glasses;
  const alert = hud.formAlert;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatPill label="Reps" value={hud.repCount} tone="good" />
        <StatPill label="kcal" value={(hud.calories ?? 0).toFixed(1)} />
        <StatPill label="FPS" value={fps} tone={fps === 0 ? 'neutral' : fps < 24 ? 'bad' : fps < 45 ? 'warn' : 'good'} />
        <StatPill label="ML ms" value={avgMs} />
      </div>
      <div
        className={`rounded-xl px-3 py-2 text-sm font-medium ${
          alert ? (alert.severity === 'critical' ? 'bg-rose-500/20 text-rose-200' : 'bg-amber-500/20 text-amber-200') : 'bg-emerald-500/10 text-emerald-300'
        }`}
      >
        {alert ? alert.message : 'Form looks good'}
      </div>
      <div className="flex items-center gap-2 text-xs text-neutral-400">
        <span>HUD:</span>
        <Badge tone={statusTone[glasses.status]}>
          {glasses.adapterLabel} · {glasses.status}
        </Badge>
        {glasses.detail && <span className="truncate">{glasses.detail}</span>}
      </div>
    </div>
  );
}
