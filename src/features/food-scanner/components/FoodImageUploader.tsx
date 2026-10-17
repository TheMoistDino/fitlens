import { useCallback, useEffect, useRef, useState, type DragEvent, type ChangeEvent } from 'react';
import { processImageForNutrition, isValidImageFile, type ProcessedImageResult } from '../services/imageProcessor';
import { Button } from '@/ui/primitives';

export interface FoodImageUploaderProps {
  onImageProcessed: (result: ProcessedImageResult) => void;
  onClear?: () => void;
  analyzing?: boolean;
  previewUrl?: string | null;
  disabled?: boolean;
}

export function FoodImageUploader({
  onImageProcessed,
  onClear,
  analyzing = false,
  previewUrl = null,
  disabled = false,
}: FoodImageUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleProcessFile = useCallback(
    async (file: File | Blob) => {
      setErrorMessage(null);

      if (!isValidImageFile(file)) {
        setErrorMessage('Please select a valid image file (JPEG, PNG, WebP, or HEIC).');
        return;
      }

      setIsProcessing(true);
      try {
        const processed = await processImageForNutrition(file);
        onImageProcessed(processed);
      } catch (err) {
        console.error('[FoodImageUploader] Processing error:', err);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to process image');
      } finally {
        setIsProcessing(false);
      }
    },
    [onImageProcessed],
  );

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleProcessFile(file);
    }
    // Reset input value so same file can be re-selected if needed
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && !analyzing) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (disabled || analyzing) return;

    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleProcessFile(file);
    }
  };

  // Clipboard paste support (paste image from clipboard)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (disabled || analyzing) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            void handleProcessFile(file);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [analyzing, disabled, handleProcessFile]);

  const handleTriggerUpload = () => {
    if (!disabled && !analyzing && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleClearImage = () => {
    setErrorMessage(null);
    onClear?.();
  };

  return (
    <div className="w-full space-y-3">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled || analyzing}
      />

      {/* Upload Dropzone or Image Preview */}
      {!previewUrl ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleTriggerUpload}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleTriggerUpload();
            }
          }}
          className={`relative flex min-h-[260px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center transition-all ${
            isDragOver
              ? 'border-emerald-400 bg-emerald-500/10'
              : 'border-neutral-700 bg-neutral-900/60 hover:border-neutral-500 hover:bg-neutral-900/90'
          } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
        >
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-800 text-neutral-300 shadow-inner">
              <svg className="h-7 w-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>

            <div>
              <p className="text-sm font-semibold text-neutral-200">
                {isProcessing ? 'Optimizing photo...' : 'Upload a meal photo'}
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                Drag and drop your food picture here, paste from clipboard, or click to browse
              </p>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-neutral-500">
              <span>Supports JPEG, PNG, WebP, HEIC</span>
              <span>•</span>
              <span>Auto-optimized client-side</span>
            </div>

            <Button
              type="button"
              variant="secondary"
              className="mt-2 text-xs"
              disabled={isProcessing || analyzing}
            >
              {isProcessing ? 'Processing...' : 'Browse Photo'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950">
          {/* Image display */}
          <div className="relative flex max-h-[380px] w-full items-center justify-center overflow-hidden bg-black/60">
            <img
              src={previewUrl}
              alt="Uploaded meal"
              className="max-h-[380px] w-auto object-contain transition-all"
            />

            {/* Analyzing overlay */}
            {analyzing && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-xs">
                <div className="h-10 w-10 animate-spin rounded-full border-3 border-emerald-400 border-t-transparent" />
                <p className="mt-3 text-sm font-semibold text-emerald-300">Analyzing nutritional profile…</p>
                <p className="mt-1 text-xs text-neutral-400">StepFun multimodal AI estimating calories & macros</p>
              </div>
            )}
          </div>

          {/* Action bar under image */}
          <div className="flex items-center justify-between border-t border-neutral-800 bg-neutral-900/90 px-4 py-2.5">
            <span className="text-xs text-neutral-400">Photo ready for caloric analysis</span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                className="text-xs"
                onClick={handleTriggerUpload}
                disabled={analyzing}
              >
                Choose another
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="text-xs"
                onClick={handleClearImage}
                disabled={analyzing}
              >
                Clear
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Error display */}
      {errorMessage && (
        <div className="flex items-center justify-between rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="ml-2 font-bold hover:text-white"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
