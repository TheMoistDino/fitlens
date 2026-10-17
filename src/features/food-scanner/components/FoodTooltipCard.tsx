import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useToast } from '@/app/providers';
import type { MacroItem } from '@/core/events/events';
import { foodScannerBus } from '../services/FoodScannerBus';
import { persistMealLog } from '../services/foodStorage';
import type { DetectedFoodItem, MealLoggedPayload, StepFunFoodItem } from '../services/types';

import {
  isLiquidContainer,
  getBeveragesByCategory,
  searchBeverages,
  generateCanWebSearchUrl,
  type BeveragePreset,
  type BeverageCategory,
} from '../services/beverageProfiles';

import {
  isFoodHidingContents,
  getCompositeBaseline,
  calculateCompositeNutrition,
  FILLING_TAGS,
  type FillingCategory,
} from '../services/compositeFoodProfiles';

import { StepFunFoodAdapter } from '../services/StepFunFoodAdapter';

/**
 * Fallback macro heuristics for common COCO food classes when cloud API has not yet responded.
 * Ensures the WebAR UI remains fully functional even in offline / degraded connectivity.
 */
const FALLBACK_MACRO_ESTIMATES: Record<string, { kcal: number; protein: number; carbs: number; fat: number; weight: number }> = {
  apple: { kcal: 95, protein: 0.5, carbs: 25, fat: 0.3, weight: 182 },
  banana: { kcal: 105, protein: 1.3, carbs: 27, fat: 0.4, weight: 118 },
  sandwich: { kcal: 420, protein: 22, carbs: 42, fat: 16, weight: 220 },
  burrito: { kcal: 680, protein: 28, carbs: 85, fat: 24, weight: 380 },
  wrap: { kcal: 520, protein: 24, carbs: 52, fat: 22, weight: 280 },
  burger: { kcal: 550, protein: 28, carbs: 44, fat: 28, weight: 240 },
  calzone: { kcal: 780, protein: 34, carbs: 76, fat: 36, weight: 350 },
  'pot pie': { kcal: 620, protein: 20, carbs: 55, fat: 36, weight: 320 },
  dumpling: { kcal: 280, protein: 12, carbs: 32, fat: 10, weight: 160 },
  dumplings: { kcal: 280, protein: 12, carbs: 32, fat: 10, weight: 160 },
  taco: { kcal: 230, protein: 12, carbs: 18, fat: 11, weight: 110 },
  tacos: { kcal: 230, protein: 12, carbs: 18, fat: 11, weight: 110 },
  quesadilla: { kcal: 580, protein: 26, carbs: 48, fat: 32, weight: 260 },
  orange: { kcal: 62, protein: 1.2, carbs: 15, fat: 0.2, weight: 130 },
  broccoli: { kcal: 55, protein: 3.7, carbs: 11, fat: 0.6, weight: 150 },
  carrot: { kcal: 41, protein: 0.9, carbs: 10, fat: 0.2, weight: 100 },
  'hot dog': { kcal: 290, protein: 10, carbs: 24, fat: 17, weight: 140 },
  pizza: { kcal: 285, protein: 12, carbs: 36, fat: 10, weight: 107 },
  donut: { kcal: 250, protein: 3, carbs: 31, fat: 13, weight: 60 },
  cake: { kcal: 350, protein: 4, carbs: 50, fat: 15, weight: 100 },
  bowl: { kcal: 380, protein: 22, carbs: 45, fat: 12, weight: 350 },
  cup: { kcal: 2, protein: 0.2, carbs: 0.3, fat: 0, weight: 240 },
  bottle: { kcal: 0, protein: 0, carbs: 0, fat: 0, weight: 355 },
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
  /** Initial category hint (e.g. 'dairy' for milk, 'canned' for cans) */
  initialCategoryHint?: BeverageCategory;
  /** Initial text detected on can or bottle */
  detectedCanText?: string;
  /** Trigger manual cloud analysis */
  onAnalyze?: () => void;
  /** Callback fired after meal is committed to storage and event bus */
  onLogged?: (meal: MealLoggedPayload) => void;
  /** Optional close / dismiss callback in review mode */
  onClose?: () => void;
  /** Manual fallback override callback when confidence < 0.60 or user requests adjustment */
  onAdjust?: (
    item: DetectedFoodItem,
    currentNutrition: {
      name: string;
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
      weight: number;
      confidence: number;
      isCloudVerified: boolean;
    },
  ) => void;
}

