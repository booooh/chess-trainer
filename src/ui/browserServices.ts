// stockfish.js runs as a classic (non-module) worker and loads its .wasm itself. `?url` makes
// Vite copy both files into the build (with content hashes) without bundling them.
import stockfishScriptUrl from 'stockfish/bin/stockfish-19-lite-single.js?url';
import stockfishWasmUrl from 'stockfish/bin/stockfish-19-lite-single.wasm?url';
import { lazyEngine } from '../core/engine';
import { ChessTrainerDb, DexieGameRepository } from '../storage/gameRepository';
import { MaiaClient } from '../workers/maiaClient';
import { StockfishClient, stockfishWorkerUrl } from '../workers/stockfishClient';
import { ModelStatusStore, type AppServices } from './services';

/** The real services: Maia and Stockfish in Web Workers, and games in IndexedDB. */
export function createBrowserServices(): AppServices {
  const modelStatus = new ModelStatusStore();
  // Start loading Maia straight away, so it's usually ready before the first opponent move.
  const worker = new Worker(new URL('../workers/maia.worker.ts', import.meta.url), { type: 'module' });
  const maia = new MaiaClient(worker, {
    onProgress: (loaded, total) => modelStatus.set({ state: 'loading', progress: total ? loaded / total : null }),
  });
  maia.ready.then(
    () => modelStatus.set({ state: 'ready' }),
    (err: Error) => modelStatus.set({ state: 'failed', message: err.message }),
  );
  return {
    predictor: maia,
    // Lite single-threaded build (ADR-0002): 1.8 MB, and no cross-origin isolation needed.
    engine: lazyEngine(() => new StockfishClient(new Worker(stockfishWorkerUrl(stockfishScriptUrl, stockfishWasmUrl)))),
    modelStatus,
    repository: new DexieGameRepository(new ChessTrainerDb()),
    random: Math.random,
  };
}
