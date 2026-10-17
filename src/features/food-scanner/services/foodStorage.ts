import { sessionLog } from '@/features/dashboard/useSessionLog';
import type { MacroItem, MacroSummary } from '@/core/events/events';
import type { MealLoggedPayload } from './types';

const DB_NAME = 'fitlens_food_db';
const DB_VERSION = 1;
const STORE_NAME = 'meal_logs';

/**
 * Open (or create) the IndexedDB database for food logs with schema upgrades.
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this environment'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('name', 'name', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });
}

/**
 * Persists a logged meal to both IndexedDB and the global sessionLog store.
 * Provides defensive fallback if IndexedDB is blocked or quota exceeded.
 */
export async function persistMealLog(meal: MealLoggedPayload): Promise<void> {
  // 1. Synchronize to sessionLog (powers Dashboard and immediate UI sync)
  const macroItem: MacroItem = {
    name: meal.name,
    kcal: meal.calories,
    protein: meal.macros.protein,
    carbs: meal.macros.carbs,
    fat: meal.macros.fat,
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

  // 2. Persist to IndexedDB for offline durability
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(meal);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('Failed to insert meal into IndexedDB'));
      transaction.oncomplete = () => db.close();
      transaction.onabort = () => db.close();
    });
  } catch (err) {
    // Defensive fallback: non-fatal, sessionLog already cached to localStorage / memory
    console.warn('[foodStorage] IndexedDB persistence fallback to sessionLog:', err);
  }
}

/**
 * Retrieves all meals from IndexedDB, sorted by timestamp descending.
 */
export async function getLoggedMealsFromIndexedDB(): Promise<MealLoggedPayload[]> {
  try {
    const db = await openDatabase();
    return await new Promise<MealLoggedPayload[]>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const request = index.getAll();

      request.onsuccess = () => {
        const results = (request.result as MealLoggedPayload[]) || [];
        resolve(results.reverse());
      };
      request.onerror = () => reject(request.error ?? new Error('Failed to read from IndexedDB'));
      transaction.oncomplete = () => db.close();
    });
  } catch (err) {
    console.warn('[foodStorage] IndexedDB read failed, returning empty list:', err);
    return [];
  }
}
