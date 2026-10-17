import assert from 'node:assert';
import {
  isFoodHidingContents,
  getCompositeBaseline,
  calculateCompositeNutrition,
  formatMinimalReticleLabel,
  COMPOSITE_BASELINES,
  FILLING_TAGS,
} from '../src/features/food-scanner/services/compositeFoodProfiles';

console.log('===============================================================');
console.log('CHALLENGER 1 RE-VERIFICATION HARNESS: 16 FINDINGS & 4 DEFECTS');
console.log('===============================================================\n');

interface FindingCheck {
  id: number;
  category: string;
  name: string;
  run: () => { pass: boolean; expected: any; actual: any; details?: string };
}

const checks: FindingCheck[] = [
  // --- Defect Category 1: isFoodHidingContents Omissions & Exclusions ---
  {
    id: 1,
    category: 'Defect 1: isFoodHidingContents',
    name: 'pot-pie (hyphenated)',
    run: () => {
      const actual = isFoodHidingContents('pot-pie');
      return { pass: actual === true, expected: true, actual };
    },
  },
  {
    id: 2,
    category: 'Defect 1: isFoodHidingContents',
    name: 'chicken pot-pie (compound hyphenated)',
    run: () => {
      const actual = isFoodHidingContents('chicken pot-pie');
      return { pass: actual === true, expected: true, actual };
    },
  },
  {
    id: 3,
    category: 'Defect 1: isFoodHidingContents',
    name: 'potpie (unspaced)',
    run: () => {
      const actual = isFoodHidingContents('potpie');
      return { pass: actual === true, expected: true, actual };
    },
  },
  {
    id: 4,
    category: 'Defect 1: isFoodHidingContents',
    name: 'steak sub (exclusion whitelist bypass)',
    run: () => {
      const actual = isFoodHidingContents('steak sub');
      return { pass: actual === true, expected: true, actual };
    },
  },
  {
    id: 5,
    category: 'Defect 1: isFoodHidingContents',
    name: 'steak quesadilla (exclusion whitelist bypass)',
    run: () => {
      const actual = isFoodHidingContents('steak quesadilla');
      return { pass: actual === true, expected: true, actual };
    },
  },
  {
    id: 6,
    category: 'Defect 1: isFoodHidingContents',
    name: 'steak panini (exclusion whitelist bypass)',
    run: () => {
      const actual = isFoodHidingContents('steak panini');
      return { pass: actual === true, expected: true, actual };
    },
  },
  {
    id: 7,
    category: 'Defect 1: isFoodHidingContents',
    name: 'steak empanada (exclusion whitelist bypass)',
    run: () => {
      const actual = isFoodHidingContents('steak empanada');
      return { pass: actual === true, expected: true, actual };
    },
  },
  {
    id: 8,
    category: 'Defect 1: isFoodHidingContents',
    name: 'quesadilla with rice (exclusion whitelist bypass)',
    run: () => {
      const actual = isFoodHidingContents('quesadilla with rice');
      return { pass: actual === true, expected: true, actual };
    },
  },

  // --- Defect Category 2: getCompositeBaseline Substring Overmatch ---
  {
    id: 9,
    category: 'Defect 2: getCompositeBaseline',
    name: 'sugar substitute (substring "sub")',
    run: () => {
      const actual = getCompositeBaseline('sugar substitute');
      return { pass: actual === undefined, expected: undefined, actual: actual?.category ?? undefined };
    },
  },
  {
    id: 10,
    category: 'Defect 2: getCompositeBaseline',
    name: 'subtle tea (substring "sub")',
    run: () => {
      const actual = getCompositeBaseline('subtle tea');
      return { pass: actual === undefined, expected: undefined, actual: actual?.category ?? undefined };
    },
  },
  {
    id: 11,
    category: 'Defect 2: getCompositeBaseline',
    name: 'submarine (substring "sub")',
    run: () => {
      const actual = getCompositeBaseline('submarine');
      return { pass: actual === undefined, expected: undefined, actual: actual?.category ?? undefined };
    },
  },

  // --- Defect Category 3: calculateCompositeNutrition Multiplier Sanitization ---
  {
    id: 12,
    category: 'Defect 3: calculateCompositeNutrition',
    name: 'portionMultiplier = -1 (negative multiplier sanitization)',
    run: () => {
      const res = calculateCompositeNutrition({
        baseLabel: 'burrito',
        selectedTagIds: [],
        portionMultiplier: -1,
      });
      const pass = res.calories === 680 && res.protein === 28 && res.calories >= 0;
      return {
        pass,
        expected: '680 kcal (defaulted to 1.0)',
        actual: `${res.calories} kcal`,
        details: `protein: ${res.protein}g, fat: ${res.fat}g`,
      };
    },
  },
  {
    id: 13,
    category: 'Defect 3: calculateCompositeNutrition',
    name: 'portionMultiplier = NaN (NaN multiplier sanitization)',
    run: () => {
      const res = calculateCompositeNutrition({
        baseLabel: 'burrito',
        selectedTagIds: [],
        portionMultiplier: NaN,
      });
      const pass = res.calories === 680 && !Number.isNaN(res.calories);
      return {
        pass,
        expected: '680 kcal (defaulted to 1.0)',
        actual: `${res.calories} kcal`,
      };
    },
  },

  // --- Defect Category 4: formatMinimalReticleLabel Calorie & Auto-Baseline Handling ---
  {
    id: 14,
    category: 'Defect 4: formatMinimalReticleLabel',
    name: 'pot-pie (auto-baseline label formatting)',
    run: () => {
      const actual = formatMinimalReticleLabel({ label: 'pot-pie' });
      const expected = 'Pot-pie · ~620 kcal (Avg)';
      return { pass: actual === expected, expected, actual };
    },
  },
  {
    id: 15,
    category: 'Defect 4: formatMinimalReticleLabel',
    name: 'Diet Coke with 0 calories (isLiquid: true)',
    run: () => {
      const actual = formatMinimalReticleLabel({ label: 'Diet Coke', calories: 0, isLiquid: true });
      const expected = 'Diet Coke · ~0 kcal';
      return { pass: actual === expected, expected, actual };
    },
  },
  {
    id: 16,
    category: 'Defect 4: formatMinimalReticleLabel',
    name: 'Water with 0 calories (isLiquid: true)',
    run: () => {
      const actual = formatMinimalReticleLabel({ label: 'Water', calories: 0, isLiquid: true });
      const expected = 'Water · ~0 kcal';
      return { pass: actual === expected, expected, actual };
    },
  },
];

