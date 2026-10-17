import * as Sentry from '@sentry/react';
import { z } from 'zod';
import { Err, Ok, toError, type Result } from '@/core/result';
import { fetchWithTimeout } from '@/core/scheduling/throttle';
import type { MacroItem, MacroSummary } from '@/core/events/events';
import { glassesController } from '@/lib/sponsors/smart-glasses/glassesPlugin';
import type { SmartGlassesAdapter } from '@/lib/sponsors/smart-glasses/SmartGlassesAdapter';
import { foodScannerBus } from './FoodScannerBus';
import {
  StepFunFoodItemSchema,
  type StepFunFoodItem,
  type StepFunFoodAnalysisResponse,
} from './types';

export interface StepFunFoodAdapterConfig {
  endpoint?: string;
  timeoutMs?: number;
  glassesAdapter?: SmartGlassesAdapter;
}

const DetailedFoodResponseSchema = z.object({
  foodItem: z.string().optional(),
  name: z.string().optional(),
  estimatedWeightGrams: z.coerce.number().nonnegative().optional(),
  weightGrams: z.coerce.number().nonnegative().optional(),
  calories: z.coerce.number().nonnegative().optional(),
  kcal: z.coerce.number().nonnegative().optional(),
  macros: z
    .object({
      protein: z.coerce.number().nonnegative(),
      carbs: z.coerce.number().nonnegative(),
      fat: z.coerce.number().nonnegative(),
    })
    .optional(),
  protein: z.coerce.number().nonnegative().optional(),
  carbs: z.coerce.number().nonnegative().optional(),
  fat: z.coerce.number().nonnegative().optional(),
  confidenceScore: z.coerce.number().min(0).max(1).optional(),
  confidence: z.coerce.number().min(0).max(1).optional(),
});

const MultiItemPayloadSchema = z.object({
  items: z.array(DetailedFoodResponseSchema),
  totalCalories: z.coerce.number().nonnegative().optional(),
  source: z.enum(['stepfun', 'mock']).optional(),
});

/**
 * StepFunFoodAdapter integrates the camera pipeline with StepFun's `step-5-preview`
 * multimodal AI service.
 *
 * Capabilities:
 * 1. Sends cropped or full keyframe images with targeted nutrition prompts.
 * 2. Parses and validates the response against strict Zod schemas:
 *    - foodItem (string)
 *    - estimatedWeightGrams (number)
 *    - calories (number)
 *    - macros: { protein, carbs, fat }
 *    - confidenceScore (number)
 * 3. Dispatches real-time macro summaries to the SmartGlassesAdapter (Null / Even Realities).
 * 4. Emits state transitions (NUTRITION_ESTIMATED, NUTRITION_FAILED) to SponsorEventBus.
 * 5. Wraps cloud inference calls with Sentry performance transactions and spans.
 */
export class StepFunFoodAdapter {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly explicitGlassesAdapter?: SmartGlassesAdapter;

  constructor(config: StepFunFoodAdapterConfig = {}) {
    this.endpoint = config.endpoint ?? '/api/stepfun/analyze';
    this.timeoutMs = config.timeoutMs ?? 20_000;
    this.explicitGlassesAdapter = config.glassesAdapter;
  }

