import { ObjectDetector } from '@mediapipe/tasks-vision';
import { getVisionFileset, monotonicClock } from '@/ml/visionRuntime';
import { foodScannerBus } from './FoodScannerBus';
import type { BoundingBox2D, DetectedFoodItem, SpatialCoordinate3D } from './types';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';

/**
 * Standard COCO classes associated with food, meals, beverages, and tableware containers.
 */
const FOOD_AND_CONTAINER_CLASSES = new Set<string>([
  'banana',
  'apple',
  'sandwich',
  'orange',
  'broccoli',
  'carrot',
  'hot dog',
  'pizza',
  'donut',
  'cake',
  'bowl',
  'cup',
  'bottle',
  'wine glass',
  'dining table',
]);

export interface ViewportDimensions {
  width: number;
  height: number;
}

export interface FoodDetectionOptions {
  scoreThreshold?: number;
  maxResults?: number;
  mirror?: boolean;
}

/**
 * FoodDetectionService handles real-time on-device computer vision at 30-60 FPS.
 *
 * Responsibilities:
 * 1. Initializes MediaPipe ObjectDetector with GPU delegate and automatic fallback to CPU.
 * 2. Extracts 2D normalized bounding boxes from decoded camera frames.
 * 3. Transforms 2D bounding boxes into Three.js 3D viewport coordinates (world position, scale, NDC).
 * 4. Emits state changes via FoodScannerBus.
 */
export class FoodDetectionService {
  private detector: ObjectDetector | null = null;
  private readonly clock = monotonicClock();
  private isInitializing = false;
  private lastEmitTime = 0;
  private currentItems: DetectedFoodItem[] = [];

  ready = false;

  constructor(private readonly options: FoodDetectionOptions = {}) {}

