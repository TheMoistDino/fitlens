import { z } from 'zod';
import type { MacroSummary } from '@/core/events/events';

/**
 * Normalized 2D bounding box [0..1] in camera video coordinates.
 * Origin (0,0) is top-left, (1,1) is bottom-right.
 */
export interface BoundingBox2D {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Spatial coordinate representation mapped to the Three.js 3D viewport space.
 * Orthographic / perspective coordinates centered at (0, 0, 0) with 1 unit = 1 CSS pixel.
 */
export interface SpatialCoordinate3D {
  /** Center position in Three.js world coordinates: [x, y, z]. */
  center: [number, number, number];
  /** Bounding dimensions in Three.js world units: [width, height, depth]. */
  size: [number, number, number];
  /** Normalized Device Coordinates [-1..1] for raycasting or frustum culling: [ndcX, ndcY]. */
  ndc: [number, number];
  /** Estimated relative depth based on inverse box scale / focal approximation. */
  estimatedDepth: number;
  /** Bounding box corners in Three.js viewport space: min [x, y], max [x, y]. */
  bounds2D: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
}

/**
 * Food item detected by real-time on-device computer vision.
 */
export interface DetectedFoodItem {
  id: string;
  label: string;
  confidence: number;
  /** Flat score alias for 3D label rendering compatibility */
  score: number;
  /** Normalized x [0..1] */
  x: number;
  /** Normalized y [0..1] */
  y: number;
  /** Normalized width [0..1] */
  w: number;
  /** Normalized height [0..1] */
  h: number;
  box2d: BoundingBox2D;
  spatial3d: SpatialCoordinate3D;
  detectedAt: number;
}

/**
 * Strict schema for StepFun multimodal food analysis (targeting step-5-preview).
 */
export const StepFunFoodItemSchema = z.object({
  foodItem: z.string().min(1),
  estimatedWeightGrams: z.number().nonnegative(),
  calories: z.number().nonnegative(),
  macros: z.object({
    protein: z.number().nonnegative(),
    carbs: z.number().nonnegative(),
    fat: z.number().nonnegative(),
  }),
  confidenceScore: z.number().min(0).max(1),
});

export type StepFunFoodItem = z.infer<typeof StepFunFoodItemSchema>;

export const StepFunFoodAnalysisResponseSchema = z.object({
  items: z.array(StepFunFoodItemSchema),
  totalCalories: z.number().nonnegative().optional(),
  source: z.enum(['stepfun', 'mock']),
});

export type StepFunFoodAnalysisResponse = z.infer<typeof StepFunFoodAnalysisResponseSchema>;

export interface MealLoggedPayload {
  id: string;
  name: string;
  calories: number;
  macros: {
    protein: number;
    carbs: number;
    fat: number;
  };
  weightGrams?: number;
  confidence?: number;
  timestamp: number;
  source: 'stepfun' | 'mock' | 'manual' | 'upload';
}

export type FoodScannerStateEvents = {
  FOOD_DETECTED: {
    items: DetectedFoodItem[];
    timestamp: number;
  };
  NUTRITION_ESTIMATED: {
    primary: StepFunFoodItem;
    items: StepFunFoodItem[];
    macroSummary: MacroSummary;
    timestamp: number;
  };
  NUTRITION_FAILED: {
    error: string;
    code: 'TIMEOUT' | 'NETWORK_ERROR' | 'INVALID_RESPONSE' | 'NO_FOOD_DETECTED' | 'ABORTED';
    timestamp: number;
  };
  MEAL_LOGGED: MealLoggedPayload;
  [key: string]: unknown;
};
