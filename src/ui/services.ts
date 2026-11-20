import type { HumanMovePredictor } from '../core/opponent';
import type { GameRepository } from '../core/records';

export type ModelStatus =
  | { state: 'loading'; progress: number | null }
  | { state: 'ready' }
  | { state: 'failed'; message: string };

/** Tiny observable for the Maia model's loading state (works with useSyncExternalStore). */
export class ModelStatusStore {
  private status: ModelStatus = { state: 'loading', progress: null };
  private readonly listeners = new Set<() => void>();

  get = (): ModelStatus => this.status;

  set(status: ModelStatus): void {
    this.status = status;
    for (const l of this.listeners) l();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

/**
 * Everything the UI needs from the outside world. `main.tsx` passes the real ones
 * (`createBrowserServices`); tests pass fakes, so they don't need a Web Worker or IndexedDB.
 */
export type AppServices = {
  predictor: HumanMovePredictor;
  modelStatus: ModelStatusStore;
  repository: GameRepository;
  random: () => number;
};
