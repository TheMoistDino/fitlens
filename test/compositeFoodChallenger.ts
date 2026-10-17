import {
  isFoodHidingContents,
  getCompositeBaseline,
  calculateCompositeNutrition,
  formatMinimalReticleLabel,
  searchFillingTags,
  getFillingTagById,
  getFillingTagsByCategory,
  getFillingTags,
  FILLING_TAGS,
  COMPOSITE_BASELINES,
  DEFAULT_BURRITO_BASELINE,
} from '../src/features/food-scanner/services/compositeFoodProfiles';

console.log('=====================================================');
console.log('CHALLENGER 1: ADVERSARIAL STRESS HARNESS & AUDIT');
console.log('=====================================================\n');

interface TestFinding {
  suite: string;
  category: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  description: string;
  input: any;
  actual: any;
  expected: any;
}

const findings: TestFinding[] = [];

// -----------------------------------------------------------------------------
// 1. STRESS TESTING `isFoodHidingContents`
// -----------------------------------------------------------------------------
console.log('>>> [1/5] Stress Testing `isFoodHidingContents`...');

const hidingTestCases: Array<{ input: any; expected: boolean; note: string }> = [
  // Standard valid composite foods
  { input: 'burrito', expected: true, note: 'exact burrito' },
  { input: 'Burrito', expected: true, note: 'capitalized burrito' },
  { input: 'chicken burrito', expected: true, note: 'compound burrito' },
  { input: 'burritos', expected: true, note: 'plural burrito' },
  { input: 'wrap', expected: true, note: 'exact wrap' },
  { input: 'veggie wrap', expected: true, note: 'compound wrap' },
  { input: 'wraps', expected: true, note: 'plural wraps' },
  { input: 'sandwich', expected: true, note: 'sandwich' },
  { input: 'turkey sandwich', expected: true, note: 'compound sandwich' },
  { input: 'sub', expected: true, note: 'sub' },
  { input: 'subs', expected: true, note: 'plural subs' },
  { input: 'meatball sub', expected: true, note: 'compound sub' },
  { input: 'panini', expected: true, note: 'panini' },
  { input: 'hoagie', expected: true, note: 'hoagie' },
  { input: 'burger', expected: true, note: 'burger' },
  { input: 'cheeseburger', expected: true, note: 'cheeseburger' },
  { input: 'hamburger', expected: true, note: 'hamburger' },
  { input: 'calzone', expected: true, note: 'calzone' },
  { input: 'calzones', expected: true, note: 'plural calzone' },
  { input: 'stromboli', expected: true, note: 'stromboli' },
  { input: 'pot pie', expected: true, note: 'pot pie' },
  { input: 'chicken pot pie', expected: true, note: 'chicken pot pie' },
  { input: 'pot-pie', expected: true, note: 'hyphenated pot-pie' },
  { input: 'chicken pot-pie', expected: true, note: 'chicken pot-pie' },
  { input: 'potpie', expected: true, note: 'unspaced potpie' },
  { input: 'dumpling', expected: true, note: 'dumpling' },
  { input: 'dumplings', expected: true, note: 'dumplings' },
  { input: 'pork dumplings', expected: true, note: 'pork dumplings' },
  { input: 'gyoza', expected: true, note: 'gyoza' },
  { input: 'wonton', expected: true, note: 'wonton' },
  { input: 'bao', expected: true, note: 'bao' },
  { input: 'baos', expected: true, note: 'plural baos' },
  { input: 'empanada', expected: true, note: 'empanada' },
  { input: 'taco', expected: true, note: 'taco' },
  { input: 'tacos', expected: true, note: 'tacos' },
  { input: 'fish taco', expected: true, note: 'fish taco' },
  { input: 'quesadilla', expected: true, note: 'quesadilla' },
  { input: 'cheese quesadilla', expected: true, note: 'cheese quesadilla' },
  { input: 'taquito', expected: true, note: 'taquito' },
  { input: 'enchilada', expected: true, note: 'enchilada' },

  // Non-composite items combined with composites
  { input: 'steak burrito', expected: true, note: 'steak + burrito' },
  { input: 'steak wrap', expected: true, note: 'steak + wrap' },
  { input: 'steak sandwich', expected: true, note: 'steak + sandwich' },
  { input: 'steak burger', expected: true, note: 'steak + burger' },
  { input: 'steak sub', expected: true, note: 'steak + sub (exclusion bypass)' },
  { input: 'steak quesadilla', expected: true, note: 'steak + quesadilla (exclusion bypass)' },
  { input: 'steak panini', expected: true, note: 'steak + panini (exclusion bypass)' },
  { input: 'steak empanada', expected: true, note: 'steak + empanada (exclusion bypass)' },
  { input: 'rice burrito', expected: true, note: 'rice + burrito' },
  { input: 'burrito with rice', expected: true, note: 'burrito with rice' },
  { input: 'quesadilla with rice', expected: true, note: 'quesadilla with rice' },

  // Boundary & False positive stress tests
  { input: 'apple', expected: false, note: 'open fruit apple' },
  { input: 'banana', expected: false, note: 'open fruit banana' },
  { input: 'pizza', expected: false, note: 'open pizza' },
  { input: 'steak', expected: false, note: 'open steak' },
  { input: 'rice', expected: false, note: 'open rice' },
  { input: 'broccoli', expected: false, note: 'open broccoli' },
  { input: 'carrot', expected: false, note: 'open carrot' },
  { input: 'cup', expected: false, note: 'container cup' },
  { input: 'bottle', expected: false, note: 'container bottle' },
  { input: 'glass', expected: false, note: 'container glass' },
  { input: 'table', expected: false, note: 'furniture table' },
  { input: 'dining table', expected: false, note: 'furniture dining table' },
  { input: 'chair', expected: false, note: 'furniture chair' },
  { input: 'shrinkwrap', expected: false, note: 'shrinkwrap packaging' },
  { input: 'bubblewrap', expected: false, note: 'bubblewrap packaging' },
  { input: 'submarine', expected: false, note: 'submarine vessel' },
  { input: 'subway', expected: false, note: 'subway metro' },
  { input: 'subdivision', expected: false, note: 'subdivision land' },
  { input: 'subtle', expected: false, note: 'subtle word' },
  { input: 'baobab', expected: false, note: 'baobab tree' },

  // Edge / Empty / Malformed inputs
  { input: '', expected: false, note: 'empty string' },
  { input: '   ', expected: false, note: 'spaces only' },
  { input: '\t\n\r', expected: false, note: 'whitespace escape chars' },
  { input: null, expected: false, note: 'null input' },
  { input: undefined, expected: false, note: 'undefined input' },
  { input: '   burrito   ', expected: true, note: 'padded burrito' },
  { input: 'BURRITO!', expected: true, note: 'uppercase with punctuation' },
  { input: 'wrap,', expected: true, note: 'wrap with comma' },
  { input: '(sandwich)', expected: true, note: 'sandwich in parentheses' },
];

