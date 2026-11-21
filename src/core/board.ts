// A minimal board for tactics: who attacks what, and who wins an exchange. chess.js knows the
// rules but can't answer "who attacks this square once these pieces have gone", which
// exchanges need (a rook behind a rook joins in once the front one has captured).
import { Chess } from 'chess.js';
import type { Color, Square } from './game';

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Piece = { color: Color; type: PieceType };

/**
 * Centipawn values used for material and exchanges. The king's value only matters inside an
 * exchange (it can never actually be captured), so it's simply larger than everything else.
 */
export const PIECE_VALUES: Readonly<Record<PieceType, number>> = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 20_000 };

export const otherColor = (c: Color): Color => (c === 'white' ? 'black' : 'white');

const FILES = 'abcdefgh';
const toXY = (sq: Square): [number, number] => [FILES.indexOf(sq[0]!), Number(sq[1]) - 1];
const toSquare = (x: number, y: number): Square | null =>
  x >= 0 && x < 8 && y >= 0 && y < 8 ? `${FILES[x]}${y + 1}` : null;

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
const ROOK_DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
const BISHOP_DIRS = [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const;

export class Board {
  private constructor(private readonly pieces: ReadonlyMap<Square, Piece>) {}

  static fromFen(fen: string): Board {
    const pieces = new Map<Square, Piece>();
    for (const row of new Chess(fen).board()) {
      for (const p of row) if (p) pieces.set(p.square, { color: p.color === 'w' ? 'white' : 'black', type: p.type });
    }
    return new Board(pieces);
  }

  get(square: Square): Piece | undefined {
    return this.pieces.get(square);
  }

  /** Every occupied square with its piece. */
  entries(): [Square, Piece][] {
    return [...this.pieces];
  }

  /**
   * Squares the piece on `from` attacks (including squares holding pieces of either colour).
   * `gone` lists squares to treat as empty, so sliding pieces see through them.
   */
  attacksFrom(from: Square, gone: ReadonlySet<Square> = new Set()): Square[] {
    const piece = this.pieces.get(from);
    if (!piece) return [];
    const [x, y] = toXY(from);
    const steps = (offsets: readonly (readonly [number, number])[]) =>
      offsets.map(([dx, dy]) => toSquare(x + dx, y + dy)).filter((s): s is Square => s !== null);
    const rays = (dirs: readonly (readonly [number, number])[]) => {
      const out: Square[] = [];
      for (const [dx, dy] of dirs) {
        for (let i = 1; ; i++) {
          const sq = toSquare(x + dx * i, y + dy * i);
          if (!sq) break;
          out.push(sq);
          if (this.pieces.has(sq) && !gone.has(sq)) break; // blocked (the blocker itself is attacked)
        }
      }
      return out;
    };
    switch (piece.type) {
      case 'p': {
        const dy = piece.color === 'white' ? 1 : -1;
        return steps([[-1, dy], [1, dy]]);
      }
      case 'n':
        return steps(KNIGHT);
      case 'k':
        return steps(KING);
      case 'b':
        return rays(BISHOP_DIRS);
      case 'r':
        return rays(ROOK_DIRS);
      case 'q':
        return rays([...ROOK_DIRS, ...BISHOP_DIRS]);
    }
  }

  /** Squares of `color`'s pieces that attack `target`, ignoring pieces on `gone` squares. */
  attackers(target: Square, color: Color, gone: ReadonlySet<Square> = new Set()): Square[] {
    const out: Square[] = [];
    for (const [sq, piece] of this.pieces) {
      if (piece.color !== color || gone.has(sq) || sq === target) continue;
      if (this.attacksFrom(sq, gone).includes(target)) out.push(sq);
    }
    return out;
  }

  /**
   * Static exchange evaluation: what `side` gains, in centipawns, by starting a capture
   * sequence on `target`. Each side captures with its cheapest piece and may stop whenever
   * carrying on would lose more. Null if `side` has no piece that can capture there.
   *
   * Simplifications, as usual for SEE: pins and en passant are ignored. A king only captures
   * on a square the other side no longer defends.
   */
  see(target: Square, side: Color): number | null {
    const first = this.cheapestAttacker(target, side, new Set());
    return first ? this.exchange(target, first, new Set()) : null;
  }

  /** Like `see`, but the first capture is made by the piece on `from`. Null if it can't capture. */
  seeCapture(from: Square, target: Square): number | null {
    const piece = this.pieces.get(from);
    if (!piece || !this.attacksFrom(from).includes(target)) return null;
    if (piece.type === 'k' && this.attackers(target, otherColor(piece.color), new Set([from])).length > 0) return null;
    return this.exchange(target, from, new Set());
  }

  private cheapestAttacker(target: Square, side: Color, gone: ReadonlySet<Square>): Square | null {
    const candidates = this.attackers(target, side, gone).sort(
      (a, b) => PIECE_VALUES[this.pieces.get(a)!.type] - PIECE_VALUES[this.pieces.get(b)!.type],
    );
    for (const sq of candidates) {
      if (this.pieces.get(sq)!.type !== 'k') return sq;
      // The king may only capture if nothing would recapture (it can't move into check).
      const after = new Set(gone).add(sq);
      if (this.attackers(target, otherColor(side), after).length === 0) return sq;
    }
    return null;
  }

  private exchange(target: Square, firstFrom: Square, gone: Set<Square>): number {
    const victim = this.pieces.get(target);
    // gains[d]: what the side making capture d has gained so far, if the sequence stops there.
    const gains = [victim ? PIECE_VALUES[victim.type] : 0];
    let onSquare = PIECE_VALUES[this.pieces.get(firstFrom)!.type];
    gone.add(firstFrom);
    let side = otherColor(this.pieces.get(firstFrom)!.color);
    for (;;) {
      const next = this.cheapestAttacker(target, side, gone);
      if (!next) break;
      gains.push(onSquare - gains.at(-1)!);
      onSquare = PIECE_VALUES[this.pieces.get(next)!.type];
      gone.add(next);
      side = otherColor(side);
    }
    // Work backwards: each side either recaptures or stops, whichever is better for it.
    for (let d = gains.length - 1; d > 0; d--) gains[d - 1] = -Math.max(-gains[d - 1]!, gains[d]!);
    return gains[0]!;
  }
}

/** Material on the board, White minus Black, in centipawns (kings excluded). */
export function materialBalance(board: Board): number {
  let total = 0;
  for (const [, piece] of board.entries()) {
    if (piece.type === 'k') continue;
    total += (piece.color === 'white' ? 1 : -1) * PIECE_VALUES[piece.type];
  }
  return total;
}
