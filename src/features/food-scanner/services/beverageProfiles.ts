export interface BeveragePreset {
  id: string;
  name: string;
  shortName: string;
  icon: string;
  category: 'dark-brown' | 'water' | 'dairy' | 'juice' | 'other';
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  servingSizeGrams: number;
  servingUnit: string;
  description: string;
}

export const LIQUID_CONTAINER_CLASSES = new Set<string>([
  'cup',
  'bottle',
  'wine glass',
  'mug',
  'glass',
  'drink',
  'beverage',
]);

export const BEVERAGE_PRESETS: BeveragePreset[] = [
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
    name: 'Unsweetened Tea',
    shortName: 'Tea',
    icon: '🍵',
    category: 'dark-brown',
    calories: 2,
    protein: 0,
    carbs: 0.4,
    fat: 0,
    servingSizeGrams: 240,
    servingUnit: '1 cup (240ml)',
    description: 'Brewed black, green, or herbal tea without added sweetener',
  },
  {
    id: 'regular-cola',
    name: 'Regular Cola / Soda',
    shortName: 'Cola',
    icon: '🥤',
    category: 'dark-brown',
    calories: 140,
    protein: 0,
    carbs: 39,
    fat: 0,
    servingSizeGrams: 355,
    servingUnit: '1 can (355ml)',
    description: 'Classic sweetened dark cola with high sucrose/HFCS content',
  },
  {
    id: 'diet-cola',
    name: 'Diet / Zero Cola',
    shortName: 'Diet Cola',
    icon: '🥤',
    category: 'dark-brown',
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    servingSizeGrams: 355,
    servingUnit: '1 can (355ml)',
    description: 'Artificially sweetened zero-calorie dark soda',
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
    description: 'Still or sparkling pure hydration',
  },
  {
    id: 'latte',
    name: 'Latte / Milk Coffee',
    shortName: 'Latte',
    icon: '🥛',
    category: 'dairy',
    calories: 150,
    protein: 8,
    carbs: 12,
    fat: 6,
    servingSizeGrams: 300,
    servingUnit: '1 cup (300ml)',
    description: 'Espresso with steamed milk and light microfoam',
  },
  {
    id: 'orange-juice',
    name: 'Orange Juice',
    shortName: 'Juice',
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
  return BEVERAGE_PRESETS.filter((b) => b.category === 'dark-brown');
}

/**
 * Returns all available beverage presets.
 */
export function getBeveragePresets(): BeveragePreset[] {
  return BEVERAGE_PRESETS;
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
  return BEVERAGE_PRESETS.find(
    (b) =>
      b.name.toLowerCase() === norm ||
      b.shortName.toLowerCase() === norm ||
      norm.includes(b.shortName.toLowerCase()),
  );
}
