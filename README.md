# FitLens

Real-time WebAR fitness and nutrition coach for LA Hacks. It does on-device pose tracking and food detection with MediaPipe WASM, draws Three.js overlays, and connects sponsor integrations (StepFun, Fetch.ai, Photon, Sentry, Even Realities) as plugins.

```bash
cp .env.example .env     # every key is optional — the app runs fully in mock mode
npm install
npm run dev              # Vite on :5173 + API proxy on :8787
```

Pages: `/workout` (Pose Form Coach), `/scan` (WebAR Macro Tracker), `/dashboard` (logs, sponsor health, glasses, Photon opt-in).

The camera only works on `localhost` or HTTPS. To test on a phone, tunnel the dev server (for example `npx cloudflared tunnel --url http://localhost:5173`).

See [ARCHITECTURE.md](ARCHITECTURE.md) for the design.
