import { lazyEngine } from '../core/engine';
import { ChessTrainerDb, DexieGameRepository } from '../storage/gameRepository';
import { MaiaClient } from '../workers/maiaClient';
import { StockfishClient } from '../workers/stockfishClient';
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
    // stockfish.js is a classic (non-module) worker that loads its .wasm itself; vite.config.ts
    // publishes both files under matching names (see stockfishEngine there).
    engine: lazyEngine(() => new StockfishClient(new Worker(import.meta.env.BASE_URL + __STOCKFISH_SCRIPT__))),
    modelStatus,
    repository: new DexieGameRepository(new ChessTrainerDb()),
    random: Math.random,
  };
}
