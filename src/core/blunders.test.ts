import { describe, expect, it } from 'vitest';
import { assessMove, BlunderChecker } from './blunders';
import type { AnalyseOptions, Engine, Line, Score } from './engine';
import { Game } from './game';

const cp = (value: number): Score => ({ type: 'cp', value });
const mate = (value: number): Score => ({ type: 'mate', value });

// White queen d1, black pawn e6: Qd5 walks into the pawn.
const QUEEN = '4k3/8/4p3/8/8/8/8/3QK3 w - - 0 1';

describe('assessMove', () => {
  // `best` is the engine's score before the move (the mover's view); `reply` is its score
  // after the move, from the opponent's view, as Stockfish reports both.

  it('names a piece the move leaves to be won, with how much the move loses', () => {
    expect(assessMove(QUEEN, 'd1d5', cp(100), cp(800))).toEqual({
      kind: 'hangs',
      piece: { color: 'white', type: 'q' },
      square: 'd5',
      lossCp: 900,
    });
  });

  it('warns about a big loss even without a hanging piece', () => {
    expect(assessMove(QUEEN, 'd1d2', cp(100), cp(200))).toEqual({ kind: 'loses', lossCp: 300 });
  });

  it('accepts small losses, and "hanging" pieces the engine is happy with (sacrifices)', () => {
    expect(assessMove(QUEEN, 'd1d2', cp(100), cp(50))).toBeNull(); // 150 cp: under the threshold
    expect(assessMove(QUEEN, 'd1d5', cp(100), cp(-100))).toBeNull();
  });

  it('takes the threshold as an option', () => {
    expect(assessMove(QUEEN, 'd1d2', cp(100), cp(50), { lossThresholdCp: 100 })).toEqual({ kind: 'loses', lossCp: 150 });
  });

  it('ignores losses once the position is completely won or lost', () => {
    // +1500 → +1100 is still winning: scores are capped at ±1000 before comparing.
    expect(assessMove(QUEEN, 'd1d2', cp(1500), cp(-1100))).toBeNull();
    expect(assessMove(QUEEN, 'd1d2', cp(-1100), cp(1500))).toBeNull();
  });

  it('warns about allowing a forced mate, unless the position was already lost to one', () => {
    expect(assessMove(QUEEN, 'd1d2', cp(0), mate(2))).toEqual({ kind: 'allowsMate', inMoves: 2 });
    expect(assessMove(QUEEN, 'd1d2', mate(-3), mate(2))).toBeNull();
  });

  it('warns about letting a short forced mate slip, but not when the mate goes on', () => {
    expect(assessMove(QUEEN, 'd1d2', mate(2), cp(-500))).toEqual({ kind: 'missesMate', inMoves: 2 });
    expect(assessMove(QUEEN, 'd1d2', mate(3), mate(-2))).toBeNull();
  });

  it('does not warn about the move that delivers checkmate', () => {
    // Fool's mate: Qh4#. After it there is no reply to score.
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2';
    expect(assessMove(fen, 'd8h4', mate(1), null)).toBeNull();
  });

  it('warns about throwing a win away with a draw, such as stalemate', () => {
    // Qc8# mates, but Qc7 is stalemate.
    const fen = 'k7/8/1K6/8/8/8/8/2Q5 w - - 0 1';
    expect(assessMove(fen, 'c1c7', mate(1), null)).toEqual({ kind: 'draws', reason: 'stalemate' });
    expect(assessMove(fen, 'c1c7', cp(-300), null)).toBeNull(); // a draw from a worse position is fine
  });
});

describe('BlunderChecker', () => {
  const after = (fen: string, uci: string) => {
    const g = new Game(fen);
    g.play(uci);
    return g.fen;
  };
  const line = (score: Score): Line[] => [{ move: 'a1a1', score, pv: [], depth: 10 }];

  /** An engine with a score per position, which records each call and can be held back. */
  function fakeEngine(scores: Map<string, Score>) {
    const calls: { fen: string; options: AnalyseOptions; signal?: AbortSignal }[] = [];
    let gate: Promise<void> = Promise.resolve();
    let fail = false;
    const engine: Engine = {
      async analyse(fen, options, signal) {
        calls.push({ fen, options, ...(signal ? { signal } : {}) });
        await gate;
        if (fail) throw new Error('engine crashed');
        const score = scores.get(fen);
        return score ? line(score) : [];
      },
    };
    return {
      engine,
      calls,
      /** Searches don't finish until the test says so (or never). */
      hold: () => void (gate = new Promise<void>(() => {})),
      fail: () => void (fail = true),
    };
  }

  it('analyses the position ahead, then only the reply position after the move', async () => {
    const f = fakeEngine(new Map([[QUEEN, cp(100)], [after(QUEEN, 'd1d5'), cp(800)]]));
    const checker = new BlunderChecker(f.engine, { prepareMs: 1000, replyMs: 300 });
    checker.prepare(QUEEN);
    checker.prepare(QUEEN); // same position: no second search
    const warning = await checker.check(QUEEN, 'd1d5', new AbortController().signal);
    expect(warning).toEqual({ text: 'This leaves your queen on d5 to be taken.', square: 'd5' });
    expect(f.calls.map((c) => [c.fen, c.options])).toEqual([
      [QUEEN, { multiPv: 1, movetimeMs: 1000 }],
      [after(QUEEN, 'd1d5'), { multiPv: 1, movetimeMs: 300 }],
    ]);
  });

  it('returns null for a good move, and prepares on its own if needed', async () => {
    const f = fakeEngine(new Map([[QUEEN, cp(100)], [after(QUEEN, 'd1d2'), cp(-90)]]));
    const checker = new BlunderChecker(f.engine);
    expect(await checker.check(QUEEN, 'd1d2', new AbortController().signal)).toBeNull();
    expect(f.calls).toHaveLength(2);
  });

  it('does not search after a move that ends the game', async () => {
    const fen = 'k7/8/1K6/8/8/8/8/2Q5 w - - 0 1';
    const f = fakeEngine(new Map([[fen, mate(1)]]));
    const checker = new BlunderChecker(f.engine);
    expect(await checker.check(fen, 'c1c7', new AbortController().signal)).toEqual({
      text: 'This is stalemate: the game ends in a draw, though you stand better.',
    });
    expect(f.calls).toHaveLength(1);
  });

  it('cancels the search for a position the game has left', () => {
    const f = fakeEngine(new Map());
    f.hold();
    const checker = new BlunderChecker(f.engine);
    checker.prepare(QUEEN);
    checker.prepare(after(QUEEN, 'd1d2'));
    expect(f.calls[0]!.signal!.aborted).toBe(true);
    expect(f.calls[1]!.signal!.aborted).toBe(false);
  });

  it('never stands in the way of a move: failures and slow engines give no warning', async () => {
    const failing = fakeEngine(new Map());
    failing.fail();
    expect(await new BlunderChecker(failing.engine).check(QUEEN, 'd1d5', new AbortController().signal)).toBeNull();

    const slow = fakeEngine(new Map([[QUEEN, cp(100)], [after(QUEEN, 'd1d5'), cp(800)]]));
    slow.hold();
    const checker = new BlunderChecker(slow.engine, { timeoutMs: 20 });
    expect(await checker.check(QUEEN, 'd1d5', new AbortController().signal)).toBeNull();
  });
});
