import { Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import { AppProviders } from '@/app/providers';
import { DEFAULT_ROUTE, routes } from '@/app/routes';
import { NavBar } from '@/ui/NavBar';
import { Button, ErrorCard } from '@/ui/primitives';

function RouteFallback() {
  return <div className="grid h-64 place-items-center text-sm text-neutral-500">Loading…</div>;
}

/**
 * Each route gets its own error boundary: a WASM/WebGL crash on the Workout page
 * never takes down navigation or the Dashboard.
 */
function RouteBoundary({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Sentry.ErrorBoundary
      beforeCapture={(scope) => scope.setTag('route', label)}
      fallback={({ error, resetError }) => (
        <ErrorCard
          title={`${label} hit a problem`}
          message={error instanceof Error ? error.message : 'Unexpected error'}
          action={<Button variant="secondary" onClick={resetError}>Reload section</Button>}
        />
      )}
    >
      <Suspense fallback={<RouteFallback />}>{children}</Suspense>
    </Sentry.ErrorBoundary>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProviders>
        <div className="min-h-dvh">
          <NavBar />
          <main className="mx-auto max-w-5xl px-4 pb-28 pt-4 md:pb-10">
            <Routes>
              {routes.map(({ path, label, Component }) => (
                <Route
                  key={path}
                  path={path}
                  element={
                    <RouteBoundary label={label}>
                      <Component />
                    </RouteBoundary>
                  }
                />
              ))}
              <Route path="*" element={<Navigate to={DEFAULT_ROUTE} replace />} />
            </Routes>
          </main>
        </div>
      </AppProviders>
    </BrowserRouter>
  );
}