  /**
   * Initializes the vision model. Attempts GPU hardware acceleration first,
   * falling back defensively to CPU WebAssembly if WebGL context or shaders fail.
   */
  async init(): Promise<void> {
    if (this.detector || this.isInitializing) return;
    this.isInitializing = true;

    try {
      const fileset = await getVisionFileset();
      const delegates = ['GPU', 'CPU'] as const;
      let lastError: unknown = null;

      for (const delegate of delegates) {
        try {
          this.detector = await ObjectDetector.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: MODEL_URL,
              delegate,
            },
            runningMode: 'VIDEO',
            scoreThreshold: this.options.scoreThreshold ?? 0.35,
            maxResults: this.options.maxResults ?? 6,
          });
          this.ready = true;
          this.isInitializing = false;
          return;
        } catch (err) {
          lastError = err;
          console.warn(`[FoodDetectionService] MediaPipe delegate '${delegate}' failed, trying fallback:`, err);
        }
      }

      throw lastError instanceof Error ? lastError : new Error('Failed to initialize MediaPipe ObjectDetector');
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Performs real-time inference on a video frame and extracts 3D viewport spatial coordinates.
   * Safe to call on every animation frame (30–60 FPS).
   *
   * @param video HTML5 video element providing raw stream frames
   * @param timestamp High-resolution timestamp in milliseconds
   * @param viewport Three.js canvas size in CSS pixels (e.g. from useThree() or container rect)
   * @param mirror Whether to mirror the X-axis (for selfie/user-facing camera)
   */
  detect(
    video: HTMLVideoElement,
    timestamp: number,
    viewport: ViewportDimensions = { width: 1, height: 1 },
    mirror = false,
  ): DetectedFoodItem[] {
    if (!this.detector || !this.ready) return [];

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return [];

    try {
      const monotonicTs = this.clock(timestamp);
      const { detections } = this.detector.detectForVideo(video, monotonicTs);
      if (!detections || detections.length === 0) {
        this.currentItems = [];
        return [];
      }

      const detectedItems: DetectedFoodItem[] = [];

      for (let i = 0; i < detections.length; i++) {
        const d = detections[i];
        if (!d || !d.categories || d.categories.length === 0 || !d.boundingBox) continue;

        const category = d.categories[0];
        const rawBox = d.boundingBox;
        if (!category || !rawBox) continue;

        const label = category.categoryName.toLowerCase();
        if (!FOOD_AND_CONTAINER_CLASSES.has(label)) continue;

        // Normalized 2D coordinates [0..1]
        const box2d: BoundingBox2D = {
          x: Math.max(0, Math.min(1, rawBox.originX / vw)),
          y: Math.max(0, Math.min(1, rawBox.originY / vh)),
          w: Math.max(0, Math.min(1, rawBox.width / vw)),
          h: Math.max(0, Math.min(1, rawBox.height / vh)),
        };

        // Extract 3D viewport spatial coordinates
        const spatial3d = this.projectToThreeSpace(box2d, viewport, mirror);

        detectedItems.push({
          id: `food-${label}-${i}-${Math.round(box2d.x * 100)}-${Math.round(box2d.y * 100)}`,
          label: category.categoryName,
          confidence: Number(category.score.toFixed(3)),
          score: Number(category.score.toFixed(3)),
          x: box2d.x,
          y: box2d.y,
          w: box2d.w,
          h: box2d.h,
          box2d,
          spatial3d,
          detectedAt: timestamp,
        });
      }

      this.currentItems = detectedItems;

      // Throttle event bus emission to ~10 Hz to prevent flooding while keeping 60 FPS in refs
      if (detectedItems.length > 0 && timestamp - this.lastEmitTime > 100) {
        this.lastEmitTime = timestamp;
        foodScannerBus.emitFoodDetected({
          items: detectedItems,
          timestamp,
        });
      }

      return detectedItems;
    } catch (err) {
      // Defensive fallback: Never throw into the requestAnimationFrame loop
      console.warn('[FoodDetectionService] Frame detection dropped:', err);
      return [];
    }
  }

  /**
   * Projects normalized 2D camera coordinates [0..1] into Three.js 3D viewport coordinates.
   *
   * In Three.js orthographic view (standard for FitLens WebAR overlay):
   * - Origin (0, 0, 0) is at the center of the canvas.
   * - +X points right, +Y points up, +Z points toward the camera.
   * - 1 unit equals 1 CSS pixel.
   */
  projectToThreeSpace(
    box: BoundingBox2D,
    viewport: ViewportDimensions,
    mirror: boolean,
  ): SpatialCoordinate3D {
    const { width, height } = viewport;
    const effectiveWidth = width > 0 ? width : 1;
    const effectiveHeight = height > 0 ? height : 1;

    // Center in normalized [0..1] space
    const normCenterX = box.x + box.w / 2;
    const normCenterY = box.y + box.h / 2;

    // Apply mirror reflection if using user-facing camera
    const correctedNormX = mirror ? 1 - normCenterX : normCenterX;

    // Map to Three.js world coordinates (centered at 0,0)
    const worldX = (correctedNormX - 0.5) * effectiveWidth;
    const worldY = (0.5 - normCenterY) * effectiveHeight;

    // Approximate relative Z depth: larger bounding boxes represent items closer to the camera.
    // Normalized area range [0..1], mapped to inverted depth factor.
    const normalizedArea = Math.max(0.001, box.w * box.h);
    const estimatedDepth = Number((1 / Math.sqrt(normalizedArea)).toFixed(2));
    const worldZ = 0; // In orthographic 2D overlay layer, primary plane is at z = 0

    // Bounding dimensions in Three.js world units
    const worldWidth = box.w * effectiveWidth;
    const worldHeight = box.h * effectiveHeight;
    const worldDepth = Math.min(worldWidth, worldHeight) * 0.5;

    // Normalized Device Coordinates (NDC) [-1..1] for raycasting and clipping checks
    const ndcX = correctedNormX * 2 - 1;
    const ndcY = -(normCenterY * 2 - 1);

    const minX = worldX - worldWidth / 2;
    const maxX = worldX + worldWidth / 2;
    const minY = worldY - worldHeight / 2;
    const maxY = worldY + worldHeight / 2;

    return {
      center: [worldX, worldY, worldZ],
      size: [worldWidth, worldHeight, worldDepth],
      ndc: [ndcX, ndcY],
      estimatedDepth,
      bounds2D: { minX, maxX, minY, maxY },
    };
  }

  getCurrentDetections(): DetectedFoodItem[] {
    return this.currentItems;
  }

  dispose(): void {
    try {
      this.detector?.close();
    } catch {
      /* ignore disposal failures */
    }
    this.detector = null;
    this.ready = false;
    this.currentItems = [];
  }
}
