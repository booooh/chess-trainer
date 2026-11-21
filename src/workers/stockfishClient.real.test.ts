// @vitest-environment node
// Contract test: StockfishClient against the real Stockfish 19 Lite wasm (the same build the
// browser loads), run through the npm package's Node entry point. The fake in
// stockfishClient.test.ts covers edge cases; this checks the fake matches reality.
import initEngine from 'stockfish';
import { describe, expect, it } from 'vitest';
import { StockfishClient, type UciWorkerLike } from './stockfishClient';

/** Wraps the Node engine in the same shape as a browser Worker. */
function nodeStockfish(): UciWorkerLike {
  const engine = initEngine('lite-single');
  let onMessage: ((e: MessageEvent<unknown>) => void) | null = null;
  engine.listener = (line) => onMessage?.({ data: line } as MessageEvent<unknown>);
  return {
    postMessage: (cmd) => engine.processCommand(cmd),
    addEventListener: (type: 'message' | 'error', fn: (e: never) => void) => {
      if (type === 'message') onMessage = fn as (e: MessageEvent<unknown>) => void;
    },
    terminate: () => engine.processCommand('quit'),
  };
}

describe('StockfishClient with real Stockfish', () => {
  it('finds mate in one, keeps a queue, and recovers after an abort', { timeout: 20_000 }, async () => {
    const client = new StockfishClient(nodeStockfish());
    await client.ready;

    // Back-rank mate: Rd8#.
    const mateIn1 = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
    const middlegame = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';

    const abort = new AbortController();
    const stopped = client.analyse(middlegame, { multiPv: 3, movetimeMs: 5000 }, abort.signal);
    const lines = client.analyse(mateIn1, { multiPv: 3, movetimeMs: 300 });
    setTimeout(() => abort.abort(), 100);

    await expect(stopped).rejects.toMatchObject({ name: 'AbortError' });
    const result = await lines;
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ move: 'd1d8', score: { type: 'mate', value: 1 }, pv: ['d1d8'] });
    expect(result[1]!.score.type).toBe('cp');
    expect(result[0]!.depth).toBeGreaterThan(5);

    // Stalemate: Black to move, no legal moves, not in check.
    expect(await client.analyse('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', { multiPv: 3, movetimeMs: 100 })).toEqual([]);
  });
});
