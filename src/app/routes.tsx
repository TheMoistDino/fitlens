import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

export interface AppRoute {
  path: string;
  label: string;
  Component: LazyExoticComponent<ComponentType>;
}

/**
 * Each feature is code-split: the MediaPipe + Three.js chunks only load when a
 * camera page is opened, keeping the dashboard and first paint light.
 */
export const routes: AppRoute[] = [
  { path: '/scan', label: 'Food Scanner', Component: lazy(() => import('@/routes/FoodScannerRoute')) },
  { path: '/workout', label: 'Workout Tracker', Component: lazy(() => import('@/features/workout/WorkoutPage')) },
  { path: '/dashboard', label: 'Dashboard', Component: lazy(() => import('@/features/dashboard/DashboardPage')) },
];

export const DEFAULT_ROUTE = '/workout';
