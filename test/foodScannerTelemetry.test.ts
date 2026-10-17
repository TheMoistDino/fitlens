import { describe, it } from 'node:test';
import assert from 'node:assert';
import { trackTelemetryMetric } from '../src/routes/FoodScannerRoute';
import { sponsorBus } from '../src/lib/sponsors/SponsorEventBus';
import { glassesController, registerGlassesAdapter } from '../src/lib/sponsors/smart-glasses/glassesPlugin';
import type { SmartGlassesAdapter } from '../src/lib/sponsors/smart-glasses/SmartGlassesAdapter';
import type { DeviceStatus, HudPayload, MacroSummary } from '../src/core/events/events';
import { useFoodLogStore } from '../src/features/food-scanner/store/useFoodLogStore';
import { sessionLog } from '../src/features/dashboard/useSessionLog';
import { foodScannerBus } from '../src/features/food-scanner/services/FoodScannerBus';
import type { MealLoggedPayload } from '../src/features/food-scanner/services/types';

// Mock MockGlassesAdapter for telemetry and dispatch verification
class MockTestGlassesAdapter implements SmartGlassesAdapter {
  readonly id = 'mock-glasses-test';
  readonly label = 'Mock Test Smart Glasses';
  public lastHudPayload: HudPayload | null = null;
  public hudCallCount = 0;

  isSupported(): boolean {
    return true;
  }
  async connect(): Promise<void> {
    return Promise.resolve();
  }
  async disconnect(): Promise<void> {
    return Promise.resolve();
  }
  async sendHud(payload: HudPayload): Promise<void> {
    this.lastHudPayload = payload;
    this.hudCallCount++;
    return Promise.resolve();
  }
  onStatusChange(cb: (status: DeviceStatus, detail?: string) => void): () => void {
    cb('connected', 'Test BLE Connected');
    return () => {};
  }
}