let hidingPass = 0;
let hidingFail = 0;

for (const tc of hidingTestCases) {
  const actual = isFoodHidingContents(tc.input);
  if (actual !== tc.expected) {
    hidingFail++;
    findings.push({
      suite: 'isFoodHidingContents',
      category: tc.note.includes('bypass') || tc.note.includes('pot-pie') ? 'HIGH' : 'MEDIUM',
      description: `Mismatch on "${tc.input}" (${tc.note}): expected ${tc.expected}, got ${actual}`,
      input: tc.input,
      actual,
      expected: tc.expected,
    });
  } else {
    hidingPass++;
  }
}
console.log(`  Passed: ${hidingPass}, Failed: ${hidingFail}`);

// -----------------------------------------------------------------------------
// 2. STRESS TESTING `getCompositeBaseline`
// -----------------------------------------------------------------------------
console.log('\n>>> [2/5] Stress Testing `getCompositeBaseline`...');

const baselineTestCases: Array<{ input: any; expectFound: boolean; expectCategory?: string; note: string }> = [
  { input: 'burrito', expectFound: true, expectCategory: 'burrito', note: 'burrito baseline' },
  { input: 'chicken burrito', expectFound: true, expectCategory: 'burrito', note: 'chicken burrito baseline' },
  { input: 'wrap', expectFound: true, expectCategory: 'wrap', note: 'wrap baseline' },
  { input: 'sandwich', expectFound: true, expectCategory: 'sandwich', note: 'sandwich baseline' },
  { input: 'burger', expectFound: true, expectCategory: 'burger', note: 'burger baseline' },
  { input: 'calzone', expectFound: true, expectCategory: 'calzone', note: 'calzone baseline' },
  { input: 'pot pie', expectFound: true, expectCategory: 'pot pie', note: 'pot pie baseline' },
  { input: 'pot-pie', expectFound: true, expectCategory: 'pot pie', note: 'pot-pie baseline' },
  { input: 'potpie', expectFound: true, expectCategory: 'pot pie', note: 'potpie baseline' },
  { input: 'dumpling', expectFound: true, expectCategory: 'dumpling', note: 'dumpling baseline' },
  { input: 'gyoza', expectFound: true, expectCategory: 'dumpling', note: 'gyoza baseline' },
  { input: 'taco', expectFound: true, expectCategory: 'taco', note: 'taco baseline' },
  { input: 'quesadilla', expectFound: true, expectCategory: 'quesadilla', note: 'quesadilla baseline' },
  { input: 'apple', expectFound: false, note: 'apple non-composite' },
  { input: 'steak', expectFound: false, note: 'steak non-composite' },
  { input: '', expectFound: false, note: 'empty string' },
  { input: null, expectFound: false, note: 'null input' },
  { input: undefined, expectFound: false, note: 'undefined input' },

  // Potential false positives from substring matching in getCompositeBaseline
  { input: 'sugar substitute', expectFound: false, note: 'sugar substitute substring "sub"' },
  { input: 'subtle tea', expectFound: false, note: 'subtle tea substring "sub"' },
  { input: 'submarine', expectFound: false, note: 'submarine substring "sub"' },
];

