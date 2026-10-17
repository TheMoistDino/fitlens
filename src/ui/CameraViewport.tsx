import { useEffect, useState, type ReactNode } from 'react';
import type { CameraError, CameraStatus } from '@/services/camera/useCameraStream';
import { Button, ErrorCard } from './primitives';

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  error: CameraError | null;
  mirror: boolean;
  onRetry: () => void;
  /** AR layer + HUD overlays, stacked over the video at the same aspect ratio. */
  children?: ReactNode;
}

/**
 * Locks the container to the camera's real aspect ratio so normalised ML coords map 1:1
 * onto the Three.js overlay (no object-cover cropping drift).
 */
export function CameraViewport({ videoRef, status, error, mirror, onRetry, children }: Props) {
  const [aspect, setAspect] = useState(16 / 9);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const update = () => v.videoWidth && v.videoHeight && setAspect(v.videoWidth / v.videoHeight);
    v.addEventListener('loadedmetadata', update);
    v.addEventListener('resize', update);
    return () => {
      v.removeEventListener('loadedmetadata', update);
      v.removeEventListener('resize', update);
    };
  }, [videoRef]);

  return (
    // Taller cap in landscape (phones held sideways have little vertical room to spare).
    <div
      className="relative mx-auto w-full max-h-[var(--cam-vh)] overflow-hidden rounded-2xl bg-black [--cam-vh:62vh] landscape:[--cam-vh:78vh]"
      style={{ aspectRatio: aspect, maxWidth: `calc(var(--cam-vh) * ${aspect})` }}
    >
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-fill"
        style={{ transform: mirror ? 'scaleX(-1)' : undefined }}
        playsInline
        muted
        autoPlay
      />
      {status === 'streaming' && children}
      {status === 'requesting' && (
        <div className="absolute inset-0 grid place-items-center text-sm text-neutral-400">Waiting for camera permission…</div>
      )}
      {status === 'error' && error && (
        <div className="absolute inset-0 grid place-items-center p-4">
          <ErrorCard title="Camera unavailable" message={error.message} action={<Button variant="secondary" onClick={onRetry}>Try again</Button>} />
        </div>
      )}
      {status === 'idle' && (
        <div className="absolute inset-0 grid place-items-center">
          <Button onClick={onRetry}>Start camera</Button>
        </div>
      )}
    </div>
  );
}
