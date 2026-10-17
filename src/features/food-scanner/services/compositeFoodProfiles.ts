import { isLiquidContainer } from './beverageProfiles';

export type FillingCategory = 'protein' | 'grain' | 'beans' | 'dairy' | 'topping';

export interface FillingTag {
  id: string;
  name: string;
  category: FillingCategory;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  weightGrams: number;
  icon: string;
}

export interface CompositeBaseline {
  category: string;
  label: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  servingSizeGrams: number;
  baselineNote: string;
  shellName: string;
  shellCalories: number;
  shellProtein: number;
  shellCarbs: number;
  shellFat: number;
  shellWeightGrams: number;
}

export interface CompositeCalculationInput {
  baseLabel: string;
  selectedTagIds: string[];
  notes?: string;
  portionMultiplier?: number;
}

export interface CompositeNutritionResult {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  weightGrams: number;
  isBaselineAverage: boolean;
  baselineNote?: string;
  selectedTags: FillingTag[];
  notesAdjustmentKcal: number;
}

/**
 * Keywords identifying foods that typically conceal inner fillings.
 */
export const HIDDEN_FOOD_KEYWORDS = [
  'burrito',
  'wrap',
  'sandwich',
  'sub',
  'panini',
  'hoagie',
  'burger',
  'hamburger',
  'cheeseburger',
  'calzone',
  'stromboli',
  'pot pie',
  'dumpling',
  'dumplings',
  'gyoza',
  'wonton',
  'bao',
  'empanada',
  'taco',
  'tacos',
  'quesadilla',
  'taquito',
  'enchilada',
] as const;

/**
 * Checks whether a food item conceals its inner fillings (e.g. burrito, wrap, calzone, sandwich).
 * Accurately rejects single open items (apple, banana, pizza, cup, steak, dining table).
 */
export function isFoodHidingContents(label: string | undefined | null): boolean {
  if (!label) return false;
  const norm = label.trim().toLowerCase();
  if (norm.length === 0) return false;

  // Open-faced or non-food exclusions unless explicitly a composite combination
  const nonCompositeExclusions = [
    'table',
    'chair',
    'cup',
    'bottle',
    'glass',
    'pizza',
    'apple',
    'banana',
    'broccoli',
    'carrot',
    'steak',
    'rice',
  ];

  if (nonCompositeExclusions.some((ex) => norm === ex || norm.startsWith(`${ex} `) || norm.endsWith(` ${ex}`))) {
    const isCompositeVariant =
      norm.includes('sandwich') ||
      norm.includes('burrito') ||
      norm.includes('wrap') ||
      norm.includes('dumpling') ||
      norm.includes('burger') ||
      norm.includes('pie') ||
      norm.includes('taco') ||
      norm.includes('calzone');
    if (!isCompositeVariant) return false;
  }

  return HIDDEN_FOOD_KEYWORDS.some((kw) => {
    if (kw.length <= 4) {
      const regex = new RegExp(`\\b${kw}s?\\b`, 'i');
      return regex.test(norm);
    }
    return norm.includes(kw);
  });
}

/**
 * Default calibrated burrito baseline used as fallback.
 */
export const DEFAULT_BURRITO_BASELINE: CompositeBaseline = {
  category: 'burrito',
  label: 'Burrito',
  calories: 680,
  protein: 28,
  carbs: 85,
  fat: 24,
  servingSizeGrams: 380,
  baselineNote:
    'Standard restaurant burrito baseline average (flour tortilla, rice, beans, seasoned meat, cheese, salsa). Customize fillings or scan inside to refine.',
  shellName: '12" Flour Tortilla',
  shellCalories: 210,
  shellProtein: 5,
  shellCarbs: 36,
  shellFat: 4.5,
  shellWeightGrams: 80,
};

/**
 * Calibrated restaurant standard baseline averages for composite foods.
 */
