import { FilesetResolver } from '@mediapipe/tasks-vision';

/**
 * Shared MediaPipe WASM runtime. Loaded once, lazily, and reused by every task (pose, object detection).
 * WASM version is pinned to the installed npm package so JS and WASM never drift.
 */
const TASKS_VISION_VERSION = '0.10.35';
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;

type Fileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
let filesetPromise: Promise<Fileset> | null = null;

export function getVisionFileset(): Promise<Fileset> {
  filesetPromise ??= FilesetResolver.forVisionTasks(WASM_BASE).catch((err: unknown) => {
    filesetPromise = null; // allow retry on next call
    throw err;
  });
  return filesetPromise;
}

/** MediaPipe requires strictly increasing timestamps per task instance. */
export function monotonicClock() {
  let last = 0;
  return (now: number) => {
    last = now > last ? now : last + 1;
    return last;
  };
}
