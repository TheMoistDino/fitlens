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
const MACHINES = ['lat_pulldown', 'chest_press', 'seated_row', 'leg_extension', 'bicep_curl', 'unknown'] as const;
const MachineGuess = z.object({
  machine: z.enum(MACHINES).catch('unknown'),
  confidence: z.coerce.number().min(0).max(1).catch(0),
  box: z.object({ x: z.coerce.number(), y: z.coerce.number(), w: z.coerce.number(), h: z.coerce.number() }).optional().catch(undefined),
});

const PROMPTS = {
  food: `You are a nutrition vision model. Identify each distinct food item or beverage in the photo and estimate its portion.
If a canned beverage, carton, or bottle is shown, read all brand names, product titles, flavors, and nutritional text printed on the label. Identify the exact canned or packaged drink.
If a cup or glass contains a liquid, determine whether it is milk/dairy (white), juice (colorful), water (clear), or a dark beverage (coffee/tea/cola). If visually ambiguous, note "Beverage (Coffee/Tea/Cola)" or "Beverage (Milk/Latte)" with confidenceScore 0.5 to allow user disambiguation.
Reply ONLY with JSON: {"items":[{"foodItem":string,"name":string,"estimatedWeightGrams":number,"calories":number,"kcal":number,"macros":{"protein":number,"carbs":number,"fat":number},"protein":number,"carbs":number,"fat":number,"confidenceScore":number 0-1}]}.
Grams for macros. Return {"items":[]} if no food or beverage is visible.`,
  pose: `You are a strength coach looking at one frame of a user exercising.
Reply ONLY with JSON: {"formNotes": string} — one or two short, actionable cues (max 25 words). Be encouraging.`,
  machine: `You identify gym equipment. Classify the main equipment in the photo as one of:
lat_pulldown, chest_press, seated_row, leg_extension,
bicep_curl (dumbbells, an EZ/curl bar, or a cable curl station), unknown.
Reply ONLY with JSON: {"machine": string, "confidence": number 0-1, "box": {"x":number,"y":number,"w":number,"h":number}}
where box is the machine's bounding box in normalised 0-1 image coordinates (x,y = top-left).`,
};