let baselinePass = 0;
let baselineFail = 0;

for (const tc of baselineTestCases) {
  const result = getCompositeBaseline(tc.input);
  const found = Boolean(result);
  if (found !== tc.expectFound || (tc.expectCategory && result?.category !== tc.expectCategory)) {
    baselineFail++;
    findings.push({
      suite: 'getCompositeBaseline',
      category: tc.input && tc.input.includes('sub') ? 'MEDIUM' : 'LOW',
      description: `Baseline lookup failed for "${tc.input}" (${tc.note}): found=${found}, cat=${result?.category}`,
      input: tc.input,
      actual: result?.category ?? null,
      expected: tc.expectCategory ?? null,
    });
  } else {
    baselinePass++;
  }
}
console.log(`  Passed: ${baselinePass}, Failed: ${baselineFail}`);

// -----------------------------------------------------------------------------
// 3. STRESS TESTING `calculateCompositeNutrition`
// -----------------------------------------------------------------------------
console.log('\n>>> [3/5] Stress Testing `calculateCompositeNutrition`...');

let calcPass = 0;
let calcFail = 0;

// Test 3.1: Portions & Multipliers
const multiplierCases = [
  { mult: 0, expectCal: 0, note: 'zero multiplier' },
  { mult: 1, expectCal: 680, note: 'normal multiplier' },
  { mult: 0.5, expectCal: 340, note: 'half multiplier' },
  { mult: 1.5, expectCal: 1020, note: '1.5x multiplier' },
  { mult: 2.0, expectCal: 1360, note: '2.0x multiplier' },
  { mult: 10, expectCal: 6800, note: '10x extreme multiplier' },
  { mult: -1, expectNonNegative: true, note: 'negative multiplier clamp' },
  { mult: NaN, expectValidNumber: true, note: 'NaN multiplier safety' },
];

for (const mc of multiplierCases) {
  const res = calculateCompositeNutrition({
    baseLabel: 'burrito',
    selectedTagIds: [],
    portionMultiplier: mc.mult,
  });

  if (mc.expectCal !== undefined) {
    if (res.calories === mc.expectCal) {
      calcPass++;
    } else {
      calcFail++;
      findings.push({
        suite: 'calculateCompositeNutrition',
        category: 'HIGH',
        description: `Multiplier calculation failed for ${mc.note}`,
        input: mc.mult,
        actual: res.calories,
        expected: mc.expectCal,
      });
    }
  }

  if (mc.expectNonNegative && res.calories < 0) {
    calcFail++;
    findings.push({
      suite: 'calculateCompositeNutrition',
      category: 'MEDIUM',
      description: `Negative multiplier produced negative calories: ${res.calories} kcal`,
      input: mc.mult,
      actual: res.calories,
      expected: '>= 0',
    });
  }

  if (mc.expectValidNumber && Number.isNaN(res.calories)) {
    calcFail++;
    findings.push({
      suite: 'calculateCompositeNutrition',
      category: 'MEDIUM',
      description: `NaN multiplier produced NaN calories: ${res.calories}`,
      input: mc.mult,
      actual: NaN,
      expected: 'Default 1.0 multiplier or 0 fallback',
    });
  }
}

