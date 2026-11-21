/// <reference types="vitest/config" />
import { readFileSync, statSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The Maia model's real size, for accurate download progress (see src/workers/download.ts).
const maiaModelBytes = statSync('node_modules/maia3-js/models/maia3_5m.onnx').size;

/**
 * Stockfish 19 Lite single-threaded (ADR-0002), published as
 * engine/stockfish-<version>-lite-single.{js,wasm}. stockfish.js finds its .wasm by swapping
 * its own URL's ".js" for ".wasm", so the two files must keep matching names: Vite's
 * content-hashed asset names would break that. (Passing the .wasm URL in the worker URL's
 * #hash isn't reliable either: when the service worker serves the script from its cache, the
 * worker's location loses the hash.) The version in the name busts caches on upgrades.
 */
const stockfishVersion: string = JSON.parse(readFileSync('node_modules/stockfish/package.json', 'utf8')).version;
const stockfishPath = `engine/stockfish-${stockfishVersion}-lite-single`;
const stockfishFiles: Record<string, { source: string; type: string }> = {
  [`${stockfishPath}.js`]: { source: 'node_modules/stockfish/bin/stockfish-19-lite-single.js', type: 'text/javascript' },
  [`${stockfishPath}.wasm`]: { source: 'node_modules/stockfish/bin/stockfish-19-lite-single.wasm', type: 'application/wasm' },
};

function stockfishEngine(): Plugin {
  return {
    name: 'stockfish-engine',
    // `vite dev`: serve the files straight from node_modules.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = stockfishFiles[(req.url ?? '').split(/[?#]/)[0]!.replace(/^\//, '')];
        if (!file) return next();
        res.setHeader('Content-Type', file.type);
        res.end(readFileSync(file.source));
      });
    },
    // `vite build`: copy them into dist/ under their fixed names.
    generateBundle() {
      for (const [fileName, file] of Object.entries(stockfishFiles)) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(file.source) });
      }
    },
  };
}

export default defineConfig({
  define: {
    __MAIA_MODEL_BYTES__: JSON.stringify(maiaModelBytes),
    __STOCKFISH_SCRIPT__: JSON.stringify(`${stockfishPath}.js`),
  },
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
    stockfishEngine(),
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
