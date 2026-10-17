/**
 * Image processing utilities for FitLens Food Scanner.
 *
 * Handles client-side validation, downscaling, compression, and data URL generation
 * to ensure rapid uploads and adherence to the server proxy's 4MB payload limits.
 */

export interface ProcessedImageResult {
  dataUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
  mimeType: string;
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

  return {
    dataUrl,
    width: targetWidth,
    height: targetHeight,
    sizeBytes: estimatedBytes,
    mimeType: 'image/jpeg',
  };
}
