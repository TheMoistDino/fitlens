# FitLens architecture

## 1. Directory map

```
server/index.ts                  Hono proxy: holds every sponsor secret, mocks when keys are absent
src/
  main.tsx                       initSentry → registerPlugins(defaultPlugins()) → <App/>
  App.tsx                        Router, NavBar, per-route Sentry.ErrorBoundary + Suspense
  app/          routes.tsx (lazy pages) · providers.tsx (toasts from bus events) · hooks.ts
  config/env.ts                  typed flags (VITE_ENABLE_EVEN_REALITIES, …), safe defaults
  core/                          no React, no sponsors
    events/EventBus.ts           typed pub/sub, sync|async dispatch, listener error isolation
    events/events.ts             SponsorEventMap — the only contract producers & consumers share
    scheduling/throttle.ts       throttle, LatestOnlyQueue, fetchWithTimeout
    result.ts                    Result<T> for network/hardware failures
  services/camera/               useCameraStream (rVFC/rAF loop) · captureKeyframe
  ml/                            on-device WASM (MediaPipe Tasks Vision)
    visionRuntime.ts             shared WASM fileset, monotonic clock
    pose/                        PoseLandmarkerService · repCounter · formRules · geometry
    food/ObjectDetectorService   local food localisation for AR anchors
  ar/                            Three.js via R3F: ArCanvas · SkeletonOverlay · MacroLabel3D
  features/
    workout/                     WorkoutPage · useWorkoutSession · HudPanel
    food-scanner/                FoodScannerPage · useFoodScan
    dashboard/                   DashboardPage · useSessionLog (localStorage)
  lib/sponsors/
    SponsorEventBus.ts           bus singleton + plugin registry + health
    types.ts                     SponsorPlugin interface
    index.ts                     defaultPlugins() — add/remove a sponsor here
    stepfun/                     StepFunClient · stepfunPlugin (keyframe → macros / coaching)
    fetchai/                     AgentDiscoveryClient · fetchaiPlugin
    photon/                      PhotonClient · photonPlugin (workout:ended → SMS)
    sentry/                      sentry.ts (init) · frameProfiler.ts (WASM frame drops)
    smart-glasses/
      SmartGlassesAdapter.ts     interface
      NullSmartGlassesAdapter.ts default no-op
      EvenRealitiesAdapter.ts    HUD formatter + EvenHubTransport shell (TODO(sdk))
      createGlassesAdapter.ts    flag + capability check → adapter, else Null
      glassesPlugin.ts           GlassesController: coalesce, throttle, reconnect, fallback
  ui/                            primitives, NavBar, CameraViewport
```

Dependency direction: `features → (services, ml, ar, lib/sponsors) → core`. `core` imports nothing app-specific; sponsors never import features.

## 2. Dual-frequency strategy: Event Bus + Observer

```
 60 FPS hot path (main thread, never awaits network)
 ┌───────────────┐   ┌──────────────────┐   ┌────────────────────┐
 │ useCameraStream│──▶│ Pose / Detector   │──▶│ landmarksRef/boxes │──▶ R3F useFrame (GPU)
 │ rVFC per frame │   │ detectForVideo()  │   └────────────────────┘
 └───────────────┘   └────────┬─────────┘
                              │ RepCounter / FormEvaluator (state machines)
                              ▼ emit ONLY on change
                   ┌──────────────────────┐
                   │   SponsorEventBus    │  rep:completed · form:alert · keyframe:captured
                   └──┬───────┬───────┬───┘  workout:ended · macro:result · device:status
       sync, O(1)     │       │       │  async (microtask), try/catch per listener
   ┌──────────────────▼┐  ┌───▼─────┐ ┌▼──────────┐
   │ GlassesController │  │ StepFun │ │ Photon /  │   ~0.1–1 Hz cold path
   │ coalesce→4 Hz HUD │  │ latest- │ │ Fetch.ai  │
   └───────┬───────────┘  │ only Q  │ └───────────┘
           ▼              └─────────┘
   SmartGlassesAdapter (Null | EvenRealities)
```

- **Per-frame data never touches React state or the bus.** It lives in refs read by `useFrame`.
- **The bus carries state changes**, not frames: a rep, a new form alert, one keyframe every `VITE_STEPFUN_KEYFRAME_INTERVAL_S`.
- **Cold-path listeners are async by default** (`queueMicrotask`) and each is wrapped in try/catch, with errors routed to Sentry tagged by plugin. A slow or throwing sponsor can't stall or crash the frame loop.
- **Backpressure:** StepFun uses a `LatestOnlyQueue` (one request in flight; newer keyframes replace queued ones). The HUD is throttled to 4 Hz and skips identical frames.

## Hardware / API failure handling

| Failure | Behaviour |
|---|---|
| Flag off (default) | `NullSmartGlassesAdapter`, status `disabled`. App is 100% browser. |
| Flag on, no bridge/SDK | `isSupported()` false → Null adapter + "glasses unavailable" toast. |
| `connect()` rejects | Exponential backoff 1→2→4→8→16 s, then falls back to Null. |
| Disconnect mid-workout | Status `disconnected`, HUD frames dropped (no backlog), auto-reconnect. Browser HUD keeps working. |
| `sendHud()` rejects | Caught, reported to Sentry, next frame tries again. |
| Camera denied / missing / busy | Typed `CameraError` → retry card. One automatic retry with relaxed constraints. |
| WebGL / GPU delegate missing | MediaPipe falls back to CPU; R3F `fallback` renders nothing; page still usable. |
| Model download fails | "Tracking unavailable" notice; navigation, scanner and dashboard unaffected. |
| Sponsor API down / no key | Proxy returns mock data; plugin health shows `mock`. |
| Uncaught render error | Per-route `Sentry.ErrorBoundary` with "Reload section". |

## Turning on Even Realities

1. Implement `EvenHubTransport` in `EvenRealitiesAdapter.ts` (the `TODO(sdk)` blocks).
2. Either set `VITE_ENABLE_EVEN_REALITIES=true`, or tap **Connect Even Realities** on the Dashboard (`registerGlassesAdapter(new EvenRealitiesAdapter())`).

Nothing else changes: producers still emit `rep:completed` / `form:alert` / `macro:result`.
