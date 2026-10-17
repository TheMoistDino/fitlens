import { useState } from 'react';
import { usePluginHealth, useGlassesState } from '@/app/hooks';
import { registerGlassesAdapter } from '@/lib/sponsors';
import { EvenRealitiesAdapter } from '@/lib/sponsors/smart-glasses/EvenRealitiesAdapter';
import { NullSmartGlassesAdapter } from '@/lib/sponsors/smart-glasses/NullSmartGlassesAdapter';
import { getSummaryPhone, setSummaryPhone } from '@/lib/sponsors/photon/photonPlugin';
import { Badge, Button, Card, StatPill } from '@/ui/primitives';
import { useNutritionHUD } from '@/features/food-scanner/store';
import { sessionLog, useSessionLog } from './useSessionLog';

const fmtTime = (ts: number) => new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function DashboardPage() {
  const log = useSessionLog();
  const health = usePluginHealth();
  const glasses = useGlassesState();
  const { totals, remaining, progress, dailyGoals, setDailyGoals, clearLogs } = useNutritionHUD();
  const [phone, setPhone] = useState(getSummaryPhone() ?? '');
  const [isEditingGoals, setIsEditingGoals] = useState(false);
  const [goalInputs, setGoalInputs] = useState({
    calories: dailyGoals.calories,
    protein: dailyGoals.protein,
    carbs: dailyGoals.carbs,
    fat: dailyGoals.fat,
  });

  const today = new Date().toDateString();
  const todays = log.filter((e) => new Date(e.endedAt).toDateString() === today);
  const burned = todays.reduce((s, e) => s + (e.kind === 'workout' ? e.calories : 0), 0);
  const reps = todays.reduce((s, e) => s + (e.kind === 'workout' ? e.reps : 0), 0);

  const handleSaveGoals = (e: React.FormEvent) => {
    e.preventDefault();
    setDailyGoals(goalInputs);
    setIsEditingGoals(false);
  };

  const handleClearAll = () => {
    sessionLog.clear();
    clearLogs();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatPill label="Eaten today" value={`${totals.calories} kcal`} tone={totals.calories > dailyGoals.calories ? 'warn' : 'good'} />
        <StatPill label="Remaining" value={`${remaining.calories} kcal`} tone="neutral" />
        <StatPill label="Burned today" value={`${burned.toFixed(1)} kcal`} tone="good" />
        <StatPill label="Reps today" value={reps} />
      </div>

      <Card
        title="Nutrition & Macro Targets"
        action={
          <Button variant="ghost" className="text-xs" onClick={() => setIsEditingGoals(!isEditingGoals)}>
            {isEditingGoals ? 'Cancel' : 'Edit targets'}
          </Button>
        }
      >
        {isEditingGoals ? (
          <form onSubmit={handleSaveGoals} className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
              <div>
                <label className="text-neutral-400">Calories (kcal)</label>
                <input
                  type="number"
                  value={goalInputs.calories}
                  onChange={(e) => setGoalInputs({ ...goalInputs, calories: Number(e.target.value) })}
                  className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
                />
              </div>
              <div>
                <label className="text-neutral-400">Protein (g)</label>
                <input
                  type="number"
                  value={goalInputs.protein}
                  onChange={(e) => setGoalInputs({ ...goalInputs, protein: Number(e.target.value) })}
                  className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
                />
              </div>
              <div>
                <label className="text-neutral-400">Carbs (g)</label>
                <input
                  type="number"
                  value={goalInputs.carbs}
                  onChange={(e) => setGoalInputs({ ...goalInputs, carbs: Number(e.target.value) })}
                  className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
                />
              </div>
              <div>
                <label className="text-neutral-400">Fat (g)</label>
                <input
                  type="number"
                  value={goalInputs.fat}
                  onChange={(e) => setGoalInputs({ ...goalInputs, fat: Number(e.target.value) })}
                  className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="submit" variant="primary">Save targets</Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs text-neutral-400 mb-1">
                <span>Calories: {totals.calories} / {dailyGoals.calories} kcal</span>
                <span>{Math.round(progress.calories * 100)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
                <div
                  className="h-full bg-emerald-400 transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.round(progress.calories * 100))}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
              <div className="rounded-lg bg-neutral-800/60 p-2">
                <div className="flex justify-between text-neutral-400 mb-1">
                  <span>Protein</span>
                  <span>{Math.round(totals.protein)}/{dailyGoals.protein}g</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-700">
                  <div
                    className="h-full bg-blue-400 transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.round(progress.protein * 100))}%` }}
                  />
                </div>
              </div>

              <div className="rounded-lg bg-neutral-800/60 p-2">
                <div className="flex justify-between text-neutral-400 mb-1">
                  <span>Carbs</span>
                  <span>{Math.round(totals.carbs)}/{dailyGoals.carbs}g</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-700">
                  <div
                    className="h-full bg-amber-400 transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.round(progress.carbs * 100))}%` }}
                  />
                </div>
              </div>

              <div className="rounded-lg bg-neutral-800/60 p-2">
                <div className="flex justify-between text-neutral-400 mb-1">
                  <span>Fat</span>
                  <span>{Math.round(totals.fat)}/{dailyGoals.fat}g</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-700">
                  <div
                    className="h-full bg-rose-400 transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.round(progress.fat * 100))}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card title="Activity log" action={log.length > 0 && <Button variant="ghost" onClick={handleClearAll}>Clear</Button>}>
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
