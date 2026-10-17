import { useCallback, useId, useMemo, useState } from 'react';
import { useToast } from '@/app/providers';
import type { MacroItem } from '@/core/events/events';
import { foodScannerBus } from '../services/FoodScannerBus';
import { persistMealLog } from '../services/foodStorage';
import type { DetectedFoodItem, MealLoggedPayload, StepFunFoodItem } from '../services/types';

/**
 * Fallback macro heuristics for common COCO food classes when cloud API has not yet responded.
 * Ensures the WebAR UI remains fully functional even in offline / degraded connectivity.
 */
const FALLBACK_MACRO_ESTIMATES: Record<string, { kcal: number; protein: number; carbs: number; fat: number; weight: number }> = {
  apple: { kcal: 95, protein: 0.5, carbs: 25, fat: 0.3, weight: 182 },
  banana: { kcal: 105, protein: 1.3, carbs: 27, fat: 0.4, weight: 118 },
  sandwich: { kcal: 350, protein: 18, carbs: 38, fat: 14, weight: 200 },
  orange: { kcal: 62, protein: 1.2, carbs: 15, fat: 0.2, weight: 130 },
  broccoli: { kcal: 55, protein: 3.7, carbs: 11, fat: 0.6, weight: 150 },
  carrot: { kcal: 41, protein: 0.9, carbs: 10, fat: 0.2, weight: 100 },
  'hot dog': { kcal: 290, protein: 10, carbs: 24, fat: 17, weight: 140 },
  pizza: { kcal: 285, protein: 12, carbs: 36, fat: 10, weight: 107 },
  donut: { kcal: 250, protein: 3, carbs: 31, fat: 13, weight: 60 },
  cake: { kcal: 350, protein: 4, carbs: 50, fat: 15, weight: 100 },
  bowl: { kcal: 380, protein: 22, carbs: 45, fat: 12, weight: 350 },
  cup: { kcal: 120, protein: 4, carbs: 18, fat: 3, weight: 240 },
  bottle: { kcal: 140, protein: 0, carbs: 35, fat: 0, weight: 355 },
  'wine glass': { kcal: 125, protein: 0.1, carbs: 3.8, fat: 0, weight: 150 },
};

export interface FoodTooltipCardProps {
  /** Real-time detected food item from on-device vision pipeline */
  item: DetectedFoodItem;
  /** High-precision macro details from StepFun multimodal cloud analysis (if available) */
  macroItem?: MacroItem | null;
  /** Granular item details from StepFun API */
  detailedItem?: StepFunFoodItem | null;
  /** Whether StepFun multimodal analysis is currently in progress */
  analyzing?: boolean;
  /** Trigger manual cloud analysis */
  onAnalyze?: () => void;
  /** Callback fired after meal is committed to storage and event bus */
  onLogged?: (meal: MealLoggedPayload) => void;
}

/**
 * Interactive WebAR Tooltip Card (`FoodTooltipCard.tsx`)
 *
 * Rendered within a Drei `<Html>` anchor projected over 3D food coordinates.
 * Features:
 * - Glassmorphism Tailwind styling with fluid entry/exit animations.
 * - Primary State: Detected food name, estimated calories, Quick Actions ("Macro Breakdown", "Add to Log").
 * - Expanded State: Donut macro chart & visual progress bars for Protein, Carbs, and Fats.
 * - Offline-safe fallback heuristics for immediate feedback before cloud inference completes.
 * - Commits to IndexedDB / Zustand session store and emits MEAL_LOGGED to event bus.
 */
