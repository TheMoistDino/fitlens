import type { BoundingBox2D } from './types';

export interface FrameSamplerOptions {
  /** Maximum interval in milliseconds between frame samples (fallback timer). Default: 2500ms (2-3s). */
  intervalMs?: number;
  /** Minimum time in milliseconds between triggers to enforce dual-frequency throttling (0.2–0.5 FPS). Default: 2000ms. */
  cooldownMs?: number;
  /** Normalized Euclidean centroid distance threshold below which the frame is considered stable. Default: 0.025 (2.5%). */
  motionThreshold?: number;
  /** Consecutive milliseconds the frame must remain below the motion threshold to trigger stability capture. Default: 600ms. */
  minStabilityDurationMs?: number;
  /** Maximum pixel dimension for keyframe exports. Default: 640px. */
  maxDimension?: number;
  /** JPEG image compression quality [0..1]. Default: 0.8. */
  imageQuality?: number;
}

export interface KeyframeSample {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
  isCropped: boolean;
  triggerReason: 'stability' | 'interval' | 'manual';
  timestamp: number;
}

/**
 * FrameSampler handles the dual-frequency bridge between the 60 FPS local camera/WASM loop
 * and the 0.2–0.5 FPS cloud multimodal API.
 *
 * It monitors optical stability via bounding box motion vector tracking, triggering
 * keyframe extraction as soon as the user holds the camera steady over food,
 * with an automatic 2–3 second interval fallback.
 */
export class FrameSampler {
  private readonly intervalMs: number;
  private readonly cooldownMs: number;
  private readonly motionThreshold: number;
  private readonly minStabilityDurationMs: number;
  private readonly maxDimension: number;
  private readonly imageQuality: number;

  private lastTriggerTime = 0;
  private stableSince: number | null = null;
  private prevCentroid: { x: number; y: number } | null = null;
  private prevArea = 0;

  constructor(options: FrameSamplerOptions = {}) {
    this.intervalMs = options.intervalMs ?? 2500;
    this.cooldownMs = options.cooldownMs ?? 2000;
    this.motionThreshold = options.motionThreshold ?? 0.025;
    this.minStabilityDurationMs = options.minStabilityDurationMs ?? 600;
    this.maxDimension = options.maxDimension ?? 640;
    this.imageQuality = options.imageQuality ?? 0.8;
  }

  /**
   * Evaluates the motion vector of detected food on the current 60 FPS frame.
   * Returns a trigger reason if sampling conditions are met, or null otherwise.
   */
  shouldSample(primaryBox: BoundingBox2D | null, timestamp: number): 'stability' | 'interval' | null {
    const elapsedSinceLast = timestamp - this.lastTriggerTime;

    // Must satisfy cooldown period (at most 0.5 FPS cloud sampling)
    if (elapsedSinceLast < this.cooldownMs) {
      return null;
    }

    // Interval fallback: if elapsed exceeds interval (e.g. 2.5s) and food is present
    if (primaryBox && elapsedSinceLast >= this.intervalMs) {
      return 'interval';
    }

    if (!primaryBox) {
      this.resetStability();
      return null;
    }

    // Centroid in normalized coordinates
    const curCentroid = {
      x: primaryBox.x + primaryBox.w / 2,
      y: primaryBox.y + primaryBox.h / 2,
    };
    const curArea = primaryBox.w * primaryBox.h;

    if (this.prevCentroid === null) {
      this.prevCentroid = curCentroid;
      this.prevArea = curArea;
      this.stableSince = timestamp;
      return null;
    }

    // Compute normalized motion vector magnitude
    const dx = curCentroid.x - this.prevCentroid.x;
    const dy = curCentroid.y - this.prevCentroid.y;
    const distance = Math.hypot(dx, dy);
    const areaDelta = Math.abs(curArea - this.prevArea) / Math.max(0.001, this.prevArea);

    this.prevCentroid = curCentroid;
    this.prevArea = curArea;

    // Motion vector check: centroid movement and area shift are both below threshold
    const isMotionLow = distance < this.motionThreshold && areaDelta < this.motionThreshold * 2;

    if (isMotionLow) {
      if (this.stableSince === null) {
        this.stableSince = timestamp;
      } else if (timestamp - this.stableSince >= this.minStabilityDurationMs) {
        return 'stability';
      }
    } else {
      this.stableSince = null;
    }

    return null;
  }

  /**
   * Extracts a downscaled keyframe from the video element.
   * If a target bounding box is supplied, crops tightly around the food item with padding.
   */
  async extractKeyframe(
    video: HTMLVideoElement,
    targetBox?: BoundingBox2D | null,
    reason: 'stability' | 'interval' | 'manual' = 'manual',
    mirror = false,
  ): Promise<KeyframeSample | null> {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    let sx = 0;
    let sy = 0;
    let sWidth = vw;
    let sHeight = vh;
    let isCropped = false;

    if (targetBox) {
      // Add 15% context padding around the detected food item
      const padW = targetBox.w * 0.15;
      const padH = targetBox.h * 0.15;

      const normX = Math.max(0, targetBox.x - padW);
      const normY = Math.max(0, targetBox.y - padH);
      const normW = Math.min(1 - normX, targetBox.w + padW * 2);
      const normH = Math.min(1 - normY, targetBox.h + padH * 2);

      sx = Math.round(normX * vw);
      sy = Math.round(normY * vh);
      sWidth = Math.round(normW * vw);
      sHeight = Math.round(normH * vh);
      isCropped = true;
    }

    // Downscale while preserving aspect ratio
    const scale = Math.min(1, this.maxDimension / Math.max(sWidth, sHeight));
    const targetW = Math.max(1, Math.round(sWidth * scale));
    const targetH = Math.max(1, Math.round(sHeight * scale));

    const timestamp = performance.now();
    this.lastTriggerTime = timestamp;
    this.resetStability();

    // Prefer OffscreenCanvas to avoid DOM overhead
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(targetW, targetH);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      if (mirror) {
        ctx.translate(targetW, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, targetW, targetH);

      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: this.imageQuality });
      const dataUrl = await this.blobToDataUrl(blob);

      return {
        blob,
        dataUrl,
        width: targetW,
        height: targetH,
        isCropped,
        triggerReason: reason,
        timestamp,
      };
    }

    // Fallback for detached canvas
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    if (mirror) {
      ctx.translate(targetW, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, targetW, targetH);

    return new Promise((resolve) => {
      canvas.toBlob(
        async (blob) => {
          if (!blob) {
            resolve(null);
            return;
          }
          const dataUrl = await this.blobToDataUrl(blob);
          resolve({
            blob,
            dataUrl,
            width: targetW,
            height: targetH,
            isCropped,
            triggerReason: reason,
            timestamp,
          });
        },
        'image/jpeg',
        this.imageQuality,
      );
    });
  }

  private resetStability(): void {
    this.stableSince = null;
    this.prevCentroid = null;
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });
  }
}