// Test 3.2: Tag IDs robustness (invalid, unknown, duplicates)
const duplicateTagsRes = calculateCompositeNutrition({
  baseLabel: 'burrito',
  selectedTagIds: ['steak', 'steak', 'steak'], // 3 steaks = 3 * 180 = 540 + 210 shell = 750
});
if (duplicateTagsRes.calories === 750 && duplicateTagsRes.selectedTags.length === 3) {
  calcPass++;
} else {
  calcFail++;
  findings.push({
    suite: 'calculateCompositeNutrition',
    category: 'LOW',
    description: `Duplicate tags unexpected result: ${duplicateTagsRes.calories} kcal (selectedTags: ${duplicateTagsRes.selectedTags.length})`,
    input: ['steak', 'steak', 'steak'],
    actual: duplicateTagsRes.calories,
    expected: 750,
  });
}

const unknownTagRes = calculateCompositeNutrition({
  baseLabel: 'burrito',
  selectedTagIds: ['non-existent-tag-id', 'invalid-id-xyz'],
});
// When only invalid tags are supplied, does it return shell calories (210) or baseline average?
if (unknownTagRes.calories === 210 && unknownTagRes.isBaselineAverage === false) {
  calcPass++;
} else {
  calcFail++;
  findings.push({
    suite: 'calculateCompositeNutrition',
    category: 'LOW',
    description: `Unknown tag IDs handling: ${unknownTagRes.calories} kcal (isBaselineAverage: ${unknownTagRes.isBaselineAverage})`,
    input: ['non-existent-tag-id'],
    actual: unknownTagRes.calories,
    expected: 210,
  });
}

// Test 3.3: Extreme write-in notes deductions & combinations
const extremeDeduction = calculateCompositeNutrition({
  baseLabel: 'burrito',
  selectedTagIds: [],
  notes: 'no rice, no cheese, no sour cream, no meat',
});
if (extremeDeduction.calories >= 0 && extremeDeduction.protein >= 0 && extremeDeduction.fat >= 0) {
  calcPass++;
} else {
  calcFail++;
  findings.push({
    suite: 'calculateCompositeNutrition',
    category: 'HIGH',
    description: `Extreme deductions produced negative macro values!`,
    input: 'no rice, no cheese, no sour cream',
    actual: extremeDeduction,
    expected: 'All macros >= 0',
  });
}

console.log(`  Passed: ${calcPass}, Failed: ${calcFail}`);

// -----------------------------------------------------------------------------
// 4. STRESS TESTING `formatMinimalReticleLabel`
// -----------------------------------------------------------------------------
console.log('\n>>> [4/5] Stress Testing `formatMinimalReticleLabel`...');

const reticleTestCases: Array<{
  input: {
    label: string;
    calories?: number;
    isLiquid?: boolean;
    isComposite?: boolean;
    isBaselineAverage?: boolean;
  };
  expected: string;
  note: string;
}> = [
  // Standard cases
  { input: { label: 'burrito', calories: 680, isBaselineAverage: true }, expected: 'Burrito · ~680 kcal (Avg)', note: 'Burrito baseline' },
  { input: { label: 'apple', calories: 95 }, expected: 'Apple · ~95 kcal', note: 'Standard apple' },
  { input: { label: 'cup', isLiquid: true }, expected: 'Drink · ~0-140 kcal', note: 'Generic cup liquid' },
  { input: { label: 'burrito', calories: 880, isBaselineAverage: false }, expected: 'Burrito · ~880 kcal', note: 'Refined burrito' },
  { input: { label: 'latte', calories: 150, isLiquid: true }, expected: 'Latte · ~150 kcal', note: 'Specific liquid with kcal' },
  { input: { label: 'burrito' }, expected: 'Burrito · ~680 kcal (Avg)', note: 'Unresolved burrito auto-baseline' },
  { input: { label: 'sandwich' }, expected: 'Sandwich · ~420 kcal (Avg)', note: 'Unresolved sandwich auto-baseline' },
  { input: { label: 'wrap' }, expected: 'Wrap · ~520 kcal (Avg)', note: 'Unresolved wrap auto-baseline' },
  { input: { label: 'pot pie' }, expected: 'Pot pie · ~620 kcal (Avg)', note: 'Unresolved pot pie auto-baseline' },
  { input: { label: 'pot-pie' }, expected: 'Pot-pie · ~620 kcal (Avg)', note: 'Unresolved pot-pie auto-baseline' },

  // Edge cases: 0 calories, negative, NaN
  { input: { label: 'Diet Coke', calories: 0, isLiquid: true }, expected: 'Diet Coke · ~0 kcal', note: 'Zero-calorie specific beverage' },
  { input: { label: 'Water', calories: 0, isLiquid: true }, expected: 'Water · ~0 kcal', note: 'Zero-calorie water' },
  { input: { label: 'Celery', calories: 0 }, expected: 'Celery · ~0 kcal', note: 'Zero-calorie food' },

  // Empty / whitespace
  { input: { label: '' }, expected: '', note: 'empty label' },
  { input: { label: '   ' }, expected: '', note: 'whitespace label' },
];