export const COMPOSITE_BASELINES: Record<string, CompositeBaseline> = {
  burrito: DEFAULT_BURRITO_BASELINE,
  wrap: {
    category: 'wrap',
    label: 'Wrap',
    calories: 520,
    protein: 24,
    carbs: 52,
    fat: 22,
    servingSizeGrams: 280,
    baselineNote:
      'Standard wrap baseline average (tortilla, poultry/protein, greens, dressing). Customize fillings or scan inside to refine.',
    shellName: 'Wheat Flatbread / Wrap',
    shellCalories: 180,
    shellProtein: 5,
    shellCarbs: 32,
    shellFat: 3.5,
    shellWeightGrams: 70,
  },
  sandwich: {
    category: 'sandwich',
    label: 'Sandwich',
    calories: 420,
    protein: 22,
    carbs: 42,
    fat: 16,
    servingSizeGrams: 220,
    baselineNote:
      'Standard deli sandwich baseline average (bread, deli meat, cheese, spread). Customize fillings or scan inside to refine.',
    shellName: '2 Slices Deli Bread',
    shellCalories: 140,
    shellProtein: 5,
    shellCarbs: 26,
    shellFat: 2,
    shellWeightGrams: 60,
  },
  burger: {
    category: 'burger',
    label: 'Burger',
    calories: 550,
    protein: 28,
    carbs: 44,
    fat: 28,
    servingSizeGrams: 240,
    baselineNote:
      'Classic burger baseline average (bun, beef patty, cheese, condiments). Customize fillings or scan inside to refine.',
    shellName: 'Burger Bun',
    shellCalories: 150,
    shellProtein: 5,
    shellCarbs: 28,
    shellFat: 2.5,
    shellWeightGrams: 60,
  },
  calzone: {
    category: 'calzone',
    label: 'Calzone',
    calories: 780,
    protein: 34,
    carbs: 76,
    fat: 36,
    servingSizeGrams: 350,
    baselineNote:
      'Baked calzone baseline average (pizza dough crust, ricotta, mozzarella, fillings). Customize fillings or scan inside to refine.',
    shellName: 'Folded Pizza Crust',
    shellCalories: 300,
    shellProtein: 8,
    shellCarbs: 55,
    shellFat: 4,
    shellWeightGrams: 150,
  },
  'pot pie': {
    category: 'pot pie',
    label: 'Pot Pie',
    calories: 620,
    protein: 20,
    carbs: 55,
    fat: 36,
    servingSizeGrams: 320,
    baselineNote:
      'Savory pot pie baseline average (flaky crust pastry, gravy, meat, vegetables). Customize fillings or scan inside to refine.',
    shellName: 'Flaky Pastry Crust',
    shellCalories: 250,
    shellProtein: 3,
    shellCarbs: 28,
    shellFat: 15,
    shellWeightGrams: 100,
  },
  'pot-pie': {
    category: 'pot pie',
    label: 'Pot Pie',
    calories: 620,
    protein: 20,
    carbs: 55,
    fat: 36,
    servingSizeGrams: 320,
    baselineNote:
      'Savory pot pie baseline average (flaky crust pastry, gravy, meat, vegetables). Customize fillings or scan inside to refine.',
    shellName: 'Flaky Pastry Crust',
    shellCalories: 250,
    shellProtein: 3,
    shellCarbs: 28,
    shellFat: 15,
    shellWeightGrams: 100,
  },
  dumpling: {
    category: 'dumpling',
    label: 'Dumplings',
    calories: 280,
    protein: 12,
    carbs: 32,
    fat: 10,
    servingSizeGrams: 160,
    baselineNote:
      'Steamed/pan-fried dumpling baseline average (5 pcs, dough wrapper, ground meat/veg). Customize fillings or scan inside to refine.',
    shellName: '5 Dumpling Wrappers',
    shellCalories: 100,
    shellProtein: 3,
    shellCarbs: 20,
    shellFat: 0.5,
    shellWeightGrams: 50,
  },
  dumplings: {
    category: 'dumpling',
    label: 'Dumplings',
    calories: 280,
    protein: 12,
    carbs: 32,
    fat: 10,
    servingSizeGrams: 160,
    baselineNote:
      'Steamed/pan-fried dumpling baseline average (5 pcs, dough wrapper, ground meat/veg). Customize fillings or scan inside to refine.',
    shellName: '5 Dumpling Wrappers',
    shellCalories: 100,
    shellProtein: 3,
    shellCarbs: 20,
    shellFat: 0.5,
    shellWeightGrams: 50,
  },
  taco: {
    category: 'taco',
    label: 'Taco',
    calories: 230,
    protein: 12,
    carbs: 18,
    fat: 11,
    servingSizeGrams: 110,
    baselineNote:
      'Standard restaurant taco baseline average (tortilla, seasoned meat, toppings). Customize fillings or scan inside to refine.',
    shellName: 'Taco Tortilla',
    shellCalories: 70,
    shellProtein: 2,
    shellCarbs: 13,
    shellFat: 1,
    shellWeightGrams: 30,
  },
  tacos: {
    category: 'taco',
    label: 'Taco',
    calories: 230,
    protein: 12,
    carbs: 18,
    fat: 11,
    servingSizeGrams: 110,
    baselineNote:
      'Standard restaurant taco baseline average (tortilla, seasoned meat, toppings). Customize fillings or scan inside to refine.',
    shellName: 'Taco Tortilla',
    shellCalories: 70,
    shellProtein: 2,
    shellCarbs: 13,
    shellFat: 1,
    shellWeightGrams: 30,
  },
  quesadilla: {
    category: 'quesadilla',
    label: 'Quesadilla',
    calories: 580,
    protein: 26,
    carbs: 48,
    fat: 32,
    servingSizeGrams: 260,
    baselineNote:
      'Standard cheese quesadilla baseline average (crispy toasted tortilla, melted jack/cheddar cheese). Customize fillings to refine.',
    shellName: 'Toasted Flour Tortilla',
    shellCalories: 210,
    shellProtein: 5,
    shellCarbs: 36,
    shellFat: 4.5,
    shellWeightGrams: 80,
  },
};