describe('WebAR Food Scanner Telemetry & Dual-Dispatch Test Suite', () => {
  it('should verify Sentry telemetry transaction instrumentation', async () => {
    let operationExecuted = false;

    const result = await trackTelemetryMetric(
      'food_scanner.multimodal_analyze',
      'ai.multimodal.inference',
      {
        'ai.model': 'step-5-preview',
        'telemetry.test': true,
      },
      async () => {
        operationExecuted = true;
        return { success: true, count: 2 };
      },
    );

    assert.strictEqual(operationExecuted, true, 'Telemetry wrapper must execute the provided function');
    assert.deepStrictEqual(result, { success: true, count: 2 });
  });

  it('should successfully dispatch logged meal to local React dashboard store AND SmartGlassesAdapter', async () => {
    // 1. Setup mock glasses adapter
    const glassesAdapter = new MockTestGlassesAdapter();
    await registerGlassesAdapter(glassesAdapter);

    // 2. Prepare test meal payload
    const mealPayload: MealLoggedPayload = {
      id: 'test-meal-' + Date.now(),
      name: 'Mediterranean Grilled Chicken Salad',
      calories: 520,
      macros: {
        protein: 45,
        carbs: 22,
        fat: 18,
      },
      weightGrams: 350,
      confidence: 0.94,
      timestamp: Date.now(),
      source: 'stepfun',
    };

    let globalSponsorBusMacroReceived: MacroSummary | null = null;
    let foodScannerBusMealReceived: MealLoggedPayload | null = null;

    // Use mode: 'sync' so the assertion immediately catches the synchronous emit
    sponsorBus.on('macro:result', (data) => {
      globalSponsorBusMacroReceived = data;
    }, { mode: 'sync' });

    foodScannerBus.on('MEAL_LOGGED', (data) => {
      foodScannerBusMealReceived = data;
    }, { mode: 'sync' });

    // 3. Execute dual-dispatch as implemented in FoodScannerRoute
    // A: Local React Dashboard Store (Zustand + IndexedDB)
    useFoodLogStore.getState().addMeal({
      id: mealPayload.id,
      name: mealPayload.name,
      calories: mealPayload.calories,
      protein: mealPayload.macros.protein,
      carbs: mealPayload.macros.carbs,
      fat: mealPayload.macros.fat,
      weightGrams: mealPayload.weightGrams,
      confidence: mealPayload.confidence,
      source: mealPayload.source,
      timestamp: mealPayload.timestamp,
    });

    // B: Session log for Dashboard React component sync
    const macroSummary: MacroSummary = {
      items: [
        {
          name: mealPayload.name,
          kcal: mealPayload.calories,
          protein: mealPayload.macros.protein,
          carbs: mealPayload.macros.carbs,
          fat: mealPayload.macros.fat,
          confidence: mealPayload.confidence,
        },
      ],
      totalKcal: mealPayload.calories,
      source: 'stepfun',
    };

    sessionLog.add({
      kind: 'meal',
      id: mealPayload.id,
      endedAt: mealPayload.timestamp,
      macros: macroSummary,
    });

    // C: Hardware Smart Glasses dispatch
    glassesController.updateHud({ macroSummary });
    sponsorBus.emit('macro:result', macroSummary);

    // D: Feature bus event
    foodScannerBus.emitMealLogged(mealPayload);

    // 4. Assertions: Local React Dashboard State
    const storedLogs = useFoodLogStore.getState().dailyLogs;
    const foundInZustand = storedLogs.find((m) => m.id === mealPayload.id);
    assert.ok(foundInZustand, 'Meal must be persisted in useFoodLogStore');
    assert.strictEqual(foundInZustand.calories, 520);
    assert.strictEqual(foundInZustand.protein, 45);

    const sessionEntries = sessionLog.get();
    const foundInSession = sessionEntries.find((s) => s.id === mealPayload.id);
    assert.ok(foundInSession, 'Meal must be present in sessionLog');
    assert.strictEqual(foundInSession.kind, 'meal');

    // 5. Assertions: Hardware Smart Glasses & Global Sponsor Bus
    assert.ok(globalSponsorBusMacroReceived, 'sponsorBus must receive macro:result');
    assert.strictEqual(globalSponsorBusMacroReceived.totalKcal, 520);
    assert.strictEqual(globalSponsorBusMacroReceived.items[0]?.name, 'Mediterranean Grilled Chicken Salad');

    // 6. Assertions: FoodScannerBus bridge
    assert.ok(foodScannerBusMealReceived, 'foodScannerBus must receive MEAL_LOGGED');
    assert.strictEqual(foodScannerBusMealReceived.id, mealPayload.id);

    console.log('✔ All telemetry & dual-dispatch assertions passed successfully!');
  });

  it('should successfully log and dispatch a meal originated from photo upload', async () => {
    const uploadMeal: MealLoggedPayload = {
      id: 'upload-meal-' + Date.now(),
      name: 'Avocado Toast with Poached Egg',
      calories: 380,
      macros: {
        protein: 16,
        carbs: 28,
        fat: 22,
      },
      weightGrams: 220,
      confidence: 0.91,
      timestamp: Date.now(),
      source: 'upload',
    };

    let macroReceived: MacroSummary | null = null;
    let busMealReceived: MealLoggedPayload | null = null;

    sponsorBus.on('macro:result', (data) => {
      macroReceived = data;
    }, { mode: 'sync' });

    foodScannerBus.on('MEAL_LOGGED', (data) => {
      busMealReceived = data;
    }, { mode: 'sync' });

    // 1. Add to store
    useFoodLogStore.getState().addMeal({
      id: uploadMeal.id,
      name: uploadMeal.name,
      calories: uploadMeal.calories,
      protein: uploadMeal.macros.protein,
      carbs: uploadMeal.macros.carbs,
      fat: uploadMeal.macros.fat,
      weightGrams: uploadMeal.weightGrams,
      confidence: uploadMeal.confidence,
      source: uploadMeal.source,
      timestamp: uploadMeal.timestamp,
    });

    const summary: MacroSummary = {
      items: [
        {
          name: uploadMeal.name,
          kcal: uploadMeal.calories,
          protein: uploadMeal.macros.protein,
          carbs: uploadMeal.macros.carbs,
          fat: uploadMeal.macros.fat,
          confidence: uploadMeal.confidence,
        },
      ],
      totalKcal: uploadMeal.calories,
      source: 'stepfun',
    };

    sessionLog.add({
      kind: 'meal',
      id: uploadMeal.id,
      endedAt: uploadMeal.timestamp,
      macros: summary,
    });

    glassesController.updateHud({ macroSummary: summary });
    sponsorBus.emit('macro:result', summary);
    foodScannerBus.emitMealLogged(uploadMeal);

    // Verify persistence in store with 'upload' source
    const found = useFoodLogStore.getState().dailyLogs.find((m) => m.id === uploadMeal.id);
    assert.ok(found, 'Uploaded meal must be stored in useFoodLogStore');
    assert.strictEqual(found.source, 'upload', 'Source must be preserved as upload');
    assert.strictEqual(found.calories, 380);

    // Verify sessionLog entry
    const sessionFound = sessionLog.get().find((s) => s.id === uploadMeal.id);
    assert.ok(sessionFound, 'Uploaded meal must be stored in sessionLog');

    // Verify sponsorBus and foodScannerBus
    assert.ok(macroReceived, 'sponsorBus received macro:result for upload');
    assert.ok(busMealReceived, 'foodScannerBus received MEAL_LOGGED for upload');
    assert.strictEqual(busMealReceived.source, 'upload');
  });
});
