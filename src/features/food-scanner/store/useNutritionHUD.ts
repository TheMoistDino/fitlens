import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MacroItem, MacroSummary } from '@/core/events/events';
import { glassesController } from '@/lib/sponsors/smart-glasses/glassesPlugin';
import { sponsorBus } from '@/lib/sponsors/SponsorEventBus';
import { useFoodLogStore, type DailyGoals, type MealLog } from './useFoodLogStore';

export interface NutritionTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface NutritionRemaining {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface NutritionProgress {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface UseNutritionHUDResult {
  dailyLogs: MealLog[];
  todayLogs: MealLog[];
  dailyGoals: DailyGoals;
  totals: NutritionTotals;
  remaining: NutritionRemaining;
  progress: NutritionProgress;
  latestMeal: MealLog | null;
  isHydrated: boolean;
  addMeal: (meal: Omit<MealLog, 'id' | 'timestamp'> & { id?: string; timestamp?: number }) => MealLog;
  removeMeal: (id: string) => void;
  updateMeal: (id: string, patch: Partial<Omit<MealLog, 'id'>>) => void;
  clearLogs: () => void;
  setDailyGoals: (goals: Partial<DailyGoals>) => void;
  emitNutritionToGlasses: (meal?: MealLog) => void;
}

/**
 * Returns the epoch timestamp of 00:00:00 today.
 */
function getStartOfTodayMs(): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.getTime();
}

/**
 * Custom hook providing real-time computed daily nutrition totals,
 * remaining macros vs targets, and reactive dispatching to the active
 * SmartGlassesAdapter (Even Realities / Null glasses driver).
 */
export function useNutritionHUD(): UseNutritionHUDResult {
  const dailyLogs = useFoodLogStore((state) => state.dailyLogs);
  const dailyGoals = useFoodLogStore((state) => state.dailyGoals);
  const isHydrated = useFoodLogStore((state) => state.isHydrated);
  const addMealAction = useFoodLogStore((state) => state.addMeal);
  const removeMealAction = useFoodLogStore((state) => state.removeMeal);
  const updateMealAction = useFoodLogStore((state) => state.updateMeal);
  const clearLogsAction = useFoodLogStore((state) => state.clearLogs);
  const setDailyGoalsAction = useFoodLogStore((state) => state.setDailyGoals);

  // Filter logs for today
  const todayLogs = useMemo(() => {
    const startOfToday = getStartOfTodayMs();
    return dailyLogs.filter((meal) => meal.timestamp >= startOfToday);
  }, [dailyLogs]);

  // Compute daily totals
  const totals = useMemo<NutritionTotals>(() => {
    return todayLogs.reduce<NutritionTotals>(
      (acc, meal) => ({
        calories: acc.calories + (meal.calories || 0),
        protein: acc.protein + (meal.protein || 0),
        carbs: acc.carbs + (meal.carbs || 0),
        fat: acc.fat + (meal.fat || 0),
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    );
  }, [todayLogs]);

  // Compute remaining amounts (clamped to 0)
  const remaining = useMemo<NutritionRemaining>(() => {
    return {
      calories: Math.max(0, dailyGoals.calories - totals.calories),
      protein: Math.max(0, dailyGoals.protein - totals.protein),
      carbs: Math.max(0, dailyGoals.carbs - totals.carbs),
      fat: Math.max(0, dailyGoals.fat - totals.fat),
    };
  }, [dailyGoals, totals]);

  // Compute fractional progress [0..1+]
  const progress = useMemo<NutritionProgress>(() => {
    return {
      calories: dailyGoals.calories > 0 ? totals.calories / dailyGoals.calories : 0,
      protein: dailyGoals.protein > 0 ? totals.protein / dailyGoals.protein : 0,
      carbs: dailyGoals.carbs > 0 ? totals.carbs / dailyGoals.carbs : 0,
      fat: dailyGoals.fat > 0 ? totals.fat / dailyGoals.fat : 0,
    };
  }, [dailyGoals, totals]);

  const latestMeal = todayLogs[0] ?? dailyLogs[0] ?? null;

  /**
   * Helper to dispatch payload updates to the active SmartGlassesAdapter
   * via glassesController.updateHud and global sponsorBus.
   */
  const emitNutritionToGlasses = useCallback(
    (targetMeal?: MealLog) => {
      try {
        const meal = targetMeal ?? latestMeal;
        let macroSummary: MacroSummary | null = null;

        if (meal) {
          const item: MacroItem = {
            name: meal.name,
            kcal: meal.calories,
            protein: meal.protein,
            carbs: meal.carbs,
            fat: meal.fat,
            confidence: meal.confidence,
          };

          macroSummary = {
            items: [item],
            totalKcal: meal.calories,
            source: meal.source === 'stepfun' ? 'stepfun' : 'mock',
          };

          // Also emit to sponsorBus so all plugin listeners receive macro update
          try {
            sponsorBus.emit('macro:result', macroSummary);
          } catch {
            /* defensive bus isolation */
          }
        }

        // Direct dispatch to SmartGlassesAdapter via glassesController
        glassesController.updateHud({
          calories: totals.calories,
          macroSummary,
        });
      } catch (err) {
        console.warn('[useNutritionHUD] Failed to dispatch update to SmartGlassesAdapter:', err);
      }
    },
    [latestMeal, totals.calories],
  );

  // Track the ID of the last emitted meal to prevent redundant BLE frames
  const lastEmittedMealIdRef = useRef<string | null>(null);
  const isInitialMount = useRef(true);

  // Watch for new meals logged and update SmartGlassesAdapter in real time
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      if (latestMeal) {
        lastEmittedMealIdRef.current = latestMeal.id;
      }
      return;
    }

    if (latestMeal && latestMeal.id !== lastEmittedMealIdRef.current) {
      lastEmittedMealIdRef.current = latestMeal.id;
      emitNutritionToGlasses(latestMeal);
    }
  }, [latestMeal, emitNutritionToGlasses]);

  // Wrapper for addMeal that guarantees immediate glasses notification
  const addMeal = useCallback(
    (mealInput: Omit<MealLog, 'id' | 'timestamp'> & { id?: string; timestamp?: number }) => {
      const added = addMealAction(mealInput);
      emitNutritionToGlasses(added);
      return added;
    },
    [addMealAction, emitNutritionToGlasses],
  );

  return {
    dailyLogs,
    todayLogs,
    dailyGoals,
    totals,
    remaining,
    progress,
    latestMeal,
    isHydrated,
    addMeal,
    removeMeal: removeMealAction,
    updateMeal: updateMealAction,
    clearLogs: clearLogsAction,
    setDailyGoals: setDailyGoalsAction,
    emitNutritionToGlasses,
  };
}
