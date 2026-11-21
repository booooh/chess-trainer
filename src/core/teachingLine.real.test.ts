// @vitest-environment node
// Integration test: a teaching line built with the real Stockfish (in Node) and a stand-in
// for Maia, to check that real engine output leads to the right move and motif.
import { describe, expect, it } from 'vitest';
import { nodeStockfish } from '../workers/nodeStockfish.testutil';
import { StockfishClient } from '../workers/stockfishClient';
import { Game } from './game';
import type { HumanMovePredictor } from './opponent';
import { buildTeachingLine } from './teachingLine';

/** A stand-in for Maia that always plays the first legal move. */
const firstLegalMove: HumanMovePredictor = {
  predict: async ({ fen }) => {
    const [from, dests] = [...new Game(fen).legalDestinations()][0]!;
    return new Map([[`${from}${dests[0]}`, 1]]);
  },
};

describe('buildTeachingLine with real Stockfish', () => {
  it('teaches the knight fork that wins the queen', { timeout: 20_000 }, async () => {
    const engine = new StockfishClient(nodeStockfish());
    // Nc7+ forks the king on e8 and the queen on a6, and the knight gets away afterwards.
    // (A target in the corner makes a poor test: after Nxa8 the knight can be trapped, and
    // Stockfish's score then varies from run to run.)
    const fork = '4k3/7p/q7/1N6/8/8/7P/4K3 w - - 0 1';
    const line = await buildTeachingLine(
      { fen: fork, moves: [], userElo: 1100, opponentElo: 1100 },
      { engine, predictor: firstLegalMove },
      { firstMovetimeMs: 300, followMovetimeMs: 150 },
    );
    expect(line!.plies[0]!.san).toBe('Nc7+');
    expect(line!.plies[0]!.facts).toContainEqual(expect.objectContaining({ kind: 'fork', targets: ['e8', 'a6'] }));
    expect(line!.plies[2]!.san).toBe('Nxa6');
    expect(line!.score.type === 'cp' && line!.score.value).toBeGreaterThan(400);
    engine.dispose();
  });
});
