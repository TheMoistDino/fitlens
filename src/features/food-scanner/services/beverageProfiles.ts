export type BeverageCategory =
  | 'all'
  | 'suggested'
  | 'dairy'
  | 'canned'
  | 'dark-brown'
  | 'water'
  | 'juice'
  | 'tea';

export interface BeveragePreset {
  id: string;
  name: string;
  shortName: string;
  icon: string;
  category: 'dairy' | 'canned' | 'dark-brown' | 'water' | 'juice' | 'tea' | 'other';
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  servingSizeGrams: number;
  servingUnit: string;
  description: string;
  isCan?: boolean;
  brand?: string;
}

export const LIQUID_CONTAINER_CLASSES = new Set<string>([
  'cup',
  'bottle',
  'wine glass',
  'mug',
  'glass',
  'can',
  'drink',
  'beverage',
]);

export const BEVERAGE_PRESETS: BeveragePreset[] = [
  // --- Dairy & Plant-Based Milks (Non-Dark Liquids) ---
  {
    id: 'whole-milk',
    name: 'Whole Milk',
    shortName: 'Whole Milk',
    icon: '🥛',
    category: 'dairy',
    calories: 150,
    protein: 8,
    carbs: 12,
    fat: 8,
    servingSizeGrams: 240,
    servingUnit: '1 cup (240ml)',
    description: 'Whole dairy milk with 3.25% milkfat',
  },
  {
    id: 'lowfat-milk',
    name: '2% Low-Fat Milk',
    shortName: '2% Milk',
    icon: '🥛',
    category: 'dairy',
    calories: 120,
    protein: 8,
    carbs: 12,
    fat: 5,
    servingSizeGrams: 240,
    servingUnit: '1 cup (240ml)',
    description: 'Reduced-fat 2% dairy milk',
  },
  {
    id: 'skim-milk',
    name: 'Skim / Non-Fat Milk',
    shortName: 'Skim Milk',
    icon: '🥛',
    category: 'dairy',
    calories: 90,
    protein: 9,
    carbs: 12,
    fat: 0,
    servingSizeGrams: 240,
    servingUnit: '1 cup (240ml)',
    description: 'Fat-free skim dairy milk',
  },
  {
    id: 'oat-milk',
    name: 'Oat Milk',
    shortName: 'Oat Milk',
    icon: '🌾',
    category: 'dairy',
    calories: 130,
    protein: 3,
    carbs: 16,
    fat: 5,
    servingSizeGrams: 240,
    servingUnit: '1 cup (240ml)',
    description: 'Smooth, creamy plant-based oat milk',
  },
  {
    id: 'almond-milk',
    name: 'Almond Milk (Unsweetened)',
    shortName: 'Almond Milk',
    icon: '🌰',
    category: 'dairy',
    calories: 35,
    protein: 1,
    carbs: 1,
    fat: 2.5,
    servingSizeGrams: 240,
    servingUnit: '1 cup (240ml)',
    description: 'Low-calorie unsweetened plant-based almond milk',
  },
  {
    id: 'chocolate-milk',
    name: 'Chocolate Milk',
    shortName: 'Choc Milk',
    icon: '🍫',
    category: 'dairy',
    calories: 210,
    protein: 8,
    carbs: 30,
    fat: 5,
    servingSizeGrams: 240,
    servingUnit: '1 cup (240ml)',
    description: 'Sweetened chocolate dairy milk',
  },
  {
    id: 'latte',
    name: 'Latte / Milk Coffee',
    shortName: 'Latte',
    icon: '☕',
    category: 'dairy',
    calories: 150,
    protein: 8,
    carbs: 12,
    fat: 6,
    servingSizeGrams: 300,
    servingUnit: '1 cup (300ml)',
    description: 'Espresso with steamed milk and microfoam',
  },

  // --- Canned Beverages (Sodas, Energy Drinks, Seltzers, Canned Teas) ---
  {
    id: 'celsius-sparkling',
    name: 'Celsius Sparkling Energy (Can)',
    shortName: 'Celsius',
    icon: '⚡',
    category: 'canned',
    calories: 10,
    protein: 0,
    carbs: 0,
    fat: 0,
    servingSizeGrams: 355,
    servingUnit: '1 can (355ml / 12oz)',
    description: 'Sugar-free functional fitness energy drink with 7 vitamins',
    isCan: true,
    brand: 'Celsius',
  },
  {
    id: 'red-bull',
    name: 'Red Bull Original (Can)',
    shortName: 'Red Bull',
    icon: '⚡',
    category: 'canned',
    calories: 110,
    protein: 1,
    carbs: 28,
    fat: 0,
    servingSizeGrams: 250,
    servingUnit: '1 can (250ml / 8.4oz)',
    description: 'Classic energy drink with caffeine and taurine',
    isCan: true,
    brand: 'Red Bull',
  },
  {
    id: 'red-bull-sugarfree',
    name: 'Red Bull Sugarfree (Can)',
    shortName: 'Red Bull SF',
    icon: '⚡',
    category: 'canned',
    calories: 5,
    protein: 0,
    carbs: 0,
    fat: 0,
    servingSizeGrams: 250,
    servingUnit: '1 can (250ml / 8.4oz)',
    description: 'Zero-sugar taurine energy drink',
    isCan: true,
    brand: 'Red Bull',
  },
  {
    id: 'monster-zero',
    name: 'Monster Energy Zero Ultra (Can)',
    shortName: 'Monster Ultra',
    icon: '⚡',
    category: 'canned',
    calories: 10,
    protein: 0,
    carbs: 4,
    fat: 0,
    servingSizeGrams: 473,
    servingUnit: '1 can (473ml / 16oz)',
    description: 'Zero sugar crisp citrus white can energy drink',
    isCan: true,
    brand: 'Monster',
  },
  {
    id: 'monster-original',
    name: 'Monster Energy Original (Can)',
    shortName: 'Monster',
    icon: '⚡',
    category: 'canned',
    calories: 210,
    protein: 0,
    carbs: 54,
    fat: 0,
    servingSizeGrams: 473,
    servingUnit: '1 can (473ml / 16oz)',
    description: 'Original classic energy drink in green claw can',
    isCan: true,
    brand: 'Monster',
  },
  {
    id: 'coke-zero',
    name: 'Coca-Cola Zero Sugar (Can)',
    shortName: 'Coke Zero',
    icon: '🥤',
    category: 'canned',
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    servingSizeGrams: 355,
    servingUnit: '1 can (355ml / 12oz)',
    description: 'Zero calorie, zero sugar classic dark cola',
    isCan: true,
    brand: 'Coca-Cola',
  },
  {
    id: 'diet-cola',
    name: 'Diet Coke / Diet Cola (Can)',
    shortName: 'Diet Cola',
    icon: '🥤',
    category: 'canned',
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    servingSizeGrams: 355,
    servingUnit: '1 can (355ml / 12oz)',
    description: 'Crisp, light calorie-free silver can cola',
    isCan: true,
    brand: 'Coca-Cola',
  },
  {
    id: 'regular-cola',
    name: 'Coca-Cola Classic (Can)',
    shortName: 'Coke Classic',
    icon: '🥤',
    category: 'canned',
    calories: 140,
    protein: 0,
    carbs: 39,
    fat: 0,
    servingSizeGrams: 355,
    servingUnit: '1 can (355ml / 12oz)',
    description: 'Original sweetened red can cola',
    isCan: true,
    brand: 'Coca-Cola',
  },
  {
    id: 'dr-pepper',
    name: 'Dr Pepper (Can)',
    shortName: 'Dr Pepper',
    icon: '🥤',
    category: 'canned',
    calories: 150,
    protein: 0,
    carbs: 40,
    fat: 0,
    servingSizeGrams: 355,
    servingUnit: '1 can (355ml / 12oz)',
    description: 'Unique 23-flavor blend dark soda',
    isCan: true,
    brand: 'Dr Pepper',
  },
  {
    id: 'sprite-can',
    name: 'Sprite (Can)',
    shortName: 'Sprite',
    icon: '🥤',
    category: 'canned',
    calories: 140,
    protein: 0,
    carbs: 38,
    fat: 0,
    servingSizeGrams: 355,
    servingUnit: '1 can (355ml / 12oz)',
    description: '100% natural lemon-lime flavored soda',
    isCan: true,
    brand: 'Sprite',
  },
  {
    id: 'poppi-soda',
    name: 'Poppi Prebiotic Soda (Can)',
    shortName: 'Poppi',
    icon: '🥤',
    category: 'canned',
    calories: 25,
    protein: 0,
    carbs: 5,
    fat: 0,
    servingSizeGrams: 355,
    servingUnit: '1 can (355ml / 12oz)',
    description: 'Low-sugar prebiotic soda with apple cider vinegar',
    isCan: true,
    brand: 'Poppi',
  },
  {
    id: 'liquid-death',
    name: 'Liquid Death Mountain Water (Can)',
    shortName: 'Liquid Death',
    icon: '🫧',
    category: 'canned',
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    servingSizeGrams: 500,
    servingUnit: '1 tall can (500ml / 16.9oz)',
    description: 'Pure Alpine mountain water in recyclable aluminum tallboy can',
    isCan: true,
    brand: 'Liquid Death',
  },
  {
    id: 'seltzer-can',
    name: 'Sparkling Water / Seltzer (Can)',
    shortName: 'Seltzer',
    icon: '🫧',
    category: 'canned',
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    servingSizeGrams: 355,
    servingUnit: '1 can (355ml / 12oz)',
    description: 'Naturally flavored zero-calorie seltzer (LaCroix / Bubly / Polar)',
    isCan: true,
  },
  {
    id: 'arizona-tea-can',
    name: 'Arizona Green Tea (Tall Can)',
    shortName: 'Arizona Tea',
    icon: '🍵',
    category: 'canned',
    calories: 210,
    protein: 0,
    carbs: 51,
    fat: 0,
    servingSizeGrams: 680,
    servingUnit: '1 tall can (680ml / 23oz)',
    description: 'Green tea with ginseng and SueBee premium orange honey',
    isCan: true,
    brand: 'Arizona',
  },

  // --- Dark Drinks (Coffee & Tea) ---
  {
    id: 'black-coffee',
    name: 'Black Coffee / Americano',
    shortName: 'Coffee',
    icon: '☕',
    category: 'dark-brown',
    calories: 2,
    protein: 0.3,
    carbs: 0.2,
    fat: 0,
    servingSizeGrams: 240,
    servingUnit: '1 cup (240ml)',
    description: 'Brewed drip coffee or Americano without sugar or milk',
  },
  {
    id: 'unsweetened-tea',
    name: 'Unsweetened Black / Green Tea',
    shortName: 'Tea',
    icon: '🍵',
    category: 'tea',
    calories: 2,
    protein: 0,
    carbs: 0.4,
    fat: 0,
    servingSizeGrams: 240,
    servingUnit: '1 cup (240ml)',
    description: 'Brewed tea without added sweetener',
  },
  {
    id: 'sweet-tea',
    name: 'Sweet Iced Tea',
    shortName: 'Sweet Tea',
    icon: '🧋',
    category: 'dark-brown',
    calories: 90,
    protein: 0,
    carbs: 23,
    fat: 0,
    servingSizeGrams: 350,
    servingUnit: '1 glass (350ml)',
    description: 'Traditional sweetened iced black tea',
  },
  {
    id: 'matcha-latte',
    name: 'Matcha Green Tea Latte',
    shortName: 'Matcha Latte',
    icon: '🍵',
    category: 'tea',
    calories: 140,
    protein: 4,
    carbs: 24,
    fat: 3,
    servingSizeGrams: 240,
    servingUnit: '1 cup (240ml)',
    description: 'Stone-ground green tea whisked with milk and light sweetener',
  },

  // --- Waters & Pure Hydration ---
  {
    id: 'water',
    name: 'Water',
    shortName: 'Water',
    icon: '💧',
    category: 'water',
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    servingSizeGrams: 250,
    servingUnit: '1 glass (250ml)',
    description: 'Pure still or filtered water',
  },

  // --- Fruit Juices ---
  {
    id: 'orange-juice',
    name: 'Orange Juice',
    shortName: 'OJ',
    icon: '🧃',
    category: 'juice',
    calories: 110,
    protein: 2,
    carbs: 26,
    fat: 0.5,
    servingSizeGrams: 240,
    servingUnit: '1 glass (240ml)',
    description: '100% pure orange juice',
  },
  {
    id: 'apple-juice',
    name: 'Apple Juice',
    shortName: 'Apple Juice',
    icon: '🍎',
    category: 'juice',
    calories: 115,
    protein: 0.2,
    carbs: 28,
    fat: 0.2,
    servingSizeGrams: 240,
    servingUnit: '1 glass (240ml)',
    description: '100% crisp apple juice',
  },
];

