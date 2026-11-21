import { describe, expect, it } from 'vitest';
import type { AnalyseOptions, Engine, Line, Score } from './engine';
import { Game, type Uci } from './game';
import type { HumanMovePredictor, PredictRequest } from './opponent';
import { buildTeachingLine } from './teachingLine';

/** FEN after playing `moves` from `fen`. */
const after = (fen: string, ...moves: Uci[]) => {
  const g = new Game(fen);
  for (const m of moves) g.play(m);
  return g.fen;
};

const cp = (value: number): Score => ({ type: 'cp', value });
const line = (score: Score, ...pv: Uci[]): Line => ({ move: pv[0]!, score, pv, depth: 14 });

/** Answers with canned lines per FEN, and records every request. */
class FakeEngine implements Engine {
  calls: { fen: string; options: AnalyseOptions }[] = [];
  constructor(private readonly answers: Map<string, Line[]>) {}
  async analyse(fen: string, options: AnalyseOptions): Promise<Line[]> {
    this.calls.push({ fen, options });
    const lines = this.answers.get(fen);
    if (!lines) throw new Error(`FakeEngine: no answer for ${fen}`);
    return lines.slice(0, options.multiPv);
  }
}

class FakePredictor implements HumanMovePredictor {
  calls: PredictRequest[] = [];
  constructor(private readonly answers: Map<string, [Uci, number][]>) {}
  async predict(req: PredictRequest) {
    this.calls.push(req);
    const probs = this.answers.get(req.fen);
    if (!probs) throw new Error(`FakePredictor: no answer for ${req.fen}`);
    return new Map(probs);
  }
}

// White to move: Nc7+ forks the king on e8 and the rook on a8. (The h7 pawn keeps enough
// material on the board that winning the rook doesn't end the game as a dead draw.)
const FORK = 'r3k3/7p/8/1N6/8/8/8/4K3 w - - 0 1';
const request = { fen: FORK, moves: [] as Uci[], userElo: 1100, opponentElo: 1100 };

