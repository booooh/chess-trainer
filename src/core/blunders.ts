// Blunder warning (DESIGN §5.4): decides whether a move the user is about to play is a
// blunder, as typed facts. The narrator turns them into the warning text (ADR-0004).
import type { Piece } from './board';
import type { Score } from './engine';
import { moveFacts, scoreToCp } from './facts';
import { Game, type DrawReason, type Square, type Uci } from './game';

export type Blunder =
  /** After the move, the opponent has a forced mate in `inMoves`. */
  | { kind: 'allowsMate'; inMoves: number }
  /** The user had a forced mate in `inMoves` and this move gives it up. */
  | { kind: 'missesMate'; inMoves: number }
  /** The move ends the game in a draw although the user stood better. */
  | { kind: 'draws'; reason: DrawReason }
  /** The move leaves `piece` on `square` to be won, and loses `lossCp` versus the best move. */
  | { kind: 'hangs'; piece: Piece; square: Square; lossCp: number }
  /** The move loses `lossCp` versus the best move. */
  | { kind: 'loses'; lossCp: number };

export type AssessOptions = {
  /** Smallest loss versus the best move that counts as a blunder. Default 200 (two pawns). */
  lossThresholdCp?: number;
  /** Smallest loss at which a newly hanging piece counts. Default 100. */
  hangingLossCp?: number;
  /** Only warn about missing a mate this short, which a player can be expected to see. Default 3. */
  missedMateMaxMoves?: number;
};

/**
 * Scores beyond this are "winning" or "lost" whatever the number: going from +15 to +11
 * pawns is not a blunder worth interrupting for.
 */
const CAP_CP = 1000;
const capped = (cp: number) => Math.max(-CAP_CP, Math.min(CAP_CP, cp));

/**
 * Is playing `uci` in `fen` a blunder? `best` is the engine's score of `fen` (the mover's
 * view, i.e. what the best move achieves); `reply` is its score after the move, from the
 * opponent's view as Stockfish reports it, or null if the move ends the game.
 *
 * In order: allowing a forced mate, ending the game in a draw from a better position,
 * missing a short forced mate, leaving a piece to be won, then any big enough loss.
 */
export function assessMove(
  fen: string,
  uci: Uci,
  best: Score,
  reply: Score | null,
  { lossThresholdCp = 200, hangingLossCp = 100, missedMateMaxMoves = 3 }: AssessOptions = {},
): Blunder | null {
  const bestCp = capped(scoreToCp(best));

  if (reply === null) {
    const game = new Game(fen);
    game.play(uci);
    const status = game.status;
    if (status.kind !== 'draw') return null; // checkmate: the best possible move
    return bestCp >= lossThresholdCp ? { kind: 'draws', reason: status.reason } : null;
  }

  const alreadyMated = best.type === 'mate' && best.value <= 0;
  if (reply.type === 'mate' && reply.value > 0 && !alreadyMated) return { kind: 'allowsMate', inMoves: reply.value };

  const keepsMate = reply.type === 'mate' && reply.value <= 0;
  if (best.type === 'mate' && best.value > 0 && best.value <= missedMateMaxMoves && !keepsMate) {
    return { kind: 'missesMate', inMoves: best.value };
  }

  const lossCp = bestCp - capped(-scoreToCp(reply));
  const mover = new Game(fen).turn;
  if (lossCp >= hangingLossCp) {
    for (const f of moveFacts(fen, uci)) {
      if (f.kind === 'hanging' && f.piece.color === mover) return { kind: 'hangs', piece: f.piece, square: f.square, lossCp };
    }
  }
  return lossCp >= lossThresholdCp ? { kind: 'loses', lossCp } : null;
}