/**
 * Checks whether a given label represents a container for liquids or a beverage item.
 */
export function isLiquidContainer(label: string | undefined | null): boolean {
  if (!label) return false;
  const normalized = label.trim().toLowerCase();
  return LIQUID_CONTAINER_CLASSES.has(normalized);
}

/**
 * Returns beverage presets filtered to visually ambiguous dark-brown drinks.
 */
export function getDarkBrownBeverages(): BeveragePreset[] {
  return BEVERAGE_PRESETS.filter(
    (b) =>
      b.category === 'dark-brown' ||
      b.id === 'unsweetened-tea' ||
      b.id === 'regular-cola' ||
      b.id === 'diet-cola' ||
      b.id === 'coke-zero' ||
      b.id === 'dr-pepper',
  );
}

/**
 * Returns all milk and dairy presets.
 */
export function getMilkBeverages(): BeveragePreset[] {
  return BEVERAGE_PRESETS.filter((b) => b.category === 'dairy');
}

/**
 * Returns canned drink presets (sodas, seltzers, energy drinks).
 */
export function getCannedBeverages(): BeveragePreset[] {
  return BEVERAGE_PRESETS.filter((b) => b.isCan || b.category === 'canned');
}

/**
 * Returns all available beverage presets.
 */
export function getBeveragePresets(): BeveragePreset[] {
  return BEVERAGE_PRESETS;
}

