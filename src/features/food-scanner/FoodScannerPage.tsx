import { useCameraStream } from '@/services/camera/useCameraStream';
import { ArCanvas } from '@/ar/ArCanvas';
import { MacroLabel3D } from '@/ar/MacroLabel3D';
import { CameraViewport } from '@/ui/CameraViewport';
import { Badge, Button, Card, StatPill } from '@/ui/primitives';
import { useFoodScan } from './useFoodScan';

export default function FoodScannerPage() {
  const scan = useFoodScan();
  const camera = useCameraStream({ facingMode: 'environment', onFrame: scan.onFrame });
  const mirror = camera.facingMode === 'user';
  const m = scan.macros;
  const totals = m?.items.reduce((t, i) => ({ p: t.p + i.protein, c: t.c + i.carbs, f: t.f + i.fat }), { p: 0, c: 0, f: 0 });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">WebAR Macro Tracker</h1>
          <p className="text-sm text-neutral-400">Point at your plate, then tap Analyze</p>
        </div>
        <div className="flex items-center gap-2">
          {scan.stabilityDetected && (
            <Badge tone="good">
              Frame Stable
            </Badge>
          )}
          <Badge tone={scan.detectorReady ? 'good' : scan.detectorReady === false ? 'warn' : 'neutral'}>
            Local detector: {scan.detectorReady === null ? 'loading' : scan.detectorReady ? 'ready' : 'off'}
          </Badge>
        </div>
      </header>

      <CameraViewport videoRef={camera.videoRef} status={camera.status} error={camera.error} mirror={mirror} onRetry={() => void camera.start()}>
        <ArCanvas>
          <MacroLabel3D boxesRef={scan.boxesRef} macros={scan.macros} />
        </ArCanvas>
      </CameraViewport>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void scan.analyze()} disabled={camera.status !== 'streaming' || scan.analyzing}>
          {scan.analyzing ? 'Analyzing…' : 'Analyze plate'}
        </Button>
        <Button variant="secondary" onClick={() => void camera.switchCamera()}>Flip camera</Button>
        {m && <Button variant="secondary" onClick={scan.logMeal}>Log meal</Button>}
      </div>

      {scan.error && <p className="text-sm text-rose-300">{scan.error}</p>}

      {m && totals && (
        <Card title="Macros" action={<Badge tone={m.source === 'stepfun' ? 'good' : 'warn'}>{m.source}</Badge>}>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatPill label="kcal" value={m.totalKcal} tone="good" />
            <StatPill label="Protein" value={`${Math.round(totals.p)}g`} />
            <StatPill label="Carbs" value={`${Math.round(totals.c)}g`} />
            <StatPill label="Fat" value={`${Math.round(totals.f)}g`} />
          </div>
          <ul className="divide-y divide-neutral-800 text-sm">
            {m.items.map((i, idx) => {
              const detailed = scan.detailedItems[idx];
              return (
                <li key={`${i.name}-${idx}`} className="flex items-center justify-between py-1.5">
                  <div>
                    <span className="font-medium">{i.name}</span>
                    {detailed && (
                      <span className="ml-2 text-xs text-neutral-400">
                        {detailed.estimatedWeightGrams}g · {Math.round(detailed.confidenceScore * 100)}% conf
                      </span>
                    )}
                  </div>
                  <span className="tabular-nums text-neutral-400">{Math.round(i.kcal)} kcal</span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
