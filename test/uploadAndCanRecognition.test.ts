import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  getMilkBeverages,
  getCannedBeverages,
  getBeveragesByCategory,
  detectLiquidAppearance,
  searchBeverages,
  generateCanWebSearchUrl,
  getBeverageById,
  isLiquidContainer,
} from '../src/features/food-scanner/services/beverageProfiles';
import { StepFunFoodAdapter } from '../src/features/food-scanner/services/StepFunFoodAdapter';

describe('Uploaded Food Recognition, Milk & Canned Beverage Suite', () => {
  it('should provide comprehensive Milk & Dairy presets (whole, low-fat, skim, oat, almond, chocolate)', () => {
    const milkOptions = getMilkBeverages();
    assert.ok(milkOptions.length >= 6, 'Should have at least 6 milk/dairy options');

    const wholeMilk = milkOptions.find((m) => m.id === 'whole-milk');
    const lowFatMilk = milkOptions.find((m) => m.id === 'lowfat-milk');
    const skimMilk = milkOptions.find((m) => m.id === 'skim-milk');
    const oatMilk = milkOptions.find((m) => m.id === 'oat-milk');
    const almondMilk = milkOptions.find((m) => m.id === 'almond-milk');
    const chocMilk = milkOptions.find((m) => m.id === 'chocolate-milk');

    assert.ok(wholeMilk, 'Whole Milk preset must exist');
    assert.strictEqual(wholeMilk.calories, 150);
    assert.strictEqual(wholeMilk.protein, 8);
    assert.strictEqual(wholeMilk.fat, 8);

    assert.ok(lowFatMilk, '2% Low-Fat Milk preset must exist');
    assert.strictEqual(lowFatMilk.calories, 120);

    assert.ok(skimMilk, 'Skim Milk preset must exist');
    assert.strictEqual(skimMilk.calories, 90);
    assert.strictEqual(skimMilk.fat, 0);

    assert.ok(oatMilk, 'Oat Milk preset must exist');
    assert.strictEqual(oatMilk.calories, 130);

    assert.ok(almondMilk, 'Almond Milk preset must exist');
    assert.strictEqual(almondMilk.calories, 35);

    assert.ok(chocMilk, 'Chocolate Milk preset must exist');
    assert.strictEqual(chocMilk.calories, 210);

    // Verify all belong to the 'dairy' category
    for (const m of [wholeMilk, lowFatMilk, skimMilk, oatMilk, almondMilk, chocMilk]) {
      assert.strictEqual(m.category, 'dairy');
    }
  });

  it('should provide full canned beverage presets (Celsius, Red Bull, Coke Zero, Poppi, etc.)', () => {
    const cans = getCannedBeverages();
    assert.ok(cans.length >= 8, 'Should have at least 8 canned beverages');

    const celsius = cans.find((c) => c.id === 'celsius-sparkling');
    assert.ok(celsius, 'Celsius preset must exist');
    assert.strictEqual(celsius.calories, 10);
    assert.strictEqual(celsius.isCan, true);
    assert.strictEqual(celsius.brand, 'Celsius');

    const redBull = cans.find((c) => c.id === 'red-bull');
    assert.ok(redBull, 'Red Bull preset must exist');
    assert.strictEqual(redBull.calories, 110);
    assert.strictEqual(redBull.isCan, true);

    const redBullSF = cans.find((c) => c.id === 'red-bull-sugarfree');
    assert.ok(redBullSF, 'Red Bull Sugarfree must exist');
    assert.strictEqual(redBullSF.calories, 5);

    const cokeZero = cans.find((c) => c.id === 'coke-zero');
    assert.ok(cokeZero, 'Coke Zero must exist');
    assert.strictEqual(cokeZero.calories, 0);

    const poppi = cans.find((c) => c.id === 'poppi-soda');
    assert.ok(poppi, 'Poppi Prebiotic Soda must exist');
    assert.strictEqual(poppi.calories, 25);

    const liquidDeath = cans.find((c) => c.id === 'liquid-death');
    assert.ok(liquidDeath, 'Liquid Death must exist');
    assert.strictEqual(liquidDeath.calories, 0);
  });

  it('should accurately detect liquid visual appearance from sampled RGB color', () => {
    // 1. White / creamy liquid -> dairy (Milk)
    const whiteMilk = detectLiquidAppearance({ r: 245, g: 240, b: 235 });
    assert.strictEqual(whiteMilk, 'dairy', 'White/creamy color should classify as dairy');

    // 2. Dark brown / black -> dark-brown (Coffee/Tea/Cola)
    const darkCoffee = detectLiquidAppearance({ r: 40, g: 25, b: 18 });
    assert.strictEqual(darkCoffee, 'dark-brown', 'Low luminance color should classify as dark-brown');

    // 3. Orange / yellow juice -> juice
    const orangeJuice = detectLiquidAppearance({ r: 230, g: 140, b: 30 });
    assert.strictEqual(orangeJuice, 'juice', 'High red/green saturated color should classify as juice');

    // 4. Clear / neutral liquid -> water
    const water = detectLiquidAppearance({ r: 150, g: 155, b: 160 });
    assert.strictEqual(water, 'water', 'Neutral mid-tone should classify as water');
  });

  it('should support searching beverages by query text (brand, name, or keywords)', () => {
    // Search by brand
    const celsiusResults = searchBeverages('celsius');
    assert.ok(celsiusResults.length >= 1);
    assert.strictEqual(celsiusResults[0].id, 'celsius-sparkling');

    // Search by keyword
    const oatResults = searchBeverages('oat');
    assert.ok(oatResults.length >= 1);
    assert.strictEqual(oatResults[0].id, 'oat-milk');

    // Search by multi-word query
    const redBullResults = searchBeverages('red bull');
    assert.ok(redBullResults.length >= 2); // Original and Sugarfree
  });

  it('should generate valid web search URLs for cans and nutrition queries', () => {
    const url = generateCanWebSearchUrl('Celsius Sparkling Orange');
    assert.ok(url.startsWith('https://www.google.com/search?q='));
    assert.ok(url.includes('Celsius'));
    assert.ok(url.includes('nutrition'));
    assert.ok(url.includes('calories'));
  });

  it('should filter beverages by categories correctly via getBeveragesByCategory', () => {
    const dairy = getBeveragesByCategory('dairy');
    assert.ok(dairy.every((b) => b.category === 'dairy'));

    const canned = getBeveragesByCategory('canned');
    assert.ok(canned.every((b) => b.isCan || b.category === 'canned'));

    const tea = getBeveragesByCategory('tea');
    assert.ok(tea.every((b) => b.category === 'tea'));

    const water = getBeveragesByCategory('water');
    assert.ok(water.every((b) => b.category === 'water'));

    const suggested = getBeveragesByCategory('suggested');
    assert.ok(suggested.length >= 5);
  });

  it('should NOT classify uploaded photos as Mediterranean Meal Bowl by default in StepFunFoodAdapter', async () => {
    const adapter = new StepFunFoodAdapter({ endpoint: 'http://invalid-mock-endpoint' });

    // 1. Milk / Dairy context
    const milkRes = await adapter.estimateNutrition('data:image/jpeg;base64,mock', 'Detected items: cup. Visual appearance: White creamy liquid (dairy / milk)');
    assert.ok(milkRes.ok);
    const milkItem = milkRes.value.items[0];
    assert.ok(milkItem);
    assert.match(milkItem.foodItem.toLowerCase(), /milk/);
    assert.notStrictEqual(milkItem.foodItem, 'Mediterranean Meal Bowl');

    // 2. Can text OCR context (e.g. Celsius)
    const canRes = await adapter.estimateNutrition('data:image/jpeg;base64,mock', 'Detected items: bottle. Can label text reads: CELSIUS SPARKLING');
    assert.ok(canRes.ok);
    const canItem = canRes.value.items[0];
    assert.ok(canItem);
    assert.match(canItem.foodItem.toLowerCase(), /celsius/);
    assert.strictEqual(canItem.calories, 10);
    assert.notStrictEqual(canItem.foodItem, 'Mediterranean Meal Bowl');

    // 3. Apple uploaded photo
    const appleRes = await adapter.estimateNutrition('data:image/jpeg;base64,mock', 'Detected items: apple');
    assert.ok(appleRes.ok);
    const appleItem = appleRes.value.items[0];
    assert.strictEqual(appleItem.foodItem, 'Fresh Apple');
    assert.strictEqual(appleItem.calories, 95);

    // 4. Default fallback when no labels match
    const fallbackRes = await adapter.estimateNutrition('data:image/jpeg;base64,mock', 'Uploaded food photo from device storage');
    assert.ok(fallbackRes.ok);
    const fallbackItem = fallbackRes.value.items[0];
    assert.strictEqual(fallbackItem.foodItem, 'Balanced Entree Plate');
    assert.notStrictEqual(fallbackItem.foodItem, 'Mediterranean Meal Bowl');
  });
});
