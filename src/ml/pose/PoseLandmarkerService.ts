import { PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { getVisionFileset, monotonicClock } from '../visionRuntime';

export type Landmarks = NormalizedLandmark[];

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export type PoseServiceStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Wraps MediaPipe PoseLandmarker for the 60 FPS hot path.
 * - Tries the GPU (WebGL) delegate first and transparently falls back to CPU.
 * - `detect()` is synchronous and never throws: on failure it returns null.
 */
export class PoseLandmarkerService {
  private landmarker: PoseLandmarker | null = null;
  private clock = monotonicClock();
  status: PoseServiceStatus = 'idle';
  delegate: 'GPU' | 'CPU' | null = null;
  lastError: Error | null = null;

  async init(): Promise<void> {
    if (this.status === 'ready' || this.status === 'loading') return;
    this.status = 'loading';
    const fileset = await getVisionFileset();

    for (const delegate of ['GPU', 'CPU'] as const) {
      try {
        this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        this.delegate = delegate;
        this.status = 'ready';
        return;
      } catch (err) {
        this.lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[Pose] ${delegate} delegate failed, trying next`, err);
      }
    }
    this.status = 'error';
    throw this.lastError ?? new Error('PoseLandmarker failed to initialise');
  }

  /** Returns landmarks for the first detected person, or null. */
  detect(video: HTMLVideoElement, now: number): Landmarks | null {
    if (!this.landmarker || this.status !== 'ready') return null;
    try {
      const result = this.landmarker.detectForVideo(video, this.clock(now));
      return result.landmarks[0] ?? null;
    } catch (err) {
      this.lastError = err instanceof Error ? err : new Error(String(err));
      return null;
    }
  }

  dispose(): void {
    try {
      this.landmarker?.close();
    } catch {
      /* already closed */
    }
    this.landmarker = null;
    this.status = 'idle';
  }
}
