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
  mode: z.enum(['food', 'pose']),
  imageDataUrl: z.string().startsWith('data:image/').max(4_000_000),
  context: z.string().max(500).optional(),
});

const FoodItemSchema = z.object({
  name: z.string().optional(),
  foodItem: z.string().optional(),
  kcal: z.coerce.number().optional(),
  calories: z.coerce.number().optional(),
  protein: z.coerce.number().optional(),
  carbs: z.coerce.number().optional(),
  fat: z.coerce.number().optional(),
  macros: z.object({ protein: z.coerce.number(), carbs: z.coerce.number(), fat: z.coerce.number() }).optional(),
  estimatedWeightGrams: z.coerce.number().optional(),
  confidence: z.coerce.number().optional(),
  confidenceScore: z.coerce.number().optional(),
}).transform((item) => {
  const name = item.foodItem ?? item.name ?? 'Food Item';
  const foodItem = item.foodItem ?? item.name ?? 'Food Item';
  const kcal = item.calories ?? item.kcal ?? 100;
  const calories = item.calories ?? item.kcal ?? 100;
  const protein = item.macros?.protein ?? item.protein ?? 5;
  const carbs = item.macros?.carbs ?? item.carbs ?? 10;
  const fat = item.macros?.fat ?? item.fat ?? 2;
  const macros = item.macros ?? { protein, carbs, fat };
  const estimatedWeightGrams = item.estimatedWeightGrams ?? 120;
  const confidence = item.confidenceScore ?? item.confidence ?? 0.8;
  const confidenceScore = item.confidenceScore ?? item.confidence ?? 0.8;
  return { name, foodItem, kcal, calories, protein, carbs, fat, macros, estimatedWeightGrams, confidence, confidenceScore };
});

const FoodItems = z.object({
  items: z.array(FoodItemSchema).max(10),
});
const PoseNotes = z.object({ formNotes: z.string() });

const PROMPTS = {
  food: `You are a nutrition vision model. Identify each distinct food item or beverage in the photo and estimate its portion.
If a cup, mug, glass, or bottle contains a liquid (e.g. coffee, tea, cola, water), identify the specific drink. If visually ambiguous (e.g. coffee vs tea vs cola), note "Beverage (Coffee/Tea/Cola)" with confidenceScore 0.5 to allow user disambiguation.
Reply ONLY with JSON: {"items":[{"foodItem":string,"name":string,"estimatedWeightGrams":number,"calories":number,"kcal":number,"macros":{"protein":number,"carbs":number,"fat":number},"protein":number,"carbs":number,"fat":number,"confidenceScore":number 0-1}]}.
Grams for macros. Return {"items":[]} if no food or beverage is visible.`,
  pose: `You are a strength coach looking at one frame of a user exercising.
Reply ONLY with JSON: {"formNotes": string} — one or two short, actionable cues (max 25 words). Be encouraging.`,
};

