/**
 * FitLens API proxy — the only place sponsor secrets live.
 *
 *   POST /api/stepfun/analyze   keyframe → StepFun step-5-preview (multimodal) → validated JSON
 *   GET  /api/agents/discover   Fetch.ai / ASI:One agent discovery (forwards to FETCH_AGENT_URL)
 *   POST /api/agents/ask        message a discovered agent
 *   POST /api/photon/summary    send post-workout SMS / voice via Photon
 *
 * Every route degrades to a realistic mock when its key/URL is missing, so the full demo runs offline.
 */
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { z } from 'zod';

const cfg = {
  port: Number(process.env.API_PORT ?? 8787),
  stepfun: {
    key: process.env.STEPFUN_API_KEY ?? '',
    base: process.env.STEPFUN_BASE_URL ?? 'https://api.stepfun.com/v1',
    model: process.env.STEPFUN_MODEL ?? 'step-5-preview',
  },
  fetchAgentUrl: process.env.FETCH_AGENT_URL ?? '',
  photon: { key: process.env.PHOTON_API_KEY ?? '', base: process.env.PHOTON_BASE_URL ?? '', from: process.env.PHOTON_FROM_NUMBER ?? '' },
};

const app = new Hono();
app.use('*', logger());

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fn(c.signal);
  } finally {
    clearTimeout(t);
  }
}

/** Pull the first JSON object out of a model reply (tolerates ```json fences / prose). */
function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in model reply');
  return JSON.parse(text.slice(start, end + 1));
}

// ---------------------------------------------------------------- StepFun
const AnalyzeBody = z.object({
  mode: z.enum(['food', 'pose', 'machine']),
  imageDataUrl: z.string().startsWith('data:image/').max(4_000_000),
  context: z.string().max(500).optional(),
});

const FoodItems = z.object({
  items: z
    .array(z.object({ name: z.string(), kcal: z.coerce.number(), protein: z.coerce.number(), carbs: z.coerce.number(), fat: z.coerce.number(), confidence: z.coerce.number().optional() }))
    .max(10),
});
const PoseNotes = z.object({ formNotes: z.string() });
const MACHINES = ['lat_pulldown', 'chest_press', 'seated_row', 'leg_extension', 'unknown'] as const;
const MachineGuess = z.object({
  machine: z.enum(MACHINES).catch('unknown'),
  confidence: z.coerce.number().min(0).max(1).catch(0),
  box: z.object({ x: z.coerce.number(), y: z.coerce.number(), w: z.coerce.number(), h: z.coerce.number() }).optional().catch(undefined),
});

const PROMPTS = {
  food: `You are a nutrition vision model. Identify each distinct food item in the photo and estimate its portion.
Reply ONLY with JSON: {"items":[{"name":string,"kcal":number,"protein":number,"carbs":number,"fat":number,"confidence":number 0-1}]}.
Grams for macros. Return {"items":[]} if no food is visible.`,
  pose: `You are a strength coach looking at one frame of a user exercising.
Reply ONLY with JSON: {"formNotes": string} — one or two short, actionable cues (max 25 words). Be encouraging.`,
  machine: `You identify gym equipment. Classify the main machine in the photo as one of:
lat_pulldown, chest_press, seated_row, leg_extension, unknown.
Reply ONLY with JSON: {"machine": string, "confidence": number 0-1, "box": {"x":number,"y":number,"w":number,"h":number}}
where box is the machine's bounding box in normalised 0-1 image coordinates (x,y = top-left).`,
};

const MOCK_FOOD = {
  items: [
    { name: 'Grilled chicken', kcal: 280, protein: 52, carbs: 0, fat: 6, confidence: 0.6 },
    { name: 'White rice', kcal: 205, protein: 4, carbs: 45, fat: 0.4, confidence: 0.6 },
    { name: 'Broccoli', kcal: 55, protein: 4, carbs: 11, fat: 0.6, confidence: 0.6 },
  ],
};

