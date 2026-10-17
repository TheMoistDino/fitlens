import { useState } from 'react';
import { usePluginHealth, useGlassesState } from '@/app/hooks';
import { registerGlassesAdapter } from '@/lib/sponsors';
import { EvenRealitiesAdapter } from '@/lib/sponsors/smart-glasses/EvenRealitiesAdapter';
import { NullSmartGlassesAdapter } from '@/lib/sponsors/smart-glasses/NullSmartGlassesAdapter';
import { getSummaryPhone, setSummaryPhone } from '@/lib/sponsors/photon/photonPlugin';
import { Badge, Button, Card, StatPill } from '@/ui/primitives';
import { sessionLog, useSessionLog } from './useSessionLog';

const fmtTime = (ts: number) => new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function DashboardPage() {
  const log = useSessionLog();
  const health = usePluginHealth();
  const glasses = useGlassesState();
  const [phone, setPhone] = useState(getSummaryPhone() ?? '');

  const today = new Date().toDateString();
  const todays = log.filter((e) => new Date(e.endedAt).toDateString() === today);
  const burned = todays.reduce((s, e) => s + (e.kind === 'workout' ? e.calories : 0), 0);
  const eaten = todays.reduce((s, e) => s + (e.kind === 'meal' ? e.macros.totalKcal : 0), 0);
  const reps = todays.reduce((s, e) => s + (e.kind === 'workout' ? e.reps : 0), 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-3 gap-2">
        <StatPill label="Eaten today" value={`${eaten} kcal`} />
        <StatPill label="Burned today" value={`${burned.toFixed(1)} kcal`} tone="good" />
        <StatPill label="Reps today" value={reps} />
      </div>

      <Card title="Activity log" action={log.length > 0 && <Button variant="ghost" onClick={sessionLog.clear}>Clear</Button>}>
        {log.length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing logged yet. Finish a set or scan a meal.</p>
        ) : (
          <ul className="divide-y divide-neutral-800 text-sm">
            {log.slice(0, 30).map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  {e.kind === 'workout' ? `🏋️ ${e.reps} × ${e.exercise}` : `🥗 ${e.macros.items.map((i) => i.name).join(', ') || 'Meal'}`}
                  {e.kind === 'workout' && e.alerts.length > 0 && <span className="ml-2 text-xs text-amber-300">{e.alerts.length} form cue(s)</span>}
                </span>
                <span className="shrink-0 text-xs text-neutral-500">
                  {e.kind === 'workout' ? `${e.calories.toFixed(1)} kcal burned` : `${e.macros.totalKcal} kcal`} · {fmtTime(e.endedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Sponsor integrations">
        <ul className="space-y-2 text-sm">
          {health.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-2">
              <span>{h.label}</span>
              <span className="flex min-w-0 items-center gap-2">
                {h.detail && <span className="truncate text-xs text-neutral-500">{h.detail}</span>}
                <Badge tone={!h.ok ? 'bad' : h.mode === 'live' ? 'good' : h.mode === 'mock' ? 'warn' : 'neutral'}>{h.mode}</Badge>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Smart glasses">
        <p className="mb-3 text-sm text-neutral-400">
          Active: <span className="text-neutral-200">{glasses.adapterLabel}</span> — {glasses.status}
          {glasses.detail ? ` (${glasses.detail})` : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void registerGlassesAdapter(new EvenRealitiesAdapter())}>Connect Even Realities</Button>
          <Button variant="ghost" onClick={() => void registerGlassesAdapter(new NullSmartGlassesAdapter(true))}>Use browser only</Button>
        </div>
      </Card>

      <Card title="Post-workout text (Photon)">
        <form
          className="flex gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            setSummaryPhone(phone.trim() || null);
          }}
        >
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 123 4567"
            className="min-w-0 flex-1 rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
          <Button type="submit" variant="secondary">Save</Button>
        </form>
        <p className="mt-2 text-xs text-neutral-500">Stored only on this device. Leave empty to turn summaries off.</p>
      </Card>
    </div>
  );
}