/**
 * Filters beverages by category.
 */
export function getBeveragesByCategory(category: BeverageCategory): BeveragePreset[] {
  if (category === 'all') return BEVERAGE_PRESETS;
  if (category === 'dairy') return getMilkBeverages();
  if (category === 'canned') return getCannedBeverages();
  if (category === 'dark-brown') return getDarkBrownBeverages();
  if (category === 'tea') return BEVERAGE_PRESETS.filter((b) => b.category === 'tea');
  if (category === 'water') return BEVERAGE_PRESETS.filter((b) => b.category === 'water');
  if (category === 'juice') return BEVERAGE_PRESETS.filter((b) => b.category === 'juice');
  // Suggested category: Popular representative options across groups
  return [
    BEVERAGE_PRESETS.find((b) => b.id === 'whole-milk')!,
    BEVERAGE_PRESETS.find((b) => b.id === 'celsius-sparkling')!,
    BEVERAGE_PRESETS.find((b) => b.id === 'coke-zero')!,
    BEVERAGE_PRESETS.find((b) => b.id === 'black-coffee')!,
    BEVERAGE_PRESETS.find((b) => b.id === 'unsweetened-tea')!,
    BEVERAGE_PRESETS.find((b) => b.id === 'water')!,
    BEVERAGE_PRESETS.find((b) => b.id === 'orange-juice')!,
    BEVERAGE_PRESETS.find((b) => b.id === 'red-bull')!,
  ].filter(Boolean);
}

