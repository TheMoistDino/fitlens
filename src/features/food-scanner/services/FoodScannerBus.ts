import { EventBus } from '@/core/events/EventBus';
import { sponsorBus } from '@/lib/sponsors/SponsorEventBus';
import { glassesController } from '@/lib/sponsors/smart-glasses/glassesPlugin';
import type { FoodScannerStateEvents } from './types';

/**
 * Feature-level event bus for the Food Scanner Vision Pipeline.
 *
 * Adheres strictly to the architectural boundary:
 * - Emits feature-specific state transitions (FOOD_DETECTED, NUTRITION_ESTIMATED, NUTRITION_FAILED).
 * - Bridges estimated nutrition into the global sponsorBus ('macro:result') so standard
 *   sponsor plugins (e.g. HUD, Session Log) receive updates seamlessly without touching core interfaces.
 * - Dispatches real-time macro updates directly to the active SmartGlassesAdapter via glassesController.
 */
class FoodScannerBus extends EventBus<FoodScannerStateEvents> {
  constructor() {
    super();

    // Automatically bridge NUTRITION_ESTIMATED to global sponsor bus and glasses HUD
    this.on(
      'NUTRITION_ESTIMATED',
      ({ macroSummary }) => {
        try {
          // Emit global macro result for all sponsor plugins
          sponsorBus.emit('macro:result', macroSummary);

          // Dispatch directly to smart glasses adapter (Null / Even Realities driver)
          glassesController.updateHud({ macroSummary });
        } catch (err) {
          console.error('[FoodScannerBus] Failed to dispatch macroSummary to sponsor bus / glasses', err);
        }
      },
      { mode: 'sync', owner: 'food-scanner:bridge' },
    );

    // Bridge MEAL_LOGGED to global sponsor bus
    this.on(
      'MEAL_LOGGED',
      (payload) => {
        try {
          (sponsorBus as unknown as EventBus<Record<string, unknown>>).emit('MEAL_LOGGED', payload);
        } catch (err) {
          console.error('[FoodScannerBus] Failed to dispatch MEAL_LOGGED to sponsor bus', err);
        }
      },
      { mode: 'sync', owner: 'food-scanner:bridge' },
    );
  }

  emitFoodDetected(payload: FoodScannerStateEvents['FOOD_DETECTED']): void {
    this.emit('FOOD_DETECTED', payload);
  }

  emitNutritionEstimated(payload: FoodScannerStateEvents['NUTRITION_ESTIMATED']): void {
    this.emit('NUTRITION_ESTIMATED', payload);
  }

  emitNutritionFailed(payload: FoodScannerStateEvents['NUTRITION_FAILED']): void {
    this.emit('NUTRITION_FAILED', payload);
  }

  emitMealLogged(payload: FoodScannerStateEvents['MEAL_LOGGED']): void {
    this.emit('MEAL_LOGGED', payload);
  }
}

export const foodScannerBus = new FoodScannerBus();
