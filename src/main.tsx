import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { initSentry } from '@/lib/sponsors/sentry/sentry';
import { defaultPlugins, registerPlugins } from '@/lib/sponsors';

// 1. Telemetry first so boot errors are captured (no-op without a DSN).
initSentry();

// 2. Sponsor plugins boot in the background; a failing plugin is skipped, never fatal.
void registerPlugins(defaultPlugins());

// 3. Render.
const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