/**
 * Searches the beverage database using fuzzy matching across name, brand, and shortName.
 */
export function searchBeverages(query: string): BeveragePreset[] {
  const norm = query.trim().toLowerCase();
  if (!norm) return getBeveragesByCategory('suggested');

  return BEVERAGE_PRESETS.filter((b) => {
    return (
      b.name.toLowerCase().includes(norm) ||
      b.shortName.toLowerCase().includes(norm) ||
      (b.brand && b.brand.toLowerCase().includes(norm)) ||
      b.description.toLowerCase().includes(norm)
    );
  });
}

/**
 * Matches a beverage preset by its unique ID.
 */
export function getBeverageById(id: string): BeveragePreset | undefined {
  return BEVERAGE_PRESETS.find((b) => b.id === id);
}

/**
 * Attempts to match a beverage preset by full or partial name.
 */
export function matchBeverageByName(name: string): BeveragePreset | undefined {
  const norm = name.trim().toLowerCase();
  return (
    BEVERAGE_PRESETS.find(
      (b) =>
        b.name.toLowerCase() === norm ||
        b.shortName.toLowerCase() === norm ||
        (b.brand && norm.includes(b.brand.toLowerCase())),
    ) ||
    BEVERAGE_PRESETS.find(
      (b) =>
        norm.includes(b.shortName.toLowerCase()) ||
        b.name.toLowerCase().includes(norm),
    )
  );
}

/**
 * Infers liquid visual appearance from sampled RGB color:
 * - White/opaque (R, G, B > 175 with low saturation) -> 'dairy' (Milk)
 * - Bright orange/yellow -> 'juice'
 * - Dark brown / black (low brightness) -> 'dark-brown' (Coffee/Cola)
 * - Clear / high luminance neutral -> 'water'
 */
export function detectLiquidAppearance(rgb: { r: number; g: number; b: number }): 'dairy' | 'dark-brown' | 'juice' | 'water' {
  const { r, g, b } = rgb;
  const brightness = (r + g + b) / 3;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const saturation = max === 0 ? 0 : delta / max;

  // White / creamy liquid: high brightness and low color saturation
  if (brightness > 175 && saturation < 0.28) {
    return 'dairy';
  }

  // Orange / Yellow juice: high red, moderate green, lower blue with saturation
  if (r > 160 && g > 90 && b < 100 && saturation > 0.35) {
    return 'juice';
  }

  // Dark brown / black: low brightness
  if (brightness < 85) {
    return 'dark-brown';
  }

  // Default clean neutral
  return 'water';
}

/**
 * Generates an authoritative web search URL for a canned or packaged drink.
 */
export function generateCanWebSearchUrl(canQuery: string): string {
  const clean = canQuery.trim() || 'canned beverage';
  return `https://www.google.com/search?q=${encodeURIComponent(`${clean} nutrition facts calories macros`)}`;
}
