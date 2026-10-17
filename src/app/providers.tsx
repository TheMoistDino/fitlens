import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { sponsorBus } from '@/lib/sponsors';

type Tone = 'info' | 'warn' | 'error';
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {});
export const useToast = () => useContext(ToastContext);

/**
 * App-level providers. Also translates system bus events (device/perf) into user-facing toasts,
 * so hardware problems surface as a gentle message instead of a crash.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const push = useCallback((message: string, tone: Tone = 'info') => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  useEffect(() => {
    const offs = [
      sponsorBus.on(
        'device:status',
        ({ adapter, status, detail }) => {
          if (adapter === 'null') return;
          if (status === 'connected') push('Smart glasses connected', 'info');
          else if (status === 'disconnected') push('Smart glasses disconnected — reconnecting…', 'warn');
          else if (status === 'error' || status === 'unsupported') push(`Glasses unavailable: ${detail ?? status}. Using browser HUD.`, 'warn');
        },
        { owner: 'ui:toasts' },
      ),
      sponsorBus.on('perf:frame-drop', ({ fps }) => push(`Tracking is running slow (${Math.round(fps)} FPS)`, 'warn'), { owner: 'ui:toasts' }),
    ];
    return () => offs.forEach((off) => off());
  }, [push]);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto max-w-md rounded-xl px-4 py-2 text-sm shadow-lg ${
              t.tone === 'error' ? 'bg-rose-600 text-white' : t.tone === 'warn' ? 'bg-amber-500 text-black' : 'bg-neutral-800 text-neutral-100'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