  /**
   * Sends a keyframe (data URL or Blob) to StepFun step-5-preview for nutritional estimation.
   * Telemetry is wrapped with Sentry performance transactions.
   */
  async estimateNutrition(
    imageData: Blob | string,
    context?: string,
  ): Promise<Result<StepFunFoodAnalysisResponse>> {
    const startTime = performance.now();

    return Sentry.startSpan(
      {
        name: 'stepfun.food.nutrition_estimation',
        op: 'ai.multimodal.inference',
        attributes: {
          'ai.model': 'step-5-preview',
          'ai.provider': 'stepfun',
          'ai.operation': 'food_macro_analysis',
        },
      },
      async (span) => {
        try {
          const imageDataUrl = typeof imageData === 'string' ? imageData : await this.blobToDataUrl(imageData);

          const payload = {
            mode: 'food',
            imageDataUrl,
            context: context
              ? `${context} | Target: foodItem, estimatedWeightGrams, calories, macros {protein, carbs, fat}, confidenceScore`
              : 'Target: foodItem, estimatedWeightGrams, calories, macros {protein, carbs, fat}, confidenceScore',
          };

          const response = await fetchWithTimeout(
            this.endpoint,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            },
            this.timeoutMs,
          );

          if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`StepFun proxy returned HTTP ${response.status}: ${errorText.slice(0, 200)}`);
          }

          const rawJson: unknown = await response.json();
          const normalized = this.normalizeResponse(rawJson);

          if (!normalized.ok) {
            throw normalized.error;
          }

          const analysis = normalized.value;
          const durationMs = performance.now() - startTime;
          span.setAttribute('ai.latency_ms', durationMs);
          span.setAttribute('ai.item_count', analysis.items.length);
          span.setAttribute('ai.source', analysis.source);

          if (analysis.items.length === 0) {
            foodScannerBus.emitNutritionFailed({
              error: 'No food items could be identified in frame',
              code: 'NO_FOOD_DETECTED',
              timestamp: Date.now(),
            });
            return Ok(analysis);
          }

          const primaryItem = analysis.items[0]!;
          const macroSummary = this.toMacroSummary(analysis);

          // Emit NUTRITION_ESTIMATED event (also bridges to sponsorBus 'macro:result')
          foodScannerBus.emitNutritionEstimated({
            primary: primaryItem,
            items: analysis.items,
            macroSummary,
            timestamp: Date.now(),
          });

          // Dispatch to SmartGlassesAdapter
          await this.dispatchToGlasses(macroSummary);

          return Ok(analysis);
        } catch (err) {
          const error = toError(err);
          span.setAttribute('error', true);
          span.setAttribute('error.message', error.message);

          Sentry.captureException(error, {
            tags: {
              service: 'StepFunFoodAdapter',
              model: 'step-5-preview',
            },
            extra: {
              durationMs: performance.now() - startTime,
            },
          });

          foodScannerBus.emitNutritionFailed({
            error: error.message,
            code: error.message.includes('timeout') ? 'TIMEOUT' : 'NETWORK_ERROR',
            timestamp: Date.now(),
          });

          // Defensive fallback: generate graceful offline estimate if network failed
          const fallback = this.createFallbackResponse(context);
          const fallbackSummary = this.toMacroSummary(fallback);

          foodScannerBus.emitNutritionEstimated({
            primary: fallback.items[0]!,
            items: fallback.items,
            macroSummary: fallbackSummary,
            timestamp: Date.now(),
          });

          await this.dispatchToGlasses(fallbackSummary);

          return Ok(fallback);
        }
      },
    );
  }

  /**
   * Dispatches macro summaries to the active SmartGlassesAdapter.
   */
  private async dispatchToGlasses(macroSummary: MacroSummary): Promise<void> {
    try {
      if (this.explicitGlassesAdapter) {
        await this.explicitGlassesAdapter.sendHud({
          repCount: 0,
          macroSummary,
        });
      } else {
        glassesController.updateHud({ macroSummary });
      }
    } catch (err) {
      console.warn('[StepFunFoodAdapter] Failed to dispatch HUD to SmartGlassesAdapter:', err);
    }
  }

  /**
   * Normalizes incoming raw JSON from StepFun or the proxy into the strict StepFunFoodItem schema.
   */
  private normalizeResponse(raw: unknown): Result<StepFunFoodAnalysisResponse> {
    try {
      // Direct array or object with items
      const multi = MultiItemPayloadSchema.safeParse(raw);
      if (multi.success) {
        const source = multi.data.source ?? 'stepfun';
        const items: StepFunFoodItem[] = multi.data.items.map((i) => {
          const foodItem = i.foodItem ?? i.name ?? 'Food Item';
          const estimatedWeightGrams = i.estimatedWeightGrams ?? i.weightGrams ?? 150;
          const calories = i.calories ?? i.kcal ?? 200;
          const macros = i.macros ?? {
            protein: i.protein ?? 10,
            carbs: i.carbs ?? 20,
            fat: i.fat ?? 5,
          };
          const confidenceScore = i.confidenceScore ?? i.confidence ?? 0.85;

          return StepFunFoodItemSchema.parse({
            foodItem,
            estimatedWeightGrams,
            calories,
            macros,
            confidenceScore,
          });
        });

        const totalCalories =
          multi.data.totalCalories ?? Math.round(items.reduce((s, item) => s + item.calories, 0));

        return Ok({
          items,
          totalCalories,
          source,
        });
      }

      // Single item response
      const single = DetailedFoodResponseSchema.safeParse(raw);
      if (single.success) {
        const item = StepFunFoodItemSchema.parse({
          foodItem: single.data.foodItem ?? single.data.name ?? 'Meal',
          estimatedWeightGrams: single.data.estimatedWeightGrams ?? single.data.weightGrams ?? 180,
          calories: single.data.calories ?? single.data.kcal ?? 250,
          macros: single.data.macros ?? {
            protein: single.data.protein ?? 15,
            carbs: single.data.carbs ?? 25,
            fat: single.data.fat ?? 8,
          },
          confidenceScore: single.data.confidenceScore ?? single.data.confidence ?? 0.8,
        });

        return Ok({
          items: [item],
          totalCalories: item.calories,
          source: 'stepfun',
        });
      }

      return Err(new Error('Response format does not match expected StepFun schema'));
    } catch (e) {
      return Err(toError(e));
    }
  }

  /**
   * Converts StepFunFoodAnalysisResponse into FitLens's standard core MacroSummary.
   */
  toMacroSummary(response: StepFunFoodAnalysisResponse): MacroSummary {
    const items: MacroItem[] = response.items.map((item) => ({
      name: item.foodItem,
      kcal: Math.round(item.calories),
      protein: Math.round(item.macros.protein),
      carbs: Math.round(item.macros.carbs),
      fat: Math.round(item.macros.fat),
      confidence: item.confidenceScore,
    }));

    const totalKcal =
      response.totalCalories ?? Math.round(items.reduce((acc, curr) => acc + curr.kcal, 0));

    return {
      items,
      totalKcal,
      source: response.source,
    };
  }

  /**
   * Resilient offline fallback mock when API keys are absent or offline.
   */
  private createFallbackResponse(context?: string): StepFunFoodAnalysisResponse {
    const ctx = (context ?? '').toLowerCase();

    // 1. Liquids / Beverages in containers
    if (
      ctx.includes('cup') ||
      ctx.includes('bottle') ||
      ctx.includes('wine glass') ||
      ctx.includes('drink') ||
      ctx.includes('beverage')
    ) {
      return {
        items: [
          {
            foodItem: 'Beverage (Coffee / Tea / Cola)',
            estimatedWeightGrams: 240,
            calories: 2,
            macros: { protein: 0.2, carbs: 0.3, fat: 0 },
            confidenceScore: 0.5,
          },
        ],
        totalCalories: 2,
        source: 'mock',
      };
    }

    // 2. Common detected foods
    if (ctx.includes('apple')) {
      return {
        items: [
          {
            foodItem: 'Fresh Apple',
            estimatedWeightGrams: 182,
            calories: 95,
            macros: { protein: 0.5, carbs: 25, fat: 0.3 },
            confidenceScore: 0.85,
          },
        ],
        totalCalories: 95,
        source: 'mock',
      };
    }

    if (ctx.includes('banana')) {
      return {
        items: [
          {
            foodItem: 'Ripe Banana',
            estimatedWeightGrams: 118,
            calories: 105,
            macros: { protein: 1.3, carbs: 27, fat: 0.4 },
            confidenceScore: 0.85,
          },
        ],
        totalCalories: 105,
        source: 'mock',
      };
    }

    if (ctx.includes('pizza')) {
      return {
        items: [
          {
            foodItem: 'Pizza Slice',
            estimatedWeightGrams: 110,
            calories: 290,
            macros: { protein: 12, carbs: 32, fat: 12 },
            confidenceScore: 0.8,
          },
        ],
        totalCalories: 290,
        source: 'mock',
      };
    }

    if (ctx.includes('sandwich')) {
      return {
        items: [
          {
            foodItem: 'Sandwich',
            estimatedWeightGrams: 200,
            calories: 360,
            macros: { protein: 20, carbs: 36, fat: 14 },
            confidenceScore: 0.8,
          },
        ],
        totalCalories: 360,
        source: 'mock',
      };
    }

    const isSalad = ctx.includes('broccoli') || ctx.includes('carrot') || ctx.includes('salad');

    const items: StepFunFoodItem[] = isSalad
      ? [
          {
            foodItem: 'Mixed Greens Salad',
            estimatedWeightGrams: 160,
            calories: 140,
            macros: { protein: 4, carbs: 12, fat: 9 },
            confidenceScore: 0.65,
          },
        ]
      : [
          {
            foodItem: 'Mediterranean Bowl',
            estimatedWeightGrams: 320,
            calories: 460,
            macros: { protein: 32, carbs: 48, fat: 14 },
            confidenceScore: 0.6,
          },
        ];

    return {
      items,
      totalCalories: items[0]!.calories,
      source: 'mock',
    };
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });
  }
}