function generateMockFoodResponse(context?: string) {
  const ctx = (context ?? '').toLowerCase();

  // 1. Milk & Non-Dark Dairy Drinks
  if (
    ctx.includes('milk') ||
    ctx.includes('dairy') ||
    ctx.includes('white liquid') ||
    ctx.includes('creamy liquid')
  ) {
    if (ctx.includes('oat')) {
      return {
        items: [
          { foodItem: 'Oat Milk', name: 'Oat Milk', estimatedWeightGrams: 240, calories: 130, kcal: 130, protein: 3, carbs: 16, fat: 5, macros: { protein: 3, carbs: 16, fat: 5 }, confidenceScore: 0.9, confidence: 0.9 },
        ],
      };
    }
    if (ctx.includes('almond')) {
      return {
        items: [
          { foodItem: 'Almond Milk (Unsweetened)', name: 'Almond Milk', estimatedWeightGrams: 240, calories: 35, kcal: 35, protein: 1, carbs: 1, fat: 2.5, macros: { protein: 1, carbs: 1, fat: 2.5 }, confidenceScore: 0.9, confidence: 0.9 },
        ],
      };
    }
    if (ctx.includes('skim') || ctx.includes('non-fat')) {
      return {
        items: [
          { foodItem: 'Skim / Non-Fat Milk', name: 'Skim Milk', estimatedWeightGrams: 240, calories: 90, kcal: 90, protein: 9, carbs: 12, fat: 0, macros: { protein: 9, carbs: 12, fat: 0 }, confidenceScore: 0.9, confidence: 0.9 },
        ],
      };
    }
    return {
      items: [
        { foodItem: 'Whole Milk', name: 'Whole Milk', estimatedWeightGrams: 240, calories: 150, kcal: 150, protein: 8, carbs: 12, fat: 8, macros: { protein: 8, carbs: 12, fat: 8 }, confidenceScore: 0.9, confidence: 0.9 },
      ],
    };
  }

  // 2. Specific Canned Beverages & Energy Drinks
  if (ctx.includes('celsius')) {
    return {
      items: [
        { foodItem: 'Celsius Sparkling Energy (Can)', name: 'Celsius Sparkling Energy (Can)', estimatedWeightGrams: 355, calories: 10, kcal: 10, protein: 0, carbs: 0, fat: 0, macros: { protein: 0, carbs: 0, fat: 0 }, confidenceScore: 0.95, confidence: 0.95 },
      ],
    };
  }
  if (ctx.includes('red bull')) {
    const isZero = ctx.includes('zero') || ctx.includes('sugarfree');
    return {
      items: [
        { foodItem: isZero ? 'Red Bull Sugarfree (Can)' : 'Red Bull Original (Can)', name: isZero ? 'Red Bull Sugarfree (Can)' : 'Red Bull Original (Can)', estimatedWeightGrams: 250, calories: isZero ? 5 : 110, kcal: isZero ? 5 : 110, protein: 1, carbs: isZero ? 0 : 28, fat: 0, macros: { protein: 1, carbs: isZero ? 0 : 28, fat: 0 }, confidenceScore: 0.95, confidence: 0.95 },
      ],
    };
  }
  if (ctx.includes('monster')) {
    const isUltra = ctx.includes('ultra') || ctx.includes('zero');
    return {
      items: [
        { foodItem: isUltra ? 'Monster Energy Zero Ultra (Can)' : 'Monster Energy Original (Can)', name: isUltra ? 'Monster Energy Zero Ultra (Can)' : 'Monster Energy Original (Can)', estimatedWeightGrams: 473, calories: isUltra ? 10 : 210, kcal: isUltra ? 10 : 210, protein: 0, carbs: isUltra ? 4 : 54, fat: 0, macros: { protein: 0, carbs: isUltra ? 4 : 54, fat: 0 }, confidenceScore: 0.95, confidence: 0.95 },
      ],
    };
  }
  if (ctx.includes('coke zero') || ctx.includes('zero sugar')) {
    return {
      items: [
        { foodItem: 'Coca-Cola Zero Sugar (Can)', name: 'Coca-Cola Zero Sugar (Can)', estimatedWeightGrams: 355, calories: 0, kcal: 0, protein: 0, carbs: 0, fat: 0, macros: { protein: 0, carbs: 0, fat: 0 }, confidenceScore: 0.95, confidence: 0.95 },
      ],
    };
  }
  if (ctx.includes('diet coke')) {
    return {
      items: [
        { foodItem: 'Diet Coke (Can)', name: 'Diet Coke (Can)', estimatedWeightGrams: 355, calories: 0, kcal: 0, protein: 0, carbs: 0, fat: 0, macros: { protein: 0, carbs: 0, fat: 0 }, confidenceScore: 0.95, confidence: 0.95 },
      ],
    };
  }
  if (ctx.includes('dr pepper')) {
    return {
      items: [
        { foodItem: 'Dr Pepper (Can)', name: 'Dr Pepper (Can)', estimatedWeightGrams: 355, calories: 150, kcal: 150, protein: 0, carbs: 40, fat: 0, macros: { protein: 0, carbs: 40, fat: 0 }, confidenceScore: 0.95, confidence: 0.95 },
      ],
    };
  }
  if (ctx.includes('poppi')) {
    return {
      items: [
        { foodItem: 'Poppi Prebiotic Soda (Can)', name: 'Poppi Prebiotic Soda (Can)', estimatedWeightGrams: 355, calories: 25, kcal: 25, protein: 0, carbs: 5, fat: 0, macros: { protein: 0, carbs: 5, fat: 0 }, confidenceScore: 0.95, confidence: 0.95 },
      ],
    };
  }
  if (ctx.includes('liquid death')) {
    return {
      items: [
        { foodItem: 'Liquid Death Mountain Water (Can)', name: 'Liquid Death Mountain Water (Can)', estimatedWeightGrams: 500, calories: 0, kcal: 0, protein: 0, carbs: 0, fat: 0, macros: { protein: 0, carbs: 0, fat: 0 }, confidenceScore: 0.95, confidence: 0.95 },
      ],
    };
  }
  if (ctx.includes('can') || ctx.includes('canned')) {
    return {
      items: [
        {
          foodItem: 'Canned Beverage (Soda / Seltzer / Energy)',
          name: 'Canned Beverage (Soda / Seltzer / Energy)',
          estimatedWeightGrams: 355,
          calories: 10,
          kcal: 10,
          protein: 0,
          carbs: 2,
          fat: 0,
          macros: { protein: 0, carbs: 2, fat: 0 },
          confidenceScore: 0.5,
          confidence: 0.5,
        },
      ],
    };
  }

  // 3. Juices & Citrus Drinks
  if (ctx.includes('orange juice') || ctx.includes('oj')) {
    return {
      items: [
        { foodItem: 'Orange Juice', name: 'Orange Juice', estimatedWeightGrams: 240, calories: 110, kcal: 110, protein: 2, carbs: 26, fat: 0.5, macros: { protein: 2, carbs: 26, fat: 0.5 }, confidenceScore: 0.9, confidence: 0.9 },
      ],
    };
  }
  if (ctx.includes('apple juice')) {
    return {
      items: [
        { foodItem: 'Apple Juice', name: 'Apple Juice', estimatedWeightGrams: 240, calories: 115, kcal: 115, protein: 0.2, carbs: 28, fat: 0.2, macros: { protein: 0.2, carbs: 28, fat: 0.2 }, confidenceScore: 0.9, confidence: 0.9 },
      ],
    };
  }

  // 4. Liquid containers / Generic Beverages
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
    // Ambiguous liquid in cup/bottle: return low confidence to trigger disambiguation flow
    return {
      items: [
        {
          foodItem: 'Beverage (Milk / Coffee / Cola)',
          name: 'Beverage (Milk / Coffee / Cola)',
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

  // 5. Specific food items
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
  if (ctx.includes('salad') || ctx.includes('broccoli') || ctx.includes('carrot') || ctx.includes('veggie')) {
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

  // 6. Uploaded image visual cues handling (prevents Mediterranean Meal Bowl lock-in)
  if (ctx.includes('fruit')) {
    return {
      items: [
        { foodItem: 'Fresh Fruit Assortment', name: 'Fresh Fruit Assortment', estimatedWeightGrams: 150, calories: 85, kcal: 85, protein: 1, carbs: 21, fat: 0.2, macros: { protein: 1, carbs: 21, fat: 0.2 }, confidenceScore: 0.8, confidence: 0.8 },
      ],
    };
  }
  if (ctx.includes('green') || ctx.includes('salad')) {
    return {
      items: [
        { foodItem: 'Mixed Greens Salad', name: 'Mixed Greens Salad', estimatedWeightGrams: 150, calories: 95, kcal: 95, protein: 3, carbs: 10, fat: 5, macros: { protein: 3, carbs: 10, fat: 5 }, confidenceScore: 0.8, confidence: 0.8 },
      ],
    };
  }

  // Balanced Entree Plate fallback
  return {
    items: [
      { foodItem: 'Balanced Entree Plate', name: 'Balanced Entree Plate', estimatedWeightGrams: 300, calories: 380, kcal: 380, protein: 24, carbs: 40, fat: 12, macros: { protein: 24, carbs: 40, fat: 12 }, confidenceScore: 0.7, confidence: 0.7 },
    ],
  };
}

app.post('/api/stepfun/analyze', async (c) => {
  const parsed = AnalyzeBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const { mode, imageDataUrl, context } = parsed.data;

  if (!cfg.stepfun.key) {
    if (mode === 'food') return c.json({ mode, source: 'mock', ...generateMockFoodResponse(context) });
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