/**
 * Returns calibrated baseline profile for a given food label, or undefined if not a composite food.
 */
export function getCompositeBaseline(label: string | undefined | null): CompositeBaseline | undefined {
  if (!label) return undefined;
  const norm = label.trim().toLowerCase();

  if (norm.includes('burrito')) return COMPOSITE_BASELINES.burrito;
  if (norm.includes('wrap')) return COMPOSITE_BASELINES.wrap;
  if (norm.includes('calzone') || norm.includes('stromboli')) return COMPOSITE_BASELINES.calzone;
  if (norm.includes('pot pie') || norm.includes('pot-pie') || norm.includes('potpie')) {
    return COMPOSITE_BASELINES['pot pie'];
  }
  if (
    norm.includes('dumpling') ||
    norm.includes('gyoza') ||
    norm.includes('wonton') ||
    norm.includes('bao') ||
    norm.includes('empanada')
  ) {
    return COMPOSITE_BASELINES.dumpling;
  }
  if (norm.includes('burger') || norm.includes('cheeseburger') || norm.includes('hamburger')) {
    return COMPOSITE_BASELINES.burger;
  }
  if (norm.includes('taco') || norm.includes('taquito')) {
    return COMPOSITE_BASELINES.taco;
  }
  if (norm.includes('quesadilla')) {
    return COMPOSITE_BASELINES.quesadilla;
  }
  if (norm.includes('sandwich') || norm.includes('sub') || norm.includes('panini') || norm.includes('hoagie')) {
    return COMPOSITE_BASELINES.sandwich;
  }

  return undefined;
}

/**
 * 16 pre-calibrated quick filling tags for modular composite foods (burritos, bowls, tacos, wraps).
 */
export const FILLING_TAGS: FillingTag[] = [
  {
    id: 'steak',
    name: 'Steak / Carne Asada',
    category: 'protein',
    calories: 180,
    protein: 24,
    carbs: 0,
    fat: 9,
    weightGrams: 110,
    icon: '🥩',
  },
  {
    id: 'chicken',
    name: 'Grilled Chicken',
    category: 'protein',
    calories: 140,
    protein: 26,
    carbs: 0,
    fat: 3.5,
    weightGrams: 110,
    icon: '🍗',
  },
  {
    id: 'carnitas',
    name: 'Carnitas / Pork',
    category: 'protein',
    calories: 190,
    protein: 22,
    carbs: 0,
    fat: 11,
    weightGrams: 110,
    icon: '🍖',
  },
  {
    id: 'tofu',
    name: 'Tofu / Sofritas',
    category: 'protein',
    calories: 110,
    protein: 9,
    carbs: 4,
    fat: 7,
    weightGrams: 100,
    icon: '🌱',
  },
  {
    id: 'white-rice',
    name: 'White Rice',
    category: 'grain',
    calories: 140,
    protein: 3,
    carbs: 30,
    fat: 0.5,
    weightGrams: 100,
    icon: '🍚',
  },
  {
    id: 'brown-rice',
    name: 'Brown Rice',
    category: 'grain',
    calories: 130,
    protein: 3,
    carbs: 28,
    fat: 1,
    weightGrams: 100,
    icon: '🌾',
  },
  {
    id: 'black-beans',
    name: 'Black Beans',
    category: 'beans',
    calories: 90,
    protein: 6,
    carbs: 16,
    fat: 0.5,
    weightGrams: 90,
    icon: '🫘',
  },
  {
    id: 'pinto-beans',
    name: 'Pinto Beans',
    category: 'beans',
    calories: 100,
    protein: 6,
    carbs: 18,
    fat: 0.5,
    weightGrams: 90,
    icon: '🫘',
  },
  {
    id: 'cheese',
    name: 'Shredded Cheese',
    category: 'dairy',
    calories: 110,
    protein: 7,
    carbs: 1,
    fat: 9,
    weightGrams: 30,
    icon: '🧀',
  },
  {
    id: 'guacamole',
    name: 'Guacamole',
    category: 'topping',
    calories: 150,
    protein: 2,
    carbs: 8,
    fat: 14,
    weightGrams: 70,
    icon: '🥑',
  },
  {
    id: 'sour-cream',
    name: 'Sour Cream',
    category: 'dairy',
    calories: 90,
    protein: 1,
    carbs: 1,
    fat: 9,
    weightGrams: 35,
    icon: '🥛',
  },
  {
    id: 'salsa',
    name: 'Fresh Salsa / Pico',
    category: 'topping',
    calories: 20,
    protein: 0.5,
    carbs: 4,
    fat: 0,
    weightGrams: 60,
    icon: '🍅',
  },
  {
    id: 'queso',
    name: 'Queso Dip',
    category: 'dairy',
    calories: 120,
    protein: 5,
    carbs: 3,
    fat: 10,
    weightGrams: 60,
    icon: '🫕',
  },
  {
    id: 'fajita-veggies',
    name: 'Fajita Veggies',
    category: 'topping',
    calories: 45,
    protein: 1,
    carbs: 8,
    fat: 0.5,
    weightGrams: 80,
    icon: '🫑',
  },
  {
    id: 'bacon',
    name: 'Crispy Bacon',
    category: 'protein',
    calories: 90,
    protein: 6,
    carbs: 0,
    fat: 7,
    weightGrams: 20,
    icon: '🥓',
  },
  {
    id: 'egg',
    name: 'Egg',
    category: 'protein',
    calories: 75,
    protein: 6,
    carbs: 0.5,
    fat: 5,
    weightGrams: 50,
    icon: '🍳',
  },
];