const CATEGORY_TABS: Array<{ id: BeverageCategory; label: string }> = [
  { id: 'suggested', label: 'Top Picks' },
  { id: 'dairy', label: '🥛 Milk' },
  { id: 'canned', label: '🥫 Cans' },
  { id: 'dark-brown', label: '☕ Coffee' },
  { id: 'tea', label: '🍵 Tea' },
  { id: 'water', label: '💧 Water' },
  { id: 'juice', label: '🧃 Juice' },
  { id: 'all', label: 'All' },
];

const FILLING_CATEGORY_TABS: Array<{ id: FillingCategory | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'protein', label: '🥩 Protein' },
  { id: 'grain', label: '🍚 Grain' },
  { id: 'beans', label: '🫘 Beans' },
  { id: 'dairy', label: '🧀 Dairy' },
  { id: 'topping', label: '🥑 Topping' },
];

const PORTION_OPTIONS = [
  { label: '0.5x Half', value: 0.5 },
  { label: '1.0x Normal', value: 1.0 },
  { label: '1.5x Large', value: 1.5 },
  { label: '2.0x Double', value: 2.0 },
];

/**
 * Interactive WebAR Tooltip & Inspection Card (`FoodTooltipCard.tsx`)
 *
 * Provides:
 * - Minimal AR Live Reticle Inspection and Paused Review Mode details.
 * - Dynamic composite food handling for burritos, wraps, sandwiches, etc. (R4).
 * - 16 quick filling tags + write-in notes + cross-section photo scan (`📸 Scan Inside`).
 * - Calibrated standard baseline averages with clear notes.
 * - Liquid and canned beverage disambiguation with web search integration.
 * - Portion multiplier adjustments (0.5x, 1x, 1.5x, 2x).
 * - Donut macro chart & visual progress bars for Protein, Carbs, and Fats.
 */