export function FoodTooltipCard({
  item,
  macroItem,
  detailedItem,
  analyzing = false,
  onAnalyze,
  onLogged,
}: FoodTooltipCardProps) {
  const toast = useToast();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLogged, setIsLogged] = useState(false);
  const [isLogging, setIsLogging] = useState(false);
  const uniqueId = useId();

  // Resolve nutrition metrics (cloud StepFun result takes priority, falling back to local heuristics)
  const nutrition = useMemo(() => {
    if (macroItem) {
      return {
        name: macroItem.name || item.label,
        calories: Math.round(macroItem.kcal),
        protein: Number(macroItem.protein.toFixed(1)),
        carbs: Number(macroItem.carbs.toFixed(1)),
        fat: Number(macroItem.fat.toFixed(1)),
        weight: detailedItem?.estimatedWeightGrams ?? 150,
        confidence: detailedItem?.confidenceScore ?? item.confidence,
        isCloudVerified: true,
      };
    }

    const fallback = FALLBACK_MACRO_ESTIMATES[item.label.toLowerCase()] ?? {
      kcal: 220,
      protein: 8,
      carbs: 26,
      fat: 9,
      weight: 150,
    };

    return {
      name: item.label.charAt(0).toUpperCase() + item.label.slice(1),
      calories: fallback.kcal,
      protein: fallback.protein,
      carbs: fallback.carbs,
      fat: fallback.fat,
      weight: fallback.weight,
      confidence: item.confidence,
      isCloudVerified: false,
    };
  }, [item, macroItem, detailedItem]);

  // Macro distribution calculations for visual gauges
  const macroBreakdown = useMemo(() => {
    const { protein, carbs, fat } = nutrition;
    const totalGrams = Math.max(0.1, protein + carbs + fat);
    const pPct = Math.round((protein / totalGrams) * 100);
    const cPct = Math.round((carbs / totalGrams) * 100);
    const fPct = Math.max(0, 100 - pPct - cPct);

    // SVG Donut circumference calculation (r = 18, circumference ≈ 113.1)
    const radius = 18;
    const circumference = 2 * Math.PI * radius;
    const pOffset = circumference * (1 - pPct / 100);
    const cOffset = circumference * (1 - cPct / 100);
    const fOffset = circumference * (1 - fPct / 100);

    return {
      pPct,
      cPct,
      fPct,
      totalGrams: Number(totalGrams.toFixed(1)),
      circumference,
      pOffset,
      cOffset,
      fOffset,
    };
  }, [nutrition]);

  // Handle "Add to Log" action
  const handleAddToLog = useCallback(async () => {
    if (isLogging || isLogged) return;
    setIsLogging(true);

    try {
      const payload: MealLoggedPayload = {
        id: crypto.randomUUID(),
        name: nutrition.name,
        calories: nutrition.calories,
        macros: {
          protein: nutrition.protein,
          carbs: nutrition.carbs,
          fat: nutrition.fat,
        },
        weightGrams: nutrition.weight,
        confidence: nutrition.confidence,
        timestamp: Date.now(),
        source: nutrition.isCloudVerified ? 'stepfun' : 'mock',
      };

      // 1. Commit to IndexedDB & sessionLog store
      await persistMealLog(payload);

      // 2. Dispatch to FoodScannerBus (which bridges to global SponsorEventBus)
      foodScannerBus.emitMealLogged(payload);

      // 3. Trigger confirmation toast
      toast(`Logged ${nutrition.name} (${nutrition.calories} kcal) to daily log`, 'info');

      setIsLogged(true);
      onLogged?.(payload);
    } catch (err) {
      console.error('[FoodTooltipCard] Failed to log meal:', err);
      toast('Failed to record meal. Please try again.', 'error');
    } finally {
      setIsLogging(false);
    }
  }, [isLogging, isLogged, nutrition, toast, onLogged]);

  return (
    <div
      role="region"
      aria-label={`Nutritional details for ${nutrition.name}`}
      className="pointer-events-auto select-none font-sans text-neutral-100 transition-all duration-300 ease-out transform translate-y-0 opacity-100 scale-100"
    >
      {/* Glassmorphism Card Container */}
      <div className="w-72 overflow-hidden rounded-2xl border border-white/15 bg-neutral-900/85 p-3.5 shadow-2xl backdrop-blur-xl ring-1 ring-white/10 transition-shadow duration-300 hover:shadow-cyan-500/10 hover:border-cyan-500/30">
        {/* Header / Primary State */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-base font-semibold tracking-tight text-white">
                {nutrition.name}
              </span>
              {nutrition.isCloudVerified ? (
                <span className="inline-flex items-center rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 border border-emerald-500/30">
                  StepFun AI
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 border border-amber-500/30">
                  Estimated
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-400">
              <span>{nutrition.weight}g est.</span>
              <span>•</span>
              <span>{Math.round(nutrition.confidence * 100)}% match</span>
            </div>
          </div>

          {/* Calorie Pill */}
          <div className="flex flex-col items-end">
            <div className="flex items-baseline gap-0.5 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 px-2.5 py-1 border border-emerald-500/30">
              <span className="text-lg font-bold tabular-nums tracking-tight text-emerald-400">
                {nutrition.calories}
              </span>
              <span className="text-[10px] font-medium uppercase text-emerald-300/80">kcal</span>
            </div>
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            aria-expanded={isExpanded}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-neutral-200 transition-colors duration-200 hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/20"
          >
            <span>Macros</span>
            <svg
              className={`h-3.5 w-3.5 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => void handleAddToLog()}
            disabled={isLogging || isLogged}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold shadow-sm transition-all duration-200 focus:outline-none focus:ring-2 ${
              isLogged
                ? 'bg-neutral-800 text-neutral-400 border border-neutral-700 cursor-default'
                : 'bg-emerald-600 text-white hover:bg-emerald-500 active:scale-98 focus:ring-emerald-400/50 shadow-emerald-900/30'
            }`}
          >
            {isLogged ? (
              <>
                <svg className="h-3.5 w-3.5 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>Logged</span>
              </>
            ) : isLogging ? (
              <span>Saving…</span>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
                <span>Add to Log</span>
              </>
            )}
          </button>
        </div>

        {/* Offline / Analysis Prompt Banner (if unverified and analyze trigger provided) */}
        {!nutrition.isCloudVerified && onAnalyze && (
          <div className="mt-2.5 flex items-center justify-between rounded-lg bg-cyan-950/40 border border-cyan-800/40 px-2 py-1.5 text-[11px] text-cyan-200">
            <span>Want cloud precision?</span>
            <button
              type="button"
              onClick={onAnalyze}
              disabled={analyzing}
              className="font-medium text-cyan-400 underline underline-offset-2 hover:text-cyan-300 disabled:opacity-50"
            >
              {analyzing ? 'Scanning…' : 'Deep Scan'}
            </button>
          </div>
        )}

        {/* Expanded State: Macro Breakdown */}
        <div
          id={`macro-drawer-${uniqueId}`}
          className={`overflow-hidden transition-all duration-300 ease-in-out ${
            isExpanded ? 'max-h-60 mt-3 pt-3 border-t border-white/10 opacity-100' : 'max-h-0 opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex items-center gap-3">
            {/* SVG Mini Donut Chart */}
            <div className="relative h-14 w-14 shrink-0">
              <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 44 44">
                {/* Background Track */}
                <circle
                  cx="22"
                  cy="22"
                  r="18"
                  className="stroke-neutral-800"
                  strokeWidth="5"
                  fill="none"
                />
                {/* Protein Segment */}
                <circle
                  cx="22"
                  cy="22"
                  r="18"
                  className="stroke-emerald-500 transition-all duration-500"
                  strokeWidth="5"
                  strokeDasharray={macroBreakdown.circumference}
                  strokeDashoffset={macroBreakdown.pOffset}
                  strokeLinecap="round"
                  fill="none"
                />
                {/* Carbs Segment (offset) */}
                <circle
                  cx="22"
                  cy="22"
                  r="18"
                  className="stroke-amber-500 transition-all duration-500"
                  strokeWidth="5"
                  strokeDasharray={`${(macroBreakdown.cPct / 100) * macroBreakdown.circumference} ${macroBreakdown.circumference}`}
                  strokeDashoffset={-((macroBreakdown.pPct / 100) * macroBreakdown.circumference)}
                  fill="none"
                />
                {/* Fat Segment (offset) */}
                <circle
                  cx="22"
                  cy="22"
                  r="18"
                  className="stroke-rose-500 transition-all duration-500"
                  strokeWidth="5"
                  strokeDasharray={`${(macroBreakdown.fPct / 100) * macroBreakdown.circumference} ${macroBreakdown.circumference}`}
                  strokeDashoffset={-(((macroBreakdown.pPct + macroBreakdown.cPct) / 100) * macroBreakdown.circumference)}
                  fill="none"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-[10px] font-bold leading-none text-neutral-200">
                  {macroBreakdown.totalGrams}g
                </span>
                <span className="text-[8px] text-neutral-400">total</span>
              </div>
            </div>

            {/* Visual Macro Progress Bars */}
            <div className="flex-1 space-y-2">
              {/* Protein Bar */}
              <div>
                <div className="flex justify-between text-[11px]">
                  <span className="font-medium text-emerald-400">Protein ({macroBreakdown.pPct}%)</span>
                  <span className="tabular-nums font-semibold text-neutral-200">{nutrition.protein}g</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-500 ease-out"
                    style={{ width: `${Math.min(100, Math.max(4, macroBreakdown.pPct))}%` }}
                  />
                </div>
              </div>

              {/* Carbs Bar */}
              <div>
                <div className="flex justify-between text-[11px]">
                  <span className="font-medium text-amber-400">Carbs ({macroBreakdown.cPct}%)</span>
                  <span className="tabular-nums font-semibold text-neutral-200">{nutrition.carbs}g</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
                  <div
                    className="h-full rounded-full bg-amber-500 transition-all duration-500 ease-out"
                    style={{ width: `${Math.min(100, Math.max(4, macroBreakdown.cPct))}%` }}
                  />
                </div>
              </div>

              {/* Fat Bar */}
              <div>
                <div className="flex justify-between text-[11px]">
                  <span className="font-medium text-rose-400">Fat ({macroBreakdown.fPct}%)</span>
                  <span className="tabular-nums font-semibold text-neutral-200">{nutrition.fat}g</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
                  <div
                    className="h-full rounded-full bg-rose-500 transition-all duration-500 ease-out"
                    style={{ width: `${Math.min(100, Math.max(4, macroBreakdown.fPct))}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
