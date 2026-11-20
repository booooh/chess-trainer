import { describe, expect, it } from 'vitest';
import { MaiaOpponent, sampleMove, type HumanMovePredictor, type PredictRequest } from './opponent';

/** A random() that returns the given values in order. */
const sequence = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe('sampleMove', () => {
  const probs = new Map([
    ['e2e4', 0.5],
    ['d2d4', 0.3],
    ['g1f3', 0.19],
    ['g2g4', 0.01],
  ]);

  it('picks moves in proportion to their probability', () => {
    // Above the floor: e2e4 0.5, d2d4 0.3, g1f3 0.19 → total 0.99.
    expect(sampleMove(probs, { random: () => 0.0 })).toBe('e2e4');
    expect(sampleMove(probs, { random: () => 0.49 / 0.99 })).toBe('e2e4');
    expect(sampleMove(probs, { random: () => 0.51 / 0.99 })).toBe('d2d4');
    expect(sampleMove(probs, { random: () => 0.9 })).toBe('g1f3');
  });

  it('never picks moves below the probability floor', () => {
    const picks = new Set(Array.from({ length: 200 }, (_, i) => sampleMove(probs, { random: () => i / 200 })));
    expect(picks.has('g2g4')).toBe(false);
    expect(picks).toEqual(new Set(['e2e4', 'd2d4', 'g1f3']));
  });

  it('falls back to the most likely move when every move is below the floor', () => {
    const flat = new Map([
      ['a2a3', 0.01],
      ['h2h3', 0.015],
    ]);
    expect(sampleMove(flat, { floor: 0.02, random: () => 0.0 })).toBe('h2h3');
  });

  it('throws when there are no moves to choose from', () => {
    expect(() => sampleMove(new Map(), { random: Math.random })).toThrow();
  });
});

describe('MaiaOpponent', () => {
  it('asks the predictor about the position at its rating and samples the reply', async () => {
    const requests: PredictRequest[] = [];
    const predictor: HumanMovePredictor = {
      async predict(req) {
        requests.push(req);
        return new Map([
          ['e7e5', 0.6],
          ['c7c5', 0.4],
        ]);
      },
    };
    const opponent = new MaiaOpponent(predictor, { elo: 800, random: sequence(0.7) });
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

    await expect(opponent.chooseMove({ fen, moves: ['e2e4'] })).resolves.toBe('c7c5');
    expect(requests).toEqual([{ fen, moves: ['e2e4'], selfElo: 800, oppoElo: 800 }]);
  });

  it('can be told the human player rating separately', async () => {
    let seen: PredictRequest | undefined;
    const predictor: HumanMovePredictor = {
      async predict(req) {
        seen = req;
        return new Map([['e2e4', 1]]);
      },
    };
    await new MaiaOpponent(predictor, { elo: 1100, opponentElo: 800 }).chooseMove({
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      moves: [],
    });
    expect(seen).toMatchObject({ selfElo: 1100, oppoElo: 800 });
  });
});