/**
 * Returns all filling tags.
 */
export function getFillingTags(): FillingTag[] {
  return FILLING_TAGS;
}

/**
 * Returns filling tags by category.
 */
export function getFillingTagsByCategory(category: FillingCategory): FillingTag[] {
  return FILLING_TAGS.filter((t) => t.category === category);
}

/**
 * Finds a filling tag by its identifier.
 */
export function getFillingTagById(id: string): FillingTag | undefined {
  return FILLING_TAGS.find((t) => t.id === id);
}

/**
 * Searches filling tags with fuzzy matching across name and ID.
 */
export function searchFillingTags(query: string): FillingTag[] {
  const norm = query.trim().toLowerCase();
  if (!norm) return FILLING_TAGS;
  return FILLING_TAGS.filter(
    (t) => t.name.toLowerCase().includes(norm) || t.id.toLowerCase().includes(norm),
  );
}

/**
 * Calculates composite food nutrition from selected tags and custom write-in notes.
 * If no tags or notes are supplied, returns the calibrated standard baseline average.
 */
export function calculateCompositeNutrition(input: CompositeCalculationInput): CompositeNutritionResult {
  const { baseLabel, selectedTagIds, notes, portionMultiplier = 1 } = input;
  const baseline = getCompositeBaseline(baseLabel) ?? DEFAULT_BURRITO_BASELINE;

  const hasNotes = Boolean(notes && notes.trim());

  // Return standard baseline average if no customizations
  if (selectedTagIds.length === 0 && !hasNotes) {
    return {
      calories: Math.round(baseline.calories * portionMultiplier),
      protein: Math.round(baseline.protein * portionMultiplier),
      carbs: Math.round(baseline.carbs * portionMultiplier),
      fat: Math.round((baseline.fat * portionMultiplier + Number.EPSILON) * 10) / 10,
      weightGrams: Math.round(baseline.servingSizeGrams * portionMultiplier),
      isBaselineAverage: true,
      baselineNote: baseline.baselineNote,
      selectedTags: [],
      notesAdjustmentKcal: 0,
    };
  }

  // Base shell
  let cal = baseline.shellCalories;
  let p = baseline.shellProtein;
  let c = baseline.shellCarbs;
  let f = baseline.shellFat;
  let w = baseline.shellWeightGrams;

  // Selected filling tags
  const matchedTags: FillingTag[] = [];
  for (const tagId of selectedTagIds) {
    const tag = FILLING_TAGS.find((t) => t.id === tagId);
    if (tag) {
      matchedTags.push(tag);
      cal += tag.calories;
      p += tag.protein;
      c += tag.carbs;
      f += tag.fat;
      w += tag.weightGrams;
    }
  }

  // Write-in notes modifier adjustments
  let notesAdjustmentKcal = 0;
  if (hasNotes) {
    const noteNorm = notes!.toLowerCase();

    if (noteNorm.includes('extra meat') || noteNorm.includes('double meat') || noteNorm.includes('double steak')) {
      notesAdjustmentKcal += 150;
      cal += 150;
      p += 20;
      f += 8;
      w += 90;
    } else if (noteNorm.includes('extra chicken') || noteNorm.includes('double chicken')) {
      notesAdjustmentKcal += 140;
      cal += 140;
      p += 26;
      f += 3.5;
      w += 90;
    }

    if (noteNorm.includes('double cheese') || noteNorm.includes('extra cheese')) {
      notesAdjustmentKcal += 110;
      cal += 110;
      p += 7;
      c += 1;
      f += 9;
      w += 30;
    }

    if (noteNorm.includes('extra guac') || noteNorm.includes('double guac') || noteNorm.includes('extra guacamole')) {
      notesAdjustmentKcal += 150;
      cal += 150;
      p += 2;
      c += 8;
      f += 14;
      w += 70;
    }

    if (noteNorm.includes('extra sour cream') || noteNorm.includes('double sour cream')) {
      notesAdjustmentKcal += 90;
      cal += 90;
      p += 1;
      c += 1;
      f += 9;
      w += 35;
    }

    if (noteNorm.includes('light rice') || noteNorm.includes('half rice')) {
      notesAdjustmentKcal -= 70;
      cal -= 70;
      p -= 1.5;
      c -= 15;
      w -= 50;
    } else if (noteNorm.includes('no rice')) {
      notesAdjustmentKcal -= 140;
      cal -= 140;
      p -= 3;
      c -= 30;
      w -= 100;
    }

    if (noteNorm.includes('no cheese')) {
      notesAdjustmentKcal -= 110;
      cal -= 110;
      p -= 7;
      c -= 1;
      f -= 9;
      w -= 30;
    }

    if (noteNorm.includes('no sour cream')) {
      notesAdjustmentKcal -= 90;
      cal -= 90;
      p -= 1;
      c -= 1;
      f -= 9;
      w -= 35;
    }
  }

  // Safety clamps
  cal = Math.max(0, cal);
  p = Math.max(0, p);
  c = Math.max(0, c);
  f = Math.max(0, f);
  w = Math.max(0, w);

  return {
    calories: Math.round(cal * portionMultiplier),
    protein: Math.round(p * portionMultiplier),
    carbs: Math.round(c * portionMultiplier),
    fat: Math.round((f * portionMultiplier + Number.EPSILON) * 10) / 10,
    weightGrams: Math.round(w * portionMultiplier),
    isBaselineAverage: false,
    selectedTags: matchedTags,
    notesAdjustmentKcal,
  };
}

