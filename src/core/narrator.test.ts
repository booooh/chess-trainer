import { describe, expect, it } from 'vitest';
import type { Score } from './engine';
import { moveFacts } from './facts';
import { Game, type Uci } from './game';
import { narrate } from './narrator';
import type { TeachingLine, TeachingPly } from './teachingLine';

/** Plays `moves` from `fen`, alternating you/opponent, with the real facts on each ply. */
function plies(fen: string, moves: Uci[], firstSide: TeachingPly['side'] = 'you'): TeachingPly[] {
  const game = new Game(fen);
  return moves.map((uci, i) => {
    const fenBefore = game.fen;
    const facts = moveFacts(fenBefore, uci);
    const { san } = game.play(uci);
    const side = i % 2 === 0 ? firstSide : firstSide === 'you' ? 'opponent' : 'you';
    return { uci, san, side, fenBefore, facts };
  });
}

function teachingLine(fen: string, moves: Uci[], score: Score, bestDefence?: Uci[]): TeachingLine {
  const main = plies(fen, moves);
  let defence: TeachingLine['bestDefence'] = null;
  if (bestDefence) {
    const g = new Game(fen);
    g.play(moves[0]!);
    defence = { plies: plies(g.fen, bestDefence, 'opponent') };
  }
  return { plies: main, bestDefence: defence, score };
}

const cp = (value: number): Score => ({ type: 'cp', value });

// Nc7+ forks the king on e8 and the queen on a6.
const QUEEN_FORK = '4k3/7p/q7/1N6/8/8/7P/4K3 w - - 0 1';

describe('narrate', () => {
  const fork = teachingLine(QUEEN_FORK, ['b5c7', 'e8d7', 'c7a6', 'd7c6'], cp(650), ['e8e7', 'c7a6']);
  const hint = narrate(fork, { fen: QUEEN_FORK, userColor: 'white' });

  it('level 1 names the kind of moment', () => {
    expect(hint.nudge).toBe('There’s a fork here.');
  });

  it('level 2 points at the piece, level 3 gives the move', () => {
    expect(hint.piece).toEqual({ square: 'b5', text: 'Look at your knight on b5.' });
    expect(hint.move).toEqual({ from: 'b5', to: 'c7', text: 'Play Nc7+.' });
  });

  it('level 4 explains the line step by step, mentioning the fork and what it wins', () => {
    expect(hint.explanation).toEqual([
      'Nc7+ is a fork: the knight attacks the king and the queen at the same time.',
      'Most players reply Kd7.',
      'Then Nxa6 wins the queen.',
      'Then Kc6.',
      'Overall you win material worth about 9 pawns.',
      'The best defence is Ke7, then Nxa6.',
    ]);
  });

  it('says the best reply when the likely reply is also the best', () => {
    const line = teachingLine(QUEEN_FORK, ['b5c7', 'e8d7', 'c7a6', 'd7c6'], cp(650));
    expect(narrate(line, { fen: QUEEN_FORK, userColor: 'white' }).explanation[1]).toBe('The best reply is Kd7.');
  });

  it('only claims material when the engine agrees', () => {
    // Same moves, but Stockfish says it's equal (e.g. the knight gets trapped later).
    const line = teachingLine(QUEEN_FORK, ['b5c7', 'e8d7', 'c7a6', 'd7c6'], cp(10));
    const text = narrate(line, { fen: QUEEN_FORK, userColor: 'white' }).explanation.join(' ');
    expect(text).not.toMatch(/Overall you win/);
  });

  it('announces a mate in one, and says it is checkmate', () => {
    const fen = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
    const hint = narrate(teachingLine(fen, ['d1d8'], { type: 'mate', value: 1 }), { fen, userColor: 'white' });
    expect(hint.nudge).toBe('You can checkmate in one move.');
    expect(hint.explanation).toEqual(['Rd8# is checkmate.']);
  });

  it('announces a longer forced mate', () => {
    const fen = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
    const hint = narrate(teachingLine(fen, ['g1f1'], { type: 'mate', value: 3 }), { fen, userColor: 'white' });
    expect(hint.nudge).toBe('There’s a forced checkmate in 3 moves.');
  });

  it("warns about the user's own hanging piece", () => {
    // Black's bishop on c5 attacks White's undefended knight on d4.
    const fen = '4k3/8/8/2b5/3N4/8/8/4K3 w - - 0 1';
    const hint = narrate(teachingLine(fen, ['d4b3', 'c5d4', 'b3d4'], cp(0)), { fen, userColor: 'white' });
    expect(hint.nudge).toBe('Your knight on d4 is under attack.');
  });

  it('works for Black too, naming captured pieces from the right side', () => {
    // Black to move: the bishop on d5 can take the undefended knight on g2.
    const fen = '4k3/7p/8/3b4/8/8/6N1/4K3 b - - 0 1';
    const hint = narrate(teachingLine(fen, ['d5g2', 'e1f2', 'g2d5'], cp(300)), { fen, userColor: 'black' });
    expect(hint.nudge).toBe('You can win material.');
    expect(hint.explanation[0]).toBe('Bxg2 takes the knight.');
    expect(hint.piece.text).toBe('Look at your bishop on d5.');
  });

  it('suggests improving the position when there is no tactic', () => {
    const fen = '4k3/7p/8/8/8/8/7P/R3K3 w - - 0 1';
    const hint = narrate(teachingLine(fen, ['a1a7', 'e8d8', 'a7h7'], cp(500)), { fen, userColor: 'white' });
    expect(hint.nudge).toBe('No tactic here: look for a move that improves your position.');
    expect(hint.explanation[0]).toBe('Play Ra7.');
  });
});
