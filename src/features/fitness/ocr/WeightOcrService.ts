import type { NormRect } from '../types';

/**
 * On-device OCR for weight-stack numbers (Tesseract.js, WASM in a Web Worker — off the main thread).
 *
 * Latency budget: we only ever OCR the ROI crop, downscaled/upscaled to a fixed ~96px text height,
 * binarised, with a digits+units whitelist and single-line page mode. Typical: 80–250 ms per read.
 * The worker and language data are lazy-loaded the first time weight scanning starts.
 */

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;

const TARGET_HEIGHT = 96;

export class WeightOcrService {
  private worker: TesseractWorker | null = null;
  private loading: Promise<void> | null = null;
  private busy = false;
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  status: 'idle' | 'loading' | 'ready' | 'error' = 'idle';

  init(): Promise<void> {
    this.loading ??= (async () => {
      this.status = 'loading';
      try {
        const { createWorker, PSM } = await import('tesseract.js');
        const worker = await createWorker('eng');
        await worker.setParameters({
          tessedit_char_whitelist: '0123456789.LBSKGlbskg# ',
          tessedit_pageseg_mode: PSM.SINGLE_LINE,
        });
        this.worker = worker;
        this.status = 'ready';
      } catch (err) {
        this.status = 'error';
        this.loading = null; // allow retry
        throw err;
      }
    })();
    return this.loading;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  /**
   * OCR the ROI of the current frame. Returns null if a read is already in flight (callers just try
   * again next tick — no queue, so results are always for a recent frame).
   */
  async readRoi(video: HTMLVideoElement, roi: NormRect): Promise<{ text: string; confidence: number } | null> {
    if (!this.worker || this.busy || !video.videoWidth) return null;
    this.busy = true;
    try {
      const crop = this.cropAndBinarise(video, roi);
      if (!crop) return null;
      const { data } = await this.worker.recognize(crop as HTMLCanvasElement);
      return { text: data.text ?? '', confidence: data.confidence ?? 0 };
    } catch {
      return null;
    } finally {
      this.busy = false;
    }
  }

  async dispose(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    this.loading = null;
    this.status = 'idle';
    await w?.terminate().catch(() => {});
  }

  /** Crop the ROI, scale it to a fixed text height, grayscale + Otsu threshold, dark-on-light. */
  private cropAndBinarise(video: HTMLVideoElement, roi: NormRect): HTMLCanvasElement | OffscreenCanvas | null {
    const sx = Math.round(roi.x * video.videoWidth);
    const sy = Math.round(roi.y * video.videoHeight);
    const sw = Math.max(1, Math.round(roi.w * video.videoWidth));
    const sh = Math.max(1, Math.round(roi.h * video.videoHeight));
    const k = TARGET_HEIGHT / sh;
    const w = Math.max(1, Math.round(sw * k));
    const h = TARGET_HEIGHT;

    if (!this.canvas) this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return null;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);

    const img = ctx.getImageData(0, 0, w, h);
    const px = img.data;
    const gray = new Uint8Array(w * h);
    const hist = new Uint32Array(256);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      const g = (px[i]! * 0.299 + px[i + 1]! * 0.587 + px[i + 2]! * 0.114) | 0;
      gray[j] = g;
      hist[g]!++;
    }
    const threshold = otsu(hist, w * h);
    let dark = 0;
    for (let j = 0; j < gray.length; j++) if (gray[j]! < threshold) dark++;
    // Plates are often light digits on a dark plate: invert so text is dark on light for Tesseract.
    const invert = dark > gray.length / 2;
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      const on = gray[j]! < threshold !== invert; // true = text pixel
      const v = on ? 0 : 255;
      px[i] = px[i + 1] = px[i + 2] = v;
      px[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return this.canvas;
  }
}

/** Otsu's method: threshold that maximises between-class variance of a grayscale histogram. */
export function otsu(hist: ArrayLike<number>, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * (hist[i] ?? 0);
  let sumB = 0, wB = 0, best = 0, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t] ?? 0;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * (hist[t] ?? 0);
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}
