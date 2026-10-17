import { useEffect, useState, type ReactNode } from 'react';
import type { CameraError, CameraStatus } from '@/services/camera/useCameraStream';
import { Button, ErrorCard } from './primitives';

export const DEFAULT_CAMERA_VIEWPORT_CLASS =
  'relative mx-auto w-full h-[calc(100dvh-4.5rem)] md:h-[calc(100dvh-5.5rem)] overflow-hidden rounded-2xl md:rounded-3xl bg-black shadow-2xl';

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  error: CameraError | null;
  mirror: boolean;
  onRetry: () => void;
  /** AR layer + HUD overlays, stacked over the video. */
  children?: ReactNode;
  /** Optional container styling class (defaults to expansive full screen height without letterboxing) */
  className?: string;
  /** Optional container style */
  style?: React.CSSProperties;
  /** Optional container style alias */
  containerStyle?: React.CSSProperties;
}

/**
 * Expansive full-screen Camera Viewport.
 * Fills available vertical screen space between the navigation bars without letterboxing.
 * Renders video with object-cover and overlays AR layers & floating HUDs.
 */
export function CameraViewport({
  videoRef,
  status,
  error,
  mirror,
  onRetry,
  children,
  className = DEFAULT_CAMERA_VIEWPORT_CLASS,
  style,
  containerStyle,
}: Props) {
  const [aspect, setAspect] = useState(16 / 9);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const update = () => {
      if (v.videoWidth && v.videoHeight) {
        setAspect(v.videoWidth / v.videoHeight);
      }
    };
    v.addEventListener('loadedmetadata', update);
    v.addEventListener('resize', update);
    return () => {
      v.removeEventListener('loadedmetadata', update);
      v.removeEventListener('resize', update);
    };
  }, [videoRef]);

  const mergedStyle = containerStyle ?? style;

  return (
    <div className={className} style={mergedStyle} data-aspect={aspect}>
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ transform: mirror ? 'scaleX(-1)' : undefined }}
        playsInline
        muted
        autoPlay
      />
      {children}
      {status === 'requesting' && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/60 text-sm text-neutral-400">
          Waiting for camera permission…
        </div>
      )}
      {status === 'error' && error && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/75 p-4">
          <ErrorCard
            title="Camera unavailable"
            message={error.message}
            action={
              <Button variant="secondary" onClick={onRetry}>
                Try again
              </Button>
            }
          />
        </div>
      )}
      {status === 'idle' && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/60">
          <Button onClick={onRetry}>Start camera</Button>
        </div>
      )}
    </div>
  );
}