/**
 * Formats a clean, compact AR reticle label directly satisfying R2.
 * Output: "{guess} · ~{kcal} kcal" or "{guess} · ~{kcal} kcal (Avg)"
 */
export function formatMinimalReticleLabel(item: {
  label: string;
  calories?: number;
  isLiquid?: boolean;
  isComposite?: boolean;
  isBaselineAverage?: boolean;
}): string {
  const normLabel = (item.label || '').trim();
  if (!normLabel) return '';

  const capitalized = normLabel.charAt(0).toUpperCase() + normLabel.slice(1);

  // Liquids and beverage containers
  if (item.isLiquid || isLiquidContainer(normLabel)) {
    const isGenericContainer = [
      'cup',
      'bottle',
      'glass',
      'drink',
      'beverage',
      'wine glass',
      'mug',
      'can',
    ].includes(normLabel.toLowerCase());

    if (item.calories !== undefined && item.calories > 0 && !isGenericContainer) {
      return `${capitalized} · ~${item.calories} kcal`;
    }
    return 'Drink · ~0-140 kcal';
  }

  // Explicit baseline average flag
  if (item.isBaselineAverage) {
    const cal = item.calories ?? getCompositeBaseline(normLabel)?.calories ?? 680;
    return `${capitalized} · ~${cal} kcal (Avg)`;
  }

  // Composite food with explicit calories
  if (item.isComposite && item.calories !== undefined) {
    return `${capitalized} · ~${item.calories} kcal`;
  }

  // Single standard food item with known calories
  if (item.calories !== undefined) {
    return `${capitalized} · ~${item.calories} kcal`;
  }

  // Unresolved composite food without calories -> use baseline average
  if (isFoodHidingContents(normLabel)) {
    const baseline = getCompositeBaseline(normLabel);
    if (baseline) {
      return `${capitalized} · ~${baseline.calories} kcal (Avg)`;
    }
  }

  return capitalized;
}
