import { afterEach, describe, expect, it, vi } from 'vitest';
import { StockfishClient, stockfishWorkerUrl, type UciWorkerLike } from './stockfishClient';

/** Stands in for the Stockfish worker: records commands, and replies when told to. */
class FakeStockfish implements UciWorkerLike {
  sent: string[] = [];
  terminated = false;
  private listener: ((e: MessageEvent<unknown>) => void) | null = null;
  private errorListener: ((e: ErrorEvent) => void) | null = null;
  postMessage(cmd: string) {
    this.sent.push(cmd);
  }
  addEventListener(type: 'message' | 'error', fn: (e: never) => void) {
    if (type === 'message') this.listener = fn as (e: MessageEvent<unknown>) => void;
    else this.errorListener = fn as (e: ErrorEvent) => void;
  }
  terminate() {
    this.terminated = true;
  }
  say(...lines: unknown[]) {
    for (const data of lines) this.listener?.({ data } as MessageEvent<unknown>);
  }
  crash(message: string) {
    this.errorListener?.({ message } as ErrorEvent);
  }
  /** Commands sent since the last call. */
  take() {
    return this.sent.splice(0);
  }
}

const FEN_A = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
const FEN_B = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
const options = { multiPv: 3, movetimeMs: 1000 };

/** A client whose engine has finished starting up. */
async function readyClient() {
  const engine = new FakeStockfish();
  const client = new StockfishClient(engine);
  engine.say('Stockfish 19 Lite WASM by the Stockfish developers', 'id name Stockfish 19 Lite WASM', 'uciok');
  await client.ready;
  engine.take();
  return { engine, client };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('stockfishWorkerUrl', () => {
  it('passes the .wasm location in the URL hash, where stockfish.js looks for it', () => {
    expect(stockfishWorkerUrl('/assets/stockfish-AbC1.js', '/assets/stockfish-XyZ2.wasm')).toBe(
      '/assets/stockfish-AbC1.js#%2Fassets%2Fstockfish-XyZ2.wasm',
    );
  });
});

describe('StockfishClient', () => {
  it('starts the UCI handshake and is ready on uciok', async () => {
    const engine = new FakeStockfish();
    const client = new StockfishClient(engine);
    expect(engine.sent).toEqual(['uci']);
    engine.say('uciok');
    await expect(client.ready).resolves.toBeUndefined();
  });

  it('waits for the engine to be ready before searching', async () => {
    const engine = new FakeStockfish();
    const client = new StockfishClient(engine);
    void client.analyse(FEN_A, options);
    await tick();
    expect(engine.sent).toEqual(['uci']);
    engine.say('uciok');
    await tick();
    expect(engine.sent).toContain('go movetime 1000');
  });

  it('sets MultiPV and the position, searches, and returns the lines best first', async () => {
    const { engine, client } = await readyClient();
    const result = client.analyse(FEN_B, options);
    await tick();
    expect(engine.take()).toEqual(['setoption name MultiPV value 3', `position fen ${FEN_B}`, 'go movetime 1000']);
    engine.say(
      'info string Network replica 1: Local memory.',
      'info depth 16 seldepth 2 multipv 1 score mate 1 nodes 258434 time 300 pv d1d8',
      'info depth 15 seldepth 22 multipv 2 score cp 671 nodes 258434 time 300 pv g2g4 f7f6',
      'bestmove d1d8',
    );
    expect(await result).toEqual([
      { move: 'd1d8', score: { type: 'mate', value: 1 }, pv: ['d1d8'], depth: 16 },
      { move: 'g2g4', score: { type: 'cp', value: 671 }, pv: ['g2g4', 'f7f6'], depth: 15 },
    ]);
  });

  it('runs one search at a time, in order, and only resends MultiPV when it changes', async () => {
    const { engine, client } = await readyClient();
    const first = client.analyse(FEN_A, options);
    const second = client.analyse(FEN_B, options);
    const third = client.analyse(FEN_B, { multiPv: 1, movetimeMs: 500 });
    await tick();
    expect(engine.take()).toEqual(['setoption name MultiPV value 3', `position fen ${FEN_A}`, 'go movetime 1000']);

    engine.say('info depth 10 multipv 1 score cp 20 nodes 1 time 1 pv f1b5', 'bestmove f1b5');
    expect((await first).map((l) => l.move)).toEqual(['f1b5']);
    expect(engine.take()).toEqual([`position fen ${FEN_B}`, 'go movetime 1000']);

    engine.say('info depth 10 multipv 1 score mate 1 nodes 1 time 1 pv d1d8', 'bestmove d1d8');
    expect((await second).map((l) => l.move)).toEqual(['d1d8']);
    expect(engine.take()).toEqual(['setoption name MultiPV value 1', `position fen ${FEN_B}`, 'go movetime 500']);

    engine.say('info depth 10 score mate 1 nodes 1 time 1 pv d1d8', 'bestmove d1d8');
    expect(await third).toHaveLength(1);
  });

  it('returns no lines for checkmate or stalemate', async () => {
    const { engine, client } = await readyClient();
    const result = client.analyse('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', options);
    await tick();
    engine.say('info depth 0 score cp 0', 'bestmove (none)');
    expect(await result).toEqual([]);
  });

  it('drops a queued search when its signal aborts, without telling the engine', async () => {
    const { engine, client } = await readyClient();
    const first = client.analyse(FEN_A, options);
    const abort = new AbortController();
    const second = client.analyse(FEN_B, options, abort.signal);
    await tick();
    engine.take();
    abort.abort();
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });

    engine.say('info depth 10 multipv 1 score cp 20 nodes 1 time 1 pv f1b5', 'bestmove f1b5');
    await first;
    expect(engine.take()).toEqual([]); // the aborted search never started
  });

  it('stops the running search on abort, and waits for its bestmove before the next one', async () => {
    const { engine, client } = await readyClient();
    const abort = new AbortController();
    const first = client.analyse(FEN_A, options, abort.signal);
    const second = client.analyse(FEN_B, options);
    await tick();
    engine.take();

    abort.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(engine.take()).toEqual(['stop']);

    // Late output of the stopped search must not leak into the next result.
    engine.say('info depth 11 multipv 1 score cp 99 nodes 1 time 1 pv d2d4');
    await tick();
    expect(engine.take()).toEqual([]); // still waiting for bestmove
    engine.say('bestmove d2d4');
    await tick();
    expect(engine.take()).toEqual([`position fen ${FEN_B}`, 'go movetime 1000']);
    engine.say('info depth 10 multipv 1 score mate 1 nodes 1 time 1 pv d1d8', 'bestmove d1d8');
    expect((await second).map((l) => l.move)).toEqual(['d1d8']);
  });

  it('rejects at once if the signal has already aborted', async () => {
    const { engine, client } = await readyClient();
    const abort = new AbortController();
    abort.abort();
    await expect(client.analyse(FEN_A, options, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await tick();
    expect(engine.take()).toEqual([]);
  });

  it('refuses input that could inject extra UCI commands', async () => {
    const { client } = await readyClient();
    await expect(client.analyse(`${FEN_A}\nquit`, options)).rejects.toThrow(/FEN/);
    await expect(client.analyse(FEN_A, { multiPv: 0, movetimeMs: 1000 })).rejects.toThrow(/multiPv/);
    await expect(client.analyse(FEN_A, { multiPv: 3, movetimeMs: 1.5 })).rejects.toThrow(/movetimeMs/);
  });

  it('ignores messages that are not text', async () => {
    const { engine, client } = await readyClient();
    const result = client.analyse(FEN_B, options);
    await tick();
    engine.say({ percent: 1 }, 'info depth 10 multipv 1 score mate 1 nodes 1 time 1 pv d1d8', 'bestmove d1d8');
    expect(await result).toHaveLength(1);
  });

  it('rejects everything, and `ready`, if the worker crashes', async () => {
    const engine = new FakeStockfish();
    const client = new StockfishClient(engine);
    const result = client.analyse(FEN_A, options);
    engine.crash('failed to fetch wasm');
    await expect(result).rejects.toThrow('failed to fetch wasm');
    await expect(client.ready).rejects.toThrow('failed to fetch wasm');
    await expect(client.analyse(FEN_A, options)).rejects.toThrow('failed to fetch wasm');
  });

  describe('when the engine never starts', () => {
    afterEach(() => vi.useRealTimers());

    // A missing or broken .wasm doesn't raise an error event: stockfish.js just never says
    // uciok. Without a timeout, a hint would wait forever.
    it('gives up after the start-up timeout and rejects everything', async () => {
      vi.useFakeTimers();
      const engine = new FakeStockfish();
      const client = new StockfishClient(engine, { startTimeoutMs: 20_000 });
      const result = client.analyse(FEN_A, options);
      const failed = expect(result).rejects.toThrow(/didn't start/);
      await vi.advanceTimersByTimeAsync(19_999);
      engine.say('info string still loading');
      await vi.advanceTimersByTimeAsync(1);
      await failed;
      await expect(client.ready).rejects.toThrow(/didn't start/);
      expect(engine.terminated).toBe(true);
    });

    it('does not time out once the engine has started', async () => {
      vi.useFakeTimers();
      const engine = new FakeStockfish();
      const client = new StockfishClient(engine, { startTimeoutMs: 20_000 });
      engine.say('uciok');
      await vi.advanceTimersByTimeAsync(60_000);
      const result = client.analyse(FEN_B, options);
      await vi.advanceTimersByTimeAsync(0);
      engine.say('info depth 10 multipv 1 score mate 1 nodes 1 time 1 pv d1d8', 'bestmove d1d8');
      expect(await result).toHaveLength(1);
    });
  });

  it('terminates the worker and rejects pending searches when disposed', async () => {
    const { engine, client } = await readyClient();
    const result = client.analyse(FEN_A, options);
    client.dispose();
    expect(engine.terminated).toBe(true);
    await expect(result).rejects.toThrow(/disposed/);
  });
});
