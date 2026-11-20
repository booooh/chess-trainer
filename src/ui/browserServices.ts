import { ChessTrainerDb, DexieGameRepository } from '../storage/gameRepository';
import { MaiaClient } from '../workers/maiaClient';
import { ModelStatusStore, type AppServices } from './services';

/** The real services: Maia in a Web Worker and games in IndexedDB. */
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
    modelStatus,
    repository: new DexieGameRepository(new ChessTrainerDb()),
    random: Math.random,
  };
}
