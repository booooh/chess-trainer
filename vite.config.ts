/// <reference types="vitest/config" />
import { statSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The Maia model's real size, for accurate download progress (see src/workers/download.ts).
const maiaModelBytes = statSync('node_modules/maia3-js/models/maia3_5m.onnx').size;

export default defineConfig({
  define: { __MAIA_MODEL_BYTES__: JSON.stringify(maiaModelBytes) },
  worker: { format: 'es' },
  resolve: {
    // maia3-js imports the default ONNX runtime build, which bundles WebGPU support
    // (29.5 MB .wasm). We only run on CPU, and the CPU-only build is half the size.
    alias: [{ find: /^onnxruntime-web$/, replacement: 'onnxruntime-web/wasm' }],
  },
  // onnxruntime-web finds its .wasm files relative to its own module URL; Vite's dependency
  // pre-bundling moves the module and breaks that, so leave it un-bundled in dev.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Large ML files (model, ONNX runtime .wasm) are cached on demand, not precached
        // on install: precaching would download them before the app is even used.
        globIgnores: ['**/*.onnx', '**/*.wasm'],
      },
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Chess Trainer',
        short_name: 'Chess Trainer',
        description: 'Chess training against human-like opponents, with hints that explain the whole line.',
        theme_color: '#2b2622',
        background_color: '#2b2622',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: true,
  },
});
