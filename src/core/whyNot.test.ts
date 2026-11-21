import { describe, expect, it } from 'vitest';
import type { Engine, Line, Score } from './engine';
import { Game, type Uci } from './game';
import type { HumanMovePredictor } from './opponent';
import type { MoveChecker, Position } from './session';
import { buildTeachingLine, type TeachingLine } from './teachingLine';
import { CoachingChecker, isClearlyWorse } from './whyNot';

// Nc7+ forks the king on e8 and the queen on a6.
const FORK = '4k3/7p/q7/1N6/8/8/7P/4K3 w - - 0 1';
const at = (...moves: Uci[]) => {
  const g = new Game(FORK);
  for (const m of moves) g.play(m);
  return g.fen;
};
const cp = (value: number): Score => ({ type: 'cp', value });
const mate = (value: number): Score => ({ type: 'mate', value });
const line = (score: Score, ...pv: Uci[]): Line => ({ move: pv[0]!, score, pv, depth: 12 });

// Stockfish and Maia, scripted. Kd2 lets the queen take the knight; h3 is nearly as good as
// Nc7+ by these (made-up) numbers.
const answers = new Map<string, Line[]>([
  [FORK, [line(cp(650), 'b5c7', 'e8d7', 'c7a6')]],
  [at('b5c7', 'e8d7'), [line(cp(700), 'c7a6', 'd7c6')]],
  [at('e1d2'), [line(cp(850), 'a6b5', 'h2h4')]],
  [at('e1d2', 'a6b5'), [line(cp(-850), 'h2h4')]],
  [at('h2h3'), [line(cp(-630), 'e8d8')]],
  [at('h2h3', 'e8d8'), [line(cp(630), 'b5d6')]],
]);
const engine: Engine = { analyse: async (fen) => answers.get(fen) ?? [] };
const replies = new Map<string, Uci>([
  [at('b5c7'), 'e8d7'],
  [at('b5c7', 'e8d7', 'c7a6'), 'd7c6'],
  [at('e1d2'), 'a6b5'],
  [at('h2h3'), 'e8d8'],
  [at('h2h3', 'e8d8', 'b5d6'), 'd8e7'],
]);
const predictor: HumanMovePredictor = { predict: async ({ fen }) => new Map([[replies.get(fen)!, 1]]) };

const request = { fen: FORK, moves: [] as Uci[], userElo: 1100, opponentElo: 1100 };
const hintLine = () => buildTeachingLine(request, { engine, predictor });
const position: Position = { fen: FORK, moves: [] };
const signal = () => new AbortController().signal;

function checker(hint: TeachingLine | null, blunders?: MoveChecker, deps = { engine, predictor }) {
  return new CoachingChecker(deps, {
    hint: () => hint,
    ...(blunders ? { blunders } : {}),
    request: { userColor: 'white', userElo: 1100, opponentElo: 1100 },
  });
}

describe('isClearlyWorse', () => {
  const withScore = (score: Score) => ({ plies: [], bestDefence: null, score }) as TeachingLine;
  it('needs half a pawn by default, comparing capped scores', () => {
    expect(isClearlyWorse(withScore(cp(100)), withScore(cp(60)))).toBe(false);
    expect(isClearlyWorse(withScore(cp(100)), withScore(cp(50)))).toBe(true);
    expect(isClearlyWorse(withScore(cp(1600)), withScore(cp(1200)))).toBe(false);
    expect(isClearlyWorse(withScore(cp(100)), withScore(cp(60)), 30)).toBe(true);
  });
  it('treats any mate as good enough when the hint mates, and giving up a mate as worse', () => {
    expect(isClearlyWorse(withScore(mate(2)), withScore(mate(5)))).toBe(false);
    expect(isClearlyWorse(withScore(mate(2)), withScore(cp(900)))).toBe(true);
    expect(isClearlyWorse(withScore(cp(0)), withScore(mate(-3)))).toBe(true);
  });
});

