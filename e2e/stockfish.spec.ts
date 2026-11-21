import { readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { stockfishWorkerUrl } from '../src/workers/stockfishClient';

// The hint UI (phase 2, step 5) isn't built yet, so nothing in the app starts Stockfish. This
// test starts the worker from the production build the same way browserServices.ts does, to
// check that the content-hashed script finds its content-hashed .wasm when served.
const assets = readdirSync('dist/assets');
const asset = (pattern: RegExp) => {
  const name = assets.find((f) => pattern.test(f));
  if (!name) throw new Error(`No ${pattern} in dist/assets: run \`npm run build\` first`);
  return `/assets/${name}`;
};

test('the built Stockfish worker loads its wasm and finds a mate in one', async ({ page }) => {
  await page.goto('./');
  const workerUrl = stockfishWorkerUrl(asset(/^stockfish-.*\.js$/), asset(/^stockfish-.*\.wasm$/));
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
    workerUrl,
  );
  expect(bestMove).toBe('bestmove d1d8');
});
