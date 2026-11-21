import { readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// The built Stockfish files keep matching names (vite.config.ts, stockfishEngine), because
// stockfish.js finds its .wasm by swapping ".js" for ".wasm" in its own URL. This starts the
// worker the same way browserServices.ts does, without going through the hint UI.
const script = readdirSync('dist/engine').find((f) => /^stockfish-.*\.js$/.test(f));

test('the built Stockfish worker loads its wasm and finds a mate in one', async ({ page }) => {
  expect(script, 'run `npm run build` first').toBeDefined();
  expect(readdirSync('dist/engine')).toContain(script!.replace(/\.js$/, '.wasm'));
  await page.goto('./');
  const bestMove = await page.evaluate(
    (url) =>
      new Promise<string>((resolve, reject) => {
        const worker = new Worker(url);
        worker.onerror = (e) => reject(new Error(e.message || 'worker error'));
        worker.onmessage = (e: MessageEvent<unknown>) => {
          if (typeof e.data !== 'string') return;
          if (e.data === 'uciok') {
            worker.postMessage('position fen 6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
            worker.postMessage('go movetime 500');
          } else if (e.data.startsWith('bestmove')) {
            worker.terminate();
            resolve(e.data);
          }
        };
        worker.postMessage('uci');
      }),
    `/engine/${script}`,
  );
  expect(bestMove).toBe('bestmove d1d8');
});