let reticlePass = 0;
let reticleFail = 0;

for (const rtc of reticleTestCases) {
  const actual = formatMinimalReticleLabel(rtc.input);
  if (actual !== rtc.expected) {
    reticleFail++;
    findings.push({
      suite: 'formatMinimalReticleLabel',
      category: rtc.note.includes('Zero-calorie') || rtc.note.includes('pot-pie') ? 'MEDIUM' : 'LOW',
      description: `Format mismatch on "${rtc.note}": expected "${rtc.expected}", got "${actual}"`,
      input: rtc.input,
      actual,
      expected: rtc.expected,
    });
  } else {
    reticlePass++;
  }
}
console.log(`  Passed: ${reticlePass}, Failed: ${reticleFail}`);

// -----------------------------------------------------------------------------
// 5. PERFORMANCE & ADVERSARIAL THROUGHPUT BENCHMARK
// -----------------------------------------------------------------------------
console.log('\n>>> [5/5] Performance & Throughput Benchmark (100,000 iterations)...');

const ITERATIONS = 100_000;
const start = performance.now();

for (let i = 0; i < ITERATIONS; i++) {
  const lbl = i % 2 === 0 ? 'steak burrito' : 'chicken quesadilla with extra cheese and sour cream';
  isFoodHidingContents(lbl);
}

const mid1 = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  calculateCompositeNutrition({
    baseLabel: 'burrito',
    selectedTagIds: ['steak', 'white-rice', 'cheese'],
    notes: 'extra meat, double cheese',
    portionMultiplier: 1.5,
  });
}

const mid2 = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  formatMinimalReticleLabel({
    label: 'burrito',
    calories: 680,
    isBaselineAverage: true,
  });
}

const end = performance.now();

const isFoodHidingMs = mid1 - start;
const calcNutritionMs = mid2 - mid1;
const formatReticleMs = end - mid2;

console.log(`  100k isFoodHidingContents:       ${isFoodHidingMs.toFixed(2)} ms (${(ITERATIONS / (isFoodHidingMs / 1000)).toFixed(0)} ops/sec)`);
console.log(`  100k calculateCompositeNutrition: ${calcNutritionMs.toFixed(2)} ms (${(ITERATIONS / (calcNutritionMs / 1000)).toFixed(0)} ops/sec)`);
console.log(`  100k formatMinimalReticleLabel:   ${formatReticleMs.toFixed(2)} ms (${(ITERATIONS / (formatReticleMs / 1000)).toFixed(0)} ops/sec)`);

// -----------------------------------------------------------------------------
// SUMMARY OF FINDINGS
// -----------------------------------------------------------------------------
console.log('\n=====================================================');
console.log(`TOTAL FINDINGS IDENTIFIED: ${findings.length}`);
console.log('=====================================================');

for (let i = 0; i < findings.length; i++) {
  const f = findings[i];
  console.log(`[#${i + 1}] [${f.category}] Suite: ${f.suite}`);
  console.log(`     Desc:     ${f.description}`);
  console.log(`     Input:    ${JSON.stringify(f.input)}`);
  console.log(`     Actual:   ${JSON.stringify(f.actual)}`);
  console.log(`     Expected: ${JSON.stringify(f.expected)}\n`);
}