app.post('/api/stepfun/analyze', async (c) => {
  const parsed = AnalyzeBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const { mode, imageDataUrl, context } = parsed.data;

  if (!cfg.stepfun.key) {
    if (mode === 'food') return c.json({ mode, source: 'mock', ...MOCK_FOOD });
    if (mode === 'machine') return c.json({ mode, source: 'mock', machine: 'lat_pulldown', confidence: 0.82, box: { x: 0.2, y: 0.12, w: 0.6, h: 0.76 } });
    return c.json({ mode, source: 'mock', formNotes: 'Nice tempo! Keep your core braced and control the way down.' });
  }

  try {
    const res = await withTimeout(18_000, (signal) =>
      fetch(`${cfg.stepfun.base}/chat/completions`, {
        method: 'POST',
        signal,
        headers: { Authorization: `Bearer ${cfg.stepfun.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: cfg.stepfun.model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: PROMPTS[mode] },
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: imageDataUrl, detail: 'low' } },
                { type: 'text', text: context ? `Context: ${context}` : 'Analyze this frame.' },
              ],
            },
          ],
        }),
      }),
    );
    if (!res.ok) throw new Error(`StepFun ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const json = extractJson(data.choices?.[0]?.message?.content ?? '');

    if (mode === 'food') return c.json({ mode, source: 'stepfun', ...FoodItems.parse(json) });
    if (mode === 'machine') return c.json({ mode, source: 'stepfun', ...MachineGuess.parse(json) });
    return c.json({ mode, source: 'stepfun', ...PoseNotes.parse(json) });
  } catch (err) {
    console.error('[stepfun]', err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

// ---------------------------------------------------------------- Fetch.ai
const MOCK_AGENTS = [
  { address: 'agent1qmock-nutrition', name: 'Macro Planner', description: 'Builds meal plans from your logged macros', capabilities: ['nutrition', 'meal-plan'] },
  { address: 'agent1qmock-recovery', name: 'Recovery Coach', description: 'Suggests rest and mobility after workouts', capabilities: ['fitness', 'recovery'] },
];

app.get('/api/agents/discover', async (c) => {
  const q = c.req.query('q') ?? '';
  if (!cfg.fetchAgentUrl) return c.json({ source: 'mock', agents: MOCK_AGENTS });
  try {
    const res = await withTimeout(8_000, (signal) => fetch(`${cfg.fetchAgentUrl}/discover?q=${encodeURIComponent(q)}`, { signal }));
    if (!res.ok) throw new Error(`agent ${res.status}`);
    const body = (await res.json()) as { agents?: unknown[] };
    return c.json({ source: 'fetchai', agents: body.agents ?? [] });
  } catch (err) {
    console.warn('[fetchai] discover failed, serving mock', err);
    return c.json({ source: 'mock', agents: MOCK_AGENTS });
  }
});

app.post('/api/agents/ask', async (c) => {
  const body = z.object({ agentAddress: z.string(), message: z.unknown() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.message }, 400);
  if (!cfg.fetchAgentUrl) return c.json({ source: 'mock', reply: 'Great session! Aim for ~30g protein in your next meal to support recovery.' });
  try {
    const res = await withTimeout(15_000, (signal) =>
      fetch(`${cfg.fetchAgentUrl}/ask`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body.data) }),
    );
    if (!res.ok) throw new Error(`agent ${res.status}`);
    const data = (await res.json()) as { reply?: string };
    return c.json({ source: 'fetchai', reply: data.reply ?? '' });
  } catch (err) {
    return c.json({ error: String(err) }, 502);
  }
});

// ---------------------------------------------------------------- Photon
const SummaryBody = z.object({
  to: z.string().regex(/^\+?[0-9 ()-]{7,20}$/),
  channel: z.enum(['sms', 'voice']),
  summary: z.object({ exercise: z.string(), reps: z.number(), calories: z.number(), durationMs: z.number(), alerts: z.array(z.object({ message: z.string() })) }),
});

function summaryText(s: z.infer<typeof SummaryBody>['summary']): string {
  const mins = Math.max(1, Math.round(s.durationMs / 60000));
  const cue = s.alerts[0] ? ` Focus next time: ${s.alerts[0].message}.` : ' Clean form throughout!';
  return `FitLens: ${s.reps} ${s.exercise}s in ${mins} min, ~${s.calories.toFixed(1)} kcal.${cue}`;
}

app.post('/api/photon/summary', async (c) => {
  const body = SummaryBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.message }, 400);
  const text = summaryText(body.data.summary);

  if (!cfg.photon.key || !cfg.photon.base) {
    console.info(`[photon:mock] → ${body.data.to}: ${text}`);
    return c.json({ source: 'mock', id: `mock-${Date.now()}` });
  }
  try {
    // TODO(sdk): swap for the Photon 2.0 SDK call once its exact API is confirmed on-site.
    const res = await withTimeout(10_000, (signal) =>
      fetch(`${cfg.photon.base}/messages`, {
        method: 'POST',
        signal,
        headers: { Authorization: `Bearer ${cfg.photon.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: body.data.to, from: cfg.photon.from, channel: body.data.channel, text }),
      }),
    );
    if (!res.ok) throw new Error(`Photon ${res.status}`);
    const data = (await res.json()) as { id?: string };
    return c.json({ source: 'photon', id: data.id ?? 'sent' });
  } catch (err) {
    return c.json({ error: String(err) }, 502);
  }
});

app.get('/api/health', (c) =>
  c.json({ stepfun: !!cfg.stepfun.key, fetchai: !!cfg.fetchAgentUrl, photon: !!(cfg.photon.key && cfg.photon.base) }),
);

serve({ fetch: app.fetch, port: cfg.port }, (info) => console.log(`[api] listening on http://localhost:${info.port}`));