describe('buildTeachingLine', () => {
  it('plays the fork, the likely reply, and the win of the rook, with facts on each ply', async () => {
    const afterKd7 = after(FORK, 'b5c7', 'e8d7');
    const afterNxa8 = after(FORK, 'b5c7', 'e8d7', 'c7a8');
    const engine = new FakeEngine(
      new Map([
        [FORK, [line(cp(480), 'b5c7', 'e8d7', 'c7a8'), line(cp(0), 'e1e2', 'a8a2')]],
        [afterKd7, [line(cp(500), 'c7a8', 'd7c8')]],
      ]),
    );
    const predictor = new FakePredictor(
      new Map([
        [after(FORK, 'b5c7'), [['e8d7', 0.6], ['e8e7', 0.3], ['e8f8', 0.1]]],
        [afterNxa8, [['d7c8', 0.7], ['d7c6', 0.3]]],
      ]),
    );

    const result = await buildTeachingLine(request, { engine, predictor });

    expect(result!.plies.map((p) => [p.san, p.side])).toEqual([
      ['Nc7+', 'you'],
      ['Kd7', 'opponent'],
      ['Nxa8', 'you'], // a capture, so the line goes on…
      ['Kc8', 'opponent'], // …until a quiet move
    ]);
    expect(result!.plies[0]!.facts).toContainEqual({
      kind: 'fork',
      by: { color: 'white', type: 'n' },
      square: 'c7',
      targets: ['e8', 'a8'],
    });
    expect(result!.plies[2]!.facts).toContainEqual({ kind: 'materialChange', deltaCp: 500 });
    expect(result!.bestDefence).toBeNull(); // Maia's reply is Stockfish's best defence
    expect(result!.score).toEqual(cp(480));

    // Thinking time: longer for the first analysis, shorter for the follow-ups.
    expect(engine.calls.map((c) => c.options)).toEqual([
      { multiPv: 3, movetimeMs: 1200 },
      { multiPv: 1, movetimeMs: 400 },
    ]);
    // Maia predicts each opponent reply at the opponent's rating, with the moves so far.
    expect(predictor.calls[0]).toMatchObject({ fen: after(FORK, 'b5c7'), moves: ['b5c7'], selfElo: 1100, oppoElo: 1100 });
  });

  it("branches when Maia's reply isn't the best defence", async () => {
    const afterKd8 = after(FORK, 'b5c7', 'e8d8');
    const engine = new FakeEngine(
      new Map([
        [FORK, [line(cp(480), 'b5c7', 'e8e7', 'c7a8', 'e7d7')]],
        [afterKd8, [line(cp(510), 'c7a8', 'd8c8')]],
      ]),
    );
    const predictor = new FakePredictor(
      new Map([
        [after(FORK, 'b5c7'), [['e8d8', 0.5], ['e8e7', 0.4]]],
        [after(FORK, 'b5c7', 'e8d8', 'c7a8'), [['d8c8', 1]]],
      ]),
    );

    const result = await buildTeachingLine(request, { engine, predictor });

    expect(result!.plies.map((p) => p.san)).toEqual(['Nc7+', 'Kd8', 'Nxa8', 'Kc8']);
    // The best defence comes from Stockfish's own line, starting at the opponent's reply.
    expect(result!.bestDefence!.plies.map((p) => [p.san, p.side])).toEqual([
      ['Ke7', 'opponent'],
      ['Nxa8', 'you'],
      ['Kd7', 'opponent'],
    ]);
    expect(engine.calls).toHaveLength(2); // no extra analysis for the branch
  });

  it('prefers a move with a motif among nearly equal candidates', async () => {
    // Stockfish rates a quiet king move 20 cp higher, but the fork is within the margin.
    const engine = new FakeEngine(
      new Map([
        [FORK, [line(cp(500), 'e1d2', 'a8a2'), line(cp(480), 'b5c7', 'e8d7'), line(cp(300), 'b5d6', 'e8d7')]],
        [after(FORK, 'b5c7', 'e8d7'), [line(cp(500), 'c7a8', 'd7c8')]],
      ]),
    );
    const predictor = new FakePredictor(
      new Map([
        [FORK, [['e1d2', 0.5], ['b5c7', 0.2], ['b5d6', 0.3]]],
        [after(FORK, 'b5c7'), [['e8d7', 1]]],
        [after(FORK, 'b5c7', 'e8d7', 'c7a8'), [['d7c8', 1]]],
      ]),
    );
    const result = await buildTeachingLine(request, { engine, predictor });
    expect(result!.plies[0]!.uci).toBe('b5c7');
    expect(result!.score).toEqual(cp(480));
    // Maia was asked how likely the user (at the user's rating) is to find each candidate.
    expect(predictor.calls[0]).toMatchObject({ fen: FORK, selfElo: 1100 });
  });

  it('without a motif, prefers the candidate a human is most likely to find', async () => {
    const quiet = '4k3/8/8/8/8/8/8/R3K3 w - - 0 1';
    const engine = new FakeEngine(
      new Map([
        [quiet, [line(cp(700), 'a1a7', 'e8d8'), line(cp(690), 'a1a6', 'e8d7'), line(cp(500), 'e1e2', 'e8d7')]],
        [after(quiet, 'a1a6', 'e8d7'), [line(cp(700), 'e1e2', 'd7c7')]],
      ]),
    );
    const predictor = new FakePredictor(
      new Map([
        [quiet, [['a1a6', 0.6], ['a1a7', 0.1], ['e1e2', 0.3]]],
        [after(quiet, 'a1a6'), [['e8d7', 1]]],
      ]),
    );
    const result = await buildTeachingLine({ ...request, fen: quiet }, { engine, predictor });
    expect(result!.plies.map((p) => p.uci)).toEqual(['a1a6', 'e8d7', 'e1e2']); // quiet, so 3 plies
  });

  it('only treats mates as equal to mates', async () => {
    const mate = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
    const engine = new FakeEngine(
      new Map([[mate, [line({ type: 'mate', value: 1 }, 'd1d8'), line(cp(671), 'g2g4', 'f7f6'), line(cp(636), 'h2h4')]]]),
    );
    const predictor = new FakePredictor(new Map([[mate, [['g2g4', 0.9], ['d1d8', 0.1]]]]));
    const result = await buildTeachingLine({ ...request, fen: mate }, { engine, predictor });
    expect(result!.plies.map((p) => p.san)).toEqual(['Rd8#']); // the game ends, so the line does too
  });

  it('records an eval swing when the opponent misses the best defence', async () => {
    // Black's natural reply loses more than Stockfish's best defence would.
    const afterKd8 = after(FORK, 'b5c7', 'e8d8');
    const engine = new FakeEngine(
      new Map([
        [FORK, [line(cp(200), 'b5c7', 'e8e7', 'c7a8')]],
        [afterKd8, [line(cp(520), 'c7a8', 'd8c8')]],
      ]),
    );
    const predictor = new FakePredictor(
      new Map([
        [after(FORK, 'b5c7'), [['e8d8', 1]]],
        [after(FORK, 'b5c7', 'e8d8', 'c7a8'), [['d8c8', 1]]],
      ]),
    );
    const result = await buildTeachingLine(request, { engine, predictor });
    // From Black's point of view: -200 before the reply, -520 after it.
    expect(result!.plies[1]!.facts).toContainEqual({ kind: 'evalSwing', fromCp: -200, toCp: -520 });
  });

  it('returns null when there is no move to teach (checkmate or stalemate)', async () => {
    const stalemate = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
    const engine = new FakeEngine(new Map([[stalemate, []]]));
    const result = await buildTeachingLine({ ...request, fen: stalemate }, { engine, predictor: new FakePredictor(new Map()) });
    expect(result).toBeNull();
  });

  it('tells Maia which position the moves start from', async () => {
    const engine = new FakeEngine(
      new Map([
        [FORK, [line(cp(480), 'b5c7', 'e8d7', 'c7a8'), line(cp(470), 'b5d6', 'e8d7')]],
        [after(FORK, 'b5c7', 'e8d7'), [line(cp(500), 'c7a8', 'd7c8')]],
      ]),
    );
    const predictor = new FakePredictor(
      new Map([
        [FORK, [['b5c7', 1]]],
        [after(FORK, 'b5c7'), [['e8d7', 1]]],
        [after(FORK, 'b5c7', 'e8d7', 'c7a8'), [['d7c8', 1]]],
      ]),
    );
    await buildTeachingLine({ ...request, startFen: FORK }, { engine, predictor });
    expect(predictor.calls.length).toBeGreaterThan(1);
    for (const call of predictor.calls) expect(call.startFen).toBe(FORK);
  });

  it('passes the abort signal to the engine and to Maia', async () => {
    const abort = new AbortController();
    abort.abort();
    const engine: Engine = {
      analyse: async (_fen, _options, signal) => {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        return [];
      },
    };
    await expect(
      buildTeachingLine(request, { engine, predictor: new FakePredictor(new Map()) }, {}, abort.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('buildTeachingLine with a given first move ("why not?")', () => {
  it('teaches the move the user played: Stockfish judges the position after it', async () => {
    // Ke2 ignores the fork. Stockfish, asked about the position after it, says Black is fine.
    const afterKe2 = after(FORK, 'e1e2');
    const engine = new FakeEngine(
      new Map([
        [afterKe2, [line(cp(20), 'a8a2', 'e2d3')]],
        [after(afterKe2, 'a8a2'), [line(cp(-20), 'e2d3')]],
      ]),
    );
    const predictor = new FakePredictor(new Map([[afterKe2, [['a8a2', 0.5], ['e8d7', 0.5]]]]));

    const result = await buildTeachingLine(request, { engine, predictor }, { firstMove: 'e1e2', minPlies: 2 });

    expect(result!.plies.map((p) => [p.san, p.side])).toEqual([
      ['Ke2', 'you'],
      ['Ra2+', 'opponent'], // a check, so the line goes on…
      ['Kd3', 'you'],
    ]);
    expect(result!.score).toEqual(cp(-20)); // the user's view of Ke2
    expect(result!.bestDefence).toBeNull(); // Maia found Stockfish's reply
    expect(engine.calls[0]).toEqual({ fen: afterKe2, options: { multiPv: 1, movetimeMs: 1200 } });
  });

  it('turns a mate for the opponent into the user’s view, and handles a move that ends the game', async () => {
    const MATE_IN_ONE = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
    const engine = new FakeEngine(new Map([[after(MATE_IN_ONE, 'a1a2'), [line({ type: 'mate', value: -3 }, 'g8f8')]]]));
    const predictor = new FakePredictor(new Map([[after(MATE_IN_ONE, 'a1a2'), [['g8f8', 1]]]]));
    const slow = await buildTeachingLine({ ...request, fen: MATE_IN_ONE }, { engine, predictor }, { firstMove: 'a1a2', maxPlies: 1 });
    expect(slow!.score).toEqual({ type: 'mate', value: 4 }); // Black is mated in 3 after Ra2: White mates in 4

    const mate = await buildTeachingLine({ ...request, fen: MATE_IN_ONE }, { engine, predictor }, { firstMove: 'a1a8' });
    expect(mate!.plies.map((p) => p.san)).toEqual(['Ra8#']);
    expect(mate!.score).toEqual({ type: 'mate', value: 1 });
  });

  it('rejects an illegal first move', async () => {
    const engine = new FakeEngine(new Map());
    const predictor = new FakePredictor(new Map());
    await expect(buildTeachingLine(request, { engine, predictor }, { firstMove: 'e1e5' })).rejects.toThrow(/illegal/);
  });
});
