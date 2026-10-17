import { z } from 'zod';
import { fetchWithTimeout } from '@/core/scheduling/throttle';
import { Err, Ok, toError, type Result } from '@/core/result';
import { blobToDataUrl } from '@/services/camera/captureKeyframe';
import type { MacroSummary } from '@/core/events/events';

/**
 * Browser-side StepFun client. It never sees the API key: it posts the keyframe to our
 * proxy (`server/index.ts`), which calls StepFun `step-5-preview` (OpenAI-compatible chat
 * completions with an image_url part) and returns validated JSON.
 */

const MacroItemSchema = z.object({
  name: z.string(),
  kcal: z.number().nonnegative(),
  protein: z.number().nonnegative(),
  carbs: z.number().nonnegative(),
  fat: z.number().nonnegative(),
  confidence: z.number().min(0).max(1).optional(),
});

const FoodResponseSchema = z.object({
  mode: z.literal('food'),
  source: z.enum(['stepfun', 'mock']),
  items: z.array(MacroItemSchema),
});

const PoseResponseSchema = z.object({
  mode: z.literal('pose'),
  source: z.enum(['stepfun', 'mock']),
  formNotes: z.string(),
});

const MachineResponseSchema = z.object({
  mode: z.literal('machine'),
  source: z.enum(['stepfun', 'mock']),
  machine: z.enum(['lat_pulldown', 'chest_press', 'seated_row', 'leg_extension', 'unknown']),
  confidence: z.number().min(0).max(1),
  box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
});

const AnalyzeResponseSchema = z.discriminatedUnion('mode', [FoodResponseSchema, PoseResponseSchema, MachineResponseSchema]);
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;

export class StepFunClient {
  lastSource: 'stepfun' | 'mock' | null = null;
  lastError: Error | null = null;

  constructor(private readonly endpoint = '/api/stepfun/analyze', private readonly timeoutMs = 20_000) {}

  async analyzeKeyframe(image: Blob, mode: 'food' | 'pose' | 'machine', context?: string): Promise<Result<AnalyzeResponse>> {
    try {
      const imageDataUrl = await blobToDataUrl(image);
      const res = await fetchWithTimeout(
        this.endpoint,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, imageDataUrl, context }) },
        this.timeoutMs,
      );
      if (!res.ok) throw new Error(`StepFun proxy ${res.status}: ${await res.text().catch(() => '')}`);
      const parsed = AnalyzeResponseSchema.safeParse(await res.json());
      if (!parsed.success) throw new Error(`Invalid StepFun response: ${parsed.error.message}`);
      this.lastSource = parsed.data.source;
      this.lastError = null;
      return Ok(parsed.data);
    } catch (e) {
      this.lastError = toError(e);
      return Err(this.lastError);
    }
  }
}

export function toMacroSummary(r: Extract<AnalyzeResponse, { mode: 'food' }>): MacroSummary {
  return {
    items: r.items,
    totalKcal: Math.round(r.items.reduce((s, i) => s + i.kcal, 0)),
    source: r.source,
  };
}
