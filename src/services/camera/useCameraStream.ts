import { useCallback, useEffect, useRef, useState } from 'react';
import { frameProfiler } from '@/lib/sponsors/sentry/frameProfiler';

/**
 * useCameraStream — getUserMedia + a high-frequency frame loop.
 *
 * - Uses `requestVideoFrameCallback` when available: it fires exactly once per *decoded* camera
 *   frame (no wasted inference on duplicate frames) and gives us `mediaTime`.
 * - Falls back to `requestAnimationFrame` + `video.currentTime` de-duplication.
 * - `onFrame` is held in a ref so swapping the callback never tears down the stream or loop.
 * - The callback runs synchronously on the main thread; its duration feeds the Sentry frame profiler.
 * - Releases the camera on unmount and while the tab is hidden (battery + privacy), and resumes on return.
 */

export type CameraStatus = 'idle' | 'requesting' | 'streaming' | 'error';
export type CameraErrorKind = 'permission-denied' | 'not-found' | 'in-use' | 'insecure-context' | 'unsupported' | 'unknown';

export interface CameraError {
  kind: CameraErrorKind;
  message: string;
}

export interface FrameInfo {
  /** High-res timestamp (ms) — pass this to MediaPipe `detectForVideo`. */
  now: number;
  /** Presentation time of the frame in seconds, when known. */
  mediaTime: number;
  frameIndex: number;
}

export type FrameCallback = (video: HTMLVideoElement, info: FrameInfo) => void;

export interface UseCameraStreamOptions {
  facingMode?: 'user' | 'environment';
  width?: number;
  height?: number;
  frameRate?: number;
  autoStart?: boolean;
  onFrame?: FrameCallback;
}

export interface UseCameraStreamResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  error: CameraError | null;
  facingMode: 'user' | 'environment';
  start: () => Promise<void>;
  stop: () => void;
  switchCamera: () => Promise<void>;
}

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

function classifyError(err: unknown): CameraError {
  const name = err instanceof DOMException ? err.name : '';
  const message = err instanceof Error ? err.message : String(err);
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return { kind: 'permission-denied', message: 'Camera permission was denied. Enable it in your browser settings.' };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return { kind: 'not-found', message: 'No compatible camera was found.' };
    case 'NotReadableError':
    case 'AbortError':
      return { kind: 'in-use', message: 'The camera is in use by another app.' };
    default:
      return { kind: 'unknown', message };
  }
}

export function useCameraStream(options: UseCameraStreamOptions = {}): UseCameraStreamResult {
  const { width = 1280, height = 720, frameRate = 60, autoStart = true } = options;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopHandleRef = useRef<{ kind: 'rvfc' | 'raf'; id: number } | null>(null);
  const onFrameRef = useRef<FrameCallback | undefined>(options.onFrame);
  const wantStreamingRef = useRef(false);
  /** Bumped on every open/stop so a slow permission prompt can't attach a stale stream (StrictMode, fast flips). */
  const requestIdRef = useRef(0);

  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<CameraError | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>(options.facingMode ?? 'user');

  // Keep the latest callback without restarting anything.
  useEffect(() => {
    onFrameRef.current = options.onFrame;
  }, [options.onFrame]);

  const stopLoop = useCallback(() => {
    const video = videoRef.current as VideoWithRvfc | null;
    const handle = loopHandleRef.current;
    if (!handle) return;
    if (handle.kind === 'rvfc') video?.cancelVideoFrameCallback?.(handle.id);
    else cancelAnimationFrame(handle.id);
    loopHandleRef.current = null;
  }, []);

  const startLoop = useCallback(() => {
    const video = videoRef.current as VideoWithRvfc | null;
    if (!video) return;
    stopLoop();

    let frameIndex = 0;
    let lastTime = -1;

    const runFrame = (now: number, mediaTime: number) => {
      const cb = onFrameRef.current;
      if (!cb || video.readyState < 2) return;
      const t0 = performance.now();
      try {
        cb(video, { now, mediaTime, frameIndex: frameIndex++ });
      } catch (err) {
        // A throwing ML step must never kill the loop.
        frameProfiler.reportError(err);
      }
      frameProfiler.record(performance.now() - t0);
    };

    if (typeof video.requestVideoFrameCallback === 'function') {
      const tick = (now: number, meta: { mediaTime: number }) => {
        runFrame(now, meta.mediaTime);
        loopHandleRef.current = { kind: 'rvfc', id: video.requestVideoFrameCallback!(tick) };
      };
      loopHandleRef.current = { kind: 'rvfc', id: video.requestVideoFrameCallback(tick) };
    } else {
      const tick = (now: number) => {
        if (video.currentTime !== lastTime) {
          lastTime = video.currentTime;
          runFrame(now, video.currentTime);
        }
        loopHandleRef.current = { kind: 'raf', id: requestAnimationFrame(tick) };
      };
      loopHandleRef.current = { kind: 'raf', id: requestAnimationFrame(tick) };
    }
  }, [stopLoop]);

  const releaseStream = useCallback(() => {
    stopLoop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [stopLoop]);

  const openStream = useCallback(
    async (mode: 'user' | 'environment') => {
      if (!window.isSecureContext) {
        setError({ kind: 'insecure-context', message: 'Camera requires HTTPS (or localhost).' });
        setStatus('error');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError({ kind: 'unsupported', message: 'This browser does not support camera access.' });
        setStatus('error');
        return;
      }

      const requestId = ++requestIdRef.current;
      releaseStream();
      setStatus('requesting');
      setError(null);

      const ideal: MediaStreamConstraints = {
        audio: false,
        video: { facingMode: mode, width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: frameRate } },
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(ideal);
      } catch (err) {
        // Retry once with relaxed constraints (common on laptops lacking a rear cam / 60fps).
        const classified = classifyError(err);
        if (classified.kind === 'permission-denied') {
          setError(classified);
          setStatus('error');
          return;
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } catch (err2) {
          if (requestId !== requestIdRef.current) return;
          setError(classifyError(err2));
          setStatus('error');
          return;
        }
      }

      // The component may have unmounted / stopped / re-requested while we awaited permission.
      if (!wantStreamingRef.current || requestId !== requestIdRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        releaseStream();
        return;
      }
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      try {
        await video.play();
      } catch {
        // Autoplay can be blocked until a gesture; the stream is still attached and will play on interaction.
      }
      setStatus('streaming');
      startLoop();
    },
    [frameRate, height, width, releaseStream, startLoop],
  );

  const start = useCallback(async () => {
    wantStreamingRef.current = true;
    await openStream(facingMode);
  }, [facingMode, openStream]);

  const stop = useCallback(() => {
    wantStreamingRef.current = false;
    requestIdRef.current++;
    releaseStream();
    setStatus('idle');
  }, [releaseStream]);

  const switchCamera = useCallback(async () => {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    if (wantStreamingRef.current) await openStream(next);
  }, [facingMode, openStream]);

  // Auto start + cleanup on unmount.
  useEffect(() => {
    if (autoStart) void start();
    return () => {
      wantStreamingRef.current = false;
      requestIdRef.current++;
      releaseStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  // Release the camera while the tab is hidden; resume on return.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        if (streamRef.current) releaseStream();
      } else if (wantStreamingRef.current && !streamRef.current) {
        void openStream(facingMode);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [facingMode, openStream, releaseStream]);

  return { videoRef, status, error, facingMode, start, stop, switchCamera };
}
