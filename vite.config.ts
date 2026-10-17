import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // Let HTTPS tunnels (cloudflared / ngrok) reach the dev server for on-phone camera testing.
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app'],
    // Required for Sentry JS self-profiling (browserProfilingIntegration).
    headers: { 'Document-Policy': 'js-profiling' },
    // Secrets live in the Hono proxy (server/index.ts); the browser only ever hits /api.
    proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 8787}` },
  },
  build: {
    sourcemap: true, // Sentry symbolication
    chunkSizeWarningLimit: 1200, // three + drei is one lazily loaded chunk
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', '@react-three/fiber', '@react-three/drei'],
          mediapipe: ['@mediapipe/tasks-vision'],
        },
      },
    },
  },
});
