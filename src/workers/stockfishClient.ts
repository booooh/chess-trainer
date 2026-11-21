import type { AnalyseOptions, Engine, Line } from '../core/engine';
import { collectLines } from '../core/uci';

/**
 * The parts of `Worker` we use, so tests can pass a fake. The worker is stockfish.js itself,
 * which speaks raw UCI: we post command strings and it posts back output lines.
 */
export interface UciWorkerLike {
  postMessage(command: string): void;
  addEventListener(type: 'message', fn: (e: MessageEvent<unknown>) => void): void;
  addEventListener(type: 'error', fn: (e: ErrorEvent) => void): void;
  terminate(): void;
}

type Job = {
  fen: string;
  options: AnalyseOptions;
  resolve: (lines: Line[]) => void;
  reject: (e: Error) => void;
  /** Set once the caller has stopped waiting; the engine's answer is then thrown away. */
  abandoned: boolean;
};

// Only characters that can appear in a FEN, so a FEN can't smuggle in another UCI command.
const FEN_CHARS = /^[pnbrqkPNBRQK1-8/wa-h\- 0-9]+$/;

const abortError = () => new DOMException('Analysis aborted', 'AbortError');

/**
 * Main-thread side of the Stockfish worker (ADR-0002). Stockfish runs one search at a time,
 * so requests wait in a queue. Aborting a queued request just removes it. Aborting the
 * running one sends `stop`, and the next search starts only after the stopped one has
 * printed its `bestmove`, so its late output can't be mistaken for the next answer.
 */
export class StockfishClient implements Engine {
  /** Resolves once the engine has answered the UCI handshake; rejects if the worker fails. */
  readonly ready: Promise<void>;
  private readonly queue: Job[] = [];
  private running: Job | null = null;
  private output: string[] = [];
  private isReady = false;
  private failure: Error | null = null;
  private multiPv: number | null = null;
  private markReady!: () => void;
  private failReady!: (e: Error) => void;
  private startTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param options.startTimeoutMs How long to wait for the engine to start. A missing or
   *   broken .wasm raises no error event (stockfish.js just never answers), so without this
   *   a hint would wait forever. Generous by default: on a slow connection the first start
   *   includes a 1.2 MB (compressed) download.
   */
  constructor(
    private readonly worker: UciWorkerLike,
    { startTimeoutMs = 30_000 }: { startTimeoutMs?: number } = {},
  ) {
    this.ready = new Promise((resolve, reject) => {
      this.markReady = resolve;
      this.failReady = reject;
    });
    // Avoid an "unhandled rejection" if nobody awaits `ready` before it fails.
    this.ready.catch(() => {});

    worker.addEventListener('message', (e) => {
      // stockfish.js can also post non-text messages (e.g. download progress); skip those.
      if (typeof e.data === 'string') this.onLine(e.data);
    });
    worker.addEventListener('error', (e) => this.failAll(new Error(e.message || 'Stockfish worker crashed')));
    worker.postMessage('uci');
    this.startTimer = setTimeout(() => {
      worker.terminate();
      this.failAll(new Error(`Stockfish didn't start within ${Math.round(startTimeoutMs / 1000)} s`));
    }, startTimeoutMs);
  }

  analyse(fen: string, options: AnalyseOptions, signal?: AbortSignal): Promise<Line[]> {
    return new Promise((resolve, reject) => {
      if (this.failure) return reject(this.failure);
      if (signal?.aborted) return reject(abortError());
      if (!FEN_CHARS.test(fen)) return reject(new Error(`Invalid FEN: ${JSON.stringify(fen)}`));
      if (!Number.isInteger(options.multiPv) || options.multiPv < 1 || options.multiPv > 256) {
        return reject(new Error(`multiPv must be a whole number from 1 to 256, got ${options.multiPv}`));
      }
      if (!Number.isInteger(options.movetimeMs) || options.movetimeMs < 1) {
        return reject(new Error(`movetimeMs must be a positive whole number, got ${options.movetimeMs}`));
      }

      const onAbort = () => this.abort(job);
      const done = () => signal?.removeEventListener('abort', onAbort);
      const job: Job = {
        fen,
        options,
        resolve: (lines) => (done(), resolve(lines)),
        reject: (e) => (done(), reject(e)),
        abandoned: false,
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.queue.push(job);
      this.startNext();
    });
  }

  dispose(): void {
    this.worker.terminate();
    this.failAll(new Error('Stockfish client disposed'));
  }

  private abort(job: Job): void {
    if (job.abandoned) return;
    job.abandoned = true;
    job.reject(abortError());
    const queued = this.queue.indexOf(job);
    if (queued !== -1) this.queue.splice(queued, 1);
    else if (this.running === job) this.worker.postMessage('stop');
  }

  private startNext(): void {
    if (!this.isReady || this.running || this.failure) return;
    const job = this.queue.shift();
    if (!job) return;
    this.running = job;
    this.output = [];
    if (this.multiPv !== job.options.multiPv) {
      this.worker.postMessage(`setoption name MultiPV value ${job.options.multiPv}`);
      this.multiPv = job.options.multiPv;
    }
    this.worker.postMessage(`position fen ${job.fen}`);
    this.worker.postMessage(`go movetime ${job.options.movetimeMs}`);
  }

  private onLine(line: string): void {
    if (!this.isReady) {
      if (line.trim() === 'uciok') {
        this.clearStartTimer();
        this.isReady = true;
        this.markReady();
        this.startNext();
      }
      return;
    }
    const job = this.running;
    if (!job) return; // output between searches (e.g. `info string`) carries nothing we need
    if (!line.startsWith('bestmove')) {
      this.output.push(line);
      return;
    }
    // `bestmove` marks the end of the search; the info lines already hold the moves.
    this.running = null;
    if (!job.abandoned) job.resolve(collectLines(this.output));
    this.output = [];
    this.startNext();
  }

  private clearStartTimer(): void {
    if (this.startTimer !== null) clearTimeout(this.startTimer);
    this.startTimer = null;
  }

  private failAll(error: Error): void {
    this.clearStartTimer();
    this.failure ??= error;
    this.failReady(error);
    const jobs = [...(this.running ? [this.running] : []), ...this.queue];
    this.running = null;
    this.queue.length = 0;
    for (const job of jobs) if (!job.abandoned) job.reject(error);
  }
}
