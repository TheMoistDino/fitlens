/**
 * Image processing utilities for FitLens Food Scanner.
 *
 * Handles client-side validation, downscaling, compression, and data URL generation
 * to ensure rapid uploads and adherence to the server proxy's 4MB payload limits.
 */

export interface VisualAnalysisResult {
  dominantColorRgb: { r: number; g: number; b: number };
  dominantColorHex: string;
  brightness: number;
  saturation: number;
  isLightLiquid: boolean;
  isDarkLiquid: boolean;
  isCanLike: boolean;
  detectedCategoryHint: 'dairy' | 'dark-brown' | 'juice' | 'water' | 'canned' | 'fruit' | 'meal';
  detectedText?: string;
}

export interface ProcessedImageResult {
  dataUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
  mimeType: string;
  imageElement?: HTMLImageElement;
  visuals?: VisualAnalysisResult;
}

export interface ImageProcessingOptions {
  maxDimension?: number;
  quality?: number;
  maxSizeBytes?: number;
}

const DEFAULT_MAX_DIMENSION = 1280; // Optimal balance for StepFun multimodal vision tokens and bandwidth
const DEFAULT_QUALITY = 0.82;
const MAX_PAYLOAD_BYTES = 3_500_000; // Defensive limit well below the 4MB proxy limit

const ACCEPTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
]);

/**
 * Validates whether a given file is a supported image format.
 */
export function isValidImageFile(file: File | Blob): boolean {
  if (!file) return false;
  if (file.type && ACCEPTED_IMAGE_TYPES.has(file.type.toLowerCase())) {
    return true;
  }
  // Fallback check on file name if type is missing (e.g., some Android or desktop pickers)
  if ('name' in file && typeof file.name === 'string') {
    return /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(file.name);
  }
  return false;
}

/**
 * Loads an image Blob into an HTMLImageElement safely.
 */
function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to decode image file. Please verify the image is not corrupted.'));
    };

    img.src = objectUrl;
  });
}

/**
 * Processes an uploaded food image:
 * 1. Validates image MIME type.
 * 2. Downscales maintaining aspect ratio to fit within maxDimension.
 * 3. Compresses to JPEG to minimize transmission latency and payload size.
 * 4. Performs defensive re-compression if base64 size approaches the server ceiling.
 */
