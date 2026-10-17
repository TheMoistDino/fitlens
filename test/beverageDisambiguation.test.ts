import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isLiquidContainer,
  getDarkBrownBeverages,
  getBeveragePresets,
  getBeverageById,
  matchBeverageByName,
  BEVERAGE_PRESETS,
} from '../src/features/food-scanner/services/beverageProfiles';
import { StepFunFoodAdapter } from '../src/features/food-scanner/services/StepFunFoodAdapter';

describe('Food Recognition Accuracy & Liquid Disambiguation Suite', () => {
  it('should verify dining table is completely excluded from liquid containers and food sets', () => {
    assert.strictEqual(isLiquidContainer('dining table'), false);
    assert.strictEqual(isLiquidContainer('table'), false);
    assert.strictEqual(isLiquidContainer('chair'), false);
  });

  it('should correctly identify liquid containers (cup, bottle, wine glass, mug)', () => {
    assert.strictEqual(isLiquidContainer('cup'), true);
    assert.strictEqual(isLiquidContainer('bottle'), true);
    assert.strictEqual(isLiquidContainer('wine glass'), true);
    assert.strictEqual(isLiquidContainer('mug'), true);
    assert.strictEqual(isLiquidContainer('glass'), true);
    assert.strictEqual(isLiquidContainer('beverage'), true);

    // Non-liquid food items
    assert.strictEqual(isLiquidContainer('apple'), false);
    assert.strictEqual(isLiquidContainer('banana'), false);
    assert.strictEqual(isLiquidContainer('pizza'), false);
    assert.strictEqual(isLiquidContainer('sandwich'), false);
  });

  it('should provide distinct nutritional profiles for dark-brown liquids (coffee vs. tea vs. cola)', () => {
    const darkBrowns = getDarkBrownBeverages();
    const coffee = darkBrowns.find((b) => b.id === 'black-coffee');
    const tea = darkBrowns.find((b) => b.id === 'unsweetened-tea');
    const cola = darkBrowns.find((b) => b.id === 'regular-cola');
    const dietCola = darkBrowns.find((b) => b.id === 'diet-cola');

    assert.ok(coffee, 'Coffee preset should exist');
    assert.ok(tea, 'Tea preset should exist');
    assert.ok(cola, 'Cola preset should exist');
    assert.ok(dietCola, 'Diet Cola preset should exist');

    // Coffee and tea are virtually zero/near-zero calories
    assert.strictEqual(coffee.calories, 2);
    assert.strictEqual(tea.calories, 2);

    // Regular Cola is sugar-dense (140 kcal, 39g carbs)
    assert.strictEqual(cola.calories, 140);
    assert.strictEqual(cola.carbs, 39);

    // Diet Cola is zero calories
    assert.strictEqual(dietCola.calories, 0);

    // Significant calorie difference between visually identical dark liquids
    assert.ok(cola.calories > coffee.calories * 50);
  });

  it('should support finding and matching beverages by ID or name', () => {
    const latte = getBeverageById('latte');
    assert.ok(latte);
    assert.strictEqual(latte.calories, 150);
    assert.strictEqual(latte.protein, 8);

    const water = matchBeverageByName('sparkling water');
    assert.ok(water);
    assert.strictEqual(water.id, 'water');
    assert.strictEqual(water.calories, 0);
  });

  it('should provide context-aware fallback in StepFunFoodAdapter when offline or key is missing', async () => {
    const adapter = new StepFunFoodAdapter({ endpoint: 'http://invalid-endpoint-for-offline-test' });

    // 1. When context indicates a cup or liquid container
    const cupResult = await adapter.estimateNutrition('data:image/jpeg;base64,mock', 'Detected items: cup');
    assert.ok(cupResult.ok);
    const cupItem = cupResult.value.items[0];
    assert.ok(cupItem);
    assert.match(cupItem.foodItem.toLowerCase(), /beverage|drink|coffee|tea/);
    // Ambiguous confidence to trigger disambiguation UI
    assert.ok(cupItem.confidenceScore <= 0.60);
    assert.strictEqual(cupItem.calories, 2); // default near-zero coffee/tea heuristic

    // 2. When context indicates an apple
    const appleResult = await adapter.estimateNutrition('data:image/jpeg;base64,mock', 'Detected items: apple');
    assert.ok(appleResult.ok);
    const appleItem = appleResult.value.items[0];
    assert.ok(appleItem);
    assert.match(appleItem.foodItem.toLowerCase(), /apple/);
    assert.strictEqual(appleItem.calories, 95);

    // 3. When context indicates a pizza
    const pizzaResult = await adapter.estimateNutrition('data:image/jpeg;base64,mock', 'Detected items: pizza');
    assert.ok(pizzaResult.ok);
    const pizzaItem = pizzaResult.value.items[0];
    assert.ok(pizzaItem);
    assert.match(pizzaItem.foodItem.toLowerCase(), /pizza/);
    assert.strictEqual(pizzaItem.calories, 290);
  });
});