function generateMockFoodResponse(context?: string) {
  const ctx = (context ?? '').toLowerCase();

  // 1. Liquid containers / Beverages
  if (
    ctx.includes('cup') ||
    ctx.includes('bottle') ||
    ctx.includes('wine glass') ||
    ctx.includes('drink') ||
    ctx.includes('beverage')
  ) {
    if (ctx.includes('coffee')) {
      return {
        items: [
          { foodItem: 'Black Coffee', name: 'Black Coffee', estimatedWeightGrams: 240, calories: 2, kcal: 2, protein: 0.3, carbs: 0.2, fat: 0, macros: { protein: 0.3, carbs: 0.2, fat: 0 }, confidenceScore: 0.9, confidence: 0.9 },
        ],
      };
    }
    if (ctx.includes('tea')) {
      return {
        items: [
          { foodItem: 'Unsweetened Tea', name: 'Unsweetened Tea', estimatedWeightGrams: 240, calories: 2, kcal: 2, protein: 0, carbs: 0.4, fat: 0, macros: { protein: 0, carbs: 0.4, fat: 0 }, confidenceScore: 0.9, confidence: 0.9 },
        ],
      };
    }
    if (ctx.includes('cola') || ctx.includes('soda')) {
      return {
        items: [
          { foodItem: 'Regular Cola', name: 'Regular Cola', estimatedWeightGrams: 355, calories: 140, kcal: 140, protein: 0, carbs: 39, fat: 0, macros: { protein: 0, carbs: 39, fat: 0 }, confidenceScore: 0.9, confidence: 0.9 },
        ],
      };
    }
    if (ctx.includes('water')) {
      return {
        items: [
          { foodItem: 'Water', name: 'Water', estimatedWeightGrams: 250, calories: 0, kcal: 0, protein: 0, carbs: 0, fat: 0, macros: { protein: 0, carbs: 0, fat: 0 }, confidenceScore: 0.95, confidence: 0.95 },
        ],
      };
    }
    // Ambiguous dark liquid in cup/bottle: return low confidence to trigger liquid disambiguation flow
    return {
      items: [
        {
          foodItem: 'Beverage (Coffee / Tea / Cola)',
          name: 'Beverage (Coffee / Tea / Cola)',
          estimatedWeightGrams: 240,
          calories: 2,
          kcal: 2,
          protein: 0.2,
          carbs: 0.3,
          fat: 0,
          macros: { protein: 0.2, carbs: 0.3, fat: 0 },
          confidenceScore: 0.5,
          confidence: 0.5,
        },
      ],
    };
  }

  // 2. Specific food items
  if (ctx.includes('apple')) {
    return {
      items: [
        { foodItem: 'Fresh Apple', name: 'Fresh Apple', estimatedWeightGrams: 182, calories: 95, kcal: 95, protein: 0.5, carbs: 25, fat: 0.3, macros: { protein: 0.5, carbs: 25, fat: 0.3 }, confidenceScore: 0.9, confidence: 0.9 },
      ],
    };
  }
  if (ctx.includes('banana')) {
    return {
      items: [
        { foodItem: 'Ripe Banana', name: 'Ripe Banana', estimatedWeightGrams: 118, calories: 105, kcal: 105, protein: 1.3, carbs: 27, fat: 0.4, macros: { protein: 1.3, carbs: 27, fat: 0.4 }, confidenceScore: 0.9, confidence: 0.9 },
      ],
    };
  }
  if (ctx.includes('sandwich')) {
    return {
      items: [
        { foodItem: 'Turkey & Cheese Sandwich', name: 'Turkey & Cheese Sandwich', estimatedWeightGrams: 210, calories: 380, kcal: 380, protein: 24, carbs: 36, fat: 14, macros: { protein: 24, carbs: 36, fat: 14 }, confidenceScore: 0.88, confidence: 0.88 },
      ],
    };
  }
  if (ctx.includes('pizza')) {
    return {
      items: [
        { foodItem: 'Pepperoni Pizza Slice', name: 'Pepperoni Pizza Slice', estimatedWeightGrams: 110, calories: 290, kcal: 290, protein: 12, carbs: 32, fat: 12, macros: { protein: 12, carbs: 32, fat: 12 }, confidenceScore: 0.88, confidence: 0.88 },
      ],
    };
  }
  if (ctx.includes('hot dog')) {
    return {
      items: [
        { foodItem: 'Hot Dog on Bun', name: 'Hot Dog on Bun', estimatedWeightGrams: 140, calories: 290, kcal: 290, protein: 10, carbs: 24, fat: 17, macros: { protein: 10, carbs: 24, fat: 17 }, confidenceScore: 0.85, confidence: 0.85 },
      ],
    };
  }
  if (ctx.includes('salad') || ctx.includes('broccoli') || ctx.includes('carrot')) {
    return {
      items: [
        { foodItem: 'Garden Vegetable Salad', name: 'Garden Vegetable Salad', estimatedWeightGrams: 160, calories: 120, kcal: 120, protein: 4, carbs: 14, fat: 6, macros: { protein: 4, carbs: 14, fat: 6 }, confidenceScore: 0.85, confidence: 0.85 },
      ],
    };
  }
  if (ctx.includes('chicken')) {
    return {
      items: [
        { foodItem: 'Grilled Chicken Breast', name: 'Grilled Chicken Breast', estimatedWeightGrams: 180, calories: 280, kcal: 280, protein: 52, carbs: 0, fat: 6, macros: { protein: 52, carbs: 0, fat: 6 }, confidenceScore: 0.88, confidence: 0.88 },
      ],
    };
  }

  // 3. Balanced meal fallback (not locked to chicken)
  return {
    items: [
      { foodItem: 'Mediterranean Meal Bowl', name: 'Mediterranean Meal Bowl', estimatedWeightGrams: 320, calories: 420, kcal: 420, protein: 26, carbs: 46, fat: 12, macros: { protein: 26, carbs: 46, fat: 12 }, confidenceScore: 0.75, confidence: 0.75 },
    ],
  };
}

app.post('/api/stepfun/analyze', async (c) => {
  const parsed = AnalyzeBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const { mode, imageDataUrl, context } = parsed.data;

  if (!cfg.stepfun.key) {
    return mode === 'food'
      ? c.json({ mode, source: 'mock', ...generateMockFoodResponse(context) })
      : c.json({ mode, source: 'mock', formNotes: 'Nice tempo! Keep your core braced and control the way down.' });
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
