import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { get, set, del } from 'idb-keyval';
import { sessionLog } from '@/features/dashboard/useSessionLog';
import type { MacroItem, MacroSummary } from '@/core/events/events';

export interface MealLog {
  id: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  timestamp: number;
  weightGrams?: number;
  confidence?: number;
  source?: 'stepfun' | 'mock' | 'manual' | 'upload';
}

export interface DailyGoals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface FoodLogState {
  dailyLogs: MealLog[];
  dailyGoals: DailyGoals;
  isHydrated: boolean;
  addMeal: (meal: Omit<MealLog, 'id' | 'timestamp'> & { id?: string; timestamp?: number }) => MealLog;
  removeMeal: (id: string) => void;
  updateMeal: (id: string, patch: Partial<Omit<MealLog, 'id'>>) => void;
  clearLogs: () => void;
  setDailyGoals: (goals: Partial<DailyGoals>) => void;
  setHydrated: (hydrated: boolean) => void;
}

export const DEFAULT_DAILY_GOALS: DailyGoals = {
  calories: 2500,
  protein: 180,
  carbs: 250,
  fat: 70,
};

const STORAGE_KEY = 'fitlens_food_logs_v1';
const MEMORY_FALLBACK = new Map<string, string>();

/**
 * Multi-tiered resilient storage engine:
 * 1. Primary: IndexedDB via idb-keyval (asynchronous, large quota, durable).
 * 2. Secondary: localStorage (synchronous browser storage fallback).
 * 3. Fallback: in-memory Map (defensive fallback for incognito/restricted environments).
 */
const resilientStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    // 1. Try IndexedDB if supported in browser environment
    if (typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined') {
      try {
        const val = await get<string>(name);
        if (val !== undefined && val !== null) {
          return val;
        }
      } catch (idbErr) {
        console.warn('[FoodLogStore] IndexedDB read failed, falling back to localStorage:', idbErr);
      }
    }

    // 2. Try localStorage
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const localVal = window.localStorage.getItem(name);
        if (localVal !== null) {
          // Opportunistically migrate to IndexedDB in background
          if (typeof window.indexedDB !== 'undefined') {
            try {
              await set(name, localVal);
            } catch {
              /* non-fatal migration */
            }
          }
          return localVal;
        }
      }
    } catch (lsErr) {
      console.warn('[FoodLogStore] localStorage read failed, falling back to memory:', lsErr);
    }

    // 3. Fallback: in-memory map
    return MEMORY_FALLBACK.get(name) ?? null;
  },

  setItem: async (name: string, value: string): Promise<void> => {
    // Write to memory cache immediately
    MEMORY_FALLBACK.set(name, value);

    // Write to localStorage for instant synchronous durability
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(name, value);
      }
    } catch (lsErr) {
      console.warn('[FoodLogStore] localStorage write failed (quota exceeded or restricted):', lsErr);
    }

    // Write to IndexedDB for primary durable persistence
    if (typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined') {
      try {
        await set(name, value);
      } catch (idbErr) {
        console.warn('[FoodLogStore] IndexedDB write failed:', idbErr);
      }
    }
  },

  removeItem: async (name: string): Promise<void> => {
    MEMORY_FALLBACK.delete(name);

    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(name);
      }
    } catch {
      /* non-fatal */
    }

    if (typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined') {
      try {
        await del(name);
      } catch {
        /* non-fatal */
      }
    }
  },
};

/**
 * Synchronize a meal entry to the existing sessionLog for dashboard backwards compatibility.
 */
function syncMealToSessionLog(meal: MealLog): void {
  try {
    const macroItem: MacroItem = {
      name: meal.name,
      kcal: meal.calories,
      protein: meal.protein,
      carbs: meal.carbs,
      fat: meal.fat,
      confidence: meal.confidence,
    };

    const macroSummary: MacroSummary = {
      items: [macroItem],
      totalKcal: meal.calories,
      source: meal.source === 'stepfun' ? 'stepfun' : 'mock',
    };

    sessionLog.add({
      kind: 'meal',
      id: meal.id,
      endedAt: meal.timestamp,
      macros: macroSummary,
    });
  } catch (err) {
    console.warn('[FoodLogStore] Failed to mirror meal to sessionLog:', err);
  }
}

export const useFoodLogStore = create<FoodLogState>()(
  persist(
    (set) => ({
      dailyLogs: [],
      dailyGoals: DEFAULT_DAILY_GOALS,
      isHydrated: false,

      setHydrated: (hydrated: boolean) => set({ isHydrated: hydrated }),

      addMeal: (mealInput) => {
        const id = mealInput.id ?? (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `meal_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);
        const timestamp = mealInput.timestamp ?? Date.now();

        const newMeal: MealLog = {
          ...mealInput,
          id,
          timestamp,
        };

        set((state) => ({
          dailyLogs: [newMeal, ...state.dailyLogs],
        }));

        // Mirror to sessionLog for unified activity history
        syncMealToSessionLog(newMeal);

        return newMeal;
      },

      removeMeal: (id: string) => {
        set((state) => ({
          dailyLogs: state.dailyLogs.filter((m) => m.id !== id),
        }));
      },

      updateMeal: (id: string, patch: Partial<Omit<MealLog, 'id'>>) => {
        set((state) => ({
          dailyLogs: state.dailyLogs.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        }));
      },

      clearLogs: () => {
        set({ dailyLogs: [] });
      },

      setDailyGoals: (goals: Partial<DailyGoals>) => {
        set((state) => ({
          dailyGoals: {
            ...state.dailyGoals,
            ...goals,
          },
        }));
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => resilientStorage),
      partialize: (state) => ({
        dailyLogs: state.dailyLogs,
        dailyGoals: state.dailyGoals,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    },
  ),
);
