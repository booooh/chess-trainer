// The facts extractor (DESIGN §5.3, ADR-0004): deterministic, typed facts about a position or
// a move, which narrators (templates now, LLMs later) turn into words. Correctness lives
// here, so a narrator can only rephrase, never invent.
import { Board, materialBalance, otherColor, PIECE_VALUES, type Piece } from './board';
import type { Score } from './engine';
import { Game, type Square, type Uci } from './game';

export type Fact =
  /** `piece` can be won: its opponent gains `gainCp` by starting the exchange on `square`. */
  | { kind: 'hanging'; piece: Piece; square: Square; gainCp: number }
  /**
   * The piece that just moved to `square` attacks two or more `targets` it could win (or the
   * king), most valuable first. A king among the targets means the fork comes with check.
   */
  | { kind: 'fork'; by: Piece; square: Square; targets: Square[] }
  /** Material won (positive) or lost by the side that moved, in centipawns. */
  | { kind: 'materialChange'; deltaCp: number }
  /** The engine's verdict before and after the move, from the mover's point of view. */
  | { kind: 'evalSwing'; fromCp: number; toCp: number };

/** Mate scores become ±MATE_CP, minus the moves to mate, so nearer mates count for more. */
export const MATE_CP = 10_000;

export function scoreToCp(score: Score): number {
  if (score.type === 'cp') return score.value;
  // mate > 0: the side to move mates. mate <= 0: it gets mated (0 means it already is).
  return score.value > 0 ? MATE_CP - score.value : -MATE_CP - score.value;
}

/** Pieces (not kings) that the opponent can win now, most valuable first. Both colours. */
export function hangingPieces(fen: string): Fact[] {
  return hangingOn(Board.fromFen(fen));
}

function hangingOn(board: Board): Extract<Fact, { kind: 'hanging' }>[] {
  const facts: Extract<Fact, { kind: 'hanging' }>[] = [];
  for (const [square, piece] of board.entries()) {
    if (piece.type === 'k') continue;
    const gainCp = board.see(square, otherColor(piece.color));
    if (gainCp !== null && gainCp > 0) facts.push({ kind: 'hanging', piece, square, gainCp });
  }
  return facts.sort((a, b) => b.gainCp - a.gainCp || a.square.localeCompare(b.square));
}

export type MoveFactsOptions = {
  /** Smallest change in evaluation worth mentioning. Default 100 (about a pawn). */
  swingThresholdCp?: number;
};

/**
 * Facts about playing `uci` in the position `fen`, in a fixed order: material change, fork,
 * pieces the move leaves hanging (either side's, if they weren't hanging before), eval swing.
 *
 * `evals` are the engine's scores before and after the move. Each is from the point of view
 * of whoever is to move in that position (as Stockfish reports them), so `after` is the
 * opponent's view; the fact is converted to the mover's.
 *
 * Throws IllegalMoveError if the move isn't legal.
 */
export function moveFacts(
  fen: string,
  uci: Uci,
  evals?: { before: Score; after: Score },
  { swingThresholdCp = 100 }: MoveFactsOptions = {},
): Fact[] {
  const game = new Game(fen);
  const mover = game.turn;
  game.play(uci);
  const before = Board.fromFen(fen);
  const after = Board.fromFen(game.fen);
  const facts: Fact[] = [];

  const sign = mover === 'white' ? 1 : -1;
  const deltaCp = sign * (materialBalance(after) - materialBalance(before));
  if (deltaCp !== 0) facts.push({ kind: 'materialChange', deltaCp });

  const fork = forkBy(after, uci.slice(2, 4));
  if (fork) facts.push(fork);

  const wasHanging = new Set(hangingOn(before).map((f) => `${f.square}${f.piece.color}${f.piece.type}`));
  for (const f of hangingOn(after)) if (!wasHanging.has(`${f.square}${f.piece.color}${f.piece.type}`)) facts.push(f);

  if (evals) {
    const fromCp = scoreToCp(evals.before);
    const toCp = -scoreToCp(evals.after);
    if (Math.abs(toCp - fromCp) >= swingThresholdCp) facts.push({ kind: 'evalSwing', fromCp, toCp });
  }
  return facts;
}

/**
 * A fork by the piece on `square`: it attacks at least two targets, where a target is the
 * enemy king or a non-pawn piece it would win material by taking. If the forking piece can
 * itself be won (e.g. a knight check the queen just takes), it isn't a fork.
 */
function forkBy(board: Board, square: Square): Extract<Fact, { kind: 'fork' }> | null {
  const by = board.get(square);
  if (!by) return null;
  const enemy = otherColor(by.color);
  if ((board.see(square, enemy) ?? 0) > 0) return null;

  const targets = board.attacksFrom(square).filter((sq) => {
    const piece = board.get(sq);
    if (!piece || piece.color !== enemy) return false;
    if (piece.type === 'k') return true;
    return piece.type !== 'p' && (board.seeCapture(square, sq) ?? 0) > 0;
  });
  if (targets.length < 2) return null;
  const value = (sq: Square) => PIECE_VALUES[board.get(sq)!.type];
  targets.sort((a, b) => value(b) - value(a) || a.localeCompare(b));
  return { kind: 'fork', by, square, targets };
}
