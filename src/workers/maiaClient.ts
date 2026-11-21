import type { HumanMovePredictor, MoveProbabilities, PredictRequest } from '../core/opponent';
import type { FromWorker, ToWorker } from './maiaProtocol';

/** The parts of `Worker` we use, so tests can pass a fake. */
export interface WorkerLike {
  postMessage(msg: ToWorker): void;
  addEventListener(type: 'message', fn: (e: MessageEvent<FromWorker>) => void): void;
  addEventListener(type: 'error', fn: (e: ErrorEvent) => void): void;
  terminate(): void;
}

type Pending = { resolve: (p: MoveProbabilities) => void; reject: (e: Error) => void };

/**
 * Main-thread side of the Maia worker: implements HumanMovePredictor by message passing.
 * Requests carry ids, so several can be in flight and answers can't get mixed up.
 */
export class MaiaClient implements HumanMovePredictor {
  /** Resolves when the model is loaded; rejects if it can't be. */
  readonly ready: Promise<void>;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private markReady!: () => void;
  private failReady!: (e: Error) => void;

  constructor(
    private readonly worker: WorkerLike,
    options: { onProgress?: (loaded: number, total: number) => void } = {},
  ) {
    this.ready = new Promise((resolve, reject) => {
      this.markReady = resolve;
      this.failReady = reject;
    });
    // Avoid an "unhandled rejection" if nobody awaits `ready` before it fails.
    this.ready.catch(() => {});

    worker.addEventListener('message', (e) => {
      const msg = e.data;
      switch (msg.type) {
        case 'progress':
          options.onProgress?.(msg.loaded, msg.total);
          break;
        case 'ready':
          this.markReady();
          break;
        case 'loadFailed':
          this.failAll(new Error(msg.message));
          break;
        case 'prediction':
          this.settle(msg.id)?.resolve(new Map(msg.probabilities));
          break;
        case 'predictionFailed':
          this.settle(msg.id)?.reject(new Error(msg.message));
          break;
      }
    });
    worker.addEventListener('error', (e) => this.failAll(new Error(e.message || 'Maia worker crashed')));
    worker.postMessage({ type: 'load' });
  }

  predict(req: PredictRequest, signal?: AbortSignal): Promise<MoveProbabilities> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException('Prediction aborted', 'AbortError'));
      this.pending.set(id, { resolve, reject });
      // The worker can't stop mid-inference, but we stop waiting and drop its answer.
      signal?.addEventListener('abort', () => this.settle(id)?.reject(new DOMException('Prediction aborted', 'AbortError')), {
        once: true,
      });
      const { fen, moves, startFen, selfElo, oppoElo } = req;
      this.worker.postMessage({ type: 'predict', id, fen, moves: [...moves], ...(startFen ? { startFen } : {}), selfElo, oppoElo });
    });
  }

  dispose(): void {
    this.worker.terminate();
    this.failAll(new Error('Maia client disposed'));
  }

  private settle(id: number): Pending | undefined {
    const p = this.pending.get(id);
    this.pending.delete(id);
    return p;
  }

  private failAll(error: Error): void {
    this.failReady(error);
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }
}