export async function processImageForNutrition(
  file: File | Blob,
  options: ImageProcessingOptions = {},
): Promise<ProcessedImageResult> {
  if (!isValidImageFile(file)) {
    throw new Error('Unsupported file type. Please upload a JPEG, PNG, WebP, or HEIC image.');
  }

  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const quality = options.quality ?? DEFAULT_QUALITY;
  const maxSizeBytes = options.maxSizeBytes ?? MAX_PAYLOAD_BYTES;

  const img = await loadImageElement(file);
  const origWidth = img.naturalWidth || img.width;
  const origHeight = img.naturalHeight || img.height;

  if (origWidth === 0 || origHeight === 0) {
    throw new Error('Image has zero dimensions and cannot be processed.');
  }

  // Calculate scaled dimensions
  let scale = 1;
  if (origWidth > maxDimension || origHeight > maxDimension) {
    scale = Math.min(maxDimension / origWidth, maxDimension / origHeight);
  }

  const targetWidth = Math.max(1, Math.round(origWidth * scale));
  const targetHeight = Math.max(1, Math.round(origHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to acquire 2D canvas rendering context.');
  }

  // Draw image to canvas
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  // Initial compression
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  let estimatedBytes = Math.round((dataUrl.length * 3) / 4);

  // Defensive fallback pass if still over safety ceiling
  if (estimatedBytes > maxSizeBytes) {
    const lowerQuality = Math.max(0.5, quality - 0.25);
    dataUrl = canvas.toDataURL('image/jpeg', lowerQuality);
    estimatedBytes = Math.round((dataUrl.length * 3) / 4);
  }

  const visuals = await analyzeImageVisuals(canvas);

  return {
    dataUrl,
    width: targetWidth,
    height: targetHeight,
    sizeBytes: estimatedBytes,
    mimeType: 'image/jpeg',
    imageElement: img,
    visuals,
  };
}

/**
 * Analyzes visual properties of an image canvas:
 * 1. Dominant color and saturation in the central food/beverage region.
 * 2. High brightness + low saturation -> Milky / Dairy liquid.
 * 3. Low brightness -> Dark drink (Coffee / Tea / Cola).
 * 4. Tall cylinder aspect ratio -> Canned drink / bottle.
 * 5. Runs native Chromium window.TextDetector (if available) to read labels on cans.
 */
export async function analyzeImageVisuals(canvas: HTMLCanvasElement): Promise<VisualAnalysisResult> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const w = canvas.width;
  const h = canvas.height;

  let rTotal = 0;
  let gTotal = 0;
  let bTotal = 0;
  let sampleCount = 0;

  if (ctx && w > 0 && h > 0) {
    // Sample the center 60% of the image (where the food or container is placed)
    const startX = Math.round(w * 0.2);
    const startY = Math.round(h * 0.2);
    const sampleW = Math.max(1, Math.round(w * 0.6));
    const sampleH = Math.max(1, Math.round(h * 0.6));

    try {
      const imgData = ctx.getImageData(startX, startY, sampleW, sampleH).data;
      // Step through every 16th pixel for sub-millisecond execution
      for (let i = 0; i < imgData.length; i += 16 * 4) {
        const r = imgData[i] ?? 0;
        const g = imgData[i + 1] ?? 0;
        const b = imgData[i + 2] ?? 0;
        rTotal += r;
        gTotal += g;
        bTotal += b;
        sampleCount++;
      }
    } catch {
      // Ignore security errors if cross-origin canvas tainted
    }
  }

  const rAvg = sampleCount > 0 ? Math.round(rTotal / sampleCount) : 128;
  const gAvg = sampleCount > 0 ? Math.round(gTotal / sampleCount) : 128;
  const bAvg = sampleCount > 0 ? Math.round(bTotal / sampleCount) : 128;

  const brightness = Math.round((rAvg + gAvg + bAvg) / 3);
  const max = Math.max(rAvg, gAvg, bAvg);
  const min = Math.min(rAvg, gAvg, bAvg);
  const delta = max - min;
  const saturation = max === 0 ? 0 : Number((delta / max).toFixed(2));

  const hexComponent = (c: number) => c.toString(16).padStart(2, '0');
  const dominantColorHex = `#${hexComponent(rAvg)}${hexComponent(gAvg)}${hexComponent(bAvg)}`;

  // Aspect ratio check for tall cylinder (standard 12oz / 16oz can or bottle)
  const isCanLike = h / w > 1.3;

  // Native OCR text extraction (Chromium TextDetector API)
  let detectedText: string | undefined;
  if (typeof window !== 'undefined' && 'TextDetector' in window) {
    try {
      const detector = new (window as any).TextDetector();
      const results = await detector.detect(canvas);
      const extracted = results
        .map((r: any) => r.rawValue?.trim())
        .filter(Boolean);
      if (extracted.length > 0) {
        detectedText = extracted.join(' ');
      }
    } catch {
      /* ignore text detector failure */
    }
  }

  // Classification hints
  const isLightLiquid = brightness > 175 && saturation < 0.28;
  const isDarkLiquid = brightness < 85;

  let detectedCategoryHint: VisualAnalysisResult['detectedCategoryHint'] = 'meal';

  const textNorm = (detectedText ?? '').toLowerCase();
  const CAN_KEYWORDS = [
    'celsius',
    'coke',
    'cola',
    'pepsi',
    'red bull',
    'monster',
    'dr pepper',
    'sprite',
    'poppi',
    'water',
    'tea',
    'zero',
    'sugar',
    'seltzer',
    'oz',
    'fl oz',
    'energy',
    'can',
  ];
  const hasCanText = CAN_KEYWORDS.some((kw) => textNorm.includes(kw));

  if (hasCanText || (isCanLike && (isLightLiquid || isDarkLiquid || saturation > 0.4))) {
    detectedCategoryHint = 'canned';
  } else if (isLightLiquid) {
    detectedCategoryHint = 'dairy';
  } else if (isDarkLiquid) {
    detectedCategoryHint = 'dark-brown';
  } else if (rAvg > 160 && gAvg > 90 && bAvg < 100 && saturation > 0.35) {
    detectedCategoryHint = 'juice';
  } else if (gAvg > rAvg && gAvg > bAvg && saturation > 0.3) {
    detectedCategoryHint = 'fruit';
  }

  return {
    dominantColorRgb: { r: rAvg, g: gAvg, b: bAvg },
    dominantColorHex,
    brightness,
    saturation,
    isLightLiquid,
    isDarkLiquid,
    isCanLike,
    detectedCategoryHint,
    detectedText,
  };
}