export function FoodTooltipCard({
  item,
  macroItem,
  detailedItem,
  analyzing = false,
  initialCategoryHint,
  detectedCanText,
  onAnalyze,
  onLogged,
  onClose,
  onAdjust,
}: FoodTooltipCardProps) {
  const toast = useToast();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLogged, setIsLogged] = useState(false);
  const [isLogging, setIsLogging] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<BeverageCategory>(initialCategoryHint ?? 'suggested');
  const [searchQuery, setSearchQuery] = useState(detectedCanText ?? '');
  const [selectedBeverage, setSelectedBeverage] = useState<BeveragePreset | null>(null);

  // Composite food (burrito, wrap, sandwich, taco, etc.) state
  const isComposite = useMemo(() => isFoodHidingContents(item.label), [item.label]);
  const baseline = useMemo(() => getCompositeBaseline(item.label), [item.label]);
  const [portionMultiplier, setPortionMultiplier] = useState<number>(1.0);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [compositeNotes, setCompositeNotes] = useState<string>('');
  const [activeFillingCategory, setActiveFillingCategory] = useState<FillingCategory | 'all'>('all');
  const [crossSectionResult, setCrossSectionResult] = useState<StepFunFoodItem | null>(null);
  const [crossSectionScanning, setCrossSectionScanning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const uniqueId = useId();

  const isLiquid = useMemo(() => {
    return (
      isLiquidContainer(item.label) ||
      isLiquidContainer(macroItem?.name) ||
      (macroItem?.name?.toLowerCase().includes('beverage') ?? false) ||
      (detailedItem?.foodItem?.toLowerCase().includes('beverage') ?? false)
    );
  }, [item.label, macroItem, detailedItem]);

  const displayedBeverages = useMemo(() => {
    if (searchQuery.trim()) {
      return searchBeverages(searchQuery);
    }
    return getBeveragesByCategory(selectedCategory);
  }, [selectedCategory, searchQuery]);

  const displayedFillingTags = useMemo(() => {
    if (activeFillingCategory === 'all') return FILLING_TAGS;
    return FILLING_TAGS.filter((t) => t.category === activeFillingCategory);
  }, [activeFillingCategory]);

  const toggleFillingTag = useCallback((tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  }, []);

  // Multimodal Cross-Section Photo Scan handler (R4)
  const handleScanInside = useCallback(
    async (file: File) => {
      setCrossSectionScanning(true);
      try {
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const adapter = new StepFunFoodAdapter();
        const result = await adapter.estimateNutrition(
          dataUrl,
          `cross-section scan inside ${item.label} exposed fillings`,
        );

        if (result.ok && result.value.items.length > 0 && result.value.items[0]) {
          const first = result.value.items[0];
          setCrossSectionResult(first);
          toast(`Cross-section scanned: ${first.foodItem} (${first.calories} kcal)`, 'info');
        } else {
          toast('Could not detect fillings from cross-section photo.', 'warn');
        }
      } catch (err) {
        console.error('[FoodTooltipCard] Cross-section scan failed:', err);
        toast('Failed to analyze cross-section image.', 'error');
      } finally {
        setCrossSectionScanning(false);
      }
    },
    [item.label, toast],
  );

  // Dynamic composite food nutrition calculation
  const compositeNutrition = useMemo(() => {
    if (!isComposite) return null;
    return calculateCompositeNutrition({
      baseLabel: item.label,
      selectedTagIds,
      notes: compositeNotes,
      portionMultiplier,
    });
  }, [isComposite, item.label, selectedTagIds, compositeNotes, portionMultiplier]);

  // Resolve nutrition metrics with priority
  const nutrition = useMemo(() => {
    // 1. Cross-section analysis takes highest priority if scanned
    if (crossSectionResult) {
      return {
        name: crossSectionResult.foodItem || `${item.label} (Cross-Section)`,
        calories: Math.round((crossSectionResult.calories ?? 680) * portionMultiplier),
        protein: Math.round(((crossSectionResult.macros?.protein ?? 28) * portionMultiplier + Number.EPSILON) * 10) / 10,
        carbs: Math.round(((crossSectionResult.macros?.carbs ?? 85) * portionMultiplier + Number.EPSILON) * 10) / 10,
        fat: Math.round(((crossSectionResult.macros?.fat ?? 24) * portionMultiplier + Number.EPSILON) * 10) / 10,
        weight: Math.round((crossSectionResult.estimatedWeightGrams ?? 380) * portionMultiplier),
        confidence: crossSectionResult.confidenceScore ?? 0.88,
        isCloudVerified: true,
        badgeType: 'cross-section' as const,
        isBaselineAverage: false,
        baselineNote: undefined,
      };
    }

    // 2. User-selected beverage preset
    if (selectedBeverage) {
      return {
        name: selectedBeverage.name,
        calories: Math.round(selectedBeverage.calories * portionMultiplier),
        protein: Math.round((selectedBeverage.protein * portionMultiplier + Number.EPSILON) * 10) / 10,
        carbs: Math.round((selectedBeverage.carbs * portionMultiplier + Number.EPSILON) * 10) / 10,
        fat: Math.round((selectedBeverage.fat * portionMultiplier + Number.EPSILON) * 10) / 10,
        weight: Math.round(selectedBeverage.servingSizeGrams * portionMultiplier),
        confidence: 1.0,
        isCloudVerified: true,
        badgeType: 'confirmed-drink' as const,
        isBaselineAverage: false,
        baselineNote: undefined,
      };
    }

    // 3. Composite foods (burrito, wrap, sandwich, burger, calzone, pot pie, dumpling, taco)
    if (isComposite && compositeNutrition) {
      const displayName = item.label.charAt(0).toUpperCase() + item.label.slice(1);
      return {
        name: compositeNutrition.isBaselineAverage
          ? `${displayName} (Baseline Avg)`
          : displayName,
        calories: compositeNutrition.calories,
        protein: compositeNutrition.protein,
        carbs: compositeNutrition.carbs,
        fat: compositeNutrition.fat,
        weight: compositeNutrition.weightGrams,
        confidence: compositeNutrition.isBaselineAverage ? 0.75 : 0.9,
        isCloudVerified: false,
        badgeType: compositeNutrition.isBaselineAverage
          ? ('baseline-avg' as const)
          : ('custom-fillings' as const),
        isBaselineAverage: compositeNutrition.isBaselineAverage,
        baselineNote: compositeNutrition.baselineNote,
      };
    }

    // 4. Multimodal cloud analysis result
    if (macroItem) {
      const isGenericPlaceholder =
        macroItem.name.toLowerCase().includes('beverage') || isLiquidContainer(macroItem.name);

      if (isGenericPlaceholder) {
        return {
          name: 'Beverage (Select Drink)',
          calories: Math.round(2 * portionMultiplier),
          protein: 0.2,
          carbs: 0.3,
          fat: 0,
          weight: Math.round(240 * portionMultiplier),
          confidence: 0.5,
          isCloudVerified: false,
          badgeType: 'specify-drink' as const,
          isBaselineAverage: false,
          baselineNote: undefined,
        };
      }

      return {
        name: macroItem.name || item.label,
        calories: Math.round(macroItem.kcal * portionMultiplier),
        protein: Number((macroItem.protein * portionMultiplier).toFixed(1)),
        carbs: Number((macroItem.carbs * portionMultiplier).toFixed(1)),
        fat: Number((macroItem.fat * portionMultiplier).toFixed(1)),
        weight: Math.round((detailedItem?.estimatedWeightGrams ?? 150) * portionMultiplier),
        confidence: detailedItem?.confidenceScore ?? item.confidence,
        isCloudVerified: true,
        badgeType: 'cloud-verified' as const,
        isBaselineAverage: false,
        baselineNote: undefined,
      };
    }

    // 5. Liquid heuristic
    if (isLiquid) {
      return {
        name:
          item.label.toLowerCase() === 'cup'
            ? 'Beverage in Cup'
            : item.label.toLowerCase() === 'bottle'
              ? 'Drink in Bottle'
              : 'Beverage',
        calories: Math.round(2 * portionMultiplier),
        protein: 0.2,
        carbs: 0.3,
        fat: 0,
        weight: Math.round(240 * portionMultiplier),
        confidence: 0.45,
        isCloudVerified: false,
        badgeType: 'specify-drink' as const,
        isBaselineAverage: false,
        baselineNote: undefined,
      };
    }

    // 6. Local heuristic fallback
    const fallback = FALLBACK_MACRO_ESTIMATES[item.label.toLowerCase()] ?? {
      kcal: 220,
      protein: 8,
      carbs: 26,
      fat: 9,
      weight: 150,
    };

    return {
      name: item.label.charAt(0).toUpperCase() + item.label.slice(1),
      calories: Math.round(fallback.kcal * portionMultiplier),
      protein: Number((fallback.protein * portionMultiplier).toFixed(1)),
      carbs: Number((fallback.carbs * portionMultiplier).toFixed(1)),
      fat: Number((fallback.fat * portionMultiplier).toFixed(1)),
      weight: Math.round(fallback.weight * portionMultiplier),
      confidence: item.confidence,
      isCloudVerified: false,
      badgeType: 'estimated' as const,
      isBaselineAverage: false,
      baselineNote: undefined,
    };
  }, [
    crossSectionResult,
    selectedBeverage,
    isComposite,
    compositeNutrition,
    macroItem,
    item,
    portionMultiplier,
    detailedItem,
    isLiquid,
  ]);

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
      <div className="w-80 sm:w-96 overflow-hidden rounded-2xl border border-white/15 bg-neutral-900/90 p-3.5 shadow-2xl backdrop-blur-xl ring-1 ring-white/10 transition-shadow duration-300 hover:shadow-cyan-500/10 hover:border-cyan-500/30">
        {/* Header / Primary State */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="truncate text-base font-semibold tracking-tight text-white">
                {nutrition.name}
              </span>
              {nutrition.badgeType === 'cross-section' ? (
                <span className="inline-flex items-center rounded-full bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-medium text-cyan-300 border border-cyan-500/30">
                  📸 Cross-Section AI
                </span>
              ) : nutrition.badgeType === 'confirmed-drink' ? (
                <span className="inline-flex items-center rounded-full bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-medium text-cyan-300 border border-cyan-500/30">
                  Confirmed Drink
                </span>
              ) : nutrition.badgeType === 'specify-drink' ? (
                <span className="inline-flex items-center rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 border border-amber-500/30 animate-pulse">
                  Specify Drink
                </span>
              ) : nutrition.badgeType === 'custom-fillings' ? (
                <span className="inline-flex items-center rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 border border-emerald-500/30">
                  Custom Fillings ({selectedTagIds.length})
                </span>
              ) : nutrition.badgeType === 'baseline-avg' ? (
                <span className="inline-flex items-center rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 border border-amber-500/30">
                  Baseline Avg
                </span>
              ) : nutrition.badgeType === 'cloud-verified' ? (
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

          {/* Calorie Pill + Close Button */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex flex-col items-end">
              <div className="flex items-baseline gap-0.5 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 px-2.5 py-1 border border-emerald-500/30">
                <span className="text-lg font-bold tabular-nums tracking-tight text-emerald-400">
                  {nutrition.calories}
                </span>
                <span className="text-[10px] font-medium uppercase text-emerald-300/80">kcal</span>
              </div>
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close inspector"
                className="rounded-lg p-1 text-neutral-400 hover:bg-white/10 hover:text-white transition"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Portion Multiplier Selector Bar */}
        <div className="mt-2.5 flex items-center justify-between gap-1 rounded-xl bg-white/5 p-1 border border-white/10 text-xs">
          <span className="pl-1.5 text-[11px] font-medium text-neutral-400 shrink-0">Portion:</span>
          <div className="flex gap-1">
            {PORTION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPortionMultiplier(opt.value)}
                className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition ${
                  portionMultiplier === opt.value
                    ? 'bg-emerald-600 text-white font-semibold shadow-sm'
                    : 'text-neutral-400 hover:text-white hover:bg-white/10'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Composite Foods & Hidden Ingredients Section (R4) */}
        {isComposite && (
          <div className="mt-2.5 rounded-xl border border-amber-500/30 bg-amber-950/40 p-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-amber-200 flex items-center gap-1.5">
                <span>🌯</span>
                <span>Hidden Ingredients & Fillings</span>
              </span>
              {(selectedTagIds.length > 0 || compositeNotes.trim()) && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTagIds([]);
                    setCompositeNotes('');
                    toast('Reset to standard baseline average', 'info');
                  }}
                  className="text-[10px] text-amber-400 hover:text-amber-200 underline"
                >
                  Reset Baseline
                </button>
              )}
            </div>

            {/* Baseline Explanation Note */}
            {nutrition.isBaselineAverage && baseline && (
              <p className="mt-1.5 rounded-lg bg-black/40 border border-amber-500/20 p-1.5 text-[11px] text-amber-300/90 leading-tight">
                ℹ️ {baseline.baselineNote}
              </p>
            )}

            {/* Quick Filling Tags Multi-Select */}
            <div className="mt-2">
              <div className="flex items-center justify-between text-[11px] text-neutral-300 font-medium mb-1">
                <span>Select Inside Fillings:</span>
                <span className="text-[10px] text-neutral-400">{selectedTagIds.length} selected</span>
              </div>

              {/* Category Filter Tabs */}
              <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
                {FILLING_CATEGORY_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveFillingCategory(tab.id)}
                    className={`shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-medium transition ${
                      activeFillingCategory === tab.id
                        ? 'bg-amber-500 text-black font-semibold'
                        : 'bg-white/10 text-neutral-300 hover:bg-white/20 hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tag Chips Grid */}
              <div className="mt-1.5 flex flex-wrap gap-1 max-h-28 overflow-y-auto pr-0.5">
                {displayedFillingTags.map((tag) => {
                  const isChecked = selectedTagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleFillingTag(tag.id)}
                      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition ${
                        isChecked
                          ? 'bg-emerald-600 text-white font-semibold ring-1 ring-emerald-400 shadow-sm'
                          : 'bg-neutral-800/90 text-neutral-300 hover:bg-neutral-700 hover:text-white border border-neutral-700/50'
                      }`}
                    >
                      <span>{tag.icon}</span>
                      <span>{tag.name}</span>
                      <span className={`text-[10px] tabular-nums ${isChecked ? 'text-emerald-200' : 'text-neutral-400'}`}>
                        +{tag.calories}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Write-In Custom Notes Input */}
            <div className="mt-2">
              <input
                type="text"
                placeholder="Special notes (e.g. double steak, no rice, extra guac)…"
                value={compositeNotes}
                onChange={(e) => setCompositeNotes(e.target.value)}
                className="w-full rounded-lg border border-amber-500/30 bg-neutral-900/90 px-2.5 py-1 text-xs text-white placeholder-neutral-500 focus:border-amber-400 focus:outline-none"
              />
            </div>

            {/* Cross-Section Scan Inside Button (R4) */}
            <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-black/40 border border-cyan-500/30 p-1.5">
              <span className="text-[11px] text-cyan-200">Cut or bitten inside?</span>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={crossSectionScanning}
                className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 px-2 py-1 text-[11px] font-semibold text-white shadow-sm transition"
              >
                {crossSectionScanning ? 'Analyzing…' : '📸 Scan Inside'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleScanInside(file);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        )}

        {/* Liquid & Canned Drink Disambiguation Panel */}
        {isLiquid && (
          <div className="mt-2.5 rounded-xl border border-cyan-500/30 bg-cyan-950/60 p-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-cyan-200 flex items-center gap-1.5">
                <span>🥤</span>
                <span>Select Drink or Identify Can</span>
              </span>
              {selectedBeverage ? (
                <span className="text-[10px] text-emerald-400 font-medium">✓ Selected</span>
              ) : (
                <span className="text-[10px] text-cyan-400/80">Milk, Cans, Coffee, etc.</span>
              )}
            </div>

            {/* Category Filter Pills */}
            <div className="mt-1.5 flex gap-1 overflow-x-auto pb-1 scrollbar-none">
              {CATEGORY_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setSelectedCategory(tab.id);
                    setSearchQuery('');
                  }}
                  className={`shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-medium transition ${
                    selectedCategory === tab.id && !searchQuery.trim()
                      ? 'bg-cyan-500 text-black font-semibold'
                      : 'bg-white/10 text-neutral-300 hover:bg-white/20 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Can / Product Search Box with Web Lookup */}
            <div className="mt-1.5 flex items-center gap-1.5">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Read/type can text (Celsius, Red Bull, Dr Pepper)…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-cyan-500/30 bg-neutral-900/90 pl-2 pr-6 py-1 text-xs text-white placeholder-neutral-500 focus:border-cyan-400 focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white text-xs"
                  >
                    ×
                  </button>
                )}
              </div>
              <a
                href={generateCanWebSearchUrl(searchQuery || selectedBeverage?.name || item.label)}
                target="_blank"
                rel="noopener noreferrer"
                title="Search Google / USDA for exact nutrition"
                className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-cyan-600/80 hover:bg-cyan-500 px-2 py-1 text-[11px] font-semibold text-white transition shadow-sm"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                <span>Web Search</span>
              </a>
            </div>

            {/* Drink Selection Grid */}
            <div className="mt-2 grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto pr-0.5">
              {displayedBeverages.slice(0, 8).map((bev) => {
                const isCurrent = selectedBeverage?.id === bev.id;
                return (
                  <button
                    key={bev.id}
                    type="button"
                    onClick={() => {
                      setSelectedBeverage(bev);
                      toast(`Selected ${bev.name} (${bev.calories} kcal)`, 'info');
                    }}
                    className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-all ${
                      isCurrent
                        ? 'bg-cyan-500 text-black font-semibold ring-1 ring-cyan-300 shadow-sm'
                        : 'bg-white/10 text-neutral-200 hover:bg-white/20 hover:text-white'
                    }`}
                  >
                    <span className="truncate flex items-center gap-1">
                      <span>{bev.icon}</span>
                      <span className="truncate">{bev.shortName}</span>
                    </span>
                    <span className={`text-[10px] tabular-nums shrink-0 ml-1 ${isCurrent ? 'text-black font-bold' : 'text-neutral-400'}`}>
                      {bev.calories} kcal
                    </span>
                  </button>
                );
              })}
            </div>

            {selectedBeverage && (
              <div className="mt-1.5 flex justify-end">
                <button
                  type="button"
                  onClick={() => setSelectedBeverage(null)}
                  className="text-[11px] text-neutral-400 hover:text-neutral-200 underline"
                >
                  Reset selection
                </button>
              </div>
            )}
          </div>
        )}

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

        {/* Manual Fallback Input: If cloud estimation fails or confidence < 0.60 */}
        {(!nutrition.isCloudVerified || nutrition.confidence < 0.60) && (
          <div className="mt-2 flex items-center justify-between rounded-lg bg-neutral-800/80 border border-neutral-700/60 px-2 py-1.5 text-[11px] text-neutral-300">
            <span className="text-amber-400 font-medium flex items-center gap-1">
              <svg className="h-3 w-3 text-amber-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              {nutrition.confidence < 0.60 ? 'Low confidence' : 'Offline heuristic'}
            </span>
            <button
              type="button"
              onClick={() => onAdjust?.(item, nutrition)}
              className="font-medium text-cyan-400 underline underline-offset-2 hover:text-cyan-300 transition-colors focus:outline-none"
            >
              Adjust Calories/Macros
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

export { FoodTooltipCard as FoodItemInspectionCard };
