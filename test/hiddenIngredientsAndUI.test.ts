import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isFoodHidingContents,
  getCompositeBaseline,
  calculateCompositeNutrition,
  formatMinimalReticleLabel,
  FILLING_TAGS,
  getFillingTags,
  getFillingTagsByCategory,
  getFillingTagById,
  searchFillingTags,
  COMPOSITE_BASELINES,
} from '../src/features/food-scanner/services/compositeFoodProfiles';
import { StepFunFoodAdapter } from '../src/features/food-scanner/services/StepFunFoodAdapter';
import { DEFAULT_CAMERA_VIEWPORT_CLASS } from '../src/ui/CameraViewport';
import { computeCoverDimensions } from '../src/features/food-scanner/components/FoodOverlayCanvas';

describe('Hidden Ingredients & Minimal AR Reticle Labels Suite', () => {
  it('should correctly identify foods that hide contents (burritos, wraps, sandwiches, calzones, pot pies, dumplings, burgers, tacos)', () => {
    // Burritos & Wraps
    assert.strictEqual(isFoodHidingContents('burrito'), true);
    assert.strictEqual(isFoodHidingContents('Chicken Burrito'), true);
    assert.strictEqual(isFoodHidingContents('wrap'), true);
    assert.strictEqual(isFoodHidingContents('Veggie Wrap'), true);

    // Sandwiches & Burgers
    assert.strictEqual(isFoodHidingContents('sandwich'), true);
    assert.strictEqual(isFoodHidingContents('Turkey Club Sandwich'), true);
    assert.strictEqual(isFoodHidingContents('sub'), true);
    assert.strictEqual(isFoodHidingContents('panini'), true);
    assert.strictEqual(isFoodHidingContents('burger'), true);
    assert.strictEqual(isFoodHidingContents('Double Cheeseburger'), true);

    // Calzones, Pot Pies, Dumplings
    assert.strictEqual(isFoodHidingContents('calzone'), true);
    assert.strictEqual(isFoodHidingContents('pot pie'), true);
    assert.strictEqual(isFoodHidingContents('Chicken Pot Pie'), true);
    assert.strictEqual(isFoodHidingContents('dumpling'), true);
    assert.strictEqual(isFoodHidingContents('Pork Dumplings'), true);
    assert.strictEqual(isFoodHidingContents('gyoza'), true);
    assert.strictEqual(isFoodHidingContents('taco'), true);
    assert.strictEqual(isFoodHidingContents('tacos'), true);
    assert.strictEqual(isFoodHidingContents('quesadilla'), true);

    // Negative controls (non-hidden foods and non-foods)
    assert.strictEqual(isFoodHidingContents('apple'), false);
    assert.strictEqual(isFoodHidingContents('banana'), false);
    assert.strictEqual(isFoodHidingContents('pizza'), false);
    assert.strictEqual(isFoodHidingContents('broccoli'), false);
    assert.strictEqual(isFoodHidingContents('cup'), false);
    assert.strictEqual(isFoodHidingContents('bottle'), false);
    assert.strictEqual(isFoodHidingContents('dining table'), false);
    assert.strictEqual(isFoodHidingContents('table'), false);
    assert.strictEqual(isFoodHidingContents('chair'), false);
    assert.strictEqual(isFoodHidingContents('steak'), false);
    assert.strictEqual(isFoodHidingContents('rice'), false);
    assert.strictEqual(isFoodHidingContents(''), false);
    assert.strictEqual(isFoodHidingContents(null), false);
    assert.strictEqual(isFoodHidingContents(undefined), false);
  });

  it('should return calibrated baseline averages when no fillings are supplied', () => {
    // 1. Burrito standard baseline (~680 kcal)
    const burritoBaseline = getCompositeBaseline('burrito');
    assert.ok(burritoBaseline);
    assert.strictEqual(burritoBaseline.calories, 680);
    assert.strictEqual(burritoBaseline.protein, 28);
    assert.strictEqual(burritoBaseline.carbs, 85);
    assert.strictEqual(burritoBaseline.fat, 24);
    assert.ok(burritoBaseline.baselineNote.includes('baseline average'));

    // 2. Wrap baseline (~520 kcal)
    const wrapBaseline = getCompositeBaseline('wrap');
    assert.ok(wrapBaseline);
    assert.strictEqual(wrapBaseline.calories, 520);
    assert.strictEqual(wrapBaseline.protein, 24);
    assert.strictEqual(wrapBaseline.carbs, 52);
    assert.strictEqual(wrapBaseline.fat, 22);

    // 3. Sandwich baseline (~420 kcal)
    const sandwichBaseline = getCompositeBaseline('sandwich');
    assert.ok(sandwichBaseline);
    assert.strictEqual(sandwichBaseline.calories, 420);
    assert.strictEqual(sandwichBaseline.protein, 22);
    assert.strictEqual(sandwichBaseline.carbs, 42);
    assert.strictEqual(sandwichBaseline.fat, 16);

    // 4. Burger baseline (~550 kcal)
    const burgerBaseline = getCompositeBaseline('burger');
    assert.ok(burgerBaseline);
    assert.strictEqual(burgerBaseline.calories, 550);
    assert.strictEqual(burgerBaseline.protein, 28);

    // 5. Calzone baseline (~780 kcal)
    const calzoneBaseline = getCompositeBaseline('calzone');
    assert.ok(calzoneBaseline);
    assert.strictEqual(calzoneBaseline.calories, 780);
    assert.strictEqual(calzoneBaseline.protein, 34);

    // 6. Pot Pie baseline (~620 kcal)
    const potPieBaseline = getCompositeBaseline('pot pie');
    assert.ok(potPieBaseline);
    assert.strictEqual(potPieBaseline.calories, 620);
    assert.strictEqual(potPieBaseline.protein, 20);

    // 7. Dumplings baseline (~280 kcal)
    const dumplingBaseline = getCompositeBaseline('dumpling');
    assert.ok(dumplingBaseline);
    assert.strictEqual(dumplingBaseline.calories, 280);
    assert.strictEqual(dumplingBaseline.protein, 12);

    // 8. Taco baseline (~230 kcal)
    const tacoBaseline = getCompositeBaseline('taco');
    assert.ok(tacoBaseline);
    assert.strictEqual(tacoBaseline.calories, 230);
    assert.strictEqual(tacoBaseline.protein, 12);

    // 9. Non-composite returns undefined
    assert.strictEqual(getCompositeBaseline('apple'), undefined);
    assert.strictEqual(getCompositeBaseline('steak'), undefined);
  });

  it('should dynamically calculate calories and macros based on selected filling tags', () => {
    // When no tags provided -> baseline average returned
    const defaultBurrito = calculateCompositeNutrition({ baseLabel: 'burrito', selectedTagIds: [] });
    assert.strictEqual(defaultBurrito.calories, 680);
    assert.strictEqual(defaultBurrito.isBaselineAverage, true);

    // When fillings selected: Tortilla (210) + Steak (180) + White Rice (140) + Black Beans (90) + Cheese (110) = 730 kcal
    // Protein: 5 (tortilla) + 24 (steak) + 3 (rice) + 6 (beans) + 7 (cheese) = 45g
    const customBurrito = calculateCompositeNutrition({
      baseLabel: 'burrito',
      selectedTagIds: ['steak', 'white-rice', 'black-beans', 'cheese'],
    });
    assert.strictEqual(customBurrito.calories, 730);
    assert.strictEqual(customBurrito.protein, 45);
    assert.strictEqual(customBurrito.carbs, 83);
    assert.strictEqual(customBurrito.fat, 23.5);
    assert.strictEqual(customBurrito.isBaselineAverage, false);
    assert.strictEqual(customBurrito.selectedTags.length, 4);

    // Adding Guacamole (+150 kcal, +14g Fat, +2g Protein, +8g Carbs)
    const withGuac = calculateCompositeNutrition({
      baseLabel: 'burrito',
      selectedTagIds: ['steak', 'white-rice', 'black-beans', 'cheese', 'guacamole'],
    });
    assert.strictEqual(withGuac.calories, 880);
    assert.strictEqual(withGuac.protein, 47);
    assert.strictEqual(withGuac.carbs, 91);
    assert.ok(withGuac.fat >= 37);
  });

  it('should parse write-in notes and adjust macros and portions accurately', () => {
    // Write-in notes: extra meat and extra cheese
    const withNotes = calculateCompositeNutrition({
      baseLabel: 'burrito',
      selectedTagIds: ['chicken', 'white-rice'],
      notes: 'extra meat, extra cheese',
    });
    // Base Tortilla (210) + Chicken (140) + White Rice (140) = 490 kcal
    // Notes: extra meat (+150), extra cheese (+110) = +260 kcal
    // Total = 750 kcal
    assert.strictEqual(withNotes.calories, 750);
    assert.strictEqual(withNotes.notesAdjustmentKcal, 260);
    assert.strictEqual(withNotes.isBaselineAverage, false);

    // Portion multiplier: 1.5x portion
    const largePortion = calculateCompositeNutrition({
      baseLabel: 'burrito',
      selectedTagIds: [],
      portionMultiplier: 1.5,
    });
    assert.strictEqual(largePortion.calories, 1020); // 680 * 1.5
    assert.strictEqual(largePortion.protein, 42); // 28 * 1.5
    assert.strictEqual(largePortion.isBaselineAverage, true);
  });

  it('should format minimal AR reticle labels with clean compact pills (R2)', () => {
    // 1. Burrito baseline label
    const burritoLabel = formatMinimalReticleLabel({ label: 'burrito', calories: 680, isBaselineAverage: true });
    assert.strictEqual(burritoLabel, 'Burrito · ~680 kcal (Avg)');

    // 2. Apple label
    const appleLabel = formatMinimalReticleLabel({ label: 'apple', calories: 95 });
    assert.strictEqual(appleLabel, 'Apple · ~95 kcal');

    // 3. Generic liquid / drink container
    const drinkLabel = formatMinimalReticleLabel({ label: 'cup', isLiquid: true });
    assert.strictEqual(drinkLabel, 'Drink · ~0-140 kcal');

    // 4. Refined composite burrito
    const refinedBurrito = formatMinimalReticleLabel({ label: 'burrito', calories: 880, isBaselineAverage: false });
    assert.strictEqual(refinedBurrito, 'Burrito · ~880 kcal');

    // 5. Specific beverage identified
    const latteLabel = formatMinimalReticleLabel({ label: 'latte', calories: 150, isLiquid: true });
    assert.strictEqual(latteLabel, 'Latte · ~150 kcal');

    // 6. Unresolved composite without explicit calories defaults to baseline average
    const autoBurrito = formatMinimalReticleLabel({ label: 'burrito' });
    assert.strictEqual(autoBurrito, 'Burrito · ~680 kcal (Avg)');

    const autoSandwich = formatMinimalReticleLabel({ label: 'sandwich' });
    assert.strictEqual(autoSandwich, 'Sandwich · ~420 kcal (Avg)');
  });

  it('should provide full set of 16 quick filling tags with categories and search helper', () => {
    assert.strictEqual(FILLING_TAGS.length, 16);

    const proteinTags = getFillingTagsByCategory('protein');
    assert.ok(proteinTags.some((t) => t.id === 'steak'));
    assert.ok(proteinTags.some((t) => t.id === 'chicken'));
    assert.ok(proteinTags.some((t) => t.id === 'carnitas'));
    assert.ok(proteinTags.some((t) => t.id === 'tofu'));
    assert.ok(proteinTags.some((t) => t.id === 'bacon'));
    assert.ok(proteinTags.some((t) => t.id === 'egg'));

    const grainTags = getFillingTagsByCategory('grain');
    assert.ok(grainTags.some((t) => t.id === 'white-rice'));
    assert.ok(grainTags.some((t) => t.id === 'brown-rice'));

    const beanTags = getFillingTagsByCategory('beans');
    assert.ok(beanTags.some((t) => t.id === 'black-beans'));
    assert.ok(beanTags.some((t) => t.id === 'pinto-beans'));

    const dairyTags = getFillingTagsByCategory('dairy');
    assert.ok(dairyTags.some((t) => t.id === 'cheese'));
    assert.ok(dairyTags.some((t) => t.id === 'sour-cream'));
    assert.ok(dairyTags.some((t) => t.id === 'queso'));

    const toppingTags = getFillingTagsByCategory('topping');
    assert.ok(toppingTags.some((t) => t.id === 'guacamole'));
    assert.ok(toppingTags.some((t) => t.id === 'salsa'));
    assert.ok(toppingTags.some((t) => t.id === 'fajita-veggies'));

    // Tag lookup by ID
    const steak = getFillingTagById('steak');
    assert.ok(steak);
    assert.strictEqual(steak.calories, 180);
    assert.strictEqual(steak.protein, 24);

    // Search filling tags
    const searchGuac = searchFillingTags('guac');
    assert.strictEqual(searchGuac.length, 1);
    assert.strictEqual(searchGuac[0].id, 'guacamole');
  });

  it('should support cross-section scan context in StepFunFoodAdapter offline fallback', async () => {
    const adapter = new StepFunFoodAdapter({ endpoint: 'http://invalid-mock-endpoint' });

    // 1. Burrito context
    const burritoRes = await adapter.estimateNutrition('data:image/jpeg;base64,mock', 'Detected items: burrito');
    assert.ok(burritoRes.ok);
    const item = burritoRes.value.items[0];
    assert.ok(item);
    assert.match(item.foodItem.toLowerCase(), /burrito/);
    assert.strictEqual(item.calories, 680);

    // 2. Cross-section exposed inside context
    const crossSectionRes = await adapter.estimateNutrition(
      'data:image/jpeg;base64,mock',
      'Cross-section inside cut of burrito: exposed steak and black beans',
    );
    assert.ok(crossSectionRes.ok);
    const crossSectionItem = crossSectionRes.value.items[0];
    assert.ok(crossSectionItem);
    assert.ok(crossSectionItem.calories >= 600);
  });

  it('should handle custom notes deductions and multi-tier portion multipliers', () => {
    // 1. "no rice" deduction (-140 kcal)
    const noRice = calculateCompositeNutrition({
      baseLabel: 'burrito',
      selectedTagIds: ['chicken', 'white-rice', 'black-beans', 'cheese'],
      notes: 'no rice, light sour cream',
    });
    // Tortilla (210) + Chicken (140) + Rice (140) + Beans (90) + Cheese (110) = 690 kcal
    // Note: no rice (-140) -> 550 kcal
    assert.strictEqual(noRice.calories, 550);
    assert.strictEqual(noRice.notesAdjustmentKcal, -140);

    // 2. Double portion multiplier (2.0x)
    const doublePortion = calculateCompositeNutrition({
      baseLabel: 'wrap',
      selectedTagIds: [],
      portionMultiplier: 2.0,
    });
    // Wrap baseline: 520 kcal * 2 = 1040 kcal
    assert.strictEqual(doublePortion.calories, 1040);
    assert.strictEqual(doublePortion.protein, 48); // 24 * 2
    assert.strictEqual(doublePortion.isBaselineAverage, true);

    // 3. Half portion multiplier (0.5x)
    const halfPortion = calculateCompositeNutrition({
      baseLabel: 'sandwich',
      selectedTagIds: [],
      portionMultiplier: 0.5,
    });
    // Sandwich baseline: 420 kcal * 0.5 = 210 kcal
    assert.strictEqual(halfPortion.calories, 210);
    assert.strictEqual(halfPortion.protein, 11); // 22 * 0.5
  });

  it('should verify expansive camera viewport layout classes and absence of 62vh letterboxing (R1)', () => {
    // 1. Mobile viewport height fills screen above bottom nav bar
    assert.ok(
      DEFAULT_CAMERA_VIEWPORT_CLASS.includes('h-[calc(100dvh-4.5rem)]'),
      'Expected mobile responsive container height calc(100dvh-4.5rem)',
    );

    // 2. Desktop viewport height fills screen above desktop nav bar
    assert.ok(
      DEFAULT_CAMERA_VIEWPORT_CLASS.includes('md:h-[calc(100dvh-5.5rem)]'),
      'Expected desktop responsive container height md:h-[calc(100dvh-5.5rem)]',
    );

    // 3. Absolute elimination of hardcoded 62vh letterbox constraint
    assert.strictEqual(
      DEFAULT_CAMERA_VIEWPORT_CLASS.includes('62vh'),
      false,
      'Viewport layout class must not contain hardcoded 62vh letterbox',
    );

    // 4. Container specifies rounded borders, shadow, and full width
    assert.ok(DEFAULT_CAMERA_VIEWPORT_CLASS.includes('w-full'));
    assert.ok(DEFAULT_CAMERA_VIEWPORT_CLASS.includes('overflow-hidden'));
  });

  it('should compensate Three.js coordinates for object-cover displayed dimensions across aspect ratios (R1)', () => {
    // 1. Container wider than video (e.g. desktop widescreen 1920x1080 container with 4:3 camera stream)
    // Container aspect: 16/9 = 1.777 > Video aspect: 4/3 = 1.333
    // Width should fit container (1920), height should expand/overflow (1920 / (4/3) = 1440)
    const wideContainer = computeCoverDimensions(1920, 1080, 4 / 3);
    assert.strictEqual(wideContainer.width, 1920);
    assert.strictEqual(wideContainer.height, 1440);

    // 2. Container narrower/taller than video (e.g. mobile portrait 390x844 container with 16:9 camera stream)
    // Container aspect: 390/844 = 0.462 < Video aspect: 16/9 = 1.777
    // Height should fit container (844), width should expand/overflow (844 * (16/9) = 1500.444)
    const tallContainer = computeCoverDimensions(390, 844, 16 / 9);
    assert.strictEqual(tallContainer.height, 844);
    assert.ok(Math.abs(tallContainer.width - 844 * (16 / 9)) < 0.001);

    // 3. Container matching video aspect ratio (1280x720 with 16:9 video)
    const exactMatch = computeCoverDimensions(1280, 720, 16 / 9);
    assert.strictEqual(exactMatch.width, 1280);
    assert.strictEqual(exactMatch.height, 720);

    // 4. Defensive fallback: missing or invalid aspect ratio defaults to container dimensions
    const fallbackNoAspect = computeCoverDimensions(800, 600, undefined);
    assert.strictEqual(fallbackNoAspect.width, 800);
    assert.strictEqual(fallbackNoAspect.height, 600);

    const fallbackZeroAspect = computeCoverDimensions(800, 600, 0);
    assert.strictEqual(fallbackZeroAspect.width, 800);
    assert.strictEqual(fallbackZeroAspect.height, 600);
  });

  it('should handle domain logic edge cases: composite exclusions bypass, pot pie variants, sub word boundaries, 0-calorie beverages, and portionMultiplier sanitization', () => {
    // 1. isFoodHidingContents: exclusions bypass & pot-pie variants
    assert.strictEqual(isFoodHidingContents('steak sub'), true, 'steak sub should be recognized as composite');
    assert.strictEqual(isFoodHidingContents('steak quesadilla'), true, 'steak quesadilla should be recognized as composite');
    assert.strictEqual(isFoodHidingContents('steak panini'), true, 'steak panini should be recognized as composite');
    assert.strictEqual(isFoodHidingContents('steak empanada'), true, 'steak empanada should be recognized as composite');
    assert.strictEqual(isFoodHidingContents('quesadilla with rice'), true, 'quesadilla with rice should be recognized as composite');
    assert.strictEqual(isFoodHidingContents('pot-pie'), true, 'pot-pie (hyphenated) should be recognized as composite');
    assert.strictEqual(isFoodHidingContents('chicken pot-pie'), true, 'chicken pot-pie should be recognized as composite');
    assert.strictEqual(isFoodHidingContents('potpie'), true, 'potpie (unspaced) should be recognized as composite');
    // Ensure non-composite exclusions still return false
    assert.strictEqual(isFoodHidingContents('steak'), false, 'standalone steak must remain non-composite');
    assert.strictEqual(isFoodHidingContents('steak with rice'), false, 'steak with rice must remain non-composite');

    // 2. getCompositeBaseline: word-boundary matching on 'sub'
    assert.strictEqual(getCompositeBaseline('sugar substitute'), undefined, 'sugar substitute must not match sub');
    assert.strictEqual(getCompositeBaseline('subtle tea'), undefined, 'subtle tea must not match sub');
    assert.strictEqual(getCompositeBaseline('submarine'), undefined, 'submarine must not match sub');
    const steakSubBaseline = getCompositeBaseline('steak sub');
    assert.ok(steakSubBaseline, 'steak sub should match sandwich baseline');
    assert.strictEqual(steakSubBaseline.category, 'sandwich');
    const potPieBaseline = getCompositeBaseline('pot-pie');
    assert.ok(potPieBaseline, 'pot-pie should match pot pie baseline');
    assert.strictEqual(potPieBaseline.calories, 620);

    // 3. formatMinimalReticleLabel: zero-calorie specific beverages
    const dietCoke = formatMinimalReticleLabel({ label: 'Diet Coke', calories: 0, isLiquid: true });
    assert.strictEqual(dietCoke, 'Diet Coke · ~0 kcal', 'Diet Coke should show ~0 kcal');

    const water = formatMinimalReticleLabel({ label: 'Water', calories: 0, isLiquid: true });
    assert.strictEqual(water, 'Water · ~0 kcal', 'Water should show ~0 kcal');

    const blackCoffee = formatMinimalReticleLabel({ label: 'Black Coffee', calories: 0, isLiquid: true });
    assert.strictEqual(blackCoffee, 'Black Coffee · ~0 kcal', 'Black coffee should show ~0 kcal');

    const genericCup = formatMinimalReticleLabel({ label: 'cup', calories: 0, isLiquid: true });
    assert.strictEqual(genericCup, 'Drink · ~0-140 kcal', 'Generic cup container retains range');

    const unresolvedPotPie = formatMinimalReticleLabel({ label: 'pot-pie' });
    assert.strictEqual(unresolvedPotPie, 'Pot-pie · ~620 kcal (Avg)', 'pot-pie auto-formats baseline average');

    // 4. calculateCompositeNutrition: portionMultiplier sanitization
    // Negative multiplier should safely default to 1.0 (never produce negative calories)
    const negBaseline = calculateCompositeNutrition({
      baseLabel: 'burrito',
      selectedTagIds: [],
      portionMultiplier: -1,
    });
    assert.strictEqual(negBaseline.calories, 680, 'negative multiplier defaults to 1.0');
    assert.strictEqual(negBaseline.protein, 28);
    assert.ok(negBaseline.calories >= 0);

    // NaN multiplier should safely default to 1.0
    const nanBaseline = calculateCompositeNutrition({
      baseLabel: 'burrito',
      selectedTagIds: [],
      portionMultiplier: NaN,
    });
    assert.strictEqual(nanBaseline.calories, 680, 'NaN multiplier defaults to 1.0');
    assert.strictEqual(Number.isNaN(nanBaseline.calories), false);

    // Infinity multiplier should safely default to 1.0
    const infBaseline = calculateCompositeNutrition({
      baseLabel: 'burrito',
      selectedTagIds: [],
      portionMultiplier: Infinity,
    });
    assert.strictEqual(infBaseline.calories, 680, 'Infinity multiplier defaults to 1.0');

    // Customized fillings with negative multiplier should also sanitize safely
    const customNeg = calculateCompositeNutrition({
      baseLabel: 'burrito',
      selectedTagIds: ['steak', 'cheese'],
      portionMultiplier: -2,
    });
    assert.ok(customNeg.calories > 0, 'custom with negative multiplier defaults to 1.0');
    assert.strictEqual(Number.isFinite(customNeg.calories), true);

    // Valid zero multiplier returns 0
    const zeroMultiplier = calculateCompositeNutrition({
      baseLabel: 'burrito',
      selectedTagIds: [],
      portionMultiplier: 0,
    });
    assert.strictEqual(zeroMultiplier.calories, 0, 'zero multiplier correctly returns 0');
    assert.strictEqual(zeroMultiplier.protein, 0);
  });
});