console.log('>>> Evaluating 16 Target Findings:');
let passedCount = 0;
let failedCount = 0;

for (const c of checks) {
  const res = c.run();
  if (res.pass) {
    passedCount++;
    console.log(`  ✓ Finding #${c.id.toString().padStart(2, ' ')} [PASS] ${c.name}`);
  } else {
    failedCount++;
    console.log(`  ✗ Finding #${c.id.toString().padStart(2, ' ')} [FAIL] ${c.name}`);
    console.log(`      Expected: ${JSON.stringify(res.expected)}`);
    console.log(`      Actual:   ${JSON.stringify(res.actual)}`);
  }
}

console.log(`\n16 Target Findings Status: ${passedCount} passed, ${failedCount} failed.`);

// -----------------------------------------------------------------------------
// ADVERSARIAL & BOUNDARY EXTENSION SUITE
// -----------------------------------------------------------------------------
console.log('\n>>> Evaluating Adversarial Boundary Extension Suite:');

const adversarialTests = [
  // 1. Black Coffee (0 kcal)
  {
    name: 'Black Coffee 0 kcal isLiquid',
    test: () => {
      const res = formatMinimalReticleLabel({ label: 'Black Coffee', calories: 0, isLiquid: true });
      assert.strictEqual(res, 'Black Coffee · ~0 kcal');
    },
  },
  // 2. Generic containers retain range even at 0 kcal
  {
    name: 'Generic cup with 0 kcal retains range',
    test: () => {
      const res = formatMinimalReticleLabel({ label: 'cup', calories: 0, isLiquid: true });
      assert.strictEqual(res, 'Drink · ~0-140 kcal');
    },
  },
  {
    name: 'Generic bottle with 0 kcal retains range',
    test: () => {
      const res = formatMinimalReticleLabel({ label: 'bottle', calories: 0, isLiquid: true });
      assert.strictEqual(res, 'Drink · ~0-140 kcal');
    },
  },
  // 3. Multiplier edge cases
  {
    name: 'portionMultiplier = Infinity defaults to 1.0',
    test: () => {
      const res = calculateCompositeNutrition({ baseLabel: 'burrito', selectedTagIds: [], portionMultiplier: Infinity });
      assert.strictEqual(res.calories, 680);
    },
  },
  {
    name: 'portionMultiplier = -Infinity defaults to 1.0',
    test: () => {
      const res = calculateCompositeNutrition({ baseLabel: 'burrito', selectedTagIds: [], portionMultiplier: -Infinity });
      assert.strictEqual(res.calories, 680);
    },
  },
  {
    name: 'portionMultiplier = "invalid" string defaults to 1.0',
    test: () => {
      const res = calculateCompositeNutrition({ baseLabel: 'burrito', selectedTagIds: [], portionMultiplier: 'big' as any });
      assert.strictEqual(res.calories, 680);
    },
  },
  {
    name: 'portionMultiplier = 0 correctly yields 0 for baseline and custom',
    test: () => {
      const resBase = calculateCompositeNutrition({ baseLabel: 'burrito', selectedTagIds: [], portionMultiplier: 0 });
      assert.strictEqual(resBase.calories, 0);
      assert.strictEqual(resBase.protein, 0);
      const resCust = calculateCompositeNutrition({ baseLabel: 'burrito', selectedTagIds: ['steak'], portionMultiplier: 0 });
      assert.strictEqual(resCust.calories, 0);
      assert.strictEqual(resCust.protein, 0);
    },
  },
  {
    name: 'portionMultiplier negative with custom tags defaults to 1.0',
    test: () => {
      const res = calculateCompositeNutrition({
        baseLabel: 'burrito',
        selectedTagIds: ['steak', 'cheese'],
        portionMultiplier: -0.5,
      });
      // Shell (210) + steak (180) + cheese (110) = 500 kcal
      assert.strictEqual(res.calories, 500);
      assert.strictEqual(res.protein, 36);
    },
  },
  // 4. Non-composite negative controls with steak, rice, etc.
  {
    name: 'standalone steak is not composite',
    test: () => {
      assert.strictEqual(isFoodHidingContents('steak'), false);
    },
  },
  {
    name: 'standalone rice is not composite',
    test: () => {
      assert.strictEqual(isFoodHidingContents('rice'), false);
    },
  },
  {
    name: 'steak with rice is not composite',
    test: () => {
      assert.strictEqual(isFoodHidingContents('steak with rice'), false);
    },
  },
  {
    name: 'steak and broccoli is not composite',
    test: () => {
      assert.strictEqual(isFoodHidingContents('steak and broccoli'), false);
    },
  },
  // 5. Positive controls with compound names
  {
    name: 'steak hoagie is composite',
    test: () => {
      assert.strictEqual(isFoodHidingContents('steak hoagie'), true);
    },
  },
  {
    name: 'steak bao is composite',
    test: () => {
      assert.strictEqual(isFoodHidingContents('steak bao'), true);
    },
  },
  {
    name: 'rice dumplings is composite',
    test: () => {
      assert.strictEqual(isFoodHidingContents('rice dumplings'), true);
    },
  },
  {
    name: 'pot-pie baseline lookup returns 620 kcal',
    test: () => {
      const b = getCompositeBaseline('pot-pie');
      assert.ok(b);
      assert.strictEqual(b.calories, 620);
      assert.strictEqual(b.category, 'pot pie');
    },
  },
  {
    name: 'chicken pot-pie baseline lookup returns 620 kcal',
    test: () => {
      const b = getCompositeBaseline('chicken pot-pie');
      assert.ok(b);
      assert.strictEqual(b.calories, 620);
      assert.strictEqual(b.category, 'pot pie');
    },
  },
  {
    name: 'meatball sub baseline lookup returns sandwich (420 kcal)',
    test: () => {
      const b = getCompositeBaseline('meatball sub');
      assert.ok(b);
      assert.strictEqual(b.calories, 420);
      assert.strictEqual(b.category, 'sandwich');
    },
  },
];

let advPassed = 0;
let advFailed = 0;

for (const at of adversarialTests) {
  try {
    at.test();
    advPassed++;
    console.log(`  ✓ [PASS] ${at.name}`);
  } catch (err: any) {
    advFailed++;
    console.log(`  ✗ [FAIL] ${at.name}: ${err.message}`);
  }
}

console.log(`\nAdversarial Extension Status: ${advPassed} passed, ${advFailed} failed.`);

if (failedCount === 0 && advFailed === 0) {
  console.log('\n===============================================================');
  console.log('ALL VERIFICATIONS PASSED: EMPIRICAL VERDICT IS APPROVE');
  console.log('===============================================================');
  process.exit(0);
} else {
  console.log('\n===============================================================');
  console.log('VERIFICATION FAILURES DETECTED: EMPIRICAL VERDICT IS REQUEST_CHANGES');
  console.log('===============================================================');
  process.exit(1);
}
