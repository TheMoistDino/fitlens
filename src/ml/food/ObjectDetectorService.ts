import { ObjectDetector } from '@mediapipe/tasks-vision';
import { getVisionFileset, monotonicClock } from '../visionRuntime';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';

/** COCO classes that are food (or hold food). Used to anchor AR labels locally at 30–60 FPS. */
const FOOD_CLASSES = new Set([
  'banana', 'apple', 'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'bowl', 'cup', 'bottle', 'wine glass',
]);

export interface FoodBox {
  label: string;
  score: number;
  /** Normalised [0..1] box in video space. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * On-device food localisation. It only tells us *where* food is (for the 3D label anchor);
 * *what* and *how many macros* is answered by StepFun on a keyframe.
 */
export class ObjectDetectorService {
  private detector: ObjectDetector | null = null;
  private clock = monotonicClock();
  ready = false;

  async init(): Promise<void> {
    if (this.detector) return;
    const fileset = await getVisionFileset();
    let lastErr: unknown;
    for (const delegate of ['GPU', 'CPU'] as const) {
      try {
        this.detector = await ObjectDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: 'VIDEO',
          scoreThreshold: 0.35,
          maxResults: 5,
        });
        this.ready = true;
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('ObjectDetector failed to initialise');
  }

  detect(video: HTMLVideoElement, now: number): FoodBox[] {
    if (!this.detector) return [];
    try {
      const { detections } = this.detector.detectForVideo(video, this.clock(now));
      const vw = video.videoWidth || 1, vh = video.videoHeight || 1;
      const out: FoodBox[] = [];
      for (const d of detections) {
        const cat = d.categories[0];
        const bb = d.boundingBox;
        if (!cat || !bb || !FOOD_CLASSES.has(cat.categoryName)) continue;
        out.push({ label: cat.categoryName, score: cat.score, x: bb.originX / vw, y: bb.originY / vh, w: bb.width / vw, h: bb.height / vh });
      }
      return out;
    } catch {
      return [];
    }
  }

  dispose(): void {
    try {
      this.detector?.close();
    } catch {
      /* noop */
    }
    this.detector = null;
    this.ready = false;
  }
}