describe('CoachingChecker', () => {
  it('after a hint, explains why a clearly worse move is worse', async () => {
    const hint = await hintLine();
    const warning = await checker(hint).check(position, 'e1d2', signal());
    expect(warning).toEqual({
      kind: 'whyNot',
      steps: [
        'After Kd2, most players reply Qxb5, taking your knight.',
        'Overall you lose material worth about 3 pawns.',
        'Nc7+ was better: it forks the king and the queen.',
      ],
      better: { from: 'b5', to: 'c7', san: 'Nc7+' },
    });
  });

  it('lets a move through that is about as good as the hint, or is the hint', async () => {
    const hint = await hintLine();
    expect(await checker(hint).check(position, 'h2h3', signal())).toBeNull();
    expect(checker(hint).check(position, 'b5c7', signal())).toBeNull(); // at once: nothing to check
  });

  it('without a hint for this position, leaves it to the blunder check, if any', async () => {
    const hint = await hintLine();
    expect(checker(null).check(position, 'e1d2', signal())).toBeNull();
    const blunders: MoveChecker = { prepare: () => {}, check: async () => ({ kind: 'blunder', text: 'Careful!' }) };
    expect(await checker(null, blunders).check(position, 'e1d2', signal())).toEqual({ kind: 'blunder', text: 'Careful!' });
    // A hint for another position doesn't count.
    expect(checker(hint).check({ fen: at('h2h3', 'e8d8'), moves: ['h2h3', 'e8d8'] }, 'b5d6', signal())).toBeNull();
  });

  it('falls back on the blunder check if the explanation fails', async () => {
    const hint = await hintLine();
    const broken: Engine = { analyse: () => Promise.reject(new Error('engine crashed')) };
    const blunders: MoveChecker = { prepare: () => {}, check: async () => ({ kind: 'blunder', text: 'Careful!' }) };
    const c = checker(hint, blunders, { engine: broken, predictor });
    expect(await c.check(position, 'e1d2', signal())).toEqual({ kind: 'blunder', text: 'Careful!' });
    expect(await checker(hint, undefined, { engine: broken, predictor }).check(position, 'e1d2', signal())).toBeNull();
  });

  it('passes prepare on to the blunder check', () => {
    const prepared: string[] = [];
    const blunders: MoveChecker = { prepare: (fen) => void prepared.push(fen), check: async () => null };
    checker(null, blunders).prepare(FORK);
    expect(prepared).toEqual([FORK]);
  });
});

describe('CoachingChecker in a quiet position (the hint has no tactic)', () => {
  // Qd2 is the hint, for no particular reason. Qd3 is a bit worse; Qc2 a lot worse.
  const QUIET = '4k3/8/4p3/8/8/8/8/3QK3 w - - 0 1';
  const from = (...moves: Uci[]) => {
    const g = new Game(QUIET);
    for (const m of moves) g.play(m);
    return g.fen;
  };
  const quietAnswers = new Map<string, Line[]>([
    [QUIET, [line(cp(120), 'd1d2', 'e8e7', 'd2d3')]],
    [from('d1d2', 'e8e7'), [line(cp(120), 'd2d3')]],
    [from('d1d3'), [line(cp(-20), 'e8e7')]],
    [from('d1d3', 'e8e7'), [line(cp(20), 'd3d4')]],
    [from('d1c2'), [line(cp(150), 'e8e7')]],
    [from('d1c2', 'e8e7'), [line(cp(-150), 'c2c3')]],
  ]);
  const quietEngine: Engine = { analyse: async (fen) => quietAnswers.get(fen) ?? [] };
  const quietPredictor: HumanMovePredictor = { predict: async () => new Map([['e8e7', 1]]) };
  const deps = { engine: quietEngine, predictor: quietPredictor };
  const here: Position = { fen: QUIET, moves: [] };

  it('lets a slightly worse move through when there is nothing concrete to say', async () => {
    const hint = await buildTeachingLine({ ...request, fen: QUIET }, deps);
    expect(await checker(hint, undefined, deps).check(here, 'd1d3', signal())).toBeNull(); // 1 pawn worse
  });

  it('still stops a move that loses as much as a blunder, even without a concrete reason', async () => {
    const hint = await buildTeachingLine({ ...request, fen: QUIET }, deps);
    expect(await checker(hint, undefined, deps).check(here, 'd1c2', signal())).toEqual({
      kind: 'whyNot',
      steps: ['After Qc2, most players reply Ke7.', 'Qd2 was better: Stockfish rates it about 3 pawns higher.'],
      better: { from: 'd1', to: 'd2', san: 'Qd2' },
    });
  });
});
