import { useSyncExternalStore } from 'react';

const query = '(orientation: portrait)';

function subscribe(cb: () => void) {
  const mql = window.matchMedia?.(query);
  mql?.addEventListener('change', cb);
  return () => mql?.removeEventListener('change', cb);
}

/** Live device orientation (re-renders on rotate). */
export function useIsPortrait(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia?.(query).matches ?? false);
}

/**
 * Overlay prompting the user to rotate the phone when an exercise tracks better in landscape
 * (e.g. push-ups: a lying body fills a wide frame, so landmarks are bigger and steadier).
 * Non-blocking — the set still runs if they ignore it.
 */
export function RotateHint() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-1/3 flex justify-center px-4">
      <div className="flex items-center gap-3 rounded-2xl bg-black/75 px-4 py-3 text-white shadow-xl backdrop-blur">
        <span aria-hidden className="inline-block animate-[spin_2.5s_ease-in-out_infinite] text-3xl">📱</span>
        <div className="text-sm">
          <p className="font-bold">Turn your phone sideways</p>
          <p className="text-xs text-neutral-300">Landscape tracks push-ups much better</p>
        </div>
      </div>
    </div>
  );
}
